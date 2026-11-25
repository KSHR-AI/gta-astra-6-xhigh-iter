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

// The district is an orthogonal grid. Two parallel streets connect through
// any crossing street, so only those crossings need a distance comparison.
export function mapRoute(roads, start, goal) {
  const from = nearestMapRoad(roads, start), to = nearestMapRoad(roads, goal);
  const path = [start, from.snap];
  if (from.road.axis !== to.road.axis) {
    path.push({ [from.road.axis]: to.snap[from.road.axis], [to.road.axis]: from.snap[to.road.axis] });
  } else if (from.road !== to.road) {
    const axis = from.road.axis;
    const crossings = roads.filter(road => road.axis !== axis);
    const cost = road => Math.abs(from.snap[axis] - road[axis]) + Math.abs(to.snap[axis] - road[axis]);
    const crossing = crossings.reduce((best, road) => cost(road) < cost(best) ? road : best);
    path.push({ ...from.snap, [axis]: crossing[axis] }, { ...to.snap, [axis]: crossing[axis] });
  }
  return [...path, to.snap, goal];
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
