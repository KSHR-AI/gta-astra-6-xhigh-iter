// All three loading points lie on asphalt: the diner service lane, the Paloma
// curb outside the court, and the west end of the pier access cross street.
export const SHIFT_STOPS = [
  { id: 'sunline', label: 'Sunline loading yard', goods: 'diner glass racks', handling: 'Glass racks shift under hard braking.', x: 55, z: -50 },
  { id: 'paloma', label: 'Paloma curb', goods: 'linen bundles', handling: 'Linen bundles cushion the load.', x: -8, z: 53 },
  { id: 'pier', label: 'Pier access road', goods: 'projection reels', handling: 'Reel cases slide during skids.', x: -91, z: 5 },
];
export const SHIFT_PULL_OFF = { x: 8, z: -69, label: 'North boulevard pull-off' };
const near = (a, b) => a && b && Math.hypot(a.x - b.x, a.z - b.z) < 5;
const stopFor = id => SHIFT_STOPS.find(point => point.id === id);
const pairKey = ids => [...ids].sort().join('+');
const validPairs = SHIFT_STOPS.flatMap((a, i) => SHIFT_STOPS.slice(i + 1).map(b => pairKey([a.id, b.id])));
const positionOf = (vehicle, fallback) => vehicle?.model?.mesh?.position || fallback;

export function createNightShift(saved, { landmarks, save, finish, onToast, onDialogue }) {
  const dispatch = { ...(landmarks.garage || { x:28, z:-126 }), label: 'Auto Works dispatch' };
  const releaseDesks = [landmarks.contact, { x:-16, z:23.1 }, { x:-5, z:28 }];
  const cancelSites = [dispatch, ...releaseDesks.filter(Boolean), ...SHIFT_STOPS];
  let running, orders, paid, condition, restrapped, carrier, lastHealth, lastSpeed, selectedPickup;
  function restore(value) {
    paid = new Set(Array.isArray(value?.paid) ? value.paid.filter(key => validPairs.includes(key)) : []);
    running = value?.running === true;
    orders = running && Array.isArray(value.orders) ? [...new Set(value.orders.filter(stopFor))].slice(0, 2) : [];
    condition = Number.isFinite(value?.condition) ? Math.max(0, Math.min(100, value.condition)) : 100;
    restrapped = value?.restrapped === true;
    selectedPickup = running && orders.length < 2 && !orders.includes(value?.selectedPickup)
      ? stopFor(value?.selectedPickup)?.id || null : null;
    carrier = null;
    lastHealth = lastSpeed = null;
  }
  restore(saved);
  function checkpoint() {
    return { running, orders: [...orders], paid: [...paid], condition: Math.floor(condition), restrapped, ...(selectedPickup ? {selectedPickup} : {}) };
  }
  function pickupNear(point) {
    return running && orders.length < 2 && (!orders.length || carrier?.health > 0)
      ? SHIFT_STOPS.find(s => !orders.includes(s.id) && near(s, point)) || null : null;
  }
  function selectPickup(point) {
    const stop = pickupNear(point);
    const selection = stop?.id || null;
    if (selection !== selectedPickup) { selectedPickup = selection; save(); }
    return stop || null;
  }
  function action(position, vehicle) {
    const at = positionOf(vehicle, position);
    const prompt = (kind, name) => ({ kind: 'shift-' + kind, title: 'NIGHT SHIFT · DISPATCH', name });
    if (!vehicle) {
      if (running && cancelSites.some(stop => near(at, stop))) return prompt('cancel', 'Cancel freight · return unpaid manifest');
      return null;
    }
    if (!(vehicle.health > 0) || !(Math.abs(vehicle.speed) < .9)) return null;
    if (!running) return near(at, dispatch) ? prompt('start', 'Sign out a two-pickup manifest') : null;
    if (orders.length && vehicle !== carrier) {
      if (near(at, stopFor(orders.at(-1))) && (!carrier || carrier.health <= 0))
        return prompt('recover', 'Reload this manifest into your vehicle');
      return null;
    }
    if (orders.length === 2 && near(at, dispatch)) {
      const reward = fee();
      return prompt('deliver', reward ? 'Unload freight · $' + reward : 'Unload practice manifest');
    }
    if (orders.length < 2) {
      const stop = SHIFT_STOPS.find(point => !orders.includes(point.id) && near(at, point));
      if (stop) {
        const practice = orders.length === 1 && paid.has(pairKey([...orders, stop.id]));
        return prompt('load-' + stop.id, 'Load ' + stop.goods + (practice ? ' · practice pair' : ''));
      }
    }
    if (orders.length && !restrapped && condition < 95 && near(at, SHIFT_PULL_OFF)) return prompt('secure', 'Pull straps tight · recover up to 15%');
    return null;
  }
  function screeningUnlocked() {
    return [...paid].some(pair => pair.split('+').includes('pier'));
  }
  function fee() {
    return paid.has(pairKey(orders)) ? 0 : 400 + Math.floor(condition) * 2;
  }
  function interact(kind, { vehicle, position } = {}) {
    if (action(position, vehicle)?.kind !== kind) return {};
    if (kind === 'shift-deliver') {
      const reward = fee();
      const firstScreening = orders.includes('pier') && !screeningUnlocked();
      paid.add(pairKey(orders));
      running = false; orders = []; carrier = null; selectedPickup = null;
      finish(reward, { title:'NIGHT SHIFT · FREIGHT RECEIVED', reward, replayHint:firstScreening ? 'First screening at the pier access road.' : 'A different pair of pickups earns a new dispatch fee.' });
      return { shiftDelivered: true };
    }
    if (kind === 'shift-start') {
      running = true; orders = []; condition = 100; restrapped = false;
      const lines = ['Two stops, your choice. Sunline has glass, the Paloma has linens, and the pier access road has film reels. Stop to load at each curb.'];
      lines.push(screeningUnlocked() ? 'Bring both orders back here. Each new pair earns a dispatch fee.' : 'Bring the projection reels and either other order back here to open the pier drive-in. Each new pair pays once.');
      onDialogue?.('DISPATCH',lines);
    } else if (kind === 'shift-cancel') {
      running = false; orders = []; carrier = null; selectedPickup = null;
      onToast?.('MANIFEST RETURNED','Dispatch has released the orders.');
    } else if (kind === 'shift-secure') {
      restrapped = true; condition = Math.min(100, condition + 15);
      onToast?.('STRAPS TIGHT','Cargo condition ' + Math.floor(condition) + '%.');
    } else {
      if (kind !== 'shift-recover') {
        const stop = stopFor(kind.slice('shift-load-'.length));
        orders.push(stop.id); restrapped = false;
        if (stop.id === selectedPickup || orders.length === 2) selectedPickup = null;
        onToast?.('LOADED · ' + stop.goods.toUpperCase(), stop.handling + (orders.length === 2 ? ' Return to dispatch.' : ' Choose one more pickup.'));
      }
      carrier = vehicle; lastHealth = vehicle.health; lastSpeed = vehicle.speed;
    }
    save();
    return { shiftInteraction:true };
  }
  function update({ vehicle, dt = 0, slip = 0 }) {
    if (!running || !carrier || vehicle !== carrier || !orders.length) return;
    const before = condition;
    const step = Math.min(.25, Math.max(0, dt));
    const brakes = Math.max(0, Math.abs(lastSpeed) - Math.abs(vehicle.speed) - 9 * step);
    const collision = Math.max(0, lastHealth - vehicle.health);
    const brakingLoss = brakes * (orders.includes('sunline') ? .44 : .23);
    const skidLoss = Math.max(0, slip - .4) * step * (orders.includes('pier') ? 4.8 : 3);
    const padding = orders.includes('paloma') ? .78 : 1;
    condition = Math.max(0, condition - (collision * .8 + brakingLoss + skidLoss) * padding);
    lastSpeed = vehicle.speed; lastHealth = vehicle.health;
    if (Math.floor(before / 5) !== Math.floor(condition / 5)) save();
  }
  function view() {
    const base = { nightShiftActive:running, nightShiftSelectedPickup:null, nightShiftCargo:Math.floor(condition), nightShiftPhase:running ? orders.length === 2 ? 'return' : 'collect' : 'available', nightShiftAvailableTarget:dispatch };
    if (!running) return base;
    const open = SHIFT_STOPS.filter(stop => !orders.includes(stop.id));
    const recovery = orders.length > 0 && (!carrier || carrier.health <= 0);
    const selected = !recovery && open.find(stop => stop.id === selectedPickup);
    const target = recovery ? stopFor(orders.at(-1)) : orders.length === 2 ? dispatch : selected || open[0];
    const choices = open.map(stop => stop.label).join(' / ');
    return { ...base, target, nightShiftSelectedPickup:selected || null, secondaryTarget: !recovery && orders.length < 2 ? open.find(stop => stop !== target) : null,
      objectiveTitle: recovery ? 'Recover the freight' : orders.length === 2 ? 'Unload at Auto Works' : selected ? selected.label : 'Choose a freight pickup',
      objective: recovery ? 'Take a working vehicle to ' + target.label + ' and reload the manifest.' :
        (orders.length === 2 ? 'Stop at dispatch and unload.' : selected ? 'Stop at ' + selected.label + ' and load ' + selected.goods + '.' : choices + ' · stop and interact to load.') +
        (orders.length ? ' Cargo ' + Math.floor(condition) + '%.' : '') +
        (orders.length && condition < 95 && !restrapped ? ' Optional: restrap at the boulevard pull-off north of Calypso.' : ''),
      missionStage:'NIGHT SHIFT · ' + orders.length + '/2 LOADED', missionProgress:orders.length / 3 };
  }
  function manifest() {
    return { orders:[...orders], carrier:carrier?.health > 0 ? carrier.model.mesh : null, recovering:running && orders.length > 0 && (!carrier || carrier.health <= 0) };
  }
  return { pickupNear, selectPickup, action, interact, update, view, checkpoint, restore, manifest, screeningUnlocked, active: () => running };
}
