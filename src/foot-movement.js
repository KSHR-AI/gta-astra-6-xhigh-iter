export const WALK_SPEED = 2.35;
export const SPRINT_SPEED = 5.8;

// Limit the whole horizontal change so diagonal input has the same response.
export function advanceFootVelocity(velocity, target, dt) {
  const dx = target.x - velocity.x;
  const dz = target.z - velocity.z;
  const change = Math.hypot(dx, dz);
  if (!change) return;
  const targetSpeed = Math.hypot(target.x, target.z);
  const slowing = targetSpeed < Math.hypot(velocity.x, velocity.z);
  const reversing = target.x * velocity.x + target.z * velocity.z < 0;
  const acceleration = slowing || reversing ? 27 : targetSpeed > WALK_SPEED ? 11 : 16;
  const fraction = Math.min(1, acceleration * dt / change);
  velocity.x += dx * fraction;
  velocity.z += dz * fraction;
}

// Ease both ends so walking and full sprint have stable camera framing.
export function sprintFraming(speed) {
  const t = Math.max(0, Math.min(1, (speed - WALK_SPEED) / (SPRINT_SPEED - WALK_SPEED)));
  return t * t * (3 - 2 * t);
}
