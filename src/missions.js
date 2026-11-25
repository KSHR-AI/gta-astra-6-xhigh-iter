import { createRoomTone } from './room-tone.js';
const SAVE_KEY = 'grand-theft-astra:coastal-job:v1';
const titles = ['A favor for Mara', 'Borrowed wheels', 'Disappear', 'Special delivery', 'A place to call home', 'Pacific Circuit'];
// The start and gates sit in the traffic lanes of the authored 80 × 90 m grid.
export const CIRCUIT_START = { x: -5, z: 28 };
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
  let savedAt = saved?.savedAt || null;
  let saveAvailable = true;
  let repairCooldown = 0;
  let circuit = null;
  let best = Number.isFinite(saved?.circuitBest) && saved.circuitBest > 0 && saved.circuitBest <= circuitLimit ? saved.circuitBest : null;
  const radio = createRoomTone(saved?.roomTone, { dialogue, toast: onToast, cue: onRecordingCue, save, finish(fee, take) {
    money += fee; completedJobs++; save(); onComplete?.({ title: 'ROOM TONE · ' + take.toUpperCase(), reward: fee });
  } });
  const radioAvailable = () => (stage === 0 || stage === 5) && !circuit;
  function save() {
    const now = Date.now();
    try {
      if (!storage || typeof storage.setItem !== 'function') throw new Error('Storage unavailable');
      storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, stage, money, completedJobs, circuitBest: best, roomTone: radio.checkpoint(), savedAt: now }));
      savedAt = now; saveAvailable = true;
    } catch { saveAvailable = false; }
  }
  function dialogue(speaker, lines) { onDialogue?.(speaker, lines); }
  function interact(kind, { vehicle, time = 0, reserve = 0, position } = {}) {
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
        dialogue('MARA', ['Welcome to Los Pacificos. I have a buyer waiting for that teal convertible on the boulevard.', 'Bring it to my workshop up north. If anyone calls it in, lose the patrol before you show up.']);
        onToast?.('THE COASTAL JOB', 'Take the teal convertible. Keep it in one piece.');
        save(); return { accepted: true };
      }
      if (money >= 150 && reserve < 192) { money -= 150; save(); dialogue('MARA', ['Keep your head down. This should keep you covered.']); return { ammo: 36 }; }
      dialogue('MARA', [stage < 4 ? 'The teal convertible. Workshop up north. No police on your tail.' : 'The room at the Paloma is yours. You earned it.']);
    }
    if (kind === 'garage' && vehicle && stage === 3 && vehicle.isJobCar) {
      stage = 4; money += 1500; completedJobs++;
      save(); onComplete?.({ title: 'THE COASTAL JOB', reward: 1500 });
      dialogue('MARA', ['Clean delivery. Fifteen hundred, as promised.', 'I left a key at the Paloma courtyard. Go settle in. This city has plenty more trouble to offer.']);
      return { delivered: true };
    }
    if (kind === 'garage' && vehicle && stage >= 4 && money >= 100 && vehicle.health < 100 && time > repairCooldown) {
      money -= 100; repairCooldown = time + 2; save(); onToast?.('BACK IN SHAPE', 'Vehicle repaired · −$100'); return { repair: true };
    }
    if (kind === 'safehouse' && stage >= 4) {
      if (stage === 4) dialogue('MARA', ['The boulevard outside your place is the start of the Pacific Circuit. Take the cream sedan outside or bring your own. Beat forty-five seconds and the full purse is yours.']);
      stage = 5; save(); onToast?.('HOME SWEET HOME', saveAvailable ? 'Progress saved. Health and supplies restored.' : 'Health restored. Browser storage is unavailable.');
      return { rest: true };
    }
    return {};
  }
  function onVehicleTaken(vehicle) {
    if (stage === 1 && vehicle.isJobCar) {
      stage = 2; onToast?.('EYES ON YOU', 'A witness saw the theft. Lose the police.');
      dialogue('MARA', ['Someone saw you. Stay off the main road until the heat dies down.']);
    }
  }
  function update({ wanted, policeState, vehicle, dt = 0, position }) {
    radio.update(dt, position, vehicle);
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
    if (stage === 2 && wanted === 0 && policeState === 'clear') {
      stage = 3; onToast?.('MAKE THE DELIVERY', 'Bring the convertible inside Mara’s workshop.');
      dialogue('MARA', ['You are clear. The workshop entrance is on the east side of the boulevard.']);
    }
    if ((stage === 2 || stage === 3) && vehicle?.isJobCar && vehicle.health <= 0) {
      stage = 1; onToast?.('THE RIDE IS WRECKED', 'Return to the boulevard. A replacement is waiting.'); return { replaceJobCar: true };
    }
    return {};
  }
  function getState() {
    if (circuit) {
      const gate = circuitGates[circuit.gate];
      const remaining = Math.max(0, circuitLimit - Math.max(0, circuit.elapsed));
      return { mission: stage, money, completedJobs, savedAt, saveAvailable, circuitActive: true, secondaryTarget: null, radioActive: false, circuitBest: best,
        circuitCountdown: circuit.elapsed < 0 ? Math.ceil(-circuit.elapsed) : 0,
        circuitSignal: circuit.elapsed < 0 ? String(Math.ceil(-circuit.elapsed)) : circuit.elapsed < 1.2 ? 'GO' : '',
        target: gate, objectiveTitle: `${gate.name} · ${Math.ceil(remaining)}s`, missionStage: `PACIFIC CIRCUIT · ${circuit.gate + 1} / ${circuitGates.length}`,
        objective: `${gate.direction}  ${clock(remaining)} remaining.`,
        missionProgress: circuit.gate / circuitGates.length };
    }
    const target = stage === 0 ? landmarks.contact : stage === 1 ? getHeroPosition() : stage === 3 ? landmarks.garage : stage === 4 ? landmarks.safehouse : stage === 5 ? CIRCUIT_START : null;
    const objective = [
      'Meet Mara inside the corner office. Press E to talk.',
      'Take the teal convertible on the boulevard.',
      'Break line of sight. Stay hidden while the patrol searches.',
      'Drive into Mara’s workshop. Stop and press E to deliver.',
      'Visit the Paloma courtyard. Press E to claim your room.',
      'Stop on the boulevard outside the Paloma to race the Pacific Circuit.' + (best ? ` Best lap ${clock(best)}.` : ''),
    ][stage];
    return { mission: stage, money, completedJobs, savedAt, saveAvailable, circuitActive: false, circuitCountdown: 0, circuitSignal:'', circuitBest: best, objectiveTitle: titles[stage], objective, missionStage: stage === 5 ? 'FREE ROAM' : `THE COASTAL JOB · ${Math.min(stage + 1, 5)} / 5`, missionProgress: stage / 5, target, ...radio.view(radioAvailable()) };
  }
  function fresh() {
    radio.restore(); circuit = null; best = null; repairCooldown = 0; stage = 0; money = 1250; completedJobs = 0; savedAt = null;
    try { storage?.removeItem(SAVE_KEY); } catch { saveAvailable = false; }
  }
  function retry() { radio.restore(radio.checkpoint()); circuit = null; if (stage === 2 || stage === 3) stage = 1; save(); }
  const radioAction = (position, vehicle) => radioAvailable() ? radio.action(position, vehicle) : null;
  return { radioAction, interact, onVehicleTaken, update, getState, save, fresh, retry };
}
