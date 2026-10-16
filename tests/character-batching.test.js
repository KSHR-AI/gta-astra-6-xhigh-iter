import test from 'node:test';
import assert from 'node:assert/strict';
import { actor } from './helpers/character-animation-fixture.js';
const rigs = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];

for (const rig of rigs) {
  test(`${rig.model}: deferred evaluation preserves transient shot, hit, landing and reload state`, async () => {
    const immediate = await actor(rig), deferred = await actor(rig);
    for (const a of [immediate, deferred]) { a.animation.setWeapon(true); a.frame({ armed: true }, 60); }
    const events = [
      { armed: true, aiming: true, shooting: true, shotId: 1 },
      { armed: true, aiming: true, shooting: false, shotId: 1, hit: true, jumping: true, verticalVelocity: 3 },
      { armed: true, aiming: true, shooting: true, shotId: 2, hit: false, jumping: false, verticalVelocity: 0 },
      { armed: true, aiming: true, shooting: false, shotId: 2, reloading: true },
    ];
    const before = deferred.animation.getEvaluationStats();
    for (const options of events) {
      immediate.animation.update(1 / 60, options);
      deferred.animation.advance(1 / 60, options);
    }
    assert.equal(deferred.animation.getEvaluationStats().poses, before.poses);
    const actual = deferred.animation.getPoseInfo(), expected = immediate.animation.getPoseInfo();
    for (const key of ['aimWeight', 'readyWeight', 'reloadWeight', 'recoil', 'landingWeight', 'hitWeight', 'airborneWeight', 'deathWeight', 'reloadProgress', 'state']) assert.equal(actual[key], expected[key], key);
    assert.deepEqual(actual.locomotion, expected.locomotion);
    assert.ok(actual.recoil > 0, 'a transient shot is not lost when final shooting is false');
    const after = deferred.animation.getEvaluationStats();
    assert.equal(after.advances - before.advances, 4); assert.equal(after.poses - before.poses, 1);
    for (let i = 0; i < 5; i++) { deferred.animation.flushPose(); deferred.animation.getPoseInfo(); }
    assert.deepEqual(deferred.animation.getEvaluationStats(), after, 'read-only repeat queries never solve twice or advance time');
  });

  test(`${rig.model}: low-cadence displayed poses retain bounded limbs and feet`, async (t) => {
    const immediate = await actor(rig), deferred = await actor(rig);
    for (const a of [immediate, deferred]) a.frame({}, 90);
    let largestFootDifference = 0, largestHipDifference = 0, lowestFoot = Infinity;
    const before = deferred.animation.getEvaluationStats();
    for (let frame = 0; frame < 48; frame++) {
      const speed = frame < 20 ? 1.1 : frame < 32 ? 4.8 : frame < 40 ? 1.1 : 0;
      for (let substep = 0; substep < 6; substep++) {
        for (const a of [immediate, deferred]) a.mesh.position.z += speed / 30;
        immediate.animation.update(1 / 30, { speed }); deferred.animation.advance(1 / 30, { speed });
      }
      deferred.animation.flushPose();
      largestHipDifference = Math.max(largestHipDifference, immediate.pose.position('Hips').distanceTo(deferred.pose.position('Hips')));
      for (const side of ['Left', 'Right']) {
        const foot = deferred.pose.position(`${side}Foot`);
        largestFootDifference = Math.max(largestFootDifference, foot.distanceTo(immediate.pose.position(`${side}Foot`)));
        lowestFoot = Math.min(lowestFoot, foot.y);
      }
    }
    t.diagnostic(JSON.stringify({ largestFootDifference, largestHipDifference, lowestFoot }));
    assert.ok(largestHipDifference < .06);
    assert.ok(largestFootDifference < .15);
    assert.ok(lowestFoot > .025, 'ankles never tunnel through the ground at five displayed poses per second');
    const after = deferred.animation.getEvaluationStats();
    assert.equal(after.advances - before.advances, 48 * 6); assert.equal(after.poses - before.poses, 48);
  });
}

test('queued animation remains safe across holster, hit, teleport and immediate reset updates', async () => {
  const a = await actor(rigs[0]); a.animation.setWeapon(true); a.frame({ armed: true, aiming: true }, 60);
  a.animation.advance(1 / 30, { armed: true, shooting: true, shotId: 1 });
  const before = a.animation.getEvaluationStats();
  a.animation.setWeapon(false);
  assert.equal(a.animation.getEvaluationStats().poses, before.poses + 1, 'pending pose resolves before an external visibility mutation');
  a.animation.flushPose(); assert.equal(a.weapon.visible, false, 'a queued armed pose must never undo holstering');
  a.animation.advance(1 / 30, { speed: 1.1 }); a.animation.reactToHit(.8);
  assert.equal(a.animation.getPoseInfo().hitWeight, .8);
  a.animation.advance(1 / 30, { speed: 1.1 });
  a.mesh.position.set(100, 0, -80);
  a.animation.update(1, { seated: true, steering: .4 });
  const state = a.animation.getPoseInfo(), stats = a.animation.getEvaluationStats();
  assert.equal(state.state, 'driving'); assert.equal(stats.pending, false); assert.equal(stats.pendingTime, 0);
  assert.ok(state.pelvis.every(Number.isFinite));
  const saved = structuredClone(state);
  a.animation.flushPose(); assert.deepEqual(a.animation.getPoseInfo(), saved, 'reset leaves no old queued pose/time to replay');
});

for (const rig of rigs) test(`${rig.model}: production sole probes keep actual shoes grounded and contacts reachable at five Hz`, async (t) => {
  const a = await actor(rig), reference = await actor(rig); a.frame({}, 90); reference.frame({}, 90);
  let lowestReferenceShoe = Infinity;
  let lowestShoe = Infinity, maximumSettledSlide = 0, maximumExtension = 0, heldContacts = 0, planted = 0;
  let previous;
  for (let frame = 0; frame < 100; frame++) {
    const speed = frame < 60 ? 1.1 : frame < 80 ? 4.8 : 0;
    for (let substep = 0; substep < 6; substep++) {
      for (const current of [a, reference]) {
        if (frame >= 20 && frame < 60) current.mesh.rotation.y += .025;
        current.mesh.position.x += Math.sin(current.mesh.rotation.y) * speed / 30;
        current.mesh.position.z += Math.cos(current.mesh.rotation.y) * speed / 30;
      }
      a.animation.advance(1 / 30, { speed });
      reference.animation.update(1 / 30, { speed });
    }
    a.animation.flushPose();
    const sample = a.sampleFeet();
    lowestReferenceShoe = Math.min(lowestReferenceShoe, reference.sampleFeet().sole);
    assert.ok(sample.shoeVertices > 100, 'test measures the actual shoe surfaces, not ankle bones');
    lowestShoe = Math.min(lowestShoe, sample.sole);
    for (const side of ['Left', 'Right']) {
      const foot = sample.feet[side], before = previous?.feet[side];
      if (foot.planted) { planted++; maximumExtension = Math.max(maximumExtension, foot.extension); }
      if (before?.planted && foot.planted && before.weight > .95 && foot.weight > .95 && foot.anchor.every((value, i) => Math.abs(value - before.anchor[i]) < 1e-8)) {
        maximumSettledSlide = Math.max(maximumSettledSlide, Math.hypot(foot.world.x - before.world.x, foot.world.z - before.world.z));
        heldContacts++;
      }
    }
    previous = sample;
  }
  t.diagnostic(JSON.stringify({ lowestShoe, lowestReferenceShoe, maximumSettledSlide, maximumExtension, heldContacts, planted }));
  // The female source shoe already reaches roughly2.7cm below the floor in
  // the immediate controller during turns. Batching must not deepen that
  // existing asset/contact limitation; test allshoevertices instead of ankleheight.
  assert.ok(lowestShoe > -.03, `actual shoes stay within the existing3cm envelope: ${lowestShoe}`);
  assert.ok(lowestShoe >= lowestReferenceShoe - .005, 'batched contact does not worsen full-shoe penetration by more than5mm');
  assert.ok(maximumExtension < .9998, 'planted feet remain reachable without fully locked knees');
  assert.ok(heldContacts > 5 && planted > 15, 'real contacts occur, so no-slide cannot pass by never planting');
  assert.ok(maximumSettledSlide < .035, `a settled held contact shifts at most3.5cm per displayed frame: ${maximumSettledSlide}`);
});

test('one deferred solve per30Hz step retains ordinary near-character motion', async (t) => {
  const immediate = await actor(rigs[0]), deferred = await actor(rigs[0]);
  for (const a of [immediate, deferred]) a.frame({}, 90);
  let maximumFootDifference = 0;
  for (let frame = 0; frame < 180; frame++) {
    const speed = frame < 100 ? 1.1 : frame < 140 ? 4.8 : 0;
    for (const a of [immediate, deferred]) {
      if (frame > 30 && frame < 80) a.mesh.rotation.y += .02;
      a.mesh.position.x += Math.sin(a.mesh.rotation.y) * speed / 30;
      a.mesh.position.z += Math.cos(a.mesh.rotation.y) * speed / 30;
    }
    immediate.animation.update(1 / 30, { speed });
    deferred.animation.advance(1 / 30, { speed }); deferred.animation.flushPose();
    for (const side of ['Left', 'Right']) maximumFootDifference = Math.max(maximumFootDifference,
      immediate.pose.position(`${side}Foot`).distanceTo(deferred.pose.position(`${side}Foot`)));
  }
  t.diagnostic(JSON.stringify({ maximumFootDifference }));
  assert.ok(maximumFootDifference < .015, 'single-step deferred rendering matches ordinary motion within1.5cm');
});
