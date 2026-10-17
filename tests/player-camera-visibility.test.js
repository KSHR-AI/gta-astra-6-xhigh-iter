import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPlayerCameraVisibility } from '../src/player-camera-visibility.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} should be near ${expected}`);

function fixture(material = new THREE.MeshStandardMaterial()) {
  const root = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.5, .3), material);
  root.add(body);
  const camera = new THREE.PerspectiveCamera();
  const at = distance => { camera.position.set(distance, 1.48, 0); return camera; };
  return { root, body, camera, at, material };
}

test('A close camera masks only private player material writes and leaves the NPC shared pistol intact', () => {
  const original = new THREE.MeshStandardMaterial({ opacity: .65, transparent: true, depthTest: false });
  const f = fixture(original), npcPistol = new THREE.Mesh(new THREE.BoxGeometry(), original);
  f.body.castShadow = true; f.body.visible = false; original.visible = false;
  const controller = createPlayerCameraVisibility(f.root), privateMaterial = f.body.material;
  assert.notEqual(privateMaterial, original);
  controller.update(f.at(.3));
  assert.equal(controller.getState().hidden, true);
  assert.equal(privateMaterial.colorWrite, false);
  assert.equal(privateMaterial.depthWrite, false);
  assert.equal(npcPistol.material, original);
  assert.equal(original.colorWrite, true);
  assert.equal(original.depthWrite, true);
  assert.equal(f.body.visible, false);
  assert.equal(f.body.castShadow, true);
  assert.equal(privateMaterial.visible, false);
  assert.equal(privateMaterial.opacity, .65);
  assert.equal(privateMaterial.depthTest, false);
  controller.update(f.at(1));
  assert.equal(controller.getState().hidden, false);
  assert.equal(privateMaterial.colorWrite, true);
  assert.equal(privateMaterial.depthWrite, true);
  assert.equal(privateMaterial.opacity, .65);
  assert.equal(privateMaterial.depthTest, false);
  controller.dispose();
});

test('Mesh material arrays, lines, and points share deduplicated private clones without cloning geometry or textures', () => {
  const root = new THREE.Group(), texture = new THREE.Texture();
  const shared = new THREE.MeshBasicMaterial({ map: texture }), detail = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
  const geometry = new THREE.BoxGeometry();
  const originalArray = [shared, detail, shared];
  const body = new THREE.Mesh(geometry, originalArray), line = new THREE.Line(geometry, shared), points = new THREE.Points(geometry, detail);
  root.add(body, line, points);
  const controller = createPlayerCameraVisibility(root);
  assert.notEqual(body.material, originalArray);
  assert.equal(body.material[0], body.material[2]);
  assert.equal(body.material[0], line.material);
  assert.equal(body.material[1], points.material);
  assert.notEqual(body.material[0], shared);
  assert.notEqual(body.material[1], detail);
  assert.equal(controller.getState().materialCount, 2);
  for (const object of [body, line, points]) assert.equal(object.geometry, geometry);
  assert.equal(body.material[0].map, texture);
  assert.equal(body.material[1].map, texture);
  controller.dispose();
  assert.equal(body.material, originalArray);
  assert.equal(line.material, shared);
  assert.equal(points.material, detail);
});

test('Private materials preserve authored shader callbacks and their program cache key', () => {
  const f = fixture();
  const compile = shader => { shader.fragmentShader = 'authored-face-shader'; };
  const beforeRender = () => 'authored-render-callback';
  const cacheKey = () => 'natural-human-custom-program';
  f.material.onBeforeCompile = compile;
  f.material.onBeforeRender = beforeRender;
  f.material.customProgramCacheKey = cacheKey;
  const controller = createPlayerCameraVisibility(f.root);
  assert.equal(f.body.material.onBeforeCompile, compile);
  assert.equal(f.body.material.onBeforeRender, beforeRender);
  assert.equal(f.body.material.customProgramCacheKey, cacheKey);
  const shader = { fragmentShader: '' }; f.body.material.onBeforeCompile(shader);
  assert.equal(shader.fragmentShader, 'authored-face-shader');
  assert.equal(f.body.material.customProgramCacheKey(), 'natural-human-custom-program');
  controller.dispose();
});

test('Hysteresis changes at the strict thresholds and restores each authored write flag without material-version churn', () => {
  const f = fixture(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true }));
  const translucent = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ depthWrite: false }));
  f.root.add(translucent);
  const controller = createPlayerCameraVisibility(f.root);
  const materials = [f.body.material, translucent.material], versions = materials.map(material => material.version);
  controller.update(f.at(.55));
  assert.equal(controller.getState().hidden, false);
  controller.update(f.at(.54));
  assert.equal(controller.getState().hidden, true);
  controller.update(f.at(.75));
  assert.equal(controller.getState().hidden, true);
  controller.update(f.at(.751));
  assert.equal(controller.getState().hidden, false);
  assert.deepEqual(materials.map(material => [material.colorWrite, material.depthWrite]), [[false, true], [true, false]]);
  for (let i = 0; i < 20; i++) {
    controller.update(f.at(.2)); controller.update(f.at(.2));
    controller.update(f.at(1)); controller.update(f.at(1));
  }
  assert.deepEqual(materials.map(material => material.version), versions, 'Write masks must not recompile materials');
  controller.dispose();
});

test('Contact-shadow subtrees retain their original materials and write behavior', () => {
  const f = fixture(), shadow = new THREE.Group(); shadow.name = 'contact-shadow';
  const shadowMaterial = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(), shadowMaterial), nested = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry(), shadowMaterial);
  shadow.add(plane, nested); nested.add(line); f.root.add(shadow);
  const controller = createPlayerCameraVisibility(f.root);
  assert.equal(controller.getState().materialCount, 1);
  controller.update(f.at(.1));
  assert.equal(plane.material, shadowMaterial);
  assert.equal(line.material, shadowMaterial);
  assert.equal(shadowMaterial.colorWrite, true);
  assert.equal(shadowMaterial.depthWrite, false);
  assert.equal(shadow.visible, true);
  controller.dispose();
  assert.equal(plane.material, shadowMaterial);
});

test('Camera masking leaves body transforms, weapon muzzle positions, visibility, and shadows unchanged', () => {
  const f = fixture(), hand = new THREE.Group(), pistol = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, .024, .202);
  hand.position.set(-.3, 1.3, .4); hand.rotation.set(.1, .3, -.2); hand.add(pistol); pistol.add(muzzle); f.root.add(hand);
  f.root.position.set(4, 0, -6); f.root.rotation.y = .7;
  f.body.castShadow = true; pistol.castShadow = true;
  const before = muzzle.getWorldPosition(new THREE.Vector3());
  const transforms = [f.root, f.body, hand, pistol, muzzle].map(object => ({ position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible, castShadow: object.castShadow }));
  const controller = createPlayerCameraVisibility(f.root);
  f.camera.position.copy(f.root.position).add(v(.1, 1.48, 0)); controller.update(f.camera);
  assert.equal(controller.getState().hidden, true);
  close(muzzle.getWorldPosition(new THREE.Vector3()).distanceTo(before), 0);
  assert.deepEqual([f.root, f.body, hand, pistol, muzzle].map(object => ({ position: object.position.toArray(), rotation: object.quaternion.toArray(), scale: object.scale.toArray(), visible: object.visible, castShadow: object.castShadow })), transforms);
  controller.dispose();
});

test('Distance uses both world positions and an unscaled world-up pivot offset', () => {
  const f = fixture(), actorParent = new THREE.Group(), cameraParent = new THREE.Group();
  actorParent.position.set(5, 3, -7); actorParent.rotation.set(.4, .7, -.25); actorParent.scale.set(2, .6, 1.4);
  f.root.position.set(2, 1, -3); actorParent.add(f.root);
  cameraParent.position.set(-8, 4, 6); cameraParent.rotation.set(-.2, .9, .3); cameraParent.add(f.camera);
  const pivotHeight = 1.1, pivot = f.root.getWorldPosition(new THREE.Vector3()).add(v(0, pivotHeight, 0));
  const controller = createPlayerCameraVisibility(f.root, { pivotHeight, hideDistance: .4, restoreDistance: .6 });
  cameraParent.updateMatrixWorld(true);
  f.camera.position.copy(cameraParent.worldToLocal(pivot.clone().add(v(.3, 0, 0))));
  controller.update(f.camera);
  close(controller.getState().distance, .3);
  assert.equal(controller.getState().hidden, true);
  f.camera.position.copy(cameraParent.worldToLocal(pivot.clone().add(v(.7, 0, 0))));
  controller.update(f.camera);
  close(controller.getState().distance, .7);
  assert.equal(controller.getState().hidden, false);
  controller.dispose();
});

test('Photo, vehicle, interaction, and title contexts restore the authored materials immediately', () => {
  for (const override of [{ photoActive: true }, { inCar: true }, { interacting: true }, { started: false }]) {
    const f = fixture(), controller = createPlayerCameraVisibility(f.root);
    controller.update(f.at(.2)); assert.equal(controller.getState().hidden, true);
    controller.update(f.camera, { ...override, paused: true });
    assert.equal(controller.getState().hidden, false);
    assert.equal(controller.getState().maskedMaterialCount, 0);
    assert.equal(f.body.material.colorWrite, true);
    assert.equal(f.body.material.depthWrite, true);
    controller.update(f.camera, { paused: true });
    assert.equal(controller.getState().hidden, true, 'Returning to gameplay evaluates proximity even while paused');
    controller.dispose();
  }
});

test('Pause freezes initialized visibility and distance, while photo exit and initial paused entry evaluate once', () => {
  const f = fixture(), controller = createPlayerCameraVisibility(f.root);
  controller.update(f.at(.2), { paused: true });
  assert.equal(controller.getState().hidden, true);
  close(controller.getState().distance, .2);
  controller.update(f.at(2), { paused: true });
  controller.update(f.camera, { paused: true });
  assert.equal(controller.getState().hidden, true);
  close(controller.getState().distance, .2);
  controller.update(f.camera, { paused: true, photoActive: true });
  assert.equal(controller.getState().hidden, false);
  controller.update(f.at(.3), { paused: true });
  assert.equal(controller.getState().hidden, true);
  close(controller.getState().distance, .3);
  controller.update(f.at(2));
  assert.equal(controller.getState().hidden, false);
  close(controller.getState().distance, 2);
  controller.dispose();
});

test('A photo round trip preserves the hidden hysteresis latch inside the band, including paused gameplay', () => {
  const f = fixture(), controller = createPlayerCameraVisibility(f.root);
  controller.update(f.at(.54));
  controller.update(f.at(.65));
  assert.equal(controller.getState().hidden, true);
  controller.update(f.camera, { paused: true });
  controller.update(f.camera, { photoActive: true, paused: true });
  assert.equal(controller.getState().hidden, false, 'A close photo shows the complete protagonist');
  assert.equal(f.body.material.colorWrite, true);
  controller.update(f.at(.65), { paused: true });
  assert.equal(controller.getState().hidden, true, 'The restored gameplay camera retains its pre-photo band state');
  assert.equal(f.body.material.depthWrite, false);
  close(controller.getState().distance, .65);
  controller.update(f.at(1), { paused: true });
  assert.equal(controller.getState().hidden, true, 'Ordinary paused updates still freeze the saved state');
  close(controller.getState().distance, .65);
  controller.update(f.camera, { photoActive: true, paused: true });
  controller.update(f.at(1), { paused: true });
  assert.equal(controller.getState().hidden, false, 'Photo exit evaluates once and clears the latch outside the restore radius');
  close(controller.getState().distance, 1);
  controller.update(f.at(.3), { paused: true });
  assert.equal(controller.getState().hidden, false, 'The newly restored paused state also remains frozen');
  controller.dispose();
});

test('Vehicle, interaction and title transitions clear a saved proximity latch instead of inheriting photo hysteresis', () => {
  for (const override of [{ inCar: true }, { interacting: true }, { started: false }, { photoActive: true, inCar: true }]) {
    const f = fixture(), controller = createPlayerCameraVisibility(f.root);
    controller.update(f.at(.54)); controller.update(f.at(.65));
    assert.equal(controller.getState().hidden, true);
    controller.update(f.camera, { ...override, paused: true });
    assert.equal(controller.getState().hidden, false);
    controller.update(f.camera, { paused: true });
    assert.equal(controller.getState().hidden, false, 'A new on-foot context starts from its own proximity state');
    controller.dispose();
  }
});

test('Invalid camera positions restore visible materials instead of retaining a stale mask', () => {
  for (const invalid of [null, NaN, Infinity, -Infinity]) {
    const f = fixture(), controller = createPlayerCameraVisibility(f.root);
    controller.update(f.at(.2)); assert.equal(controller.getState().hidden, true);
    if (invalid === null) controller.update(null);
    else { f.camera.position.x = invalid; controller.update(f.camera); }
    assert.equal(controller.getState().hidden, false);
    assert.equal(f.body.material.colorWrite, true);
    assert.equal(f.body.material.depthWrite, true);
    controller.dispose();
  }
});

test('Disposal restores owned references, preserves external replacements, and disposes only private clones once', () => {
  const f = fixture(), shared = f.material, texture = new THREE.Texture(); shared.map = texture;
  const originalArray = [shared, shared], second = new THREE.Mesh(new THREE.BoxGeometry(), originalArray);
  f.root.add(second);
  const controller = createPlayerCameraVisibility(f.root), clone = f.body.material;
  let cloneDisposals = 0, originalDisposals = 0, textureDisposals = 0, geometryDisposals = 0;
  clone.addEventListener('dispose', () => cloneDisposals++);
  shared.addEventListener('dispose', () => originalDisposals++);
  texture.addEventListener('dispose', () => textureDisposals++);
  f.body.geometry.addEventListener('dispose', () => geometryDisposals++);
  controller.update(f.at(.2));
  const replacement = new THREE.MeshBasicMaterial({ color: 0xff0000 }); f.body.material = replacement;
  controller.dispose(); controller.dispose();
  assert.equal(f.body.material, replacement);
  assert.equal(second.material, originalArray);
  assert.equal(cloneDisposals, 1);
  assert.equal(originalDisposals, 0);
  assert.equal(textureDisposals, 0);
  assert.equal(geometryDisposals, 0);
  assert.equal(controller.getState().disposed, true);
  const state = controller.getState(); controller.update(f.at(.1));
  assert.deepEqual(controller.getState(), state);
  assert.equal(replacement.colorWrite, true);
  assert.equal(replacement.depthWrite, true);
});

test('Visibility diagnostics are independent snapshots', () => {
  const f = fixture(), controller = createPlayerCameraVisibility(f.root);
  controller.update(f.at(.2));
  const snapshot = controller.getState();
  snapshot.hidden = false; snapshot.distance = 100; snapshot.materialCount = -1; snapshot.disposed = true;
  const fresh = controller.getState();
  assert.equal(fresh.hidden, true);
  close(fresh.distance, .2);
  assert.equal(fresh.materialCount, 1);
  assert.equal(fresh.disposed, false);
  controller.dispose();
});

test('Disposal restores owned array entries while retaining an externally replaced slot', () => {
  const root = new THREE.Group(), originalA = new THREE.MeshBasicMaterial(), originalB = new THREE.MeshBasicMaterial();
  const originalArray = [originalA, originalB, originalA];
  const body = new THREE.Mesh(new THREE.BoxGeometry(), originalArray); root.add(body);
  const controller = createPlayerCameraVisibility(root), clones = new Set(body.material);
  const disposals = new Map();
  for (const material of clones) material.addEventListener('dispose', () => disposals.set(material, (disposals.get(material) ?? 0) + 1));
  const replacement = new THREE.MeshBasicMaterial(); body.material[1] = replacement;
  controller.dispose(); controller.dispose();
  assert.deepEqual(body.material, [originalA, replacement, originalA]);
  assert.deepEqual(originalArray, [originalA, originalB, originalA], 'External slot edits never mutate the authored shared array');
  assert.notEqual(body.material, originalArray);
  assert.deepEqual([...disposals.values()], [1, 1]);
});

test('Diagnostics count only materials whose authored write contribution can actually be masked', () => {
  const f = fixture(new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  f.root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  const controller = createPlayerCameraVisibility(f.root);
  controller.update(f.at(.2));
  assert.equal(controller.getState().materialCount, 2);
  assert.equal(controller.getState().maskedMaterialCount, 1);
  controller.update(f.at(1));
  assert.equal(f.body.material.colorWrite, false);
  assert.equal(f.body.material.depthWrite, false);
  assert.equal(controller.getState().maskedMaterialCount, 0);
  controller.dispose();
});
