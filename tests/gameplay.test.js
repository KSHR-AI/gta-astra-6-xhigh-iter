import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMission, readProgress } from '../src/missions.js';
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
    onPoliceShot: shot => policeShots.push(shot),
    onToast: (title, detail) => toasts.push({ title, detail }),
  });
  const playerPosition = point();
  const tick = time => simulation.update(.1, { playerPosition, currentCar: null, time });
  return { simulation, police, pedestrians, playerPosition, tick, toasts, policeShots };
}

test('The Coastal Job can be played from briefing to delivery and home, with the reward paid once', () => {
  const { mission, landmarks, heroPosition, completions, dialogue, storage } = missionFixture();
  const hero = { isJobCar: true, health: 100 };
  assert.equal(mission.getState().mission, 0);
  assert.equal(mission.getState().target, landmarks.contact);
  assert.deepEqual(mission.interact('garage', { vehicle: hero }), {});
  assert.deepEqual(mission.interact('safehouse'), {});

  assert.equal(mission.interact('contact').accepted, true);
  assert.equal(mission.getState().mission, 1);
  assert.equal(mission.getState().target, heroPosition);
  assert.equal(dialogue[0].speaker, 'MARA');
  assert.ok(dialogue[0].lines.join(' ').includes('convertible'));

  mission.onVehicleTaken({ isJobCar: false, health: 100 });
  assert.equal(mission.getState().mission, 1, 'Stealing an unrelated car must not advance the job');
  mission.onVehicleTaken(hero);
  assert.equal(mission.getState().mission, 2);
  mission.update({ wanted: 1, policeState: 'pursuit', vehicle: hero });
  assert.equal(mission.getState().mission, 2);
  mission.update({ wanted: 0, policeState: 'reported', vehicle: hero });
  assert.equal(mission.getState().mission, 2, 'An incoming witness report is still heat');
  mission.update({ wanted: 1, policeState: 'searching', vehicle: hero });
  assert.equal(mission.getState().mission, 2);
  assert.deepEqual(mission.interact('garage', { vehicle: hero }), {}, 'The workshop cannot pay before the escape');

  mission.update({ wanted: 0, policeState: 'clear', vehicle: hero });
  assert.equal(mission.getState().mission, 3);
  assert.equal(mission.getState().target, landmarks.garage);
  assert.deepEqual(mission.interact('garage', { vehicle: { isJobCar: false, health: 100 } }), {});
  assert.equal(mission.interact('garage', { vehicle: hero }).delivered, true);
  assert.equal(mission.getState().money, 2750);
  assert.equal(mission.getState().completedJobs, 1);
  assert.equal(mission.getState().target, landmarks.safehouse);
  assert.deepEqual(completions, [{ title: 'THE COASTAL JOB', reward: 1500 }]);

  mission.interact('garage', { vehicle: hero });
  assert.equal(mission.getState().money, 2750, 'Repeated interaction must not duplicate the payout');
  assert.equal(completions.length, 1);
  assert.equal(mission.interact('safehouse').rest, true);
  assert.equal(mission.getState().mission, 5);
  assert.equal(mission.getState().missionProgress, 1);
  assert.equal(mission.getState().target, null);
  mission.interact('safehouse');
  assert.equal(mission.getState().completedJobs, 1);
  assert.equal(readProgress(storage).stage, 5);
  assert.equal(readProgress(storage).money, 2750);
});

test('A wrecked delivery car resets the attempt without charging or paying the player', () => {
  const { mission, completions, heroPosition } = missionFixture();
  mission.interact('contact');
  const hero = { isJobCar: true, health: 100 };
  mission.onVehicleTaken(hero);
  hero.health = 0;
  assert.equal(mission.update({ wanted: 1, policeState: 'pursuit', vehicle: hero }).replaceJobCar, true);
  assert.equal(mission.getState().mission, 1);
  assert.equal(mission.getState().target, heroPosition);
  assert.equal(mission.getState().money, 1250);
  assert.equal(completions.length, 0);
  hero.health = 100;
  mission.onVehicleTaken(hero);
  assert.equal(mission.getState().mission, 2, 'The replacement can be used for a new attempt');
});

test('Reloading an active escape or delivery restores a usable pre-theft checkpoint', () => {
  for (const stage of [2, 3]) {
    const storage = memoryStorage({ version: 1, stage, money: 1100, completedJobs: 0, savedAt: 1700000000000 });
    const { mission, heroPosition } = missionFixture(storage);
    assert.equal(mission.getState().mission, 1);
    assert.equal(mission.getState().target, heroPosition);
    assert.equal(mission.getState().money, 1100);
    assert.equal(mission.getState().completedJobs, 0);
  }
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
  return { mesh, update() {}, getMuzzlePosition(target) { return target.copy(mesh.position); } };
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
