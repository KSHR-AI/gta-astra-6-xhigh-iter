// All navigation uses the same footprint as the player's car collisions. These
// are ground-plane checks: neither a hidden mesh nor a model's ornamental trim
// should change where a person can walk.
export const PERSON_RADIUS = .34;
const HALF_WIDTH = 1.08;
const HALF_LENGTH = 2.25;

function localPoint(point, car) {
  const origin = car.model.mesh.position;
  const x = point.x - origin.x, z = point.z - origin.z;
  const s = Math.sin(car.heading), c = Math.cos(car.heading);
  return { x: x * c - z * s, z: x * s + z * c };
}

export function insideVehicle(point, car, radius = PERSON_RADIUS) {
  const p = localPoint(point, car);
  return Math.abs(p.x) < HALF_WIDTH + radius && Math.abs(p.z) < HALF_LENGTH + radius;
}

export function vehicleEscape(position, car) {
  const p = localPoint(position, car);
  if (!insideVehicle(position, car)) return null;
  const side = HALF_WIDTH + PERSON_RADIUS - Math.abs(p.x);
  const front = HALF_LENGTH + PERSON_RADIUS - Math.abs(p.z);
  const x = side < front ? (Math.sign(p.x) || 1) : 0;
  const z = side < front ? 0 : (Math.sign(p.z) || 1);
  return { x: x * Math.cos(car.heading) + z * Math.sin(car.heading), z: -x * Math.sin(car.heading) + z * Math.cos(car.heading) };
}

export function vehiclePenetration(position, car) {
  const p = localPoint(position, car);
  return Math.max(0, Math.min(HALF_WIDTH + PERSON_RADIUS - Math.abs(p.x), HALF_LENGTH + PERSON_RADIUS - Math.abs(p.z)));
}

function crossesBox(a, b, minX, maxX, minZ, maxZ) {
  let enter = 0, leave = 1;
  for (const [origin, direction, low, high] of [[a.x, b.x - a.x, minX, maxX], [a.z, b.z - a.z, minZ, maxZ]]) {
    if (Math.abs(direction) < 1e-8) {
      if (origin <= low || origin >= high) return false;
    } else {
      const near = (low - origin) / direction, far = (high - origin) / direction;
      enter = Math.max(enter, Math.min(near, far));
      leave = Math.min(leave, Math.max(near, far));
      if (enter >= leave) return false;
    }
  }
  return leave > 0 && enter < 1;
}

export function crossesVehicle(a, b, car, radius = PERSON_RADIUS) {
  return crossesBox(localPoint(a, car), localPoint(b, car), -HALF_WIDTH - radius, HALF_WIDTH + radius, -HALF_LENGTH - radius, HALF_LENGTH + radius);
}

function clearSegment(a, b, vehicles, colliders) {
  return !vehicles.some(car => crossesVehicle(a, b, car)) && !colliders.some(box =>
    crossesBox(a, b, box.minX - PERSON_RADIUS, box.maxX + PERSON_RADIUS, box.minZ - PERSON_RADIUS, box.maxZ + PERSON_RADIUS));
}

/** A tiny local visibility graph gives a stable route around a parked car.
 * Corners on the wall side are discarded, so the person uses the open side.
 * Returning no route means wait; collision checks still guard every movement.
 */
export function vehicleDetour(position, target, vehicles, colliders) {
  const nearby = vehicles.filter(car => Math.hypot(car.model.mesh.position.x - position.x, car.model.mesh.position.z - position.z) < 14);
  if (!nearby.some(car => crossesVehicle(position, target, car))) return null;
  const nodes = [{ x: position.x, z: position.z }, target];
  for (const car of nearby) {
    const s = Math.sin(car.heading), c = Math.cos(car.heading), origin = car.model.mesh.position;
    // Extra clearance prevents a rounded walking step from shaving a corner.
    for (const x of [-HALF_WIDTH - PERSON_RADIUS - .22, HALF_WIDTH + PERSON_RADIUS + .22]) {
      for (const z of [-HALF_LENGTH - PERSON_RADIUS - .22, HALF_LENGTH + PERSON_RADIUS + .22]) {
        const corner = { x: origin.x + x * c + z * s, z: origin.z - x * s + z * c };
        if (!nearby.some(other => insideVehicle(corner, other)) && !colliders.some(box =>
          corner.x > box.minX - PERSON_RADIUS && corner.x < box.maxX + PERSON_RADIUS && corner.z > box.minZ - PERSON_RADIUS && corner.z < box.maxZ + PERSON_RADIUS)) nodes.push(corner);
      }
    }
  }
  const costs = nodes.map(() => Infinity), previous = nodes.map(() => -1), visited = new Set();
  costs[0] = 0;
  while (visited.size < nodes.length) {
    let node = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (node === -1 || costs[i] < costs[node])) node = i;
    if (node === -1 || !Number.isFinite(costs[node])) return [];
    if (node === 1) {
      const path = [];
      for (let i = 1; i !== 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(node);
    for (let i = 0; i < nodes.length; i++) {
      if (visited.has(i) || !clearSegment(nodes[node], nodes[i], nearby, colliders)) continue;
      const cost = costs[node] + Math.hypot(nodes[i].x - nodes[node].x, nodes[i].z - nodes[node].z);
      if (cost < costs[i]) { costs[i] = cost; previous[i] = node; }
    }
  }
  return [];
}

/** Wait outside a moving car's path. People already in the lane keep clearing
 * it; drivers yield to them. Once a driver stops, walking can resume. */
export function shouldYieldToVehicle(position, velocity, car) {
  const speed = Math.abs(car.speed);
  if (speed < .8) return false;
  const p = localPoint(position, car), direction = Math.sign(car.speed);
  const ahead = p.z * direction;
  if (Math.abs(p.x) < HALF_WIDTH + PERSON_RADIUS + .18) return false;
  // Let an already passing vehicle clear the crossing rather than walking
  // around a corner that is itself moving away every frame.
  if (crossesVehicle(position, { x: position.x + velocity.x, z: position.z + velocity.z }, car)) return true;
  if (ahead < HALF_LENGTH + PERSON_RADIUS || ahead > HALF_LENGTH + PERSON_RADIUS + speed * 1.35) return false;
  const sideVelocity = velocity.x * Math.cos(car.heading) - velocity.z * Math.sin(car.heading);
  const closestSide = p.x + sideVelocity * Math.min(1.1, Math.max(.3, (ahead - HALF_LENGTH) / speed));
  return Math.abs(closestSide) < HALF_WIDTH + PERSON_RADIUS + .18 || Math.sign(closestSide) !== Math.sign(p.x);
}

/** Stopping distance rather than a fixed radius makes drivers react early at
 * speed, without stopping for someone safely walking along the pavement. */
export function pedestrianSpeedLimit(car, people) {
  let limit = Infinity;
  for (const person of people) {
    const p = localPoint(person.position, car);
    if (p.z < -HALF_LENGTH - PERSON_RADIUS || p.z > Math.max(15, car.speed * car.speed / 9 + 5)) continue;
    const velocity = person.velocity || { x: 0, z: 0 };
    const sideVelocity = velocity.x * Math.cos(car.heading) - velocity.z * Math.sin(car.heading);
    const arrival = Math.min(1.1, Math.max(0, (p.z - HALF_LENGTH) / Math.max(car.speed, 2)));
    const futureSide = p.x + sideVelocity * arrival;
    const crossesLane = Math.abs(p.x) < HALF_WIDTH + PERSON_RADIUS + .23 || Math.abs(futureSide) < HALF_WIDTH + PERSON_RADIUS + .23 || Math.sign(p.x) !== Math.sign(futureSide);
    if (!crossesLane) continue;
    const clearance = Math.max(0, p.z - HALF_LENGTH - PERSON_RADIUS - .65);
    limit = Math.min(limit, Math.sqrt(2 * 4.5 * clearance));
  }
  return limit;
}
