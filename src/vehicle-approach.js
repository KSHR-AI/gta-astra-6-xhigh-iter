import * as THREE from 'three';

// Corner rounding remains inside the authored route's turn triangle. The caller
// checks the sampled path against the world before starting the interaction.
export function createVehicleApproach(route, { speed = 2.35, acceleration = 6, braking = 8, rounding = .42 } = {}) {
  const points = [route[0].clone()];
  for (let i = 1; i < route.length - 1; i++) {
    const before = route[i - 1], corner = route[i], after = route[i + 1];
    const cut = Math.min(rounding, before.distanceTo(corner) * .3, corner.distanceTo(after) * .3);
    const entry = corner.clone().lerp(before, cut / Math.max(.001, corner.distanceTo(before)));
    const exit = corner.clone().lerp(after, cut / Math.max(.001, corner.distanceTo(after)));
    points.push(entry);
    for (let j = 1; j <= 8; j++) {
      const t = j / 8;
      points.push(entry.clone().multiplyScalar((1-t)**2).addScaledVector(corner, 2*t*(1-t)).addScaledVector(exit, t*t));
    }
  }
  if (route.length > 1) points.push(route.at(-1).clone());
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const distance = lengths.reduce((sum, value) => sum + value, 0);
  const peak = Math.min(speed, Math.sqrt(2 * distance / (1 / acceleration + 1 / braking)));
  const rise = peak / acceleration, fall = peak / braking;
  const coast = peak > 0 ? Math.max(0, (distance - peak * (rise + fall) / 2) / peak) : 0;
  const duration = rise + coast + fall;
  function atDistance(value, target = new THREE.Vector3()) {
    let remaining = Math.max(0, Math.min(distance, value));
    for (let i = 0; i < lengths.length; i++) {
      if (remaining <= lengths[i]) return target.lerpVectors(points[i], points[i + 1], remaining / Math.max(.000001, lengths[i]));
      remaining -= lengths[i];
    }
    return target.copy(points.at(-1));
  }
  return {
    points, distance, duration,
    sample(time) {
      const t = Math.max(0, Math.min(duration, time));
      let travelled, velocity;
      if (t < rise) { velocity = acceleration * t; travelled = acceleration * t * t / 2; }
      else if (t < rise + coast) { velocity = peak; travelled = peak * rise / 2 + peak * (t - rise); }
      else { const remaining = duration - t; velocity = braking * remaining; travelled = distance - braking * remaining * remaining / 2; }
      const position = atDistance(travelled);
      const look = atDistance(Math.min(distance, travelled + .3 + velocity * .1));
      return { position, direction: look.sub(position).normalize(), speed: velocity, finished: time >= duration };
    },
  };
}
