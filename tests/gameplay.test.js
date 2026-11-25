import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LAST_LIGHT_FORK, LAST_LIGHT_ROUTES } from '../src/last-light.js';
import { SCREENING_AUDIENCE, createMission, readProgress } from '../src/missions.js';
import { createCitySimulation, hasSight } from '../src/simulation.js';

const SAVE_KEY = 'grand-theft-astra:coastal-job:v1';
const point = (x = 0, z = 0) => new THREE.Vector3(x, 0, z);

function memoryStorage(initial) {
  const entries = new Map(initial === undefined ? [] : [[SAVE_KEY, typeof initial === 'string' ? initial : JSON.stringify(initial)]]);
  return {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
}

function missionFixture(storage = memoryStorage()) {
  const landmarks = { contact: point(-15, 20), garage: point(15, -100), safehouse: point(70, 30) };
  const heroPosition = point(5, 18);
  const dialogue = [], toasts = [], completions = [];
  const mission = createMission({
    landmarks, getHeroPosition: () => heroPosition, storage,
    onDialogue: (speaker, lines) => dialogue.push({ speaker, lines }),
    onToast: (title, detail) => toasts.push({ title, detail }),
    onComplete: result => completions.push(result),
  });
  return { mission, storage, landmarks, heroPosition, dialogue, toasts, completions };
}

function carAt(x, z, extra = {}) {
  const mesh = new THREE.Object3D();
  mesh.position.copy(point(x, z));
  return { model: { mesh, update() {}, setDamage() {}, setDoor() {} }, heading: 0, steer: 0, speed: 0, health: 100, routeIndex: 0, ...extra };
}

function pedestrianAt(x, z, extra = {}) {
  const mesh = new THREE.Object3D();
  mesh.position.copy(point(x, z));
  return { actor: { mesh, update() {} }, home: point(x, z), down: false, fleeUntil: 0, reportingUntil: 0, ...extra };
}

function simulationFixture({ policePosition = [0, 200], pedestrians = [], colliders = [], officers = [] } = {}) {
  const police = carAt(...policePosition, { police: true });
  const toasts = [], policeShots = [];
  const simulation = createCitySimulation({
    vehicles: [police], pedestrians, police, officers, world: { colliders },
    moveBody(position, dx, dz) { position.x += dx; position.z += dz; return false; },
    carsOverlap: () => false,
    getPoliceShotGeometry: () => ({ player: { object: playerPosition, position: playerPosition }, groundY: .04 }),
    policeRandom: () => 0,
    onPoliceShot: shot => policeShots.push(shot),
    onToast: (title, detail) => toasts.push({ title, detail }),
  });
  const playerPosition = point();
  const tick = time => simulation.update(.1, { playerPosition, currentCar: null, time });
  return { simulation, police, pedestrians, playerPosition, tick, toasts, policeShots };
}

function prepareAurora(fixture) {
  const { mission, heroPosition } = fixture;
  const hero = carAt(heroPosition.x, heroPosition.z, { isJobCar: true, heading: Math.PI });
  const rear = point(heroPosition.x,heroPosition.z+2.4);
  if (mission.getState().mission===0) mission.interact('contact');
  mission.onVehicleTaken(hero);
  assert.equal(mission.getState().mission,1,'Boarding before the required inspection cannot advance');
  assert.equal(mission.inspectAction(rear,null,hero).kind,'inspect');
  mission.interact('inspect',{position:rear,jobVehicle:hero});
  mission.update({dt:1.5,position:rear,jobVehicle:hero});
  assert.equal(mission.getState().lastLight.inspected,true);
  mission.onVehicleTaken(hero);
  return hero;
}

function driveTo(mission,hero,pointWanted) {
  hero.model.mesh.position.set(pointWanted.x,0,pointWanted.z);
  mission.update({vehicle:hero,jobVehicle:hero,wanted:0,policeState:'clear',dt:.13});
}

for (const [branch,health] of [['boulevard',100],['service',72]]) {
  test(`Last Light pays once after physically completing the ${branch} route`, () => {
    const fixture=missionFixture();
    const {mission,landmarks,completions,storage}=fixture;
    const hero=prepareAurora(fixture);
    assert.equal(mission.getState().target,LAST_LIGHT_FORK);
    driveTo(mission,hero,landmarks.garage);
    assert.deepEqual(mission.interact('garage',{vehicle:hero}),{});
    driveTo(mission,hero,LAST_LIGHT_FORK);
    assert.equal(mission.getState().lastLight.phase,'fork');
    assert.equal(mission.getState().secondaryTarget,LAST_LIGHT_ROUTES.service[0]);
    hero.health=health;
    for (const gate of LAST_LIGHT_ROUTES[branch]) driveTo(mission,hero,gate);
    assert.equal(mission.getState().mission,3);
    assert.equal(mission.getState().target,landmarks.garage);
    assert.deepEqual(mission.interact('garage',{vehicle:hero}),{},'Park in the actual bay');
    driveTo(mission,hero,landmarks.garage);
    assert.deepEqual(mission.interact('garage',{vehicle:hero,wanted:2,policeState:'pursuit'}),{});
    hero.speed=4;
    assert.deepEqual(mission.interact('garage',{vehicle:hero}),{});
    hero.speed=0;
    assert.equal(mission.interact('garage',{vehicle:hero}).delivered,true);
    const bonus=health>=85?500:0;
    assert.equal(mission.getState().money,2750+bonus);
    assert.equal(mission.getState().completedJobs,1);
    assert.equal(mission.getState().mission,5);
    assert.equal(completions[0].basePay,1500);assert.equal(completions[0].cleanBonus,bonus);
    assert.equal(completions[0].reward,1500+bonus);
    mission.interact('garage',{vehicle:hero});
    assert.equal(completions.length,1);
    const restored=missionFixture(storage).mission;
    assert.deepEqual(restored.getState().target,landmarks.garage);
    assert.equal(restored.getState().money,2750+bonus);
    assert.equal(restored.getState().lastLight.routeRecords[branch],health);
    assert.deepEqual(restored.interact('garage',{vehicle:hero}),{});
  });
}

test('the lamp check waits for a reachable stance and player input interrupts it near the bumper',()=>{
  const {mission,heroPosition}=missionFixture();
  const hero=carAt(heroPosition.x,heroPosition.z,{isJobCar:true,heading:Math.PI});
  const rear=point(heroPosition.x,heroPosition.z+2.4);
  mission.interact('contact');
  mission.interact('inspect',{position:rear,jobVehicle:hero});
  mission.update({dt:2,position:rear,jobVehicle:hero,inspectionReady:false});
  assert.equal(mission.inspectionRemaining,1.4);
  mission.update({dt:.75,position:rear,jobVehicle:hero});
  mission.update({dt:.1,position:rear,jobVehicle:hero,interruptInspection:true});
  assert.equal(mission.inspectionRemaining,0);
  assert.equal(mission.getState().lastLight.inspected,false);
  assert.equal(mission.inspectAction(rear,null,hero).kind,'inspect');
});

test('The inspection can be interrupted, and walking away from the assigned car keeps the route checkpoint',()=>{
  const {mission,heroPosition}=missionFixture(), hero=carAt(heroPosition.x,heroPosition.z,{isJobCar:true,heading:Math.PI});
  const rear=point(heroPosition.x,heroPosition.z+2.4);
  mission.interact('contact');
  mission.interact('inspect',{position:rear,jobVehicle:hero});
  mission.update({dt:1.6,position:point(100,100),jobVehicle:hero});
  assert.equal(mission.getState().lastLight.inspected,false);
  mission.interact('inspect',{position:rear,jobVehicle:hero});
  mission.update({dt:1.6,position:rear,jobVehicle:hero});
  mission.onVehicleTaken(hero);
  driveTo(mission,hero,LAST_LIGHT_FORK);driveTo(mission,hero,LAST_LIGHT_ROUTES.service[0]);
  mission.update({vehicle:null,jobVehicle:hero,position:rear,wanted:0,policeState:'clear'});
  assert.equal(mission.getState().target,heroPosition);
  assert.equal(mission.getState().lastLight.mile,1);
  assert.equal(mission.interact('recover').replaceJobCar,true);
  assert.equal(mission.getState().mission,1);
  assert.equal(mission.getState().jobCarCheckpoint.x,27);
});

test('Wreck/reload retain earned route milestones and a lost bonus without granting the reward',()=>{
  const f=missionFixture(),hero=prepareAurora(f);
  driveTo(f.mission,hero,LAST_LIGHT_FORK);
  driveTo(f.mission,hero,LAST_LIGHT_ROUTES.service[0]);
  hero.health=0;
  assert.equal(f.mission.update({jobVehicle:hero,vehicle:null}).replaceJobCar,true);
  const restored=missionFixture(f.storage).mission;
  assert.equal(restored.getState().mission,1);
  assert.equal(restored.getState().lastLight.cleanEligible,false);
  assert.equal(restored.getState().money,1250);
  hero.health=100;restored.onVehicleTaken(hero);
  assert.equal(restored.getState().target,LAST_LIGHT_ROUTES.service[1]);
  assert.equal(restored.getState().deliveryQuote.cleanBonus,0);
});

test('Legacy active jobs restart at the inspection and preserve wallet, radio and circuit records',()=>{
  for(const stage of [1,2,3]){
    const storage=memoryStorage({version:1,stage,money:1612,completedJobs:3,circuitBest:44,roomTone:{phase:'finished',site:'boulevard'}});
    const {mission}=missionFixture(storage);
    assert.equal(mission.getState().mission,1);
    assert.equal(mission.getState().lastLight.inspected,false);
    assert.equal(mission.getState().radioPhase,'finished');
    assert.equal(mission.getState().money,1612);
    assert.equal(mission.getState().circuitBest,44);
  }
});

test('Practice runs on a paid save remain unpaid across a mid-route reload',()=>{
  const f=missionFixture(memoryStorage({version:1,stage:5,money:3100,completedJobs:2}));
  assert.equal(f.mission.interact('replay').replayAccepted,true);
  const hero=prepareAurora(f);
  driveTo(f.mission,hero,LAST_LIGHT_FORK);driveTo(f.mission,hero,LAST_LIGHT_ROUTES.boulevard[0]);
  const restored=missionFixture(f.storage);
  restored.mission.onVehicleTaken(hero);
  driveTo(restored.mission,hero,LAST_LIGHT_ROUTES.boulevard[1]);
  driveTo(restored.mission,hero,restored.landmarks.garage);
  restored.mission.interact('garage',{vehicle:hero});
  assert.equal(restored.mission.getState().money,3100);
  assert.equal(restored.mission.getState().completedJobs,2);
  assert.equal(restored.completions[0].reward,0);
});
test('A paid delivery survives reload without granting a second reward; a fresh session clears it', () => {
  const storage = memoryStorage({ version: 1, stage: 4, money: 2750, completedJobs: 1, savedAt: 1700000000000 });
  const { mission, landmarks, completions } = missionFixture(storage);
  assert.equal(mission.getState().target, landmarks.safehouse);
  mission.interact('garage', { vehicle: { isJobCar: true, health: 100 } });
  assert.equal(mission.getState().money, 2750);
  assert.equal(completions.length, 0);
  assert.equal(mission.interact('safehouse').rest, true);
  mission.fresh();
  assert.equal(mission.getState().mission, 0);
  assert.equal(mission.getState().money, 1250);
  assert.equal(mission.getState().completedJobs, 0);
  assert.equal(mission.getState().savedAt, null);
  assert.equal(readProgress(storage), null);
});

test('Malformed or incompatible saves cannot replace a new player session', async t => {
  const invalid = [
    ['invalid JSON', '{not json'],
    ['null', 'null'],
    ['unknown version', { version: 2, stage: 1, money: 1250 }],
    ['missing balance', { version: 1, stage: 1 }],
    ['non-numeric balance', { version: 1, stage: 1, money: '1250' }],
    ['fractional stage', { version: 1, stage: 1.5, money: 1250 }],
    ['stage out of range', { version: 1, stage: 6, money: 1250 }],
    ['negative stage', { version: 1, stage: -1, money: 1250 }],
    ['non-numeric job count', { version: 1, stage: 4, money: 2750, completedJobs: 'many' }],
    ['fractional job count', { version: 1, stage: 4, money: 2750, completedJobs: 1.5 }],
  ];
  for (const [name, value] of invalid) {
    await t.test(name, () => {
      const storage = memoryStorage(value);
      assert.equal(readProgress(storage), null);
      const { mission } = missionFixture(storage);
      assert.equal(mission.getState().mission, 0);
      assert.equal(mission.getState().money, 1250);
    });
  }
});

test('Unavailable persistence never claims a save succeeded, while the job remains playable', async t => {
  const unavailable = [
    ['no storage', null],
    ['storage is read-only', { getItem: () => null }],
    ['storage denies access', { getItem() { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); }, removeItem() { throw new Error('Storage disabled'); } }],
  ];
  for (const [name, storage] of unavailable) {
    await t.test(name, () => {
      const { mission } = missionFixture(storage);
      assert.equal(mission.interact('contact').accepted, true);
      assert.equal(mission.getState().mission, 1);
      assert.equal(mission.getState().saveAvailable, false);
      assert.equal(mission.getState().savedAt, null, 'The menu must not advertise a nonexistent continue save');
      mission.fresh();
      assert.equal(mission.getState().mission, 0);
    });
  }
});

test('Buildings block sight across horizontal, vertical and diagonal streets, but leave open routes visible', () => {
  const box = { minX: 4, maxX: 6, minZ: -2, maxZ: 2 };
  assert.equal(hasSight(point(0, 0), point(10, 0), [box]), false);
  assert.equal(hasSight(point(10, 0), point(0, 0), [box]), false, 'Visibility must be symmetric');
  assert.equal(hasSight(point(5, -10), point(5, 10), [box]), false);
  assert.equal(hasSight(point(0, -5), point(10, 5), [box]), false);
  assert.equal(hasSight(point(0, 5), point(10, 5), [box]), true);
  assert.equal(hasSight(point(0, 0), point(3, 0), [box]), true, 'A building behind the target must not block sight');
  assert.equal(hasSight(point(0, 0), point(10, 0), []), true);
  assert.equal(hasSight(point(0, 0), point(10, 0), [{...box,occludesSight:false}]), true, 'Glass shelters and low cafe furniture must not conceal a witnessed crime');
  assert.equal(hasSight(point(0, 0), point(10, 0), [{...box,occludesSight:false},box]), false, 'A solid wall behind transparent furniture still blocks sight');
});

test('An unseen theft stays quiet; a witness needs time to report before police are dispatched', () => {
  const quiet = simulationFixture();
  assert.equal(quiet.simulation.reportCrime({ position: point(), now: 10 }).policeState, 'clear');
  assert.equal(quiet.tick(20).wanted, 0);

  const witness = pedestrianAt(5, 0);
  const { simulation, tick, toasts } = simulationFixture({ pedestrians: [witness] });
  const reported = simulation.reportCrime({ position: point(), now: 10 });
  assert.equal(reported.policeState, 'reported');
  assert.equal(reported.wanted, 0);
  assert.ok(witness.fleeUntil > 10, 'Witnesses should react to the theft');
  const pending = tick(13.4);
  assert.equal(pending.policeState, 'reported');
  assert.equal(pending.wanted, 0);
  assert.ok(pending.reportProgress > 0 && pending.reportProgress < 1);
  const dispatched = tick(13.5);
  assert.equal(dispatched.wanted, 1);
  assert.equal(dispatched.policeState, 'pursuit');
  assert.ok(toasts.some(({ title }) => title === 'POLICE DISPATCHED'));
});

test('Hiding out of sight completes a search; being spotted resets escape progress', () => {
  const { simulation, police, tick } = simulationFixture({ pedestrians: [pedestrianAt(5, 0)] });
  simulation.reportCrime({ position: point(), now: 10 });
  tick(13.5);
  assert.equal(tick(16.1).policeState, 'searching');
  const halfway = tick(22.1);
  assert.ok(halfway.searchProgress > .45 && halfway.searchProgress < .55);
  police.model.mesh.position.copy(point(0, 10));
  const spotted = tick(22.2);
  assert.equal(spotted.policeState, 'pursuit');
  assert.equal(spotted.searchProgress, 0);
  assert.equal(spotted.wanted, 1);
  police.model.mesh.position.copy(point(0, 200));
  assert.equal(tick(25).policeState, 'searching');
  assert.equal(tick(36.9).wanted, 1, 'A fresh search must run its full duration');
  const escaped = tick(37.1);
  assert.equal(escaped.policeState, 'clear');
  assert.equal(escaped.wanted, 0);
  assert.equal(escaped.lastKnown, null);
});

test('A patrol that witnesses a crime reacts immediately, but walls protect an unseen player', () => {
  const open = simulationFixture({ policePosition: [0, 15] });
  assert.equal(open.simulation.reportCrime({ position: point(), level: 2, now: 10 }).wanted, 2);
  assert.equal(open.simulation.getState().policeState, 'pursuit');
  const hidden = simulationFixture({ policePosition: [0, 15], colliders: [{ minX: -5, maxX: 5, minZ: 5, maxZ: 10 }] });
  assert.equal(hidden.simulation.reportCrime({ position: point(), level: 2, now: 10 }).policeState, 'clear');
  assert.equal(hidden.tick(20).wanted, 0);
});

test('Gunshots can be heard through a building even when the theft itself was not visible', () => {
  const { simulation } = simulationFixture({ pedestrians: [pedestrianAt(15, 0)], colliders: [{ minX: 5, maxX: 10, minZ: -5, maxZ: 5 }] });
  assert.equal(simulation.reportCrime({ position: point(), kind: 'theft', now: 10 }).policeState, 'clear');
  assert.equal(simulation.reportCrime({ position: point(), kind: 'gunshot', level: 2, now: 11 }).policeState, 'reported');
});

test('Reset cancels a pending witness call so a fresh session cannot inherit wanted heat', () => {
  const { simulation, tick } = simulationFixture({ pedestrians: [pedestrianAt(5, 0)] });
  simulation.reportCrime({ position: point(), level: 3, now: 10 });
  assert.equal(simulation.getState().policeState, 'reported');
  simulation.reset();
  const state = tick(30);
  assert.equal(state.policeState, 'clear');
  assert.equal(state.wanted, 0);
  assert.equal(state.reportProgress, 0);
  assert.equal(state.lastKnown, null);
});

test('Driving the stolen patrol car does not let the empty car track its own thief forever', () => {
  const { simulation, police, playerPosition } = simulationFixture({ policePosition: [0, 0] });
  simulation.reportCrime({ position: playerPosition, level: 1, now: 0 });
  assert.equal(simulation.getState().wanted, 1);
  // No officers or other witnesses remain outside the car. The player has taken the patrol vehicle.
  const hidden = simulation.update(.1, { playerPosition, currentCar: police, time: 3 });
  assert.equal(hidden.policeState, 'searching');
  const escaped = simulation.update(.1, { playerPosition, currentCar: police, time: 15.1 });
  assert.equal(escaped.wanted, 0);
  assert.equal(escaped.policeState, 'clear');
});

test('A second witnessed crime raises the pending alert without restarting the witness call', () => {
  const { simulation, tick } = simulationFixture({ pedestrians: [pedestrianAt(5, 0)] });
  simulation.reportCrime({ position: point(), level: 1, now: 10 });
  simulation.reportCrime({ position: point(), kind: 'gunshot', level: 3, now: 12 });
  assert.equal(tick(13.5).wanted, 3, 'The original report deadline must still dispatch the raised alert');
});

test('A browser that blocks the localStorage property can still load and play the briefing', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('SecurityError: storage access denied'); } });
  try {
    assert.equal(readProgress(), null);
    const mission = createMission({
      landmarks: { contact: point(), garage: point(0, 30), safehouse: point(30, 0) },
      getHeroPosition: () => point(4, 18),
    });
    assert.equal(mission.interact('contact').accepted, true);
    assert.equal(mission.getState().saveAvailable, false);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});


function officerActor() {
  const mesh = new THREE.Object3D();
  mesh.visible = false;
  return { mesh, update() {}, getMuzzlePosition(target) { return target.copy(mesh.position).add(new THREE.Vector3(0, 1.4, 0)); } };
}

test('Repeated gunfire cannot extend the initial police warning grace indefinitely', t => {
  t.mock.method(Math, 'random', () => .9);
  const { simulation, tick, policeShots } = simulationFixture({ policePosition: [0, 10], officers: [officerActor()] });
  simulation.reportCrime({ position: point(), now: 0 });
  for (let time = 2; time <= 12; time += 2) {
    simulation.reportCrime({ position: point(), kind: 'gunshot', now: time });
    tick(time + .1);
  }
  assert.equal(policeShots.length, 6);
  assert.deepEqual(policeShots.slice(0, 2).map(shot => shot.hit), [false, false], 'The first encounter still provides a warning window');
  assert.ok(policeShots.slice(2).every(shot => shot.hit), 'Returning fire cannot reset the damage grace period');
});

test('Escaping fully grants a new warning grace when another police encounter begins', t => {
  t.mock.method(Math, 'random', () => .9);
  const officer = officerActor();
  const { simulation, police, tick, policeShots } = simulationFixture({ policePosition: [0, 10], officers: [officer] });
  simulation.reportCrime({ position: point(), now: 0 });
  tick(7.1);
  assert.equal(policeShots.at(-1).hit, true);
  police.model.mesh.position.copy(point(0, 200));
  officer.mesh.position.copy(point(0, 200));
  assert.equal(tick(10).policeState, 'searching');
  assert.equal(tick(22.1).policeState, 'clear');
  police.model.mesh.position.copy(point(0, 10));
  simulation.reportCrime({ position: point(), now: 23 });
  tick(23.1);
  assert.equal(policeShots.at(-1).hit, false, 'A distinct encounter grants the player time to react');
  tick(29.2);
  assert.equal(policeShots.at(-1).hit, true, 'The new grace also ends normally');
});

test('A visible officer keeps the pursuit active even when a building hides the patrol car', t => {
  t.mock.method(Math, 'random', () => .9);
  const officer = officerActor();
  officer.mesh.visible = true;
  officer.mesh.position.copy(point(3, 2));
  const { simulation, tick } = simulationFixture({
    policePosition: [0, 10], officers: [officer],
    colliders: [{ minX: -2, maxX: 2, minZ: 5, maxZ: 7 }],
  });
  simulation.reportCrime({ position: point(), now: 0, force: true });
  assert.equal(tick(3.5).wanted, 1);
  assert.equal(tick(6.2).policeState, 'pursuit');
  assert.equal(tick(20).wanted, 1, 'Visible officers must prevent a successful escape');
  officer.mesh.userData.downUntil = 100;
  assert.equal(tick(23).policeState, 'searching', 'An incapacitated officer cannot maintain visual contact');
  assert.equal(tick(35.1).policeState, 'clear');
});

test('An officer who has not deployed cannot reveal the player from a hidden mesh position', () => {
  const officer = officerActor();
  officer.mesh.position.copy(point(3, 2));
  const { simulation, tick } = simulationFixture({ policePosition: [0, 200], officers: [officer] });
  simulation.reportCrime({ position: point(), now: 0, force: true });
  tick(3.5);
  assert.equal(officer.mesh.visible, false);
  assert.equal(tick(6.2).policeState, 'searching');
  assert.equal(tick(18.3).policeState, 'clear');
});

test('Pacific Circuit accepts free-roam drivers, pays once and preserves the best lap', () => {
  const storage = memoryStorage({ version: 1, stage: 5, money: 2750, completedJobs: 1 });
  const { mission, completions } = missionFixture(storage);
  const vehicle = carAt(-5, 28);
  const start = () => mission.interact('circuit', { vehicle });
  const update = dt => mission.update({ vehicle, dt, wanted: 0, policeState: 'clear' });
  assert.deepEqual(missionFixture().mission.interact('circuit', { vehicle }), {});
  assert.deepEqual(mission.interact('circuit'), {});
  assert.equal(start().startedCircuit, true);
  assert.deepEqual(start(), {});
  for (const secondsPerGate of [8, 12]) {
    if (!mission.getState().circuitActive) start();
    const firstGate = mission.getState().target;
    vehicle.model.mesh.position.set(firstGate.x, 0, firstGate.z);
    assert.equal(mission.getState().circuitSignal, '3');
    for (const signal of ['2', '1']) {
      update(1);
      assert.equal(mission.getState().circuitSignal, signal);
      assert.equal(mission.getState().missionProgress, 0);
    }
    vehicle.model.mesh.position.set(-5, 0, 28);
    update(1);
    assert.equal(mission.getState().circuitSignal, 'GO');
    for (let gate = 0; gate < 5; gate++) {
      const { target, missionProgress } = mission.getState();
      assert.equal(missionProgress, gate / 5);
      vehicle.model.mesh.position.set(target.x, 0, target.z);
      update(secondsPerGate);
    }
    update(1);
  }
  assert.deepEqual(completions.map(result => result.reward), [750, 500]);
  assert.equal(mission.getState().money, 4000);
  assert.equal(mission.getState().completedJobs, 3);
  assert.equal(missionFixture(storage).mission.getState().circuitBest, 40);
  mission.fresh();
  assert.equal(mission.getState().circuitBest, null);
});

test('the courtesy race returns a fresh player to Mara after interruption, finish and reload', () => {
  const { mission, storage, landmarks } = missionFixture();
  const vehicle = carAt(-8, 28, { circuitLoaner: true });
  const desk = point(-16, 23.1);
  const start = () => mission.interact('circuit', { vehicle });
  assert.equal(start().startedCircuit, true);
  assert.deepEqual(mission.interact('radio-start', { position: desk }), {});
  assert.deepEqual(mission.interact('contact'), {});
  mission.update({ dt: 1, vehicle: null });
  assert.deepEqual(mission.getState().target, landmarks.contact);
  assert.equal(mission.getState().money, 1250);
  assert.equal(start().startedCircuit, true);
  for (let gate = 0; gate < 5; gate++) {
    const target = mission.getState().target;
    vehicle.model.mesh.position.set(target.x, 0, target.z);
    mission.update({ dt: 8, vehicle });
  }
  for (const state of [mission.getState(), missionFixture(storage).mission.getState()]) {
    assert.equal(state.mission, 0);
    assert.deepEqual(state.target, landmarks.contact);
    assert.equal(state.money, 2000);
  }
  mission.interact('radio-start', { position: desk });
  assert.deepEqual(start(), {});
  assert.equal(missionFixture(storage).mission.getState().mission, 0);
});

test('Interrupted circuits allow a clean restart without payment', () => {
  const { mission, completions } = missionFixture(memoryStorage({ version: 1, stage: 5, money: 2750 }));
  const vehicle = carAt(-5, 28);
  for (const event of [{ dt: 94, vehicle }, { vehicle: null }, { vehicle: carAt(0, 0) }]) {
    assert.equal(mission.interact('circuit', { vehicle }).startedCircuit, true);
    mission.update(event);
    assert.equal(mission.getState().circuitActive, false);
    assert.equal(mission.getState().money, 2750);
  }
  assert.equal(completions.length, 0);
});

test('Room Tone restores a usable recording checkpoint and pays once after the chosen take', () => {
  for (const [site, position, seconds, fee] of [
    ['courtyard', point(-28,37), 3, 350], ['boulevard', point(-13.5,-40), 4, 650],
  ]) {
    const desk = point(-16,23.1);
    const { mission, storage } = missionFixture();
    assert.equal(mission.radioAction(desk, null).kind, 'radio-start');
    assert.deepEqual(mission.interact('radio-start', { position }), {});
    mission.interact('radio-start', { position: desk });
    mission.interact('radio-' + site, { position });
    assert.equal(missionFixture(storage).mission.getState().radioPhase, 'choosing');
    mission.update({ position, dt: 1 });
    mission.interact('radio-cut', { position });
    assert.equal(mission.getState().radioPhase, 'choosing');
    mission.interact('radio-' + site, { position });
    mission.update({ position, dt: seconds });
    mission.interact('radio-cut', { position });
    const restored = missionFixture(storage);
    assert.equal(restored.mission.getState().radioPhase, 'returning');
    assert.equal(restored.mission.getState().money, 1250);
    restored.mission.interact('radio-return', { position: desk });
    restored.mission.interact('radio-return', { position: desk });
    assert.equal(restored.mission.getState().money, 1250 + fee);
    assert.equal(restored.mission.getState().completedJobs, 1);
    assert.equal(restored.completions.length, 1);
    assert.equal(missionFixture(storage).mission.getState().radioPhase, 'finished');
    assert.equal(restored.mission.getState().mission, 0);
    restored.mission.fresh();
    assert.equal(restored.mission.getState().radioPhase, 'available');
  }
});

test('Room Tone permits switching locations after missing the cue, leaving or cancelling', () => {
  const { mission, landmarks } = missionFixture();
  const desk=point(-16,23.1), position=point(-28,37);
  mission.interact('radio-start',{position:desk});
  mission.interact('radio-courtyard',{position});
  mission.update({position,dt:9});
  assert.equal(mission.getState().radioPhase,'choosing');
  mission.interact('radio-courtyard',{position});
  mission.update({position:desk,dt:1});
  assert.equal(mission.radioAction(desk,null).kind,'radio-cancel');
  mission.interact('radio-cancel',{position:desk});
  assert.equal(mission.getState().radioPhase,'available');
  assert.equal(mission.getState().target,landmarks.contact);
});

test('Dispatch and story activities cannot overlap, and freight survives reload and cancellation', () => {
  const f=missionFixture(memoryStorage({version:1,stage:5,money:2750,completedJobs:1}));
  const car=carAt(f.landmarks.garage.x,f.landmarks.garage.z);
  const m=f.mission;
  assert.equal(m.nightShiftAction(car.model.mesh.position,car).kind,'shift-start');
  assert.equal(m.interact('shift-start',{vehicle:car}).shiftInteraction,true);
  assert.equal(m.getState().nightShiftActive,true);
  assert.deepEqual(m.interact('replay'),{});
  assert.deepEqual(m.interact('circuit',{vehicle:car}),{});
  assert.equal(m.radioAction(point(-16,23.1),null),null);
  const restored=missionFixture(f.storage).mission;
  assert.equal(restored.getState().nightShiftActive,true);
  assert.equal(restored.nightShiftAction(f.landmarks.garage,null).kind,'shift-cancel');
  restored.interact('shift-cancel',{position:f.landmarks.garage});
  assert.equal(restored.getState().nightShiftActive,false);
  assert.equal(restored.getState().money,2750);
  assert.equal(restored.interact('replay').replayAccepted,true);
});

test('Replaying the flagship preserves settled freight manifests through an active checkpoint', () => {
  const storage=memoryStorage({version:1,stage:5,money:4300,completedJobs:4,nightShift:{paid:['paloma+sunline']}});
  const first=missionFixture(storage).mission;
  first.interact('replay');
  const resumed=missionFixture(storage).mission;
  resumed.save();
  assert.deepEqual(readProgress(storage).nightShift.paid,['paloma+sunline']);
  assert.equal(resumed.getState().money,4300);
});

test('First delivered film manifest unlocks the screening throughout practice and circuit play',()=>{
  const f=missionFixture(memoryStorage({version:1,stage:5,money:2750,completedJobs:1}));
  const m=f.mission,car=carAt(f.landmarks.garage.x,f.landmarks.garage.z);
  assert.equal(m.getState().pierScreeningUnlocked,false);
  m.interact('shift-start',{vehicle:car});
  car.model.mesh.position.set(-91,0,5);
  m.interact('shift-load-pier',{vehicle:car});
  assert.equal(m.getState().pierScreeningUnlocked,false);
  car.model.mesh.position.set(-8,0,53);
  m.interact('shift-load-paloma',{vehicle:car});
  car.model.mesh.position.copy(f.landmarks.garage);
  m.interact('shift-deliver',{vehicle:car});
  assert.equal(m.getState().pierScreeningUnlocked,true);
  assert.match(f.completions.at(-1).replayHint,/screening/i);
  const restored=missionFixture(f.storage).mission;
  assert.equal(restored.getState().pierScreeningUnlocked,true);
  restored.interact('circuit',{vehicle:car});
  assert.equal(restored.getState().pierScreeningUnlocked,true);
  restored.retry(); restored.interact('replay'); restored.save();
  assert.equal(missionFixture(f.storage).mission.getState().pierScreeningUnlocked,true);
  restored.fresh();
  assert.equal(restored.getState().pierScreeningUnlocked,false);
});

test('The optional evening follows the film manifest and records first attendance without paying again',()=>{
  const f=missionFixture(), {mission,landmarks,storage}=f;
  const hero=prepareAurora(f);
  assert.equal(mission.interact('contact',{reserve:0}).reminder,true);
  assert.equal(mission.getState().money,1250);
  driveTo(mission,hero,LAST_LIGHT_FORK);
  for(const gate of LAST_LIGHT_ROUTES.boulevard)driveTo(mission,hero,gate);
  driveTo(mission,hero,landmarks.garage);
  mission.interact('garage',{vehicle:hero});
  const handoff=mission.getState();
  assert.equal(handoff.eveningPhase,'dispatch');
  assert.equal(handoff.target,landmarks.garage);
  assert.equal(handoff.money,3250);
  assert.deepEqual(mission.interact('watch-screening',{position:SCREENING_AUDIENCE}),{});
  mission.interact('shift-start',{vehicle:hero});
  assert.equal(mission.getState().objectiveTitle,'Choose a freight pickup');
  hero.model.mesh.position.set(-91,0,5);mission.interact('shift-load-pier',{vehicle:hero});
  hero.model.mesh.position.set(55,0,-50);mission.interact('shift-load-sunline',{vehicle:hero});
  hero.model.mesh.position.copy(landmarks.garage);mission.interact('shift-deliver',{vehicle:hero});
  const projection=mission.getState();
  assert.equal(projection.eveningPhase,'screening');
  assert.equal(projection.target,SCREENING_AUDIENCE);
  assert.equal(projection.money,3850);
  assert.equal(projection.completedJobs,2);
  assert.equal(mission.screeningAction(landmarks.garage,null),null);
  hero.model.mesh.position.set(-96,0,5);hero.speed=12;
  assert.equal(mission.screeningAction(SCREENING_AUDIENCE,hero),null);
  hero.speed=0;
  assert.equal(mission.screeningAction(SCREENING_AUDIENCE,hero).kind,'watch-screening');
  mission.interact('radio-start',{position:point(-16,23.1)});
  assert.equal(mission.screeningAction(SCREENING_AUDIENCE,hero),null);
  assert.equal(mission.getState().objectiveTitle,'Choose your sound');
  mission.interact('radio-cancel',{position:point(-16,23.1)});
  assert.deepEqual(mission.interact('watch-screening',{vehicle:hero}),{screeningStarted:true,firstScreening:true});
  assert.equal(mission.getState().eveningPhase,'free-roam');
  assert.equal(mission.getState().target,null);
  const before=storage.getItem(SAVE_KEY);
  assert.deepEqual(mission.interact('watch-screening',{position:SCREENING_AUDIENCE}),{screeningStarted:true,firstScreening:false});
  assert.equal(storage.getItem(SAVE_KEY),before);
  const resumed=missionFixture(storage).mission;
  assert.equal(resumed.getState().screeningSeen,true);
  assert.equal(resumed.getState().money,3850);
  assert.equal(resumed.getState().completedJobs,2);
  assert.equal(resumed.interact('replay').replayAccepted,true);
  assert.equal(resumed.getState().screeningSeen,true);
  resumed.fresh();assert.equal(resumed.getState().screeningSeen,false);
});

test('A second press at Mara after briefing only repeats the inspection instructions',()=>{
  const {mission,dialogue}=missionFixture();
  mission.interact('contact',{reserve:0});
  assert.deepEqual(mission.interact('contact',{reserve:0}),{reminder:true});
  assert.equal(mission.getState().money,1250);
  assert.match(dialogue.at(-1).lines[0],/rear lamp/);
  const paid=missionFixture(memoryStorage({version:1,stage:5,money:2750})).mission;
  assert.deepEqual(paid.interact('contact',{reserve:0}),{ammo:36});
  assert.equal(paid.getState().money,2600);
});

test('fractional Aurora health agrees with the handoff fee across saves', () => {
  for (const [health,shown,fee] of [[19.6,19,1500],[84.9,84,1500],[85,85,2000]]) {
    const storage=memoryStorage({version:1,stage:3,money:1250,completedJobs:0,
      lastLight:{forkPassed:true,route:'boulevard',mile:2,conditionPct:health}});
    const {mission,landmarks,completions}=missionFixture(storage);
    const car=carAt(landmarks.garage.x,landmarks.garage.z,{isJobCar:true,health});
    assert.equal(mission.getState().lastLight.conditionPct,shown);
    mission.onVehicleTaken(car);
    mission.update({vehicle:car,jobVehicle:car,wanted:0,policeState:'clear'});
    assert.equal(mission.getState().deliveryQuote.total,fee);
    assert.ok(mission.interact('garage',{vehicle:car}).delivered);
    assert.equal(completions[0].conditionPct,shown);
    const restored=missionFixture(storage).mission;
    assert.equal(restored.getState().money,1250+fee);
    assert.equal(restored.getState().completedJobs,1);
    assert.equal(restored.getState().lastLight.routeRecords.boulevard,shown);
  }
});
