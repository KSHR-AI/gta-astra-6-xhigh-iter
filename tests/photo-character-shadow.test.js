import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPhotoCharacterShadow, getCharacterShadowBounds } from '../src/photo-character-shadow.js';

function actor(x = 0, z = 0) {
  const mesh = new THREE.Group(); mesh.name = `Actor ${x}/${z}`; mesh.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(.5, 1.8, .3), new THREE.MeshStandardMaterial()); body.position.y = .9; mesh.add(body);
  return { mesh, body, getFaceInfo: () => ({ supported: true }), getLODInfo: () => ({ level: 0 }),
    getHitVolumes: () => ({ spheres: [{ center: mesh.localToWorld(new THREE.Vector3(0, 1.65, 0)), radius: .15 }] }) };
}
function fixture(actors = [actor()]) {
  const scene = new THREE.Scene(); actors.forEach(item => scene.add(item.mesh));
  const camera = new THREE.PerspectiveCamera(50, 1.5, .1, 100); camera.position.set(0, 1.65, 3); camera.lookAt(0, 1.65, 0);
  const sun = new THREE.DirectionalLight(); sun.position.set(-3, 2, 5); scene.add(sun, sun.target); scene.updateMatrixWorld(true);
  const domElement = new EventTarget(), renderer = { domElement, getDrawingBufferSize: target => target.set(1200, 800), getContext: () => ({ isContextLost: () => false }) };
  const helpers = [];
  const helperFactory = (_renderer, options) => {
    const helper = { options, root: null, releases: 0, disposed: false, captures: 0, select(root) { this.root = root; },
      update({ bounds, enabled = true }) { if (!enabled) return false; this.bounds = bounds().clone(); this.captures++; return true; },
      release() { this.root = null; this.releases++; }, dispose() { this.disposed = true; }, setBiases(patch) { this.biases = { ...patch }; },
      getInfo() { return { reason: 'captured', calls: 3, triangles: 45, captures: this.captures }; } };
    helpers.push(helper); return helper;
  };
  const controller = createPhotoCharacterShadow({ renderer, camera, scene, getActors: () => actors, sun, helperFactory });
  const update = () => controller.update({ photoActive: true, night: false, started: true });
  return { scene, camera, renderer, controller, update, actors, helpers };
}

test('tight bounds follow visible indexed posed surfaces and include the visible sibling weapon, excluding Basic/unused data', () => {
  const root = new THREE.Group(), geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.2, 0, 0, .2, 0, 0, 0, 1.8, 0, 500, 500, 500], 3)); geometry.setIndex([0, 1, 2]);
  geometry.morphTargetsRelative = true; geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, .1, 0, 0, 0, 0], 3)];
  const body = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); body.morphTargetInfluences[0] = 1; root.add(body);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(.1, .1, .2), new THREE.MeshStandardMaterial()); weapon.position.set(.4, 1.1, .5); root.add(weapon);
  const helper = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100), new THREE.MeshBasicMaterial()); root.add(helper);
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(200, 200, 200), new THREE.MeshStandardMaterial()); hidden.visible = false; root.add(hidden);
  root.position.set(2, .2, -3); root.updateMatrixWorld(true);
  const bounds = getCharacterShadowBounds(root);
  assert.ok(bounds.max.x < 2.46 && bounds.max.x > 2.44);
  assert.ok(Math.abs(bounds.max.y - 2.1) < 1e-6);
  assert.ok(bounds.max.z > -2.41 && bounds.max.z < -2.39);
  weapon.visible = false; const withoutWeapon = getCharacterShadowBounds(root);
  assert.ok(withoutWeapon.max.x < 2.21); assert.equal(withoutWeapon.max.z, -3);
});

test('render draw range and visible material groups constrain bounds', () => {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 20, 0, 0, 21, 0, 0, 20, 1, 0], 3));
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  const opaque = new THREE.MeshStandardMaterial(), blend = new THREE.MeshStandardMaterial({ transparent: true, opacity: .3 });
  const mesh = new THREE.Mesh(geometry, [opaque, blend]); mesh.updateMatrixWorld(true);
  assert.equal(getCharacterShadowBounds(mesh).max.x, 1);
  blend.alphaTest = .5; geometry.setDrawRange(0, 3); assert.equal(getCharacterShadowBounds(mesh).max.x, 1);
  geometry.setDrawRange(0, 6); assert.equal(getCharacterShadowBounds(mesh).max.x, 21);
});

test('photo/day and projected head gates select the centered visible actor and release on exit, night and distant view', () => {
  const f = fixture([actor(), actor(2, 0), actor(0, 6)]);
  assert.equal(f.controller.update({ photoActive: false }), false); assert.equal(f.helpers.length, 0);
  assert.equal(f.update(), true);
  assert.equal(f.helpers[0].root, f.actors[0].mesh); assert.ok(f.controller.getInfo().projectedHeadPixels > 64);
  assert.equal(f.controller.getInfo().frameCalls, 3);
  f.controller.update({ photoActive: false }); assert.equal(f.helpers[0].root, null); assert.equal(f.controller.getInfo().frameCalls, 0);
  f.update(); f.controller.update({ photoActive: true, night: true }); assert.equal(f.helpers[0].root, null);
  f.update(); f.camera.position.z = 30; f.camera.updateMatrixWorld(true); f.update(); assert.equal(f.helpers[0].root, null);
  assert.equal(f.controller.getInfo().reason, 'no-close-visible-face'); f.controller.dispose();
});

test('opaque geometry blocks head selection but transparent glass does not; hidden/offscreen actors never win', () => {
  const f = fixture(), wall = new THREE.Mesh(new THREE.BoxGeometry(2, 2, .1), new THREE.MeshStandardMaterial()); wall.position.set(0, 1.65, 1); f.scene.add(wall); f.scene.updateMatrixWorld(true);
  f.controller.configure({ enabled: true }); assert.equal(f.update(), false); assert.equal(f.controller.getInfo().rejectedOccluded, 1);
  // A changed view invalidates the cached occlusion sample.
  wall.material.transparent = true; wall.material.opacity = .3; f.camera.position.x = .01; assert.equal(f.update(), true);
  f.actors[0].mesh.visible = false; assert.equal(f.update(), false); assert.equal(f.helpers[0].root, null); f.controller.dispose();
});

test('resolution changes dispose maps; context loss restores selection only after restoration; cleanup is idempotent', () => {
  const f = fixture(); f.update(); const first = f.helpers[0];
  f.controller.configure({ resolution: 512 }); assert.equal(first.disposed, true); f.update(); assert.equal(f.helpers[1].options.resolution, 512);
  f.renderer.domElement.dispatchEvent(new Event('webglcontextlost')); assert.equal(f.helpers[1].disposed, true);
  assert.equal(f.update(), false); assert.equal(f.helpers.length, 2); assert.equal(f.controller.getInfo().reason, 'context-lost');
  f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored')); f.update(); assert.equal(f.helpers.length, 3);
  assert.equal(f.helpers[2].root, f.actors[0].mesh);
  f.controller.dispose(); f.controller.dispose(); assert.equal(f.helpers[2].disposed, true); assert.equal(f.controller.getInfo().disposed, true); assert.equal(f.update(), false);
  f.renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(f.controller.getInfo().reason, 'disposed', 'disposed controllers no longer listen to context events');
});

test('bias comparison updates the existing helper without replacing its frozen capture; invalid patches are atomic', () => {
  const f = fixture(); f.controller.configure({ enabled: true }); f.update(); const helper = f.helpers[0];
  f.controller.configure({ normalBias: .0015, depthBias: .0003 });
  assert.equal(f.helpers.length, 1); assert.equal(helper.disposed, false); assert.equal(helper.captures, 1);
  assert.deepEqual(helper.biases, { normalBias: .0015, depthBias: .0003 });
  const config = f.controller.getInfo().config;
  assert.throws(() => f.controller.configure({ normalBias: .002, depthBias: -1, resolution: 512 }), /Nonnegative/);
  assert.deepEqual(f.controller.getInfo().config, config); assert.equal(helper.disposed, false);
  f.controller.configure({ resolution: 512 }); f.update();
  assert.equal(f.helpers[1].options.normalBias, .0015); assert.equal(f.helpers[1].options.depthBias, .0003);
  f.controller.dispose();
});

test('only contenders that can win undergo exact occlusion; visibility cache avoids traversal on frozen frames', () => {
  const high = actor(), low = actor(.8, 0), f = fixture([high, low]);
  // Other actors do not obstruct this selection-focused fixture.
  high.body.raycast = low.body.raycast = () => {};
  let traversals = 0; const traverse = f.scene.traverseVisible;
  f.scene.traverseVisible = function(callback) { traversals++; return traverse.call(this, callback); };
  f.controller.configure({ enabled: true }); f.update();
  assert.equal(f.helpers[0].root, high.mesh); assert.equal(f.controller.getInfo().occlusionQueries, 1); assert.equal(traversals, 1);
  f.update(); assert.equal(f.controller.getInfo().occlusionQueries, 0); assert.equal(traversals, 1);
  high.mesh.visible = false; f.update();
  assert.equal(f.helpers[0].root, low.mesh); assert.equal(f.controller.getInfo().occlusionQueries, 1); assert.equal(traversals, 2);
  f.controller.dispose();
});

test('a hidden leading actor falls through to the next visible score and only one occluder traversal', () => {
  const high = actor(), low = actor(.8, 0), f = fixture([high, low]);
  high.body.raycast = low.body.raycast = () => {};
  const wall = new THREE.Mesh(new THREE.BoxGeometry(.2, .5, .1), new THREE.MeshStandardMaterial()); wall.position.set(0, 1.65, 1.5);
  f.scene.add(wall); f.scene.updateMatrixWorld(true);
  let traversals = 0; const traverse = f.scene.traverseVisible;
  f.scene.traverseVisible = function(callback) { traversals++; return traverse.call(this, callback); };
  f.controller.configure({ enabled: true }); f.update();
  assert.equal(f.helpers[0].root, low.mesh); assert.equal(f.controller.getInfo().rejectedOccluded, 1);
  assert.equal(f.controller.getInfo().occlusionQueries, 2); assert.equal(traversals, 1);
  f.controller.dispose();
});

test('opaque early hits stop later mesh queries and still inspect opaque groups behind transparent ones', () => {
  const f = fixture(), wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [new THREE.MeshStandardMaterial({ transparent: true, opacity: .3 }), new THREE.MeshStandardMaterial()]);
  wall.raycast = (_ray, hits) => {
    hits.push({ object: wall, face: { materialIndex: 0 }, distance: .5 });
    hits.push({ object: wall, face: { materialIndex: 1 }, distance: .6 });
  };
  const later = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  let laterQueries = 0; later.raycast = () => { laterQueries++; };
  f.scene.add(wall, later); f.scene.updateMatrixWorld(true);
  f.controller.configure({ enabled: true }); f.update();
  assert.equal(f.controller.getInfo().rejectedOccluded, 1); assert.equal(f.controller.getInfo().occlusionMeshTests, 1); assert.equal(laterQueries, 0);
  f.update(); assert.equal(f.controller.getInfo().occlusionQueries, 0); assert.equal(laterQueries, 0);
  f.controller.dispose();
});

test('photo round trips invalidate other-object cover even when camera and head return unchanged', () => {
  const f = fixture(), wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial()); wall.position.set(4, 1.65, 1);
  f.scene.add(wall); f.scene.updateMatrixWorld(true); f.controller.configure({ enabled: true }); f.update();
  assert.equal(f.helpers[0].root, f.actors[0].mesh);
  f.controller.update({ photoActive: false }); wall.position.x = 0; f.scene.updateMatrixWorld(true);
  f.update(); assert.equal(f.helpers[0].root, null); assert.equal(f.controller.getInfo().rejectedOccluded, 1); assert.equal(f.controller.getInfo().occlusionQueries, 1);
  f.controller.dispose();
});

test('frozen visibility periodically observes changed cover without dropping the cache between rejected frames', () => {
  const f = fixture(), wall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial()); wall.position.set(0, 1.65, 1);
  f.scene.add(wall); f.scene.updateMatrixWorld(true); f.controller.configure({ enabled: true }); f.update();
  assert.equal(f.controller.getInfo().rejectedOccluded, 1);
  wall.visible = false;
  for (let i = 0; i < 19; i++) { f.update(); assert.equal(f.controller.getInfo().occlusionQueries, 0); }
  f.update(); assert.equal(f.controller.getInfo().occlusionQueries, 1); assert.equal(f.helpers[0].root, f.actors[0].mesh);
  f.controller.dispose();
});

test('retained selection holds below the hysteresis boundary and switches at exactly 25 percent', () => {
  const retained = actor(), challenger = actor(1, 0), f = fixture([retained, challenger]);
  retained.body.raycast = challenger.body.raycast = () => {};
  let challengerRadius = .12;
  retained.getHitVolumes = () => ({ spheres: [{ center: new THREE.Vector3(0, 1.65, 0), radius: .125 }] });
  challenger.getHitVolumes = () => ({ spheres: [{ center: new THREE.Vector3(0, 1.65, 0), radius: challengerRadius }] });
  // Exactly 100 and 125 projected pixels at the boundary, with equal center
  // penalties, avoid letting floating-point setup mask the equality rule.
  f.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 / 3)); f.camera.updateProjectionMatrix();
  f.controller.configure({ enabled: true }); f.update(); assert.equal(f.helpers[0].root, retained.mesh);
  challengerRadius = .15624; f.update(); assert.equal(f.helpers[0].root, retained.mesh); assert.equal(f.controller.getInfo().occlusionQueries, 0);
  challengerRadius = .15625; f.update(); assert.equal(f.helpers[0].root, challenger.mesh); assert.equal(f.controller.getInfo().occlusionQueries, 1);
  assert.equal(f.controller.getInfo().projectedHeadPixels, 125);
  f.controller.dispose();
});

test('exact occlusion retains layer, hierarchy, distance, actor exclusion and compacted instance behavior', () => {
  const f = fixture(); let ownQueries = 0; f.actors[0].body.raycast = () => { ownQueries++; };
  const hidden = new THREE.Group(), hiddenWall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial());
  hidden.visible = false; hidden.add(hiddenWall); hiddenWall.raycast = () => { throw new Error('Hidden ancestor was queried'); }; f.scene.add(hidden);
  const layerWall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial()); layerWall.position.set(0, 1.65, 1); layerWall.layers.set(1); f.scene.add(layerWall);
  const farWall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial()); farWall.position.set(0, 1.65, -5); f.scene.add(farWall);
  const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, .1), new THREE.MeshStandardMaterial(), 2);
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 1.65, 1));
  instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 1.65, 1));
  instances.computeBoundingSphere(); instances.count = 1; f.scene.add(instances); f.scene.updateMatrixWorld(true);
  f.controller.configure({ enabled: true }); f.update(); assert.equal(f.helpers[0].root, f.actors[0].mesh); assert.equal(ownQueries, 0);
  instances.count = 2; f.camera.position.x = .001; f.update(); assert.equal(f.helpers[0].root, null); assert.equal(f.controller.getInfo().rejectedOccluded, 1);
  instances.count = 1; f.camera.position.x = .002; f.update(); assert.equal(f.helpers[0].root, f.actors[0].mesh);
  f.controller.dispose();
});


test('production gates release map memory on photo exit, night, quality reduction and restart, then recreate on demand', () => {
  const f = fixture();
  for (const gate of [
    () => f.controller.update({ photoActive: false }),
    () => f.controller.update({ photoActive: true, night: true }),
    () => f.controller.update({ photoActive: true, started: false }),
    () => { f.renderer.shadowMap = { enabled: false }; f.update(); },
    () => f.controller.release('restart'),
    () => f.controller.configure({ enabled: false }),
  ]) {
    f.renderer.shadowMap = { enabled: true }; f.controller.configure({ enabled: true });
    f.update(); const helper = f.helpers.at(-1); assert.equal(helper.root, f.actors[0].mesh);
    gate(); assert.equal(helper.root, null); assert.equal(helper.disposed, true); assert.equal(f.controller.getInfo().shadow, null);
  }
  f.controller.dispose();
});

test('look-away releases actor materials while retaining one reusable target, then reselects without comparison hooks', () => {
  const f = fixture(); f.update(); const helper = f.helpers[0];
  f.camera.lookAt(0, 1.65, 6); f.update();
  assert.equal(helper.root, null); assert.equal(helper.disposed, false); assert.equal(f.controller.getInfo().reason, 'no-close-visible-face');
  f.camera.lookAt(0, 1.65, 0); f.update();
  assert.equal(helper.root, f.actors[0].mesh); assert.equal(f.helpers.length, 1);
  assert.equal('comparisonEnabled' in f.controller.getInfo().config, false); assert.equal(f.controller.getHelper, undefined);
  f.controller.dispose();
});

test('fallback or far-LOD characters never allocate a local target', () => {
  const f = fixture(); f.actors[0].getFaceInfo = () => ({ supported: false });
  assert.equal(f.update(), false); assert.equal(f.helpers.length, 0);
  f.actors[0].getFaceInfo = () => ({ supported: true }); f.actors[0].getLODInfo = () => ({ level: 2 });
  assert.equal(f.update(), false); assert.equal(f.helpers.length, 0);
  f.actors[0].getLODInfo = () => ({ level: 0 }); assert.equal(f.update(), true);
  f.actors[0].getLODInfo = () => ({ level: 1 }); f.update(); assert.equal(f.helpers[0].root, null);
  f.controller.dispose();
});

test('a failed render releases owned resources and disables further captures until explicitly re-enabled', () => {
  const f = fixture(); f.update(); const helper = f.helpers[0];
  helper.update = () => { throw new Error('GPU capture failed'); };
  const previousWarn = console.warn; const warnings = []; console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(f.update(), false); assert.equal(helper.root, null); assert.equal(helper.disposed, true);
    assert.equal(f.controller.getInfo().config.enabled, false); assert.match(f.controller.getInfo().error, /GPU capture failed/);
    assert.equal(f.update(), false); assert.equal(f.helpers.length, 1); assert.equal(warnings.length, 1);
    f.controller.configure({ enabled: true }); assert.equal(f.update(), true); assert.equal(f.helpers.length, 2);
  } finally { console.warn = previousWarn; f.controller.dispose(); }
});
