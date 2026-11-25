import test from 'node:test';
import assert from 'node:assert/strict';
import { createNightShift, SHIFT_STOPS, SHIFT_PULL_OFF } from '../src/night-shift.js';

const landmarks = { garage:{x:28,z:-126} };
function session() {
  let saved;
  const receipts = [];
  const car = { speed:0, health:100, model:{mesh:{position:{...landmarks.garage}}} };
  const job = createNightShift(null, {landmarks, save(){saved=job.checkpoint()}, finish(reward,receipt){receipts.push(receipt);saved=job.checkpoint()}});
  function act(point, kind, vehicle = car) {
    if (vehicle) vehicle.model.mesh.position = {...point};
    return job.interact('shift-'+kind, {vehicle, position:point});
  }
  return {job, car, act, receipts, saved:()=>saved};
}
test('stationary commercial pickups, two distinct orders, dispatch settlement once per pair', () => {
  const {job,car,act,receipts,saved}=session();
  car.speed=3;
  assert.deepEqual(act(landmarks.garage,'start'),{});
  car.speed=0;
  for (const pair of [[0,2],[2,0],[1,2]]) {
    assert.ok(act(landmarks.garage,'start').shiftInteraction);
    for (const i of pair) {
      const point=SHIFT_STOPS[i];
      assert.deepEqual(act(landmarks.garage,'load-'+point.id),{});
      assert.ok(act(point,'load-'+point.id).shiftInteraction);
      assert.deepEqual(act(point,'load-'+point.id),{});
    }
    assert.ok(act(landmarks.garage,'deliver').shiftDelivered);
    assert.deepEqual(act(landmarks.garage,'deliver'),{});
    job.restore(saved());
  }
  assert.deepEqual(receipts.map(r=>r.reward),[600,0,600]);
  assert.equal(job.screeningUnlocked(),true);
  assert.match(receipts[0].replayHint,/First screening/);
  assert.ok(receipts.slice(1).every(receipt=>!receipt.replayHint.includes('screening')));
});
test('rough driving reduces the fee, straps recover once per leg, missing car reloads at last order', () => {
  const {job,car,act,saved}=session();
  act(landmarks.garage,'start');act(SHIFT_STOPS[0],'load-sunline');
  car.health=62;
  job.update({vehicle:car,dt:.016,slip:1});
  const damage=job.view().nightShiftCargo;
  assert.ok(damage<75);
  assert.ok(act(SHIFT_PULL_OFF,'secure').shiftInteraction);
  assert.equal(job.view().nightShiftCargo,damage+15);
  assert.deepEqual(act(SHIFT_PULL_OFF,'secure'),{});
  job.restore(saved());
  assert.equal(job.view().target.id,'sunline');
  assert.deepEqual(act(SHIFT_STOPS[1],'load-paloma'),{});
  assert.ok(act(SHIFT_STOPS[0],'recover').shiftInteraction);
  assert.ok(act(SHIFT_STOPS[1],'load-paloma').shiftInteraction);
  assert.ok(act(SHIFT_STOPS[1],'cancel',null).shiftInteraction);
  assert.equal(job.active(),false);
});
test('malformed optional progress cannot create a loaded order or a payout', () => {
  const {job,act}=session();
  job.restore({running:true,orders:['warehouse','warehouse',null],paid:['fake'],condition:Infinity});
  assert.equal(job.view().nightShiftCargo,100);
  assert.deepEqual(job.checkpoint().orders,[]);
  assert.deepEqual(act(landmarks.garage,'deliver'),{});
});
test('glass suffers most under braking and reels suffer most in a skid', () => {
  function run(stop, speed, slip) {
    const {job, car, act} = session();
    act(landmarks.garage,'start');
    act(stop,'load-'+stop.id);
    car.speed=18;
    job.update({vehicle:car,dt:.1,slip:0});
    car.speed=speed;
    for(let i=0;i<20;i++) job.update({vehicle:car,dt:.1,slip});
    return job.view().nightShiftCargo;
  }
  const [glass,linen,reels]=SHIFT_STOPS;
  assert.ok(run(glass,2,0)<run(linen,2,0));
  assert.ok(run(reels,18,1)<run(glass,18,1));
});
test('Mara, Vale, and the race gate let the player explicitly release freight on foot', () => {
  const garage = landmarks.garage, contact = {x:-16,z:16.8};
  const car = {speed:0,health:100,model:{mesh:{position:garage}}};
  for(const point of [contact,{x:-16,z:23.1},{x:-5,z:28}]) {
    const job=createNightShift(null,{landmarks:{garage,contact},save(){}});
    job.interact('shift-start',{vehicle:car,position:garage});
    assert.match(job.action(point,null).name,/Cancel freight/);
    assert.equal(job.active(),true);
    job.interact('shift-cancel',{position:point});
    assert.equal(job.active(),false);
  }
});

test('marking a pickup guides the driver through arrival until loading or clearing it', () => {
  const {job,car,act,saved}=session();
  const [glass,linen,reels]=SHIFT_STOPS;
  assert.equal(job.selectPickup(reels),null);
  act(landmarks.garage,'start');
  assert.equal(job.view().target,glass);
  assert.equal(job.pickupNear({x:reels.x+5,z:reels.z}),null);
  job.selectPickup({x:reels.x+3,z:reels.z+2});
  assert.equal(job.view().target,reels);
  assert.equal(job.view().secondaryTarget,glass);
  assert.equal(job.view().objectiveTitle,'Pier access road');
  assert.match(job.view().objective,/projection reels/);
  assert.equal(job.checkpoint().selectedPickup,'pier');
  job.restore(saved());
  assert.equal(job.view().nightShiftSelectedPickup,reels);
  car.model.mesh.position={...reels};
  job.update({vehicle:car});
  assert.equal(job.view().target,reels);
  assert.equal(job.action(reels,car).kind,'shift-load-pier');
  job.selectPickup(null);
  assert.equal(job.view().target,glass);
  job.selectPickup(linen);
  job.selectPickup({x:10,z:12});
  assert.equal(job.view().nightShiftSelectedPickup,null);
  job.selectPickup(reels);
  act(reels,'load-pier');
  assert.equal(job.view().nightShiftSelectedPickup,null);
  assert.equal(job.selectPickup(reels),null);
  assert.equal(job.view().target,glass);
  job.selectPickup(linen);
  job.restore(saved());
  assert.equal(job.view().objectiveTitle,'Recover the freight');
  assert.equal(job.view().target,reels);
  assert.equal(job.view().nightShiftSelectedPickup,null);
  act(reels,'recover');
  assert.equal(job.view().target,linen);
  act(linen,'load-paloma');
  assert.equal(job.view().objectiveTitle,'Unload at Auto Works');
  assert.equal(job.view().nightShiftSelectedPickup,null);
  assert.equal(job.selectPickup(glass),null);
  assert.equal(job.checkpoint().selectedPickup,undefined);
});
