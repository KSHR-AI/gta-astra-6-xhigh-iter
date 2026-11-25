// The district is an orthogonal grid. Two parallel streets connect through
// any crossing street, so only those crossings need a distance comparison.
export function mapRoute(roads, start, goal) {
  function nearest(point) {
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

  const from = nearest(start), to = nearest(goal);
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
