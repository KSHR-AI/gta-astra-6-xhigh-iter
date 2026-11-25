import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createPosedActorCollider, getAimPoint } from '../src/combat.js';

let factoryPromise;
function factory(t) {
  return factoryPromise ??= (async () => {
    const characters = await import('../src/characters.js');
    t.mock.method(GLTFLoader.prototype, 'loadAsync', async (path) => {
      const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
      const loader = new GLTFLoader();
      loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
      return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    });
    t.mock.method(globalThis, 'fetch', async (path) => {
      const bytes = await readFile(new URL(`../public${path}`, import.meta.url));
      return { ok: true, json: () => JSON.parse(bytes.toString()) };
    });
    await characters.loadCharacterAssets();
    return characters;
  })();
}

function bonesOf(actor) {
  const bones = {};
  actor.mesh.traverse(object => { if (object.isBone) bones[object.name.replace(/.*mixamorig[:_]?/i, '')] = object; });
  return bones;
}

function assertHitEnvelope(actor, volumes) {
  const before = actor.getEvaluationStats();
  const collider = createPosedActorCollider(actor);
  assert.deepEqual(actor.getEvaluationStats(), before, 'reading the broad phase never evaluates a pending pose');
  assert.ok(collider.bounds, 'production characters expose a conservative collision envelope');
  const containsSphere = (center, radius) => {
    for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
      const extreme = center.clone(); extreme[axis] += sign * radius;
      assert.ok(collider.bounds.containsPoint(extreme), 'posed hit volumes, including their radii, remain inside the envelope');
    }
  };
  for (const sphere of volumes.spheres) containsSphere(sphere.center, sphere.radius);
  for (const capsule of volumes.capsules) {
    containsSphere(capsule.start, capsule.radius); containsSphere(capsule.end, capsule.radius);
  }
  return collider;
}

function skinHeadCenter(actor, bones) {
  const bounds = new THREE.Box3(), point = new THREE.Vector3();
  actor.mesh.updateMatrixWorld(true);
  actor.mesh.traverse(object => {
    if (!object.isSkinnedMesh || !object.material.userData.naturalHuman) return;
    const head = object.skeleton.bones.indexOf(bones.Head);
    const { skinIndex, skinWeight, _hair_mask: hair } = object.geometry.attributes;
    for (let index = 0; index < skinIndex.count; index++) {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (skinIndex.getComponent(index, k) === head) weight += skinWeight.getComponent(index, k);
      if (weight < 0.8 || hair?.getX(index) > 0.5) continue;
      object.getVertexPosition(index, point); object.localToWorld(point); bounds.expandByPoint(point);
    }
  });
  return bounds.getCenter(new THREE.Vector3());
}

for (const gender of ['male', 'female']) {
  test(`${gender}: real posed head and torso hit volumes follow standing, seated and tilted characters`, async t => {
    const { createCharacter } = await factory(t);
    let actor = createCharacter({ npc: true });
    if (!actor.mesh.userData.characterAsset.includes(`${gender} /`)) actor = createCharacter({ npc: true });
    assert.ok(actor.mesh.userData.characterAsset.includes(`${gender} /`));
    const bones = bonesOf(actor);
    for (const seated of [false, true]) {
      for (const tilt of [false, true]) {
        actor.mesh.position.set(17, seated ? 0.5 : 0, -13);
        actor.mesh.rotation.set(tilt ? 0.055 : 0, 1.2, tilt ? -0.07 : 0);
        for (let i = 0; i < 90; i++) actor.update(1 / 60, { seated, steering: 0.6 });
        const snapshot = actor.getHitVolumes(), head = snapshot.spheres[0], torso = snapshot.capsules[0];
        assertHitEnvelope(actor, snapshot);
        assert.ok(head.center.distanceTo(skinHeadCenter(actor, bones)) < 0.035, 'head volume centers on the actual skinned skull, including its forward offset');
        assert.ok(head.center.distanceTo(bones.Head.getWorldPosition(new THREE.Vector3())) > 0.07, 'the Head joint at the neck is not mistaken for the face center');
        assert.ok(head.radius > 0.10 && head.radius < 0.20);
        assert.ok(torso.start.distanceTo(bones.Hips.getWorldPosition(new THREE.Vector3())) < 1e-8);
        assert.ok(torso.end.distanceTo(bones.Spine2.getWorldPosition(new THREE.Vector3())) < 1e-8);
        assert.ok(torso.radius >= 0.18 && torso.radius <= 0.25);
        const old = head.center.clone(), oldStart = torso.start.clone();
        const before = Object.values(bones).map(b => b.quaternion.toArray());
        const again = actor.getHitVolumes();
        assert.deepEqual(Object.values(bones).map(b => b.quaternion.toArray()), before, 'reading volumes does not change the animation pose');
        again.spheres[0].center.set(100, 100, 100); again.capsules[0].start.set(100, 100, 100);
        assert.deepEqual(head.center, old); assert.deepEqual(torso.start, oldStart);
      }
    }
    const uprightCenter = actor.mesh.worldToLocal(actor.getHitVolumes().spheres[0].center.clone());
    for (let i = 0; i < 180; i++) actor.update(1 / 60, { seated: true, dead: true });
    const downVolumes = actor.getHitVolumes();
    assertHitEnvelope(actor, downVolumes);
    const slumpedCenter = actor.mesh.worldToLocal(downVolumes.spheres[0].center.clone());
    assert.ok(slumpedCenter.y < uprightCenter.y - 0.10, `the posed skull volume follows the forward slump (${uprightCenter.y - slumpedCenter.y} m down)`);
    assert.ok(slumpedCenter.z > uprightCenter.z + 0.2, 'slumped head collision moves forward with the visible face');
    assert.ok(downVolumes.spheres[0].center.distanceTo(skinHeadCenter(actor, bones)) < 0.035, 'downed head collision still matches the current skinned geometry');
    const initial = actor.getHitVolumes();
    actor.mesh.scale.setScalar(1.2);
    const scaled = actor.getHitVolumes();
    assertHitEnvelope(actor, scaled);
    assert.ok(Math.abs(scaled.spheres[0].radius / initial.spheres[0].radius - 1.2) < 1e-7);
    assert.ok(Math.abs(scaled.capsules[0].radius / initial.capsules[0].radius - 1.2) < 1e-7);
    actor.advance(1 / 30, { seated: true, steering: -.5 });
    const pending = actor.getEvaluationStats();
    assert.equal(pending.pending, true);
    const collider = createPosedActorCollider(actor);
    getAimPoint({ cameraRay: new THREE.Ray(new THREE.Vector3(100, 100, 100), new THREE.Vector3(1, 0, 0)), actors: [collider] });
    assert.deepEqual(actor.getEvaluationStats(), pending, 'an unrelated aimed ray leaves actual driver animation deferred');
    const origin = collider.bounds.getCenter(new THREE.Vector3()); origin.x = collider.bounds.min.x - 1;
    getAimPoint({ cameraRay: new THREE.Ray(origin, new THREE.Vector3(1, 0, 0)), actors: [collider] });
    assert.equal(actor.getEvaluationStats().poses, pending.poses + 1, 'a plausible driver resolves its fresh pending pose exactly once');
    collider.getVolumes();
    assert.equal(actor.getEvaluationStats().poses, pending.poses + 1);
  });
}

test('articulated fallback exposes fresh volumes that follow its seated visual', async () => {
  const { createCharacter } = await import('../src/characters.js?unloaded-hit-volume-fallback');
  const actor = createCharacter();
  const standing = actor.getHitVolumes();
  actor.mesh.position.set(4, 0.5, -3); actor.mesh.rotation.set(0.05, 1.2, -0.06);
  actor.update(1 / 60, { seated: true });
  const seated = actor.getHitVolumes();
  const center = actor.mesh.worldToLocal(seated.spheres[0].center.clone());
  assert.ok(Math.abs(center.y - (1.63 - 0.94)) < 1e-8, 'fallback head drops with its pelvis anchoring');
  assert.ok(Math.abs(standing.spheres[0].center.y - 1.63) < 1e-8);
  assert.ok(seated.capsules[0].end.distanceTo(seated.capsules[0].start) > 0.3);
  actor.update(1 / 60, { seated: true, dead: true });
  const downHead = actor.mesh.worldToLocal(actor.getHitVolumes().spheres[0].center.clone());
  assert.ok(downHead.y < center.y - 0.09 && downHead.z > 0.3, 'fallback also slumps over its anchored pelvis');
  assert.ok(Math.abs(actor.getPoseInfo().pelvis[1]) < 1e-8);
});
