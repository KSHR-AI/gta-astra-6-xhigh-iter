const SAVE_KEY = 'grand-theft-astra:coastal-job:v1';
const titles = ['A favor for Mara', 'Borrowed wheels', 'Disappear', 'Special delivery', 'A place to call home', 'Los Pacificos is yours'];
function browserStorage() { try { return globalThis.localStorage; } catch { return null; } }

export function readProgress(storage = browserStorage()) {
  try {
    const value = JSON.parse(storage?.getItem(SAVE_KEY) || 'null');
    if (!value || value.version !== 1 || !Number.isFinite(value.money) || !Number.isInteger(value.stage) || value.stage < 0 || value.stage > 5) return null;
    if (value.completedJobs !== undefined && (!Number.isInteger(value.completedJobs) || value.completedJobs < 0 || value.completedJobs > 100000)) return null;
    return { ...value, money: Math.max(0, Math.min(value.money, 1000000)), completedJobs: Math.max(0, value.completedJobs || 0) };
  } catch { return null; }
}

export function createMission({ landmarks, getHeroPosition, onDialogue, onToast, onComplete, storage = browserStorage() }) {
  const saved = readProgress(storage);
  let stage = saved?.stage || 0;
  // The delivery car belongs to a live simulation. Restore at a useful checkpoint.
  if (stage === 2 || stage === 3) stage = 1;
  let money = saved?.money ?? 1250;
  let completedJobs = saved?.completedJobs || 0;
  let savedAt = saved?.savedAt || null;
  let saveAvailable = true;
  let repairCooldown = 0;
  function save() {
    const now = Date.now();
    try {
      if (!storage || typeof storage.setItem !== 'function') throw new Error('Storage unavailable');
      storage.setItem(SAVE_KEY, JSON.stringify({ version: 1, stage, money, completedJobs, savedAt: now }));
      savedAt = now; saveAvailable = true;
    } catch { saveAvailable = false; }
  }
  function dialogue(speaker, lines) { onDialogue?.(speaker, lines); }
  function interact(kind, { vehicle, time = 0, reserve = 0 } = {}) {
    if (kind === 'contact') {
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
  function update({ wanted, policeState, vehicle }) {
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
    const target = stage === 0 ? landmarks.contact : stage === 1 ? getHeroPosition() : stage === 3 ? landmarks.garage : stage === 4 ? landmarks.safehouse : null;
    const objective = [
      'Meet Mara inside the corner office. Press E to talk.',
      'Take the teal convertible on the boulevard.',
      'Break line of sight. Stay hidden while the patrol searches.',
      'Drive into Mara’s workshop. Stop and press E to deliver.',
      'Visit the Paloma courtyard. Press E to claim your room.',
      'Explore. Repair at the workshop, rest at the Paloma, or buy supplies from Mara.',
    ][stage];
    return { mission: stage, money, completedJobs, savedAt, saveAvailable, objectiveTitle: titles[stage], objective, missionStage: stage === 5 ? 'FREE ROAM' : `THE COASTAL JOB · ${Math.min(stage + 1, 5)} / 5`, missionProgress: stage / 5, target };
  }
  function fresh() {
    stage = 0; money = 1250; completedJobs = 0; savedAt = null;
    try { storage?.removeItem(SAVE_KEY); } catch { saveAvailable = false; }
  }
  function retry() { if (stage === 2 || stage === 3) stage = 1; save(); }
  return { interact, onVehicleTaken, update, getState, save, fresh, retry };
}
