import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { measureCharacterScale } from '../src/character-scale.js';
import { actor } from './helpers/character-animation-fixture.js';

const rigs = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];

function renderedHeight(root) {
  const point = new THREE.Vector3(), box = new THREE.Box3();
  root.updateMatrixWorld(true);
  root.traverse(object => {
    if (!object.isSkinnedMesh) return;
    const geometry = object.geometry;
    const indices = geometry.index ? new Set(geometry.index.array)
      : Array.from({ length: geometry.attributes.position.count }, (_, index) => index);
    for (const index of indices) {
      object.getVertexPosition(index, point); point.applyMatrix4(object.matrixWorld); box.expandByPoint(point);
    }
  });
  return box.max.y - box.min.y;
}

for (const rig of rigs) {
  test(`${rig.model}: authored neutral stature is measured through skinning and independent of world placement`, async () => {
    const bytes = await readFile(new URL(`../public/models/${rig.model}`, import.meta.url));
    const loader = new GLTFLoader();
    loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
    const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    const root = new THREE.Group(), visual = new THREE.Group(); root.add(visual); visual.add(asset.scene);
    const expected = renderedHeight(asset.scene), reference = measureCharacterScale(asset.scene, rig.height);
    assert.ok(Math.abs(reference.referenceHeight - expected) < 1e-8, 'reference contains the actual skinned rest silhouette');
    const before = [];
    asset.scene.traverse(object => { if (object.isBone) before.push(object.quaternion.toArray()); });
    root.position.set(13, 7, -21); root.rotation.set(.3, 1.2, -.2); root.scale.set(1.2, .8, 1.5);
    const moved = measureCharacterScale(asset.scene, rig.height);
    assert.ok(Math.abs(reference.referenceHeight - moved.referenceHeight) * reference.scale < 1e-6, 'world orientation and nonuniform ancestor scale do not redefine the body');
    const after = [];
    asset.scene.traverse(object => { if (object.isBone) after.push(object.quaternion.toArray()); });
    assert.deepEqual(after, before, 'measurement never poses or resets the source skeleton');
    root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.setScalar(1);
    visual.scale.setScalar(reference.scale); asset.scene.position.y += reference.offsetY;
    assert.ok(Math.abs(renderedHeight(root) - rig.height) < 1e-7, 'uniform normalization realizes the requested neutral stature');
  });

  test(`${rig.model}: relaxed standing remains close to authored stature without crouch-driven overscaling`, async (t) => {
    const a = await actor(rig); a.frame({}, 180);
    const actual = renderedHeight(a.mesh);
    t.diagnostic(JSON.stringify({ requestedNeutralHeight: rig.height, relaxedStandingHeight: actual }));
    assert.ok(actual > rig.height - .025 && actual <= rig.height + .005,
      'relaxed knees may shorten stature slightly; the crouched setup clip must not inflate it by 4–5%');
    const feet = a.sampleFeet();
    for (const foot of Object.values(feet.feet)) assert.ok(foot.clearance > -.002 && foot.clearance < .006);
  });
}

test('neutral scale ignores unreferenced payload and respects geometry draw ranges', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 1, 0, 1, 3, 0, 0, 2, 0, 0, 500, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 1, 3]); geometry.setDrawRange(0, 3);
  const mesh = new THREE.Mesh(geometry), model = new THREE.Group(); model.add(mesh);
  assert.deepEqual(measureCharacterScale(model, 1.8), { scale: .9, offsetY: -1, referenceHeight: 2, minimum: 1, maximum: 3, vertices: 3 });
  geometry.setIndex([0, 1, 2]); geometry.setDrawRange(0, Infinity);
  assert.equal(measureCharacterScale(model, 1.8).referenceHeight, 2);
  geometry.attributes.position.setY(3, NaN);
  assert.equal(measureCharacterScale(model, 1.8).referenceHeight, 2, 'unreferenced malformed payload does not affect rendered stature');
  geometry.attributes.position.setY(2, NaN);
  assert.equal(measureCharacterScale(model, 1.8), null, 'a malformed rendered vertex cannot silently shrink the measured stature');
});

test('empty or flat reference geometry and invalid requested heights never generate invalid scales', () => {
  const model = new THREE.Group();
  assert.equal(measureCharacterScale(model, 1.8), null);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 0, 1], 3));
  model.add(new THREE.Mesh(geometry));
  assert.equal(measureCharacterScale(model, 1.8), null);
  for (const height of [0, -1, NaN, Infinity]) assert.throws(() => measureCharacterScale(model, height), RangeError);
});
