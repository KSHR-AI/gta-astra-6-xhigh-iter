import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhotoActorVisibility } from '../src/photo-actor-visibility.js';

function actor(visible = false) {
  const mesh = new THREE.Group(); mesh.visible = visible;
  mesh.position.set(66, 0, -54);
  return { mesh, advance() { assert.fail('Photo visibility must not advance animation'); },
    update() { assert.fail('Photo visibility must not update simulation'); },
    flushPose() { assert.fail('Photo visibility must not evaluate a pose'); },
    updateLOD() { assert.fail('The existing presentation pass owns LOD'); } };
}

function setup(pedestrians = [], vehicles = []) {
  return { pedestrians, vehicles, controller: createPhotoActorVisibility({ pedestrians, vehicles }) };
}

test('A distant pedestrian becomes available to the free camera without advancing or moving it', () => {
  const subject = actor(), state = { actor: subject, down: false, recoverAt: 0, fleeUntil: 17 };
  subject.mesh.rotation.y = .7; subject.mesh.userData.animationState = 'walking';
  const position = subject.mesh.position.clone(), rotation = subject.mesh.quaternion.clone();
  const { controller } = setup([state]);
  controller.update(); assert.equal(subject.mesh.visible, false);
  controller.enter();
  for (let frame = 0; frame < 10; frame++) controller.update();
  assert.equal(subject.mesh.visible, true);
  assert.ok(subject.mesh.position.equals(position));
  assert.ok(subject.mesh.quaternion.equals(rotation));
  assert.equal(subject.mesh.userData.animationState, 'walking');
  assert.equal(state.fleeUntil, 17);
  assert.deepEqual(controller.getInfo(), { active: true, trackedActors: 1, revealedActors: 1, disposed: false });
  controller.exit(); assert.equal(subject.mesh.visible, false);
});

test('Corpses and active disabled occupants keep their frozen state while inactive drivers stay hidden', () => {
  const corpse = actor(), seated = actor(), inactive = actor();
  const pedestrian = { actor: corpse, down: true, recoverAt: 50 };
  const car = { driver: seated, driverActive: true, driverDownUntil: 50 };
  const { controller } = setup([pedestrian], [car, { driver: inactive, driverActive: false }]);
  controller.enter();
  assert.equal(corpse.mesh.visible, true); assert.equal(seated.mesh.visible, true);
  assert.equal(inactive.mesh.visible, false);
  assert.equal(pedestrian.down, true); assert.equal(pedestrian.recoverAt, 50);
  assert.equal(car.driverDownUntil, 50);
  controller.exit();
  assert.equal(corpse.mesh.visible, false); assert.equal(seated.mesh.visible, false);
});

test('Player, mission contact and undeployed officers are outside ambient visibility ownership', () => {
  const subject = actor(), player = actor(), contact = actor(), officer = actor();
  const { controller } = setup([{ actor: subject }]);
  controller.enter(); controller.update(); controller.exit();
  for (const excluded of [player, contact, officer]) assert.equal(excluded.mesh.visible, false);
});

test('Driver-to-pedestrian handoff and duplicate records cannot replace the original snapshot', () => {
  const driver = actor(), car = { driver, driverActive: true };
  const { controller, pedestrians } = setup([], [car]);
  controller.enter();
  pedestrians.push({ actor: driver, down: true }, { actor: driver });
  controller.update();
  assert.equal(controller.getInfo().trackedActors, 1);
  car.driverActive = false; controller.update();
  assert.equal(driver.mesh.visible, true);
  controller.exit(); assert.equal(driver.mesh.visible, false);
});

test('Paused driver distance writes are reapplied without changing the gameplay snapshot', () => {
  const hiddenDriver = actor(false), visibleDriver = actor(true);
  const { controller } = setup([], [hiddenDriver, visibleDriver].map(driver => ({ driver, driverActive: true })));
  controller.enter();
  hiddenDriver.mesh.visible = false; visibleDriver.mesh.visible = false;
  controller.update();
  assert.equal(hiddenDriver.mesh.visible, true); assert.equal(visibleDriver.mesh.visible, true);
  controller.enter(); // Duplicate UI entry must not snapshot the override.
  controller.exit();
  assert.equal(hiddenDriver.mesh.visible, false); assert.equal(visibleDriver.mesh.visible, true);
});

test('Exit restores mixed gameplay flags immediately, including an already-paused session', () => {
  const hidden = actor(false), visible = actor(true);
  const { controller } = setup([{ actor: hidden }, { actor: visible }]);
  controller.enter(); controller.exit();
  assert.equal(hidden.mesh.visible, false); assert.equal(visible.mesh.visible, true);
  assert.deepEqual(controller.getInfo(), { active: false, trackedActors: 0, revealedActors: 0, disposed: false });
  hidden.mesh.visible = true; visible.mesh.visible = false;
  controller.enter(); controller.exit(); controller.exit(); controller.update();
  assert.equal(hidden.mesh.visible, true); assert.equal(visible.mesh.visible, false);
});

test('Removed pedestrians and deactivated drivers retain their lifecycle visibility on update and exit', () => {
  for (const runUpdate of [false, true]) {
    const pedestrian = actor(true), driver = actor(true), car = { driver, driverActive: true };
    const { controller, pedestrians } = setup([{ actor: pedestrian }], [car]);
    controller.enter();
    pedestrians.length = 0; car.driverActive = false;
    pedestrian.mesh.visible = false; driver.mesh.visible = false;
    if (runUpdate) controller.update();
    controller.exit();
    assert.equal(pedestrian.mesh.visible, false); assert.equal(driver.mesh.visible, false);
  }
});

test('A removed actor reintroduced during photo gets its current lifecycle snapshot', () => {
  const subject = actor(true), record = { actor: subject };
  const { controller, pedestrians } = setup([record]);
  controller.enter(); pedestrians.length = 0; subject.mesh.visible = false; controller.update();
  assert.equal(controller.getInfo().trackedActors, 0);
  pedestrians.push(record); controller.update();
  assert.equal(subject.mesh.visible, true);
  assert.equal(controller.getInfo().revealedActors, 1);
  controller.exit(); assert.equal(subject.mesh.visible, false);
});

test('New actors are snapshotted on their first photo presentation', () => {
  const first = actor(false), second = actor(true), third = actor(false);
  const { controller, pedestrians, vehicles } = setup([{ actor: first }]);
  controller.enter();
  pedestrians.push({ actor: second }); vehicles.push({ driver: third, driverActive: true });
  controller.update();
  assert.equal(second.mesh.visible, true); assert.equal(third.mesh.visible, true);
  assert.equal(controller.getInfo().trackedActors, 3);
  controller.exit();
  assert.equal(first.mesh.visible, false); assert.equal(second.mesh.visible, true); assert.equal(third.mesh.visible, false);
});

test('Native frustum bounds, child visibility, geometry and material state stay untouched', () => {
  const subject = actor(), child = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  child.visible = false; child.frustumCulled = true; child.castShadow = true;
  child.geometry.computeBoundingSphere(); subject.mesh.add(child);
  const geometry = child.geometry, material = child.material, bounds = geometry.boundingSphere.clone();
  const { controller } = setup([{ actor: subject }]);
  controller.enter(); controller.update(); controller.exit();
  assert.equal(child.visible, false); assert.equal(child.frustumCulled, true); assert.equal(child.castShadow, true);
  assert.equal(child.geometry, geometry); assert.equal(child.material, material);
  assert.ok(child.geometry.boundingSphere.equals(bounds));
  assert.equal(material.colorWrite, true); assert.equal(material.depthWrite, true);
  geometry.dispose(); material.dispose();
});

test('Disposal restores once, diagnostics are copies, and a disposed controller cannot reveal actors', () => {
  const subject = actor(), { controller } = setup([{ actor: subject }]);
  controller.enter(); const info = controller.getInfo(); info.revealedActors = 50;
  assert.equal(controller.getInfo().revealedActors, 1);
  controller.dispose(); assert.equal(subject.mesh.visible, false);
  subject.mesh.visible = true;
  controller.dispose(); controller.enter(); controller.update(); controller.exit();
  assert.equal(subject.mesh.visible, true);
  assert.deepEqual(controller.getInfo(), { active: false, trackedActors: 0, revealedActors: 0, disposed: true });
});
