import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWeaponHandling, PISTOL } from '../src/weapon-handling.js';

// A fresh unloaded module exercises the actual network-failure factory without
// adding a production export or replacing the fallback with a test double.
const { createCharacter } = await import('../src/characters.js?fallback-aim-contract');
const frame = (actor, options, count=60) => {
  for(let i=0;i<count;i++)actor.update(1/60,options);
};
const equipped = () => {
  const actor=createCharacter();
  assert.equal(actor.mesh.userData.characterAsset,'Articulated fallback');
  actor.setWeapon(true);
  return actor;
};

test('fallback raises into the real handling readiness gate before the request expires', () => {
  const actor=equipped(), pistol=createWeaponHandling();
  assert.equal(actor.getAimState().ready,false);
  pistol.request(0,actor.getAimState().ready);
  let firedAt=null;
  for(let i=1;i<=60;i++) {
    actor.update(1/60,{aiming:true,shooting:pistol.queued,shotId:pistol.shots});
    if(pistol.consume(i/60,actor.getAimState().ready)) {
      assert.equal(firedAt,null,'one press cannot produce another round');
      firedAt=i/60;
      actor.applyShot(pistol.shots);
    }
  }
  assert.ok(firedAt>=PISTOL.raiseTime&&firedAt<=.38,`fallback fires within its input buffer: ${firedAt}`);
  assert.equal(pistol.shots,1);
  assert.equal(actor.getAimState().ready,true);
  const snapshot=actor.getAimState();snapshot.ready=false;snapshot.recoil=99;
  assert.equal(actor.getAimState().ready,true,'readiness snapshots cannot change the character');
  assert.notEqual(actor.getPoseInfo().aim.recoil,99);
});

test('fallback barrel follows local yaw/pitch and world target under translated tilted roots', () => {
  const actor=equipped();
  actor.mesh.position.set(17,.4,-8);actor.mesh.rotation.set(.07,1.1,-.04);
  frame(actor,{aiming:true,aimYaw:.8,aimPitch:.3});
  const expected=new THREE.Vector3(Math.sin(.8)*Math.cos(.3),Math.sin(.3),Math.cos(.8)*Math.cos(.3))
    .applyQuaternion(actor.mesh.getWorldQuaternion(new THREE.Quaternion()));
  assert.ok(actor.getMuzzleDirection().angleTo(expected)<1e-4);
  const target=actor.mesh.localToWorld(new THREE.Vector3(-4,2,8));
  const unchanged=target.clone();
  frame(actor,{aiming:true,aimTarget:target});
  const actual=actor.getMuzzleDirection();
  assert.ok(actual.angleTo(target.clone().sub(actor.getMuzzlePosition()).normalize())<.003);
  assert.equal(actor.getAimState().ready,true);
  assert.ok(Math.abs(actual.length()-1)<1e-12);
  assert.deepEqual(target,unchanged,'the world aim target is never modified');
  const output=new THREE.Vector3();assert.equal(actor.getMuzzleDirection(output),output);
});

test('fallback yaw limits and non-firing states cannot claim readiness', () => {
  for(const options of [{reloading:true},{seated:true},{dead:true},{interactionPhase:'enter',interactionProgress:.5},{armed:false}]) {
    const actor=equipped();frame(actor,{aiming:true});
    assert.equal(actor.getAimState().ready,true);
    actor.update(1/60,{aiming:true,...options});
    assert.equal(actor.getAimState().ready,false,JSON.stringify(options));
    assert.equal(actor.applyShot(1),false,'ineligible states do not accept a recoil event');
  }
  const actor=equipped();frame(actor,{aiming:true,aimTarget:new THREE.Vector3(0,1.4,-10)});
  assert.equal(actor.getAimState().ready,false,'a target behind the anatomical aim limit waits for the root turn');
  assert.equal(actor.getAimState().yawClamped,true);
  frame(actor,{aiming:true});actor.setWeapon(false);
  assert.equal(actor.getAimState().ready,false,'holstering immediately clears readiness');
});

test('fallback accepted-shot event is immediate, idempotent, and leaves body/interaction state untouched', () => {
  const actor=equipped();frame(actor,{aiming:true,speed:1.1});
  const weaponObjects=new Set();actor.weapon.traverse(object=>weaponObjects.add(object));
  const transforms=()=>{
    const values=[];
    actor.mesh.traverse(object=>{if(!weaponObjects.has(object))values.push([object.id,object.position.toArray(),object.quaternion.toArray(),object.scale.toArray()]);});
    return values;
  };
  const beforeBody=transforms(),beforeVolumes=actor.getHitVolumes(),beforeState=actor.mesh.userData.animationState;
  const beforeDirection=actor.getMuzzleDirection();
  assert.equal(actor.applyShot(7),true);
  assert.ok(actor.getAimState().recoil>0);
  assert.ok(actor.getMuzzleDirection().angleTo(beforeDirection)>.005,'the same presentation sees the weapon kick');
  assert.deepEqual(transforms(),beforeBody,'no body animation, gait, or interaction transform advances');
  assert.deepEqual(actor.getHitVolumes(),beforeVolumes);
  assert.equal(actor.mesh.userData.animationState,beforeState);
  const afterPose=actor.getPoseInfo(),afterDirection=actor.getMuzzleDirection();
  assert.equal(actor.applyShot(7),false);assert.equal(actor.applyShot(6),false);
  assert.deepEqual(actor.getPoseInfo(),afterPose);assert.deepEqual(actor.getMuzzleDirection(),afterDirection);
  actor.update(0,{aiming:true,speed:1.1,shooting:true,shotId:7});
  assert.equal(actor.getAimState().recoil,afterPose.recoil,'zero-time update does not repeat the already accepted event');
});

test('fallback automatic shot IDs and explicit acceptance share one recoil event', () => {
  const automatic=equipped(),explicit=equipped();
  frame(automatic,{aiming:true});frame(explicit,{aiming:true});
  automatic.update(0,{aiming:true,shooting:true,shotId:4});
  explicit.applyShot(4);
  assert.equal(automatic.getAimState().recoil,explicit.getAimState().recoil);
  for(let i=0;i<90;i++) {
    automatic.update(1/60,{aiming:true,shooting:true,shotId:4});
    explicit.update(1/60,{aiming:true});
    assert.equal(automatic.getAimState().recoil,explicit.getAimState().recoil,'held shooting does not accumulate recoil');
  }
  assert.ok(Math.abs(automatic.getAimState().recoil)<1e-5);
  assert.equal(automatic.getAimState().ready,true);
});
