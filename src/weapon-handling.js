// Semi-automatic input and camera recovery are independent of frame rate. Keep
// them separate from rendering so a slow frame cannot turn one press into bursts.
export const PISTOL = Object.freeze({ capacity: 12, reloadTime: 1.45, interval: .23, raiseTime: .12 });
const HIT_DURATION = .18;

export function createWeaponHandling() {
  let pending = false, readyAt = 0, expiresAt = 0, lastShot = -Infinity;
  let pitch = 0, yaw = 0, pitchVelocity = 0, yawVelocity = 0, bloom = 0, hit = 0;
  let hitUnpresented = false;
  let shots = 0;
  return {
    get queued() { return pending; },
    get shots() { return shots; },
    get recoilPitch() { return pitch; },
    get recoilYaw() { return yaw; },
    get hitMarker() { return hit / HIT_DURATION; },
    // Readiness describes the actual weapon pose, not the aim-button state.
    // A raised follow-up pays only the cooldown; a fresh raise retains its
    // minimum duration and must also be ready when consume checks it again.
    request(now, poseReady = false) {
      if (pending) return false;
      pending = true;
      readyAt = Math.max(now + (poseReady ? 0 : PISTOL.raiseTime), lastShot + PISTOL.interval);
      expiresAt = now + .38;
      return true;
    },
    consume(now, poseReady = false) {
      if (!pending) return false;
      if (now > expiresAt) { pending = false; return false; }
      if (now < readyAt || !poseReady) return false;
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
      bloom *= Math.exp(-7 * dt);
    },
    spread(aimed, speed = 0) { return (aimed ? .0012 : .006) + Math.min(1, speed / 3) * (aimed ? .003 : .006) + bloom; },
    confirmHit() { hit = HIT_DURATION; hitUnpresented = true; },
    // Call once before the HUD's actual presentation. Physics may have taken
    // many substeps since a hit; none may consume its first visible frame.
    // Paused/covered HUDs do not acknowledge a new hit. Once shown, feedback
    // ages with presentation time even if subsequently hidden, unless paused.
    presentHitMarker(dt, { visible = true, paused = false } = {}) {
      if (!paused) {
        if (hitUnpresented) {
          if (visible) hitUnpresented = false;
        } else hit = Math.max(0, hit - dt);
      }
      return hit / HIT_DURATION;
    },
    cancel() { pending = false; },
    reset() {
      pending = hitUnpresented = false; readyAt = expiresAt = 0; lastShot = -Infinity;
      pitch = yaw = pitchVelocity = yawVelocity = bloom = hit = 0;
      // IDs remain monotonic so an existing animator recognizes the next shot
      // after restart, even when its previous accepted ID happened to be one.
    },
  };
}
