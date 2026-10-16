import test from 'node:test';
import assert from 'node:assert/strict';
import { actor } from './helpers/character-animation-fixture.js';
import { advanceGroundedPosition } from '../src/character-grounding.js';

const rigs = [
  { model: 'CivilianMaleNatural.glb', motion: 'civilian-male-motion.json', height: 1.82 },
  { model: 'CivilianFemaleNatural.glb', motion: 'pedestrian-motion.json', height: 1.76 },
];

test('a 24 cm city curb wholly inside the shoe footprint still supports the real sole', async () => {
  const groundHeightAt = (_x, z) => z >= .04 && z <= .28 ? .34 : .0345;
  const a = await actor({ ...rigs[1], groundHeightAt });
  a.mesh.position.y = .0345; a.frame({}, 90);
  const vertex = a.mesh.position.clone();
  let heel = Infinity, toe = -Infinity;
  for (const probe of a.soleProbes.filter(probe => probe.side === 'Right')) {
    probe.object.getVertexPosition(probe.index, vertex); probe.object.localToWorld(vertex);
    heel = Math.min(heel, vertex.z); toe = Math.max(toe, vertex.z);
  }
  assert.equal(groundHeightAt(0, heel), .0345, 'both heel corners lie behind the curb');
  assert.equal(groundHeightAt(0, toe), .0345, 'both toe corners lie beyond the curb');
  assert.equal(groundHeightAt(0, (heel + toe) / 2), .34, 'the actual city-width curb crosses the sole center');
  const sample = a.sampleFeet();
  assert.ok(sample.feet.Right.clearance > -.002, 'every rendered right-shoe vertex clears the interior curb');
  assert.ok(sample.feet.Right.sole > .338 && sample.feet.Right.sole < .346, 'the curb physically supports the sole');
  assert.ok(sample.feet.Right.extension < .99, 'the supported knee retains a natural bend');
});

for (const rig of rigs) {
  for (const hz of [5, 60]) test(`${rig.model}: ${hz}-Hz stopped stance returns to a relaxed upright pelvis`, async (t) => {
    const a = await actor(rig); a.frame({}, 180);
    const snapshot = () => {
      const sample = a.sampleFeet(), info = a.animation.getPoseInfo();
      const legs = Object.fromEntries(['Left', 'Right'].map(side => {
        const hip = a.pose.position(`${side}UpLeg`), knee = a.pose.position(`${side}Leg`), foot = a.pose.position(`${side}Foot`);
        const flexion = 180 - hip.sub(knee).angleTo(foot.sub(knee)) * 180 / Math.PI;
        return [side, { flexion, extension: sample.feet[side].extension, clearance: sample.feet[side].clearance }];
      }));
      return { pelvis: info.pelvis[1], head: a.pose.position('Head').y, lift: info.neutralPelvisLift, legs };
    };
    const fresh = snapshot();
    assert.ok(fresh.lift > .035 && fresh.lift < .09, 'the measured rifle-idle crouch needs a plausible 3.5–9 cm correction');
    let maximumReturnHeight = 0;
    for (const speed of [2.35, 0, 5.8, 0]) {
      for (let frame = 0; frame < hz * 2; frame++) {
        for (let substep = 0; substep < 60 / hz; substep++) {
          a.mesh.position.z += speed / 60;
          a.animation.advance(1 / 60, { speed });
        }
        a.animation.flushPose();
      }
      if (speed) {
        assert.ok(a.animation.getPoseInfo().standingWeight < .001, 'standing posture fades out during full gait');
        continue;
      }
      const stopped = snapshot();
      maximumReturnHeight = Math.max(maximumReturnHeight, Math.abs(stopped.pelvis - fresh.pelvis));
      assert.ok(Math.abs(stopped.head - fresh.head) < .008, 'stopping restores the fresh standing head height without accumulating lift');
      for (const leg of Object.values(stopped.legs)) {
        assert.ok(leg.flexion > 15 && leg.flexion < 27, 'standing knees retain a relaxed bend rather than the source crouch or a lock');
        assert.ok(leg.extension > .975 && leg.extension < .99);
        assert.ok(leg.clearance > -.002 && leg.clearance < .006, 'upright posture keeps both actual shoe surfaces supported');
      }
    }
    assert.ok(maximumReturnHeight < .004, 'fresh and stopped pelvis heights agree within 4 mm');
    t.diagnostic(JSON.stringify({ lift: fresh.lift, legs: fresh.legs, maximumReturnHeight }));
  });

  test(`${rig.model}: placement, resets and landing keep the sole at the real raised surface`, async (t) => {
    const groundHeightAt = () => .22, a = await actor({ ...rig, groundHeightAt });
    a.mesh.position.y = .22; a.animation.update(1 / 60, {});
    assert.equal(a.animation.getPoseInfo().surfaceOffset, 0, 'initial placement is not a step');
    a.frame({}, 60);
    a.mesh.position.y += .15; a.animation.advance(1 / 60, {});
    assert.ok(a.animation.getPoseInfo().surfaceOffset < -.1);
    a.mesh.position.y = .22; a.animation.resetGrounding(); a.animation.update(0, {});
    assert.equal(a.animation.getPoseInfo().surfaceOffset, 0, 'explicit teleport reset clears the visual step');
    let velocity = 5, minimum = Infinity, landings = 0;
    for (let frame = 0; frame < 105; frame++) {
      const support = advanceGroundedPosition(a.mesh.position, a.mesh.position.clone(), velocity, 1 / 60, groundHeightAt);
      velocity = support.verticalVelocity;
      a.animation.update(1 / 60, { jumping: support.height > .01, verticalVelocity: velocity });
      const sample = a.sampleFeet(), info = a.animation.getPoseInfo();
      if (support.height === 0) {
        minimum = Math.min(minimum, sample.clearance);
        if (info.landingWeight > .05) landings++;
      }
    }
    t.diagnostic(JSON.stringify({ minimum, landings }));
    assert.ok(landings > 8, 'test covers the impact compression, not just the eventual idle');
    assert.ok(minimum > -.002, 'impact compresses the legs while actual shoe surfaces stay above the pavement');
  });
  test(`${rig.model}: real sole surfaces remain grounded through idle, gait, aiming and five-Hz turns`, async (t) => {
    let lowest = Infinity, highestSupport = -Infinity, contacts = 0;
    for (const mode of ['idle', 'walk', 'run', 'turn', 'aim', 'turn5Hz']) {
      const a = await actor(rig); a.frame({}, 90);
      if (mode === 'aim') a.animation.setWeapon(true);
      const speed = { idle: 0, walk: 2.35, run: 5.8, turn: 1.1, aim: 1.5, turn5Hz: 1.1 }[mode];
      const batches = mode === 'turn5Hz' ? 6 : 1, dt = mode === 'turn5Hz' ? 1 / 30 : 1 / 60;
      for (let frame = 0; frame < 150; frame++) {
        for (let substep = 0; substep < batches; substep++) {
          if (mode.includes('turn') || mode === 'aim') a.mesh.rotation.y += dt * .9;
          a.mesh.position.x += Math.sin(a.mesh.rotation.y) * speed * dt;
          a.mesh.position.z += Math.cos(a.mesh.rotation.y) * speed * dt;
          a.animation.advance(dt, { speed, armed: mode === 'aim', aiming: mode === 'aim' });
        }
        const sample = a.sampleFeet();
        lowest = Math.min(lowest, sample.clearance);
        for (const foot of Object.values(sample.feet)) {
          if (mode === 'idle' || foot.planted && foot.weight > .98) {
            contacts++;
            highestSupport = Math.max(highestSupport, foot.clearance);
          }
        }
      }
    }
    t.diagnostic(JSON.stringify({ lowest, highestSupport, contacts }));
    assert.ok(lowest > -.002, 'all rendered shoe vertices, including unprobed edges, stay within 2 mm of the surface');
    assert.ok(highestSupport < .006, 'each settled anatomical sole supports its own foot within 6 mm');
    assert.ok(contacts > 500, 'real support is retained throughout the gaits');
  });

  test(`${rig.model}: anatomical feet independently support road and sidewalk with ten terrain queries`, async () => {
    let queries = 0;
    const groundHeightAt = x => { queries++; return x > 0 ? .22 : .0345; };
    const a = await actor({ ...rig, groundHeightAt }); a.mesh.position.y = .0345; a.frame({}, 90);
    for (let frame = 0; frame < 30; frame++) {
      queries = 0; a.animation.update(1 / 30, {});
      assert.equal(queries, 10, 'the support query is per footprint corner and center, never per shoe vertex');
      const sample = a.sampleFeet();
      assert.ok(sample.feet.Left.sole > .218 && sample.feet.Left.sole < .226);
      assert.ok(sample.feet.Right.sole > .0325 && sample.feet.Right.sole < .0405);
      for (const foot of Object.values(sample.feet)) assert.ok(foot.extension < .99);
    }
  });

  for (const hz of [5, 30]) test(`${rig.model}: ${hz}-Hz step ascent and descent preserve posed sole clearance and reachable support`, async (t) => {
    let minimum = Infinity, extension = 0, pelvisStep = 0;
    for (const ascending of [true, false]) {
      const groundHeightAt = (_x, z) => (z > .6) === ascending ? .22 : .0345;
      const a = await actor({ ...rig, groundHeightAt });
      a.mesh.position.y = groundHeightAt(0, 0); a.frame({}, 90);
      let previousHip = a.bones.Hips.getWorldPosition(a.mesh.position.clone()).y;
      for (let frame = 0; frame < hz * 4; frame++) {
        for (let step = 0; step < 30 / hz; step++) {
          a.mesh.position.z += 1.1 / 30;
          a.mesh.position.y = groundHeightAt(0, a.mesh.position.z);
          a.animation.advance(1 / 30, { speed: 1.1 });
        }
        const sample = a.sampleFeet();
        minimum = Math.min(minimum, sample.clearance);
        for (const foot of Object.values(sample.feet)) if (foot.planted) extension = Math.max(extension, foot.extension);
        const hip = a.bones.Hips.getWorldPosition(a.mesh.position.clone()).y;
        pelvisStep = Math.max(pelvisStep, Math.abs(hip - previousHip)); previousHip = hip;
      }
    }
    t.diagnostic(JSON.stringify({ minimum, extension, pelvisStep }));
    assert.ok(minimum > -.003, 'full posed shoes clear both levels through the real root-height transition');
    assert.ok(extension < .9998, 'a held step contact never locks the knee to reach its anchor');
    assert.ok(pelvisStep < (hz === 30 ? .075 : .20), 'the torso softens the surface discontinuity while physics stays on the exact surface');
  });
}
