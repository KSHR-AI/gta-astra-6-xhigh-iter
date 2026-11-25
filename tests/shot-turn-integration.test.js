import test from 'node:test';
import assert from 'node:assert/strict';
import {combatHarness,RIGS} from './helpers/shot-turn-fixture.js';
const jitter=[...Array(11).fill(.3471/11),.03299,...Array(30).fill(1/60)];
function close(h){assert.ok(Math.abs(h.metrics.totalDt-h.ctx.elapsed)<1e-12);const expected=h.metrics.frames.reduce((sum,f)=>sum+f.dt,0);assert.ok(Math.abs(h.ctx.elapsed-expected)<1e-12);}
for(const rig of RIGS){
 test(`${rig.model}: exact admissible jitter loses baseline tap and deadline visit preserves it`,async()=>{
  const shots=[];
  for(const schedule of['baseline','deadline']){
   const h=await combatHarness(rig,{distance:1.25,targetHeight:1.48,shoulderOffset:.55,schedule});h.setHeading(-Math.PI);h.press();h.release();
   for(const dt of jitter)h.frameDt(dt);
   close(h);shots.push(h.shotEvents);
   if(schedule==='baseline'){assert.equal(h.shotEvents.length,0);assert.ok(h.poseHistory.find(p=>p.ready).time>.38);}
   else{assert.equal(h.shotEvents.length,1);assert.ok(h.shotEvents[0].time<=.38);assert.equal(h.shotEvents[0].aim.yawClamped,false);assert.equal(h.handling.queued,false);assert.equal(h.ctx.state.ammo,11);}
   if(schedule==='deadline'){assert.equal(h.shotEvents[0].time,.38);assert.ok(h.metrics.frames.every(f=>f.calls<=f.nominal+1));assert.equal(h.metrics.frames.reduce((n,f)=>n+f.calls-f.nominal,0),1);}
  }
 });
 for(const raised of[false,true])for(const sign of[-1,1])test(`${rig.model}: ${raised?'ADS':'low-ready'} ${sign*180} turn under jitter preserves tap and immutable lifetime`,async()=>{
  const h=await combatHarness(rig,{raised,distance:1.25,targetHeight:1.48,shoulderOffset:.55,schedule:'deadline'});h.setHeading(sign*Math.PI);h.press();h.release();const expires=h.handling.pendingDeadline;
  for(const dt of jitter){h.frameDt(dt);if(h.handling.queued)assert.equal(h.handling.pendingDeadline,expires);}
  assert.equal(h.shotEvents.length,1);assert.ok(h.shotEvents[0].time<=expires);assert.ok(h.shotEvents[0].error<=Math.PI/60);assert.equal(h.shotEvents[0].aim.reachLimited,false);close(h);
  h.run(.5);assert.equal(h.shotEvents.length,1,'no extra shot after expiry');
 });
 test(`${rig.model}: genuinely unreachable target expires at boundary without delaying a ghost shot`,async()=>{
  const h=await combatHarness(rig,{distance:.8,schedule:'deadline'});h.press();for(const dt of jitter.slice(0,12))h.frameDt(dt);assert.equal(h.shotEvents.length,0);assert.equal(h.handling.queued,false);h.setTarget(90);h.run(.5);assert.equal(h.shotEvents.length,0);h.release();h.press();h.release();h.run(.5);assert.equal(h.shotEvents.length,1);
 });
}
for(const rig of RIGS){
 test(`${rig.model}: no-pending movement and pose trajectory is identical to baseline`,async()=>{
  const snapshots=[];
  for(const schedule of['baseline','deadline']){
   const h=await combatHarness(rig,{raised:false,schedule});h.ctx.keys.add('KeyW');
   for(const dt of[.016,.0317,.2,.03299,.017,.025])h.frameDt(dt);
   snapshots.push({position:h.a.mesh.position.toArray(),heading:h.a.mesh.rotation.y,history:h.poseHistory,frames:h.metrics.frames,pose:h.a.animation.getPoseInfo()});
  }
  assert.deepEqual(snapshots[0],snapshots[1]);
 });
 for(const degreesPerSecond of[-30,30,600])test(`${rig.model}: moving view ${degreesPerSecond}deg/s preserves bounded, physically eligible firing`,async()=>{
  for(const schedule of['baseline','deadline']){
   const h=await combatHarness(rig,{distance:1.25,targetHeight:1.48,shoulderOffset:.55,schedule});const initial=-179*Math.PI/180;h.setHeading(initial);h.press();h.release();
   for(const dt of jitter){h.setHeading(initial+degreesPerSecond*Math.PI/180*(h.ctx.elapsed+dt));h.frameDt(dt);}
   assert.ok(h.shotEvents.length<=1);assert.equal(h.handling.queued,false);close(h);
   for(const shot of h.shotEvents){assert.ok(shot.time<=.38);assert.equal(shot.aim.ready,true);assert.equal(shot.aim.yawClamped,false);assert.equal(shot.aim.reachLimited,false);assert.ok(shot.error<=Math.PI/60);}
  }
 });
 test(`${rig.model}: target becomes reachable before expiry, without resetting original deadline`,async()=>{
  for(const schedule of['baseline','deadline']){
   const h=await combatHarness(rig,{distance:.8,schedule});h.press();h.release();const deadline=h.handling.pendingDeadline;
   for(const dt of jitter.slice(0,11))h.frameDt(dt);assert.equal(h.shotEvents.length,0);h.setTarget(90);assert.equal(h.handling.pendingDeadline,deadline);h.frameDt(.03299);
   assert.equal(h.shotEvents.length,schedule==='deadline'?1:0);if(h.shotEvents.length)assert.equal(h.shotEvents[0].time,deadline);assert.equal(h.handling.queued,false);close(h);
  }
 });
}
