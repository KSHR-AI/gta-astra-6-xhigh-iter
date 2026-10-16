// Semi-automatic input and camera recovery are independent of frame rate. Keep
// them separate from rendering so a slow frame cannot turn one press into bursts.
export const PISTOL = Object.freeze({ capacity: 12, reloadTime: 1.45, interval: .23, raiseTime: .12 });

export function createWeaponHandling() {
  let pending = false, readyAt = 0, expiresAt = 0, lastShot = -Infinity;
  let pitch = 0, yaw = 0, pitchVelocity = 0, yawVelocity = 0, bloom = 0, hit = 0;
  let shots = 0;
  return {
    get queued() { return pending; },
    get shots() { return shots; },
    get recoilPitch() { return pitch; },
    get recoilYaw() { return yaw; },
    get hitMarker() { return hit / .18; },
    request(now, aimed = false) {
      if (pending) return;
      pending = true;
      readyAt = Math.max(now + (aimed ? 0 : PISTOL.raiseTime), lastShot + PISTOL.interval);
      expiresAt = now + .38;
    },
    consume(now) {
      if (!pending) return false;
      if (now > expiresAt) { pending = false; return false; }
      if (now < readyAt) return false;
      pending = false; lastShot = now; shots++;
      pitchVelocity += .34;
      yawVelocity += (shots % 2 ? 1 : -1) * .055;
      bloom = Math.min(.012, bloom + .004);
      return true;
    },
    update(dt) {
      // Substep the damped spring at a fixed maximum integration interval.
      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        pitchVelocity += (-120 * pitch - 19 * pitchVelocity) * step;
        yawVelocity += (-100 * yaw - 18 * yawVelocity) * step;
        pitch += pitchVelocity * step; yaw += yawVelocity * step;
      }
      bloom *= Math.exp(-7 * dt); hit = Math.max(0, hit - dt);
    },
    spread(aimed, speed = 0) { return (aimed ? .0012 : .006) + Math.min(1, speed / 3) * (aimed ? .003 : .006) + bloom; },
    confirmHit() { hit = .18; },
    cancel() { pending = false; },
    reset() { pending = false; lastShot = -Infinity; pitch = yaw = pitchVelocity = yawVelocity = bloom = hit = 0; },
  };
}
