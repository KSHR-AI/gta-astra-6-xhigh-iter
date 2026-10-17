import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sampleCharacterBlink } from '../src/character-face.js';

let factoryPromise;
// Staged authoring validation uses the same runtime loader before promotion.
// Normal test runs always assert the actual shipped production assets.
function assetPath(path) {
  return process.env.ASTRA_CHARACTER_ASSET_DIR && /Civilian(?:Male|Female)Natural\.(?:glb|lod\.json)$/.test(path)
    ? resolve(process.env.ASTRA_CHARACTER_ASSET_DIR, path.split('/').at(-1))
    : new URL(`../public${path}`, import.meta.url);
}
function factory(t) {
  return factoryPromise ??= (async () => {
    const characters = await import('../src/characters.js');
    t.mock.method(GLTFLoader.prototype, 'loadAsync', async path => {
      const bytes = await readFile(assetPath(path));
      const loader = new GLTFLoader();
      loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
      return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    });
    t.mock.method(globalThis, 'fetch', async path => {
      const bytes = await readFile(assetPath(path));
      return { ok: true, json: () => JSON.parse(bytes.toString()) };
    });
    await characters.loadCharacterAssets();
    return characters;
  })();
}

for (const gender of ['male', 'female']) test(`${gender}: production eyelids animate without moving original head bones or unowned skin`, async t => {
  const { createCharacter } = await factory(t);
  let actor = createCharacter({ npc: true });
  if (!actor.mesh.userData.characterAsset.includes(`${gender} /`)) actor = createCharacter({ npc: true });
  const initial = actor.getFaceInfo();
  assert.equal(initial.supported, true, 'The shipped natural character must contain named eyelid targets');
  assert.equal(initial.meshes, 2, 'Opaque face and translucent lashes share the facial motion');
  let closedTime = 0;
  while (closedTime < 12) {
    const blink = sampleCharacterBlink(closedTime, initial.seed);
    if (blink.left > .999 && blink.right > .999) break;
    closedTime += .002;
  }
  assert.ok(closedTime < 12);
  // Several physics advances may happen before one presentation update.
  for (let time = 0; time < closedTime;) {
    const dt = Math.min(1 / 30, closedTime - time);
    actor.advance(dt, { seated: true }); time += dt;
  }
  actor.flushPose(); actor.mesh.updateMatrixWorld(true);
  const beforeBones = [], eyelids = [], unaffected = [];
  const point = new THREE.Vector3();
  actor.mesh.traverse(object => {
    if (object.isBone && !object.userData.astraEye) beforeBones.push({ object, position: object.position.toArray(), quaternion: object.quaternion.toArray() });
    if (!object.isSkinnedMesh || !Number.isInteger(object.morphTargetDictionary?.blinkRight)) return;
    object.skeleton.update();
    const targets = object.geometry.morphAttributes.position;
    const moved = [], still = [];
    const rendered = object.geometry.index ? new Set(object.geometry.index.array) : null;
    for (let index = 0; index < object.geometry.attributes.position.count; index++) {
      if (rendered && !rendered.has(index)) continue;
      const delta = Math.max(...targets.map(target => Math.hypot(target.getX(index), target.getY(index), target.getZ(index))));
      if (delta > 1e-8) moved.push({ index, delta });
      else if (still.length < 12 && !object.geometry.attributes._eye_side?.getX(index)) still.push(index);
    }
    moved.sort((a, b) => b.delta - a.delta);
    assert.ok(moved.length > 20, 'The exported target deforms an actual eyelid surface');
    for (const { index } of moved.slice(0, 12)) { object.getVertexPosition(index, point); object.localToWorld(point); eyelids.push({ object, index, before: point.clone() }); }
    for (const index of still) { object.getVertexPosition(index, point); object.localToWorld(point); unaffected.push({ object, index, before: point.clone() }); }
  });
  const camera = new THREE.PerspectiveCamera(55); camera.position.set(0, 1.5, 3);
  actor.updateLOD(camera);
  const closed = actor.getFaceInfo();
  assert.ok(closed.blinkLeft > .999 && closed.blinkRight > .999);
  assert.equal(closed.samples, 1, 'Physics advances defer facial application until presentation');
  assert.ok(Math.abs(closed.time - closedTime) < 1e-10);
  assert.ok(eyelids.length >= 24);
  for (const sample of eyelids) {
    sample.object.getVertexPosition(sample.index, point); sample.object.localToWorld(point);
    const displacement = point.distanceTo(sample.before);
    assert.ok(displacement > .002 && displacement < .03, `The actual lid closes by a plausible distance: ${displacement} m`);
  }
  for (const sample of unaffected) {
    sample.object.getVertexPosition(sample.index, point); sample.object.localToWorld(point);
    assert.ok(point.distanceTo(sample.before) < 1e-8, 'Unmorphed skin outside the explicitly owned gaze rig stays exactly still');
  }
  for (const before of beforeBones) {
    assert.deepEqual(before.object.position.toArray(), before.position);
    assert.deepEqual(before.object.quaternion.toArray(), before.quaternion);
  }
  for (let i = 0; i < 8; i++) { actor.advance(0, { seated: true }); actor.updateLOD(camera); }
  assert.equal(actor.getFaceInfo().time, closed.time);
  assert.equal(actor.getFaceInfo().samples, closed.samples);
  assert.equal(actor.getFaceInfo().writes, closed.writes, 'Paused presentation preserves a captured blink');
  camera.position.z = 60; camera.fov = 55;
  assert.equal(actor.updateLOD(camera), 2, 'The actual index LOD API selects simplified far geometry');
  assert.equal(actor.getFaceInfo().lodLevel, 2);
  assert.equal(actor.getFaceInfo().active, false);
  actor.mesh.traverse(object => {
    const dictionary = object.morphTargetDictionary;
    if (!dictionary) return;
    for (const name of ['blinkLeft', 'blinkRight']) if (Number.isInteger(dictionary[name])) {
      assert.equal(object.morphTargetInfluences[dictionary[name]], 0, 'Reduced distant faces always use neutral lids');
    }
  });
  // A photo zoom can restore full detail without unpausing game time.
  camera.fov = 8;
  assert.equal(actor.updateLOD(camera), 0);
  assert.equal(actor.getFaceInfo().time, closed.time);
  assert.equal(actor.getFaceInfo().blinkLeft, closed.blinkLeft);
  assert.equal(actor.getFaceInfo().blinkRight, closed.blinkRight);
  const another = createCharacter({ npc: true });
  assert.equal(another.getFaceInfo().blinkLeft, 0, 'One clone cannot write another actor’s eyelid weights');
});

test('Articulated fallback exposes unsupported facial diagnostics without inventing eye animation', async () => {
  const { createCharacter } = await import('../src/characters.js?unloaded-face-fallback');
  const actor = createCharacter(); actor.advance(.1, { dead: true });
  assert.equal(actor.getFaceInfo().supported, false);
  assert.equal(actor.getFaceInfo().blinkLeft, 0);
});
