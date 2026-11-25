import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { chooseCharacterLOD, registerCharacterLODs, createCharacterLOD } from '../src/character-lod.js';

async function load(sex) {
  const bytes = await readFile(new URL(`../public/models/Civilian${sex}Natural.glb`, import.meta.url));
  const data = JSON.parse(await readFile(new URL(`../public/models/Civilian${sex}Natural.lod.json`, import.meta.url)));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  return { bytes, data, asset };
}

test('LOD selection avoids boundary flicker and respects photo-camera magnification', () => {
  assert.equal(chooseCharacterLOD(14, 55, 0), 0);
  assert.equal(chooseCharacterLOD(17, 55, 0), 1);
  assert.equal(chooseCharacterLOD(14, 55, 1), 1);
  assert.equal(chooseCharacterLOD(11, 55, 1), 0);
  assert.equal(chooseCharacterLOD(35, 55, 0), 2);
  assert.equal(chooseCharacterLOD(28, 55, 2), 2);
  assert.equal(chooseCharacterLOD(35, 15, 2), 0, 'photo zoom restores the full-resolution face');
});

for (const sex of ['Male', 'Female']) {
  test(`${sex}: generated LODs reference the current authored asset and lower triangle cost`, async () => {
    const { bytes, data } = await load(sex);
    assert.equal(data.sha256, createHash('sha256').update(bytes).digest('hex'), 'rebuild LODs whenever authoring changes the source geometry');
    const totals = [0, 0, 0];
    for (const mesh of data.meshes) {
      totals[0] += mesh.triangles;
      for (const [i, level] of mesh.levels.entries()) {
        totals[i + 1] += level.indices.length / 3;
        assert.equal(level.indices.length % 3, 0);
        assert.ok(level.indices.every(index => Number.isInteger(index) && index >= 0 && index < mesh.vertices));
        assert.ok(level.error < 0.019);
      }
    }
    // Male authored flyaway ribbons retain borders (1806 triangles) and both
    // bodies retain raised clothing/skin seams. Blink suppression recovers far
    // face simplification; these ceilings retain little headroom for growth.
    assert.ok(totals[1] < totals[0] * (sex === 'Male' ? 0.74 : 0.65));
    assert.ok(totals[2] < totals[0] * (sex === 'Male' ? 0.57 : 0.51));
  });

  test(`${sex}: actual GLTF meshes swap geometry without changing skinning, wardrobe masks or sole probes`, async () => {
    const { data, asset } = await load(sex);
    assert.equal(registerCharacterLODs(asset, data), 3, 'all source GLTF primitive associations resolve');
    const root = new THREE.Group(); root.add(asset.scene);
    const objects = [];
    asset.scene.traverse(object => {
      if (!object.isSkinnedMesh) return;
      object.geometry.setAttribute('clothDye', new THREE.Float32BufferAttribute(new Float32Array(object.geometry.attributes.position.count), 1));
      objects.push({ object, geometry: object.geometry, skeleton: object.skeleton, sample: object.getVertexPosition(0, new THREE.Vector3()).clone() });
    });
    const lod = createCharacterLOD(asset.scene, root);
    const camera = new THREE.PerspectiveCamera(55);
    camera.position.z = 50;
    lod.update(camera);
    assert.equal(lod.getInfo().level, 2);
    for (const entry of objects) {
      assert.equal(entry.object.skeleton, entry.skeleton);
      for (const [name, attribute] of Object.entries(entry.geometry.attributes)) assert.equal(entry.object.geometry.attributes[name], attribute, `${name} must retain original vertices`);
      assert.ok(entry.object.getVertexPosition(0, new THREE.Vector3()).distanceTo(entry.sample) < 1e-10);
    }
    camera.position.z = 3; lod.update(camera);
    assert.equal(lod.getInfo().level, 0);
    for (const entry of objects) assert.equal(entry.object.geometry, entry.geometry);
    const heroLOD = createCharacterLOD(asset.scene, root, { enabled: false });
    camera.position.z = 100; heroLOD.update(camera);
    assert.equal(heroLOD.getInfo().level, 0, 'the playable protagonist retains full geometry');
  });
}

test('malformed optional LOD files leave full-quality asset usable', async () => {
  const { asset, data } = await load('Male');
  for (const invalid of [null, {}, { version: 1, meshes: null },
    { version: 1, meshes: [null, { mesh: 0, primitive: 0, vertices: data.meshes[0].vertices }] },
    { version: 1, meshes: [{ ...data.meshes[0], levels: [null, {}] }] },
    { version: 1, meshes: [{ ...data.meshes[0], levels: [{ indices: 'abc' }, { indices: [] }] }] },
    { version: 1, meshes: [{ ...data.meshes[0], levels: [{ indices: [0, 1, Infinity] }, { indices: [0, 1, 2] }] }] },
  ]) assert.equal(registerCharacterLODs(asset, invalid), 0);
});

function blinkLODFixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.morphAttributes.position = [0, 1].map(() => new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  geometry.morphTargetsRelative = true;
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  mesh.morphTargetDictionary = { blinkLeft: 0, blinkRight: 1 }; mesh.morphTargetInfluences = [0, 0];
  const scene = new THREE.Group(); scene.add(mesh);
  const asset = { scene, parser: { associations: new Map([[mesh, { meshes: 0, primitives: 0 }]]) } };
  const data = { version: 1, meshes: [{ mesh: 0, primitive: 0, vertices: 3, levels: [
    { indices: [0, 1, 2] }, { indices: [0, 1, 2], disabledMorphTargets: ['blinkLeft', 'blinkRight'] },
  ] }] };
  return { asset, data, mesh };
}

test('far blink contract zeros both targets every frame while near/mid retain animation', () => {
  const { asset, data, mesh } = blinkLODFixture();
  assert.equal(registerCharacterLODs(asset, data), 1);
  const lod = createCharacterLOD(asset.scene, asset.scene), camera = new THREE.PerspectiveCamera(55);
  mesh.morphTargetInfluences = [.5, .7]; camera.position.z = 20;
  assert.equal(lod.update(camera), 1); assert.deepEqual(mesh.morphTargetInfluences, [.5, .7]);
  camera.position.z = 50; assert.equal(lod.update(camera), 2); assert.deepEqual(mesh.morphTargetInfluences, [0, 0]);
  mesh.morphTargetInfluences = [1, 1]; lod.update(camera); assert.deepEqual(mesh.morphTargetInfluences, [0, 0]);
  camera.position.z = 2; lod.update(camera); mesh.morphTargetInfluences = [.3, .4]; lod.update(camera);
  assert.deepEqual(mesh.morphTargetInfluences, [.3, .4]);
});

test('unsafe far suppression sidecars retain full geometry', () => {
  for (const corrupt of [
    ({ data }) => { data.meshes[0].levels[0].disabledMorphTargets = ['blinkLeft', 'blinkRight']; },
    ({ data }) => { data.meshes[0].levels[1].disabledMorphTargets = ['blinkLeft', 'jawOpen']; },
    ({ data }) => { data.meshes[0].levels[1].disabledMorphTargets = ['blinkLeft', 'blinkLeft']; },
    ({ data }) => { data.meshes[0].levels[1].disabledMorphTargets = 'blinkLeft'; },
    ({ mesh }) => { mesh.morphTargetInfluences[0] = .5; },
    ({ mesh }) => { mesh.morphTargetDictionary.blinkRight = 0; },
    ({ mesh }) => { mesh.morphTargetDictionary.jawOpen = 2; },
    ({ mesh }) => { mesh.geometry.morphTargetsRelative = false; },
    ({ mesh }) => { mesh.geometry.morphAttributes.position.pop(); },
  ]) {
    const fixture = blinkLODFixture(); corrupt(fixture);
    assert.equal(registerCharacterLODs(fixture.asset, fixture.data), 0);
    assert.equal(createCharacterLOD(fixture.asset.scene, fixture.asset.scene).getInfo().meshes, 0);
  }
});
