import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compactCharacterModel } from '../scripts/compact-character-models.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function readModel(bytes) {
  const length = bytes.readUInt32LE(12);
  const data = JSON.parse(bytes.toString('utf8', 20, 20 + length));
  const binary = bytes.subarray(28 + length);
  function view(index) {
    const { byteOffset = 0, byteLength } = data.bufferViews[index];
    return binary.subarray(byteOffset, byteOffset + byteLength);
  }
  function accessor(index) {
    const { bufferView, ...layout } = data.accessors[index];
    return { ...layout, stride: data.bufferViews[bufferView].byteStride, bytes: hash(view(bufferView)) };
  }
  const shapes = data.meshes.map(mesh => ({
    ...mesh,
    primitives: mesh.primitives.map(primitive => {
      const attributes = group => Object.fromEntries(Object.entries(group).map(([name, i]) => [name, accessor(i)]));
      return { ...primitive, attributes: attributes(primitive.attributes), indices: accessor(primitive.indices),
        targets: primitive.targets?.map(attributes) };
    }),
  }));
  const skins = data.skins.map(skin => ({ ...skin, inverseBindMatrices: accessor(skin.inverseBindMatrices) }));
  return { data, shapes, skins, view };
}

for (const name of ['Male', 'Female']) test(`${name} delivery preserves geometry, rig, morphs, LOD numbering and all original texture bytes`, async () => {
  const input = await readFile(new URL(`../public/models/Civilian${name}Natural.glb`, import.meta.url));
  const textures = new Map();
  const output = compactCharacterModel(input, (uri, bytes) => textures.set(uri, bytes));
  const source = readModel(input), delivered = readModel(output);
  assert.deepEqual(delivered.shapes, source.shapes);
  assert.deepEqual(delivered.skins, source.skins);
  for (const key of ['nodes', 'materials', 'scenes', 'textures', 'samplers', 'animations']) {
    assert.deepEqual(delivered.data[key], source.data[key]);
  }
  assert.ok(output.byteLength < input.byteLength / 2);
  const physicalRanges = new Map();
  for (const [index, view] of delivered.data.bufferViews.entries()) {
    const bytes = delivered.view(index), digest = hash(bytes);
    assert.equal(view.byteOffset % 4, 0);
    if (physicalRanges.has(digest)) assert.equal(view.byteOffset, physicalRanges.get(digest));
    physicalRanges.set(digest, view.byteOffset);
  }
  assert.ok(physicalRanges.size < delivered.data.bufferViews.length, 'duplicate authored views share a BIN range');
  for (const [index, image] of delivered.data.images.entries()) {
    const original = source.view(source.data.images[index].bufferView);
    const initial = delivered.view(image.bufferView);
    const uri = image.extras?.fullResolutionUri;
    if (uri) {
      assert.equal(initial.readUInt32BE(16), 512);
      assert.equal(initial.readUInt32BE(20), 512);
      assert.deepEqual(textures.get(uri), original);
    } else assert.deepEqual(initial, original);
  }
});

test('stream upgrades shared texture storage and retries a failed original after reconnect', async t => {
  const THREE = await import('three');
  const { registerCharacterTextures, streamCharacterTextures } = await import('../src/character-texture-stream.js');
  const events = new EventTarget();
  t.after(() => {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.requestAnimationFrame;
  });
  globalThis.document = { baseURI: 'https://example.test/game/' };
  globalThis.window = events;
  globalThis.requestAnimationFrame = callback => setImmediate(callback);
  const preview = { width: 512 }, original = { width: 2048 };
  const texture = new THREE.Texture(preview);
  texture.userData.fullResolutionUri = 'character-textures/face.png';
  const material = new THREE.MeshStandardMaterial({ map: texture });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry(), material), new THREE.Mesh(new THREE.BoxGeometry(), material.clone()));
  let attempts = 0, disposals = 0;
  texture.addEventListener('dispose', () => disposals++);
  const loader = { async loadAsync(url) {
    assert.equal(url, 'https://example.test/game/models/character-textures/face.png');
    if (++attempts === 1) throw new Error('offline');
    return original;
  } };
  registerCharacterTextures({ scene, parser: { textureLoader: loader } }, 'models/hero.glb');
  assert.equal(attempts, 0);
  await streamCharacterTextures();
  assert.equal(texture.image, preview);
  events.dispatchEvent(new Event('online'));
  await streamCharacterTextures();
  assert.equal(texture.image, original);
  assert.equal(disposals, 1);
  assert.equal(attempts, 2);
  for (const mesh of scene.children) assert.equal(mesh.material.map, texture);
});
