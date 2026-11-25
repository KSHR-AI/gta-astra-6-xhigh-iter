import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { measureCharacterScale } from '../src/character-scale.js';
import { createHumanoidAnimator } from '../src/character-animation.js';
import { makeSoleProbes } from '../src/characters.js';

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
  const normalization = measureCharacterScale(asset.scene, height);
  const mixer = new THREE.AnimationMixer(asset.scene);
  const actions = Object.fromEntries(clips.map((clip) => [clip.name.toLowerCase(), mixer.clipAction(THREE.AnimationClip.parse(clip))]));
  actions.idle.play(); mixer.update(0); mesh.updateMatrixWorld(true);
  visual.scale.setScalar(normalization.scale);
  asset.scene.position.y += normalization.offsetY;
  mesh.updateMatrixWorld(true);

  const soleProbes = makeSoleProbes(asset.scene), vertex = new THREE.Vector3();
  assert.ok(soleProbes.length >= 2, 'the actual imported shoes supply ground probes');
  const weapon = new THREE.Group(), magazine = new THREE.Group();
  mesh.add(weapon, magazine);
  const animator = createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine,
    soleProbes, restPose, bindHeadOrientation, npc: false });
  mesh.position.set(13, 0, -7);
  mesh.rotation.y = 1.13;
  const forward = new THREE.Vector3(Math.sin(mesh.rotation.y), 0, Math.cos(mesh.rotation.y));
  function frame(speed = 0, movementAngle = 0) {
    forward.set(Math.sin(mesh.rotation.y + movementAngle), 0, Math.cos(mesh.rotation.y + movementAngle));
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
    return { feet, sole, hip: info.pelvis[1], locomotion: info.locomotion };
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


for (const rig of RIGS) {
  test(`${rig.model}: slow pedestrians take shorter steps with low shoe clearance`, async () => {
    const measures = [];
    for (const speed of [1.1, 2.35]) {
      const actor = await fixture(rig);
      for (let i = 0; i < 120; i++) actor.frame(speed);
      const samples = Array.from({ length: 360 }, () => actor.frame(speed));
      measures.push(Object.fromEntries(['Left', 'Right'].map((side) => {
        const ankles = samples.map((sample) => sample.feet[side].local);
        return [side, {
          stride: Math.max(...ankles.map((p) => p.z)) - Math.min(...ankles.map((p) => p.z)),
          clearance: Math.max(...ankles.map((p) => p.y)) - Math.min(...ankles.map((p) => p.y)),
        }];
      })));
    }
    for (const side of ['Left', 'Right']) {
      assert.ok(measures[0][side].stride < measures[1][side].stride * 0.82, `${side} shortens its slow-speed arc, instead of using full-size steps in slow motion`);
      for (const gait of measures) {
        assert.ok(gait[side].clearance > 0.07 && gait[side].clearance < 0.15,
          `${side} clears the pavement without the source soldier's 20–23 cm marching step (${gait[side].clearance} m)`);
      }
    }
  });

  test(`${rig.model}: sprint stopping blends the gait without a pelvis or ankle snap`, async () => {
    let maximumHipStep = 0, maximumFootStep = 0;
    // Stopping is phase-dependent. Test both support and swing phases rather
    // than selecting one convenient point in the animation cycle.
    for (const phase of [0, 10, 20, 30, 40]) {
      const actor = await fixture(rig);
      for (let i = 0; i < 120 + phase; i++) actor.frame(5.8);
      let previous = actor.frame(5.8);
      for (let i = 0; i < 60; i++) {
        const sample = actor.frame(0);
        maximumHipStep = Math.max(maximumHipStep, Math.abs(sample.hip - previous.hip));
        for (const side of ['Left', 'Right']) maximumFootStep = Math.max(maximumFootStep,
          sample.feet[side].world.distanceTo(previous.feet[side].world));
        previous = sample;
      }
    }
    assert.ok(maximumHipStep < 0.018, `stopping pelvis change stays below 1.8 cm per 60 Hz frame (${maximumHipStep})`);
    assert.ok(maximumFootStep < 0.12, `stopping ankle motion stays below 12 cm per frame (${maximumFootStep})`);
  });

  test(`${rig.model}: side steps keep shoes apart and preserve planted support`, async () => {
    for (const direction of [-Math.PI / 2, Math.PI / 2]) {
      const actor = await fixture(rig);
      for (let i = 0; i < 120; i++) actor.frame(1.5, direction);
      const samples = Array.from({ length: 360 }, () => actor.frame(1.5, direction));
      assert.ok(Math.min(...samples.map((sample) => sample.feet.Left.local.x - sample.feet.Right.local.x)) > 0.09,
        'ankles retain at least 9 cm of separation instead of crossing through one another');
      const slip = [];
      for (const side of ['Left', 'Right']) {
        for (let i = 1; i < samples.length; i++) {
          const current = samples[i].feet[side], previous = samples[i - 1].feet[side];
          if (current.planted && previous.planted && current.weight > 0.98) {
            slip.push(Math.hypot(current.world.x - previous.world.x, current.world.z - previous.world.z) / DT);
          }
        }
      }
      assert.ok(slip.length > 24, 'both directions establish measurable support contacts');
      assert.ok(percentile(slip, 0.95) < 0.25, 'side-step support p95 slip remains below 0.25 m/s');
    }
  });

  test(`${rig.model}: changing travel direction releases support without an ankle pop`, async () => {
    const actor = await fixture(rig);
    for (let i = 0; i < 120; i++) actor.frame(1.5);
    let previous = actor.frame(1.5), maximumStep = 0;
    for (const direction of [Math.PI / 2, Math.PI, -Math.PI / 2, 0]) {
      for (let i = 0; i < 60; i++) {
        const sample = actor.frame(1.5, direction);
        for (const side of ['Left', 'Right']) maximumStep = Math.max(maximumStep,
          sample.feet[side].world.distanceTo(previous.feet[side].world));
        previous = sample;
      }
    }
    assert.ok(maximumStep < 0.10, `an ankle moves less than 10 cm in a 60 Hz direction-change frame (${maximumStep})`);
    assert.ok(Math.abs(previous.locomotion.movementAngle) < 0.001, 'a full turn returns the local travel direction to forward');
  });
}
