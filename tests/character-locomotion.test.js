import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createHumanoidAnimator } from '../src/character-animation.js';

const RIGS = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];
const DT = 1 / 60;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)];

async function fixture({ model, motion, height }) {
  const bytes = await readFile(new URL(`../public/models/${model}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'TEST_SKIP_RASTER_DECODE', loadTexture: () => Promise.resolve(new THREE.Texture()) }));
  const asset = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const mesh = new THREE.Group(), visual = new THREE.Group();
  mesh.add(visual); visual.add(asset.scene);
  const bones = {}, restPose = {}, skinned = [];
  asset.scene.traverse((object) => {
    if (object.isSkinnedMesh) skinned.push(object);
    if (!/mixamorig/i.test(object.name)) return;
    const name = object.name.replace(/.*mixamorig[:_]?/i, '');
    bones[name] = object;
    restPose[name] = object.quaternion.clone();
  });
  const bindHeadOrientation = bones.Head.getWorldQuaternion(new THREE.Quaternion());
  const clips = JSON.parse(await readFile(new URL(`../public/models/${motion}`, import.meta.url), 'utf8'));
  const mixer = new THREE.AnimationMixer(asset.scene);
  const actions = Object.fromEntries(clips.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(asset.scene);
  visual.scale.setScalar(height / (bounds.max.y - bounds.min.y));
  asset.scene.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);

  // Use actual shoe vertices, spread across both soles, so ankle-height
  // calibration exercises the different male/female shoe and leg geometry.
  const soleProbes = [], vertex = new THREE.Vector3();
  for (const object of skinned) {
    const candidates = [];
    for (let index = 0; index < object.geometry.attributes.position.count; index++) {
      object.getVertexPosition(index, vertex); object.localToWorld(vertex);
      if (vertex.y < 0.085) candidates.push({ index, position: vertex.clone() });
    }
    candidates.sort((a, b) => a.position.y - b.position.y);
    if (!candidates.length) continue;
    const selected = [candidates[0]];
    while (selected.length < Math.min(12, candidates.length)) {
      let farthest, greatest = -1;
      for (const candidate of candidates) {
        const distance = Math.min(...selected.map((chosen) => candidate.position.distanceToSquared(chosen.position)));
        if (distance > greatest) { greatest = distance; farthest = candidate; }
      }
      if (!farthest || greatest < 1e-6) break;
      selected.push(farthest);
    }
    for (const { index } of selected) soleProbes.push({ object, index });
  }
  assert.ok(soleProbes.length >= 2, 'the actual imported shoes supply ground probes');
  const weapon = new THREE.Group(), magazine = new THREE.Group();
  mesh.add(weapon, magazine);
  const animator = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine,
    soleProbes, restPose, bindHeadOrientation, npc: false });
  mesh.position.set(13, 0, -7);
  mesh.rotation.y = 1.13;
  const forward = new THREE.Vector3(Math.sin(mesh.rotation.y), 0, Math.cos(mesh.rotation.y));
  function frame(speed = 0) {
    mesh.position.addScaledVector(forward, speed * DT);
    animator.update(DT, { speed });
    mesh.updateMatrixWorld(true);
    const info = animator.getPoseInfo();
    const feet = Object.fromEntries(['Left', 'Right'].map((side) => {
      const world = bones[`${side}Foot`].getWorldPosition(new THREE.Vector3());
      const hip = bones[`${side}UpLeg`].getWorldPosition(new THREE.Vector3());
      const knee = bones[`${side}Leg`].getWorldPosition(new THREE.Vector3());
      const extension = hip.distanceTo(world) / (hip.distanceTo(knee) + knee.distanceTo(world));
      return [side, { world, local: mesh.worldToLocal(world.clone()), extension,
        ...info.footContacts.find((contact) => contact.side === side) }];
    }));
    let sole = Infinity;
    for (const probe of soleProbes) {
      probe.object.getVertexPosition(probe.index, vertex);
      probe.object.localToWorld(vertex); mesh.worldToLocal(vertex);
      sole = Math.min(sole, vertex.y);
    }
    return { feet, sole, hip: info.pelvis[1] };
  }
  for (let i = 0; i < 60; i++) frame();
  return { frame };
}

for (const rig of RIGS) {
  for (const [gait, speed] of [['walk', 2.35], ['sprint', 5.8]]) {
    test(`${rig.model}: ${gait} gives both feet real support without sliding or locked knees`, async () => {
      const actor = await fixture(rig);
      for (let i = 0; i < 120; i++) actor.frame(speed);
      const samples = Array.from({ length: 360 }, () => actor.frame(speed));
      assert.ok(Math.min(...samples.map((sample) => sample.sole)) > -0.02, 'posed shoe vertices stay above the floor within 2 cm');
      const hipRange = Math.max(...samples.map((sample) => sample.hip)) - Math.min(...samples.map((sample) => sample.hip));
      assert.ok(hipRange < 0.10, `locomotion keeps pelvis bounce below 10 cm, got ${hipRange}`);
      for (const side of ['Left', 'Right']) {
        let contactAge = 0, contactFrames = 0;
        const settledSpeeds = [];
        for (let i = 1; i < samples.length; i++) {
          const foot = samples[i].feet[side], previous = samples[i - 1].feet[side];
          if (!foot.planted) { contactAge = 0; continue; }
          contactFrames++; contactAge += DT;
          if (contactAge > 0.1 && foot.weight > 0.95) {
            assert.ok(foot.extension < 0.9995, `${side} releases an unreachable anchor before locking the knee straight`);
            settledSpeeds.push(Math.hypot(foot.world.x - previous.world.x, foot.world.z - previous.world.z) / DT);
          }
        }
        // A missing plant cannot pass as a perfectly stationary foot. This
        // catches a low forward swing consuming the actual touchdown event.
        assert.ok(contactFrames / samples.length > 0.17, `${side} establishes support on every gait cycle`);
        assert.ok(settledSpeeds.length >= 12, `${side} has enough sustained contacts to measure slipping`);
        const p95 = percentile(settledSpeeds, 0.95);
        assert.ok(p95 < 0.25, `${side} planted-foot p95 ground speed is below 0.25 m/s, got ${p95}`);
        const clearance = Math.max(...samples.map((sample) => sample.feet[side].local.y))
          - Math.min(...samples.map((sample) => sample.feet[side].local.y));
        assert.ok(clearance > (gait === 'walk' ? 0.08 : 0.25), `${side} retains a real swing phase`);
      }
    });
  }

  test(`${rig.model}: entering a walk blends pelvis height without the initial upward snap`, async () => {
    const actor = await fixture(rig);
    let previous = actor.frame(), maximumStep = 0;
    for (let i = 0; i < 30; i++) {
      const sample = actor.frame(2.35);
      maximumStep = Math.max(maximumStep, Math.abs(sample.hip - previous.hip));
      previous = sample;
    }
    assert.ok(maximumStep < 0.018, `pelvis moves less than 1.8 cm in a 60 Hz startup frame, got ${maximumStep}`);
  });
}
