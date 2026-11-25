import { createNightShift } from './night-shift.js';
import { createLastLight } from './last-light.js';
import { createRoomTone } from './room-tone.js';
const SAVE_KEY = 'grand-theft-astra:coastal-job:v1';
const titles = ['Meet Mara at the Paloma', 'Pick up the Aurora', 'Calypso mural', 'Park at Auto Works', 'Claim your room', 'Pacific Circuit'];
// The start and gates sit in the traffic lanes of the authored 80 × 90 m grid.
export const CIRCUIT_START = { x: -5, z: 28 };
export const SCREENING_AUDIENCE = { x: -96, z: 5, label: 'Pier drive-in' };
const circuitGates = [
  { x: -5, z: 80, heading: 0, name: 'South boulevard', direction: 'Follow the boulevard south.' },
  { x: 69, z: 94, heading: Math.PI / 2, name: 'South crossing', direction: 'Turn east at the crossing.' },
  { x: 85, z: -77, heading: Math.PI, name: 'East avenue', direction: 'Head north along East Avenue.' },
  { x: 10, z: -94, heading: -Math.PI / 2, name: 'North crossing', direction: 'Turn west across the north crossing.' },
  { ...CIRCUIT_START, heading: 0, name: 'Paloma finish', direction: 'Head south to the Paloma.' },
];
const circuitLimit = 90;
function clock(seconds) {
  const tenths = Math.round(seconds * 10);
  return `${Math.floor(tenths / 600)}:${String(Math.floor(tenths / 10) % 60).padStart(2, '0')}.${tenths % 10}`;
}
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

export function readProgress(storage = browserStorage()) {
  try {
    const value = JSON.parse(storage?.getItem(SAVE_KEY) || 'null');
    if (!value || value.version !== 1 || !Number.isFinite(value.money) || !Number.isInteger(value.stage) || value.stage < 0 || value.stage > 5) return null;
    if (value.completedJobs !== undefined && (!Number.isInteger(value.completedJobs) || value.completedJobs < 0 || value.completedJobs > 100000)) return null;
    return { ...value, money: Math.max(0, Math.min(value.money, 1000000)), completedJobs: Math.max(0, value.completedJobs || 0) };
  } catch { return null; }
}

export function createMission({ landmarks, getHeroPosition, onDialogue, onToast, onComplete, onRecordingCue, storage = browserStorage() }) {
  const saved = readProgress(storage);
  let stage = saved?.stage || 0;
  // The delivery car belongs to a live simulation. Restore at a useful checkpoint.
  if (stage === 2 || stage === 3) stage = 1;
  let money = saved?.money ?? 1250;
  let completedJobs = saved?.completedJobs || 0;
  const light = createLastLight(saved?.lastLight, saved?.stage >= 4);
  let inspecting = 0, inspectionPoint = null, onFoot = false, hasHeat = false, trackedCar = null;
  let savedAt = saved?.savedAt || null;
  let saveAvailable = true;
  let repairCooldown = 0;
  let circuit = null;
  let best = Number.isFinite(saved?.circuitBest) && saved.circuitBest > 0 && saved.circuitBest <= circuitLimit ? saved.circuitBest : null;
  const radio = createRoomTone(saved?.roomTone, { dialogue, toast: onToast, cue: onRecordingCue, save, finish(fee, take) {
    money += fee; completedJobs++; save(); onComplete?.({ title: 'ROOM TONE · ' + take.toUpperCase(), reward: fee });
  } });
  const shift = createNightShift(saved?.nightShift && { ...saved.nightShift, running: stage === 5 && saved.nightShift.running }, {
    landmarks, save, onToast, onDialogue,
    finish(reward, receipt) {
      if (reward > 0) { money += reward; completedJobs++; }
      save(); onComplete?.(receipt);
    },
  });
  let screeningSeen = saved?.screeningSeen === true && shift.screeningUnlocked();
  const radioAvailable = () => (stage === 0 || stage === 5) && !circuit && !shift.active();
  const shiftAvailable = () => stage === 5 && !circuit && !radio.active();
  function save() {
    const now = Date.now();
    try {
      if (!storage || typeof storage.setItem !== 'function') throw new Error('Storage unavailable');
      storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, stage, money, completedJobs, circuitBest: best, roomTone: radio.checkpoint(), lastLight: light.saveState(), nightShift: shift.checkpoint(), screeningSeen, savedAt: now }));
      savedAt = now; saveAvailable = true;
    } catch { saveAvailable = false; }
  }
  function dialogue(speaker, lines, options) { onDialogue?.(speaker, lines, options); }
  function rearOf(car = trackedCar) {
    const p = car?.model?.mesh?.position || getHeroPosition();
    const heading = Number.isFinite(car?.heading) ? car.heading : Math.PI;
    return { x: p.x - 2.4 * Math.sin(heading), z: p.z - 2.4 * Math.cos(heading) };
  }
  function inspectAction(position, vehicle, jobVehicle) {
    if (stage !== 1 || light.view(stage).inspected || vehicle || !position || inspecting > 0) return null;
    const point = rearOf(jobVehicle);
    return Math.hypot(position.x-point.x,position.z-point.z) <= 2.1
      ? { kind:'inspect', title:'ASTRA AURORA', name:'Check tail lamp and bodywork' } : null;
  }
  function screeningAction(position, vehicle) {
    if (!shiftAvailable() || shift.active() || !shift.screeningUnlocked()) return null;
    if (vehicle && (!(vehicle.health > 0) || !(Math.abs(vehicle.speed) < .9))) return null;
    const p = vehicle?.model?.mesh?.position || position;
    if (!p || Math.hypot(p.x-SCREENING_AUDIENCE.x,p.z-SCREENING_AUDIENCE.z) > 7) return null;
    return { kind:'watch-screening', title:'PIER DRIVE-IN', name:screeningSeen ? 'Replay the night screening' : 'Watch the night screening' };
  }
  function interact(kind, { vehicle, time = 0, reserve = 0, position, jobVehicle, wanted = 0, policeState = 'clear' } = {}) {
    if (kind === 'watch-screening') {
      if (!screeningAction(position,vehicle)) return {};
      const firstScreening = !screeningSeen;
      if (firstScreening) {
        screeningSeen = true;
        save();
        dialogue('MARA',['There it is. Your reels, up on the big screen. Leave the keys in your pocket. The night shift can wait.'],{replace:true});
      }
      return { screeningStarted:true, firstScreening };
    }
    if (kind.startsWith('shift-')) return shiftAvailable() ? shift.interact(kind,{vehicle,position}) : {};
    if (kind === 'inspect' && inspectAction(position,vehicle,jobVehicle)) {
      inspecting = 1.4; inspectionPoint = rearOf(jobVehicle);
      onToast?.('CHECKING THE AURORA', 'Stay beside the rear bumper.');
      return { inspecting: true };
    }
    if (kind === 'replay' && shiftAvailable() && !shift.active()) {
      light.reset(true); stage = 1; onFoot = false; hasHeat = false; save();
      dialogue('MARA',['One more run from the Paloma? Take whichever approach you missed. This one is on your time.']);
      return { replayAccepted: true };
    }
    if (kind === 'recover' && (stage === 2 || stage === 3) && !vehicle) {
      stage = 1; inspecting = 0; onFoot = false; save();
      onToast?.('AURORA RECOVERED', 'The car is waiting at your last route checkpoint.');
      return { replaceJobCar: true };
    }
    if (kind.startsWith('radio-')) return radioAvailable() ? radio.interact(kind, position, vehicle) : {};
    if (radio.active() && (kind === 'contact' || kind === 'circuit')) return {};
    if (kind === 'circuit' && radioAvailable() && (stage === 5 || vehicle?.circuitLoaner) && vehicle?.health > 0) {
      circuit = { vehicle, gate: 0, elapsed: -3, previousSplit: 0 };
      onToast?.('PACIFIC CIRCUIT', 'Five gates. Launch on green.');
      return { startedCircuit: true };
    }
    if (kind === 'contact' && !circuit) {
      if (stage === 0) {
        stage = 1;
        dialogue('MARA', ['That teal convertible is our last car before the night shift. Check the rear lamp, then take the keys.', 'Fifteen hundred for the run. Keep her at 85 percent and I’ll add five hundred. At the mural, stay straight on Vespucci or turn right for Sunline.'], {replace:true});
        onToast?.('LAST LIGHT AT THE PALOMA', 'Inspect the Aurora before you leave.');
        save(); return { accepted: true };
      }
      if (stage >= 1 && stage <= 3) {
        const progress = light.view(stage);
        const reminder = stage === 1 ? progress.inspected ? 'The inspection is signed. Take the driver’s seat in the teal Aurora.' :
          'Check the rear lamp first. I need to know the condition before we take it out.' :
          stage === 3 ? 'Pull into the Auto Works bay and stop for the handoff.' :
          light.guidance()?.objective || 'Bring the Aurora up to Auto Works.';
        dialogue('MARA',[reminder],{replace:true});
        return { reminder:true };
      }
      if (money >= 150 && reserve < 192) { money -= 150; save(); dialogue('MARA', ['Keep your head down. This should keep you covered.']); return { ammo: 36 }; }
      dialogue('MARA', [stage < 4 ? 'The Aurora goes to Astra Auto Works. Check the rear lamp, then drive north to Calypso.' : 'The room at the Paloma is yours. You earned it.']);
    }
    if (kind === 'garage' && stage === 3 && vehicle?.isJobCar && light.routeFinished() &&
        vehicle.health > 0 && Math.abs(vehicle.speed || 0) < 1.5 && wanted === 0 && policeState === 'clear') {
      const p = vehicle.model?.mesh?.position || position;
      if (!p || Math.hypot(p.x-landmarks.garage.x,p.z-landmarks.garage.z) >= 6) return {};
      light.condition(vehicle.health);
      const receipt = light.quote();
      stage = 5;
      if (!receipt.replay) { money += receipt.total; completedJobs++; }
      const replayHint = light.finish();
      save();
      onComplete?.({ title:'LAST LIGHT AT THE PALOMA', ...receipt, reward:receipt.total, replayHint });
      dialogue('MARA', [receipt.replay ? 'Different line, same bay. I’ll take the keys.' :
        receipt.cleanBonus ? 'Look at that paint. You even kept the corners clean. The extra five hundred is yours.' :
        receipt.conditionPct < 55 ? 'That quarter panel needs a night on the bench. Your base pay is here. I’m keeping the bodywork bonus.' :
        'I can see the scrape from here. Fifteen hundred for the delivery. The bonus stays in the paint fund.',
        receipt.replay ? 'The city’s yours. Take the long way home.' :
          'Dispatch has film reels to collect for the pier drive-in. Take the manifest here, pick up the reels and one other order, then bring both back.'], {replace:true});
      return { delivered: true };
    }
    if (kind === 'garage' && vehicle && stage >= 4 && money >= 100 && vehicle.health < 100 && time > repairCooldown) {
      money -= 100; repairCooldown = time + 2; save(); onToast?.('BACK IN SHAPE', 'Vehicle repaired · −$100'); return { repair: true };
    }
    if (kind === 'safehouse' && stage >= 4) {
      if (stage === 4) dialogue('MARA', ['The room and the cream sedan are yours. Auto Works has a film courier manifest if you’re still out tonight.']);
      stage = 5; save(); onToast?.('HOME SWEET HOME', saveAvailable ? 'Progress saved. Health and supplies restored.' : 'Health restored. Browser storage is unavailable.');
      return { rest: true };
    }
    return {};
  }
  function onVehicleTaken(vehicle) {
    if (stage !== 1 || !vehicle?.isJobCar) return;
    if (!light.view(stage).inspected) {
      onToast?.('MARA’S CHECKLIST', 'Step out and inspect the rear of the Aurora first.');
      return;
    }
    stage = light.routeFinished() ? 3 : 2; onFoot = false;
    onToast?.('KEYS IN HAND', light.checkpoint() ? 'Pick up your route.' : 'Head north to the Calypso mural.');
    save();
  }
  function update({ wanted, policeState, vehicle, jobVehicle, dt = 0, position, slip = 0, inspectionReady = true, interruptInspection = false }) {
    if (jobVehicle) trackedCar = jobVehicle;
    if (stage === 1 && jobVehicle?.health <= 0) {
      inspecting = 0; onToast?.('AURORA RECOVERED','A working Aurora is waiting at the pickup checkpoint.');
      return { replaceJobCar:true };
    }
    if (inspecting > 0) {
      if (interruptInspection || vehicle || !position || Math.hypot(position.x-inspectionPoint.x,position.z-inspectionPoint.z)>2.4) {
        inspecting=0; onToast?.('CHECK INTERRUPTED','Return to the rear lamp to finish the inspection.');
      } else if (inspectionReady && (inspecting -= Math.max(0,dt)) <= 0) {
        light.inspect();
        if (jobVehicle) light.condition(jobVehicle.health);
        save();
        const assessment = light.quote();
        const bodywork = assessment.conditionPct + '% bodywork';
        const note = assessment.replay ? 'Practice run.' : assessment.cleanBonus ? '$500 clean bonus available.' : 'Base fee only.';
        onToast?.('TAIL LAMP WORKING', bodywork + ' · ' + note + ' Take the driver’s seat.');
      }
    }
    radio.update(dt, position, vehicle);
    if (stage === 5) shift.update({vehicle,dt,slip});
    if (circuit) {
      circuit.elapsed += Math.max(0, dt);
      if (vehicle !== circuit.vehicle || vehicle.health <= 0 || circuit.elapsed > circuitLimit) {
        const reason = circuit.elapsed > circuitLimit ? 'Time expired.' : 'Run interrupted.';
        circuit = null;
        onToast?.('PACIFIC CIRCUIT', reason + ' Restart outside the Paloma.');
      } else {
        const gate = circuitGates[circuit.gate];
        const p = vehicle.model.mesh.position;
        if (circuit.elapsed >= 0 && Math.hypot(p.x - gate.x, p.z - gate.z) < 9) {
          circuit.gate++;
          if (circuit.gate === circuitGates.length) {
            const finish = Math.max(.1, circuit.elapsed);
            const record = best === null || finish < best;
            const reward = finish <= 45 ? 750 : finish <= 65 ? 500 : 300;
            if (record) best = finish;
            money += reward;
            completedJobs++;
            circuit = null;
            save();
            onComplete?.({ title: `${record ? 'PERSONAL BEST' : 'PACIFIC CIRCUIT'} · ${clock(finish)}`, reward, replayHint: 'Stop at the Paloma gate to race again.' });
          } else {
            onToast?.(`GATE ${circuit.gate} / ${circuitGates.length} · ${clock(circuit.elapsed)}`,
              `Sector ${clock(circuit.elapsed - circuit.previousSplit)} · ${circuitGates[circuit.gate].direction}`);
            circuit.previousSplit = circuit.elapsed;
          }
        }
      }
    }
    if (stage === 2 || stage === 3) {
      const car = jobVehicle || (vehicle?.isJobCar ? vehicle : null);
      const lostBonus = car && light.condition(car.health);
      if (car && car.health <= 0) {
        stage=1; onFoot=false; save(); onToast?.('AURORA RECOVERED','A replacement is at your last checkpoint. The clean bonus was lost.');
        return { replaceJobCar:true };
      }
      onFoot = !vehicle?.isJobCar; hasHeat = wanted > 0 || policeState !== 'clear';
      const milestone = stage === 2 && !onFoot ? light.advance(vehicle.model?.mesh?.position || position) : null;
      if (light.routeFinished()) stage = 3;
      if (lostBonus || milestone) save();
      if (milestone) {
        onToast?.(milestone.title,milestone.detail);
        if (milestone.radio) dialogue('MARA',[milestone.radio],{replace:true});
      }
      if (lostBonus && !light.view(stage).replay) onToast?.('BODYWORK BONUS LOST','The Aurora dropped below 85%. The $1,500 delivery fee is protected.');
    }
    return {};
  }
  function getState() {
    const pierScreeningUnlocked = shift.screeningUnlocked();
    const eveningPhase = stage < 5 ? 'delivery' : screeningSeen ? 'free-roam' : pierScreeningUnlocked ? 'screening' : 'dispatch';
    const evening = { pierScreeningUnlocked, screeningSeen, eveningPhase };
    if (circuit) {
      const gate = circuitGates[circuit.gate];
      const remaining = Math.max(0, circuitLimit - Math.max(0, circuit.elapsed));
      return { mission: stage, money, completedJobs, savedAt, saveAvailable, ...evening, circuitActive: true, secondaryTarget: null, radioActive: false, nightShiftActive: false, nightShiftAvailableTarget: null, circuitBest: best,
        circuitCountdown: circuit.elapsed < 0 ? Math.ceil(-circuit.elapsed) : 0,
        circuitSignal: circuit.elapsed < 0 ? String(Math.ceil(-circuit.elapsed)) : circuit.elapsed < 1.2 ? 'GO' : '',
        target: gate, objectiveTitle: `${gate.name} · ${Math.ceil(remaining)}s`, missionStage: `PACIFIC CIRCUIT · ${circuit.gate + 1} / ${circuitGates.length}`,
        objective: `${gate.direction}  ${clock(remaining)} remaining.`,
        missionProgress: circuit.gate / circuitGates.length };
    }
    const target = stage === 0 ? landmarks.contact : stage === 1 ? getHeroPosition() : stage === 3 ? landmarks.garage : stage === 4 ? landmarks.safehouse : stage === 5 ? CIRCUIT_START : null;
    const objective = [
      'Talk to Mara under the Paloma awning.',
      'Take the driver’s seat in the teal Aurora.',
      'Drive the Aurora to the Calypso mural.',
      'Turn into Astra Auto Works. Stop in the bay and interact to deliver.',
      'Visit the Paloma courtyard. Press E to claim your room.',
      'Stop on the boulevard outside the Paloma to race the Pacific Circuit.' + (best ? ` Best lap ${clock(best)}.` : ''),
    ][stage];
    const details = { ...light.view(stage), drivingJobCar: (stage === 2 || stage === 3) && !onFoot };
    let guide = stage === 2 ? light.guidance() : null;
    if (shiftAvailable() && !shift.active()) {
      if (eveningPhase === 'dispatch') guide = {
        target: landmarks.garage, objectiveTitle: 'The film courier', missionStage: 'LAST LIGHT · NIGHT SHIFT', missionProgress:.5,
        objective: 'Sign out a manifest in a stopped car at Auto Works. Bring the pier projection reels and one other order back to dispatch.',
      };
      else if (eveningPhase === 'screening') guide = {
        target: SCREENING_AUDIENCE, objectiveTitle: 'Catch the first screening', missionStage: 'LAST LIGHT · EPILOGUE', missionProgress:.85,
        objective: 'Head to the pier access road. Park facing the drive-in or walk to the audience mark, then interact to watch the film.',
      };
      else guide = {
        target: null, objectiveTitle: 'After the credits', missionStage: 'FREE ROAM',
        objective: 'Race at the Paloma, take a new freight manifest, or return to the drive-in.',
      };
    }
    if (stage === 1 && !details.inspected) guide = { target:rearOf(), objectiveTitle: inspecting > 0 ? 'Checking rear lamp…' : 'Inspect the rear lamp', objective:'Walk to the rear bumper of the Aurora and check the lamp before boarding.' };
    if ((stage === 2 || stage === 3) && onFoot) guide = { target:getHeroPosition(), objectiveTitle:'Return to the Aurora', objective:'Get back into the Aurora to continue. Mara can recover it to the last checkpoint.' };
    else if (stage === 3 && hasHeat) guide = { target:null, objectiveTitle:'Lose the patrol', objective:'Wait until the police call off the search, then bring the Aurora inside.' };
    return { mission: stage, money, completedJobs, savedAt, saveAvailable, ...evening, circuitActive: false, circuitCountdown: 0, circuitSignal:'', circuitBest: best, objectiveTitle: titles[stage], objective, missionStage: stage === 5 ? 'FREE ROAM' : stage === 4 ? 'THE PALOMA' : 'LAST LIGHT AT THE PALOMA', missionProgress: stage / 5, target, lastLight:details, jobCarCheckpoint:stage >= 1 && stage <= 3 ? light.checkpoint() : null, deliveryQuote:light.quote(), ...radio.view(radioAvailable()), ...(shiftAvailable() ? shift.view() : {nightShiftActive:false,nightShiftAvailableTarget:null}), ...guide };
  }
  function fresh() {
    screeningSeen=false; shift.restore(); light.reset(); inspecting=0; onFoot=false; hasHeat=false; radio.restore(); circuit = null; best = null; repairCooldown = 0; stage = 0; money = 1250; completedJobs = 0; savedAt = null;
    try { storage?.removeItem(SAVE_KEY); } catch { saveAvailable = false; }
  }
  function retry() { shift.restore(shift.checkpoint()); inspecting=0; onFoot=false; hasHeat=false; radio.restore(radio.checkpoint()); circuit = null; if (stage === 2 || stage === 3) stage = 1; save(); }
  const radioAction = (position, vehicle) => radioAvailable() ? radio.action(position, vehicle) : null;
  const nightShiftAction = (position, vehicle) => shiftAvailable() ? shift.action(position,vehicle) : null;
  const getFreightManifest = () => stage === 5 ? shift.manifest() : null;
  return { get inspectionRemaining(){return Math.max(0,inspecting);}, inspectAction, radioAction, nightShiftAction, freightPickupNear:shift.pickupNear, selectFreightPickup:shift.selectPickup, screeningAction, getFreightManifest, interact, onVehicleTaken, update, getState, save, fresh, retry };
}
