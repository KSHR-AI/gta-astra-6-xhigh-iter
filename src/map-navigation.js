export function nearestMapRoad(roads, point) {
  let best;
  for (const road of roads) {
    const axis = road.axis, across = axis === 'x' ? 'z' : 'x';
    const along = Math.max(road[axis] - road.length / 2, Math.min(road[axis] + road.length / 2, point[axis]));
    const snap = { [axis]: along, [across]: road[across] };
    const distance = Math.hypot(point.x - snap.x, point.z - snap.z);
    if (!best || distance < best.distance) best = { road, snap, distance };
  }
  return best;
}

// A crossing exists only where both finite road centre lines reach it.
function crossing(a, b) {
  if (a.axis === b.axis) return null;
  const point = { [a.axis]: b[a.axis], [b.axis]: a[b.axis] };
  return [a,b].every(r => Math.abs(point[r.axis] - r[r.axis]) <= r.length / 2) ? point : null;
}

export function mapRoute(roads, start, goal) {
  const from = nearestMapRoad(roads, start), to = nearestMapRoad(roads, goal);
  if (!from || !to) return [start];
  if (from.road === to.road) return [start, from.snap, to.snap, goal];

  const nodes = [{ point: from.snap, roads: [from.road] }, { point: to.snap, roads: [to.road] }];
  for (let i = 0; i < roads.length; i++) {
    for (let j = i + 1; j < roads.length; j++) {
      const point = crossing(roads[i], roads[j]);
      if (point) nodes.push({ point, roads: [roads[i], roads[j]] });
    }
  }
  const costs = nodes.map(() => Infinity), previous = [], settled = new Set();
  costs[0] = 0;
  while (true) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!settled.has(i) && costs[i] < (current < 0 ? Infinity : costs[current])) current = i;
    }
    if (current < 0) return [start, from.snap];
    if (current === 1) break;
    settled.add(current);
    const node = nodes[current];
    for (let i = 0; i < nodes.length; i++) {
      if (settled.has(i) || !nodes[i].roads.some(road => node.roads.includes(road))) continue;
      const next = nodes[i].point;
      const cost = costs[current] + Math.hypot(next.x - node.point.x, next.z - node.point.z);
      if (cost < costs[i]) { costs[i] = cost; previous[i] = current; }
    }
  }
  const path = [];
  for (let i = 1; i !== undefined; i = previous[i]) path.push(nodes[i].point);
  return [start, ...path.reverse(), goal];
}

// The first and last short segments snap the route to the road centre. Only
// mark a corner if there is a meaningful onward leg beyond it.
export function nextMapTurn(route, reach) {
  const start = route[0];
  for (let i = 2; i < route.length - 1; i++) {
    const corner = route[i], next = route[i + 1];
    const dx = next.x - corner.x, dz = next.z - corner.z;
    if (Math.hypot(dx, dz) < 8) continue;
    const distance = Math.hypot(corner.x - start.x, corner.z - start.z);
    if (distance > reach) return null;
    return { x: corner.x, z: corner.z, heading: Math.atan2(dx, dz) };
  }
  return null;
}


export const cityMapCenter = { x: -10, z: -20 };
export const cityMapScale = (width, height) => Math.min(width / 405, height / 466);

// The canvas uses object-fit: contain, including letterboxing on wide screens.
export function mapClickPosition(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const fit = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const scale = fit * cityMapScale(canvas.width, canvas.height);
  return {
    x: cityMapCenter.x + (clientX - rect.left - rect.width / 2) / scale,
    z: cityMapCenter.z + (clientY - rect.top - rect.height / 2) / scale,
  };
}
