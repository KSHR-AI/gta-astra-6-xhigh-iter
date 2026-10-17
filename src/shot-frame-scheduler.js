/**
 * Preserve normal simulation steps while visiting a queued shot's inclusive
 * deadline before any time after it. Readiness comes from advance's real pose.
 * A single pending request adds at most one advance call to its expiry frame.
 */
export function createShotFrameScheduler({ getTime, advance, handling, maxStep = .033 }) {
  if (!Number.isFinite(maxStep) || maxStep <= 0) throw new RangeError('Maximum step must be finite and positive');
  function finishDeadline(deadline) {
    // advance may consume/cancel the old request. Never cancel its replacement.
    if (handling.pendingDeadline === deadline && getTime() >= deadline) handling.cancel();
  }
  return function advanceFrame(dt, paused = false) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Frame dt must be finite and nonnegative');
    if (paused) { advance(dt); return 1; }
    const nominalSteps = Math.max(1, Math.ceil(dt / maxStep));
    const step = dt / nominalSteps;
    let calls = 0;
    for (let i = 0; i < nominalSteps; i++) {
      const deadline = handling.pendingDeadline;
      const untilDeadline = deadline === null ? Infinity : deadline - getTime();
      if (untilDeadline < 0) {
        // Overdue requests cannot drive another raised pose or revive later.
        handling.cancel();
      }
      if (untilDeadline >= 0 && untilDeadline < step) {
        // A zero-length boundary at frame start is intentional: the inclusive
        // instant still gets one real pose check before the request is retired.
        advance(untilDeadline); calls++;
        finishDeadline(deadline);
        advance(step - untilDeadline); calls++;
      } else {
        advance(step); calls++;
        if (deadline !== null) finishDeadline(deadline);
      }
    }
    return calls;
  };
}
