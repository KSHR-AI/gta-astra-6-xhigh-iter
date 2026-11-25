import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { actor } from './helpers/character-animation-fixture.js';

const rig = { model:'CivilianFemaleNatural.glb', motion:'pedestrian-motion.json', height:1.72 };
const point = (a,bone) => a.bones[bone].getWorldPosition(new THREE.Vector3());

test('briefing, handoff and shutter use distinct hand destinations and return to idle', async () => {
  const a = await actor(rig);
  a.frame({},90);
  const idle = point(a,'RightHand');
  a.animation.performGesture('briefing');
  a.frame({},50);
  const briefing = point(a,'RightHand');
  assert.ok(briefing.distanceTo(idle) > .22);
  a.animation.performGesture('handoff');
  a.frame({},45);
  const handoff = point(a,'RightHand');
  assert.ok(handoff.z > idle.z+.20);
  assert.ok(handoff.x > briefing.x+.12);
  a.frame({},150);
  assert.ok(point(a,'RightHand').distanceTo(idle)<.035);
  a.frame({ambientGesture:'shutter',gestureProgress:.64},4);
  assert.ok(point(a,'RightHand').y > handoff.y+.18);
});

test('door reach follows the supplied world handle after actor translation and rotation',async()=>{
  const a=await actor(rig);
  a.mesh.position.set(3,0,5);a.mesh.rotation.y=.7;a.frame({},60);
  const target=a.mesh.localToWorld(new THREE.Vector3(.27,1.12,.27));
  const options={interactionPhase:'enter',interactionProgress:.35};
  a.frame(options,15);
  const before = point(a,'LeftHand').distanceTo(target);
  a.frame({...options,doorHandleTarget:target},15);
  assert.ok(point(a,'LeftHand').distanceTo(target)<before*.75);
});

for (const subject of [rig,{model:'CivilianMaleNatural.glb',motion:'civilian-male-motion.json',height:1.82}])
test(subject.model+' rear lamp inspection lowers the stance, reaches the lens and releases into movement',async()=>{
  const a=await actor({...subject,groundHeightAt:(x,z)=>.035+.04*x+.02*z});
  a.mesh.position.set(3,.035+.04*3+.02*5,5);
  a.mesh.rotation.y=.8;
  a.frame({},90);
  const normalHip=point(a,'Hips').y;
  const lamp=a.mesh.localToWorld(new THREE.Vector3(-.16,.727,.43));
  a.frame({inspectionTarget:lamp},65);
  assert.equal(a.animation.getPoseInfo().state,'inspecting');
  assert.ok(point(a,'Hips').y < normalHip-.24);
  assert.ok(point(a,'RightHandIndex2').distanceTo(lamp)<.055);
  assert.ok(a.sampleFeet().clearance>-.012);
  a.frame({speed:2.35},1);
  assert.ok(point(a,'Hips').y < normalHip-.16);
  a.frame({speed:2.35},45);
  assert.equal(a.animation.getPoseInfo().state,'walking');
});
