// These points align with the drivable junction, the diner lane and the workshop driveway.
const fork = { x: 3, z: 0, label: 'Calypso mural', radius: 11 };
const boulevard = [
  { x: 4, z: -36, label: 'Vespucci Boulevard', radius: 11, heading: Math.PI, directions: 'Stay north on the boulevard. Watch the crossings.' },
  { x: 4, z: -88, label: 'North crossing', radius: 13, heading: Math.PI, directions: 'Cross North Street and continue to Auto Works.' },
];
const service = [
  { x: 27, z: 0, label: 'Sunline service lane', radius: 10, heading: Math.PI / 2, directions: 'Turn east at Calypso, then left into the service lane.' },
  { x: 55, z: -8, label: 'Diner loading entrance', radius: 8, heading: Math.PI, directions: 'Swing left past the diner. The loading lane runs north.' },
  { x: 55, z: -50, label: 'Sunline loading yard', radius: 7, heading: Math.PI, directions: 'Ease through the loading yard beside the diner.' },
  { x: 55, z: -90, label: 'North Street exit', radius: 9, heading: Math.PI, directions: 'Leave the service lane and turn west onto North Street.' },
  { x: 4, z: -92, label: 'Boulevard reunion', radius: 12, heading: -Math.PI / 2, directions: 'Follow North Street west, then turn north onto the boulevard.' },
];
const routes = { boulevard, service };
export const LAST_LIGHT_FORK = fork;
export const LAST_LIGHT_ROUTES = routes;
const names = { boulevard: 'Vespucci Boulevard', service: 'Sunline service lane' };
const close = (p, gate) => p && Math.hypot(p.x - gate.x, p.z - gate.z) <= gate.radius;
const basePay = 1500, cleanPay = 500, cleanThreshold = 85;
const cleanState = () => ({ inspected: false, forkPassed: false, route: null, mile: 0, conditionPct: 100, cleanEligible: true });

export function createLastLight(stored, legacyPaid = false) {
  let drive = cleanState();
  let paid = legacyPaid || stored?.paid === true;
  let replay = paid && stored?.replay === true;
  let checkpointHealth = 100;
  let routeRecords = {};
  for (const route of Object.keys(routes)) {
    const recorded = stored?.routeRecords?.[route];
    if (Number.isInteger(recorded) && recorded >= 0 && recorded <= 100) routeRecords[route] = recorded;
  }
  if (stored && typeof stored === 'object') {
    drive.forkPassed = stored.forkPassed === true;
    drive.inspected = drive.forkPassed || stored.inspected === true;
    if (drive.forkPassed && Object.hasOwn(routes, stored.route) && Number.isInteger(stored.mile)) {
      drive.route = stored.route;
      drive.mile = Math.max(1,Math.min(routes[drive.route].length,stored.mile));
    }
    checkpointHealth = Number.isFinite(stored.conditionPct) ? Math.max(1,Math.min(100,stored.conditionPct)) : 100;
    drive.conditionPct = checkpointHealth;
    drive.cleanEligible = stored.cleanEligible !== false && checkpointHealth >= cleanThreshold;
  }
  function saveState() { return { ...drive, conditionPct: Math.max(1,drive.conditionPct), paid, replay, routeRecords:{...routeRecords} }; }
  function reset(practice = false) {
    drive = cleanState(); replay = practice; checkpointHealth = 100;
    if (!practice) { paid = false; routeRecords = {}; }
  }
  function routeFinished() { return Boolean(drive.route && drive.mile === routes[drive.route].length); }
  function checkpoint() {
    const point = drive.route ? routes[drive.route][drive.mile - 1] : drive.forkPassed ? fork : null;
    return point && { x: point.x, z: point.z, heading: point.heading ?? Math.PI, health: Math.max(40,checkpointHealth) };
  }
  function condition(health) {
    if (!Number.isFinite(health)) return false;
    drive.conditionPct = Math.max(0,Math.min(100,Math.floor(health)));
    const lost = drive.cleanEligible && drive.conditionPct < cleanThreshold;
    if (lost) drive.cleanEligible = false;
    return lost;
  }
  function advance(position) {
    if (!drive.forkPassed) {
      if (!close(position,fork)) return null;
      drive.forkPassed = true; checkpointHealth = drive.conditionPct;
      return { title: 'CALYPSO MURAL', detail: 'Straight for Vespucci Boulevard. Turn right for the Sunline service lane.' };
    }
    if (!drive.route) {
      const route = close(position,boulevard[0]) ? 'boulevard' : close(position,service[0]) ? 'service' : null;
      if (!route) return null;
      drive.route = route; drive.mile = 1; checkpointHealth = drive.conditionPct;
      return {
        title: names[route].toUpperCase(),
        detail: route === 'boulevard' ? 'Leave room at the north crossing.' : 'Turn into the lane beside the diner.',
        radio: route === 'boulevard' ? 'You’re staying on Vespucci. Leave yourself room to brake at North Street.' :
          'I hear the diner extractor. Watch that left into the loading yard. It gets tight behind the kitchen.',
      };
    }
    if (routeFinished()) return null;
    const gate = routes[drive.route][drive.mile];
    if (!close(position,gate)) return null;
    drive.mile++; checkpointHealth = drive.conditionPct;
    return { title: gate.label.toUpperCase(), detail: routeFinished() ? 'Turn into Auto Works. Bring the Aurora to a stop in the bay.' : routes[drive.route][drive.mile].directions };
  }
  function quote() {
    const base = paid ? 0 : basePay, bonus = !paid && drive.cleanEligible ? cleanPay : 0;
    return { basePay: base, cleanBonus: bonus, total: base + bonus, cleanThreshold, conditionPct: drive.conditionPct, routeLabel: names[drive.route] || '', replay };
  }
  function view(stage) {
    const phase = ['briefing','pickup',drive.route ? 'drive' : drive.forkPassed ? 'fork' : 'approach','handoff','complete','complete'][stage];
    return { phase, routeRecords:{...routeRecords}, inspected: drive.inspected, route: drive.route, routeLabel: names[drive.route] || '', mile: drive.mile,
      conditionPct: drive.conditionPct, cleanThreshold, cleanEligible: drive.cleanEligible, replay };
  }
  function guidance() {
    if (!drive.forkPassed) return { target: fork, objectiveTitle: 'Find the Calypso mural', objective: 'Drive the Aurora north to the mural at Calypso.' };
    if (!drive.route) return { target: boulevard[0], secondaryTarget: service[0], objectiveTitle: 'Choose your approach', objective: 'Drive straight along Vespucci Boulevard, or turn right for the tighter Sunline service lane.' };
    const next = routes[drive.route][drive.mile];
    return next && { target: next, objectiveTitle: next.label, objective: next.directions };
  }
  function inspect() { drive.inspected = true; }
  function finish() {
    const route = drive.route;
    routeRecords[route] = Math.max(routeRecords[route] ?? 0, drive.conditionPct);
    paid = true; replay = false;
    const other = route === 'service' ? 'boulevard' : 'service';
    return Object.hasOwn(routeRecords,other)
      ? 'Both approaches completed. Your best bodywork score for each route is saved.'
      : 'Replay at the Paloma to try ' + names[other] + '.';
  }
  return { saveState, reset, inspect, routeFinished, checkpoint, condition, advance, quote, view, guidance, finish };
}
