// World-space velocity is deliberately independent of the body's heading. That
// distinction gives the tires something to grip and lets a handbrake turn slide.
// The fixed simulation step also keeps driving consistent on slower browsers.
const STEP = 1 / 120;
const MAX_FRAME_TIME = .5;
const HULL_RADIUS = 1.03;
const HULL_OFFSETS = [-1.2, 0, 1.2];
const STATIC_CONTACT = Symbol('world');
const states = new WeakMap();
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const approach = (value, target, rate, dt) => target + (value - target) * Math.exp(-rate * dt);
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

const TUNING = {
  sport: { mass: 1420, wheelbase: 2.64, acceleration: 10.8, brake: 19, grip: 13.2, maxSpeed: 44, reverse: 9, steering: .54 },
  sedan: { mass: 1660, wheelbase: 2.83, acceleration: 8.1, brake: 17, grip: 10.8, maxSpeed: 38, reverse: 8, steering: .52 },
  police: { mass: 1740, wheelbase: 2.83, acceleration: 9.7, brake: 18.5, grip: 12.3, maxSpeed: 43, reverse: 9, steering: .52 },
};
const GEAR_RATIOS = [4.4, 2.85, 2.05, 1.55, 1.25, 1.05];

function tuningFor(car) {
  return TUNING[car.police ? 'police' : car.model.type] || TUNING.sport;
}

function freshState(car) {
  const position = car.model.mesh.position;
  const speed = Number.isFinite(car.speed) ? car.speed : 0;
  const heading = Number.isFinite(car.heading) ? car.heading : 0;
  return {
    vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed,
    accumulator: 0, clock: 0, yawRate: 0, acceleration: 0, slip: 0,
    roll: 0, pitch: 0, heave: 0, rollVelocity: 0, pitchVelocity: 0, heaveVelocity: 0,
    brake: 0, rpm: 850, gear: 1, lastShift: -1,
    lastX: position.x, lastZ: position.z, lastHeading: heading, lastSpeed: speed,
    contacts: new Map(), impact: null,
  };
}

function stateFor(car) {
  let state = states.get(car);
  if (!state) {
    state = freshState(car);
    states.set(car, state);
  }
  return state;
}

function synchronize(car, state) {
  const position = car.model.mesh.position;
  const speed = Number.isFinite(car.speed) ? car.speed : 0;
  const heading = Number.isFinite(car.heading) ? car.heading : 0;
  const movedExternally = Math.hypot(position.x - state.lastX, position.z - state.lastZ) > .35;
  const rotatedExternally = Math.abs(angleDelta(state.lastHeading, heading)) > .025;
  if (movedExternally || rotatedExternally) {
    // Traffic control, entering a vehicle, and restarting may move a car without
    // this integrator. Never retain an old drift velocity across a teleport.
    Object.assign(state, freshState(car));
  } else if (Math.abs(speed - state.lastSpeed) > .015) {
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const lateral = state.vx * fz - state.vz * fx;
    const retain = Math.abs(speed) < .05 ? 0 : Math.min(1, Math.abs(speed) / Math.max(.1, Math.abs(state.lastSpeed)));
    state.vx = fx * speed + fz * lateral * retain;
    state.vz = fz * speed - fx * lateral * retain;
    state.yawRate *= retain;
  }
  car.speed = speed;
  car.heading = heading;
  if (!Number.isFinite(car.steer)) car.steer = 0;
}

function moveUnobstructed(position, dx, dz) {
  position.x += dx;
  position.z += dz;
  return false;
}

// The caller's moveBody resolves circles against world geometry. Three swept
// circles approximate the complete chassis, including its front and rear ends.
function probeHull(position, heading, x, z, nextHeading, moveBody) {
  let blockedX = false, blockedZ = false, hit = false;
  const oldSin = Math.sin(heading), oldCos = Math.cos(heading);
  const newSin = Math.sin(nextHeading), newCos = Math.cos(nextHeading);
  for (const offset of HULL_OFFSETS) {
    const probe = { x: position.x + oldSin * offset, y: position.y || 0, z: position.z + oldCos * offset };
    const targetX = x + newSin * offset, targetZ = z + newCos * offset;
    const collided = moveBody(probe, targetX - probe.x, targetZ - probe.z, HULL_RADIUS);
    const failedX = Math.abs(targetX - probe.x) > 1e-7;
    const failedZ = Math.abs(targetZ - probe.z) > 1e-7;
    blockedX ||= failedX;
    blockedZ ||= failedZ;
    hit ||= collided || failedX || failedZ;
  }
  return { blockedX, blockedZ, hit };
}

function contactNormal(a, ah, b, bh) {
  const dx = a.x - b.x, dz = a.z - b.z;
  const af = { x: Math.sin(ah), z: Math.cos(ah) }, ar = { x: af.z, z: -af.x };
  const bf = { x: Math.sin(bh), z: Math.cos(bh) }, br = { x: bf.z, z: -bf.x };
  let best = { x: 0, z: 1, depth: Infinity };
  for (const axis of [af, ar, bf, br]) {
    const extent = 2.25 * (Math.abs(af.x * axis.x + af.z * axis.z) + Math.abs(bf.x * axis.x + bf.z * axis.z))
      + 1.02 * (Math.abs(ar.x * axis.x + ar.z * axis.z) + Math.abs(br.x * axis.x + br.z * axis.z));
    const distance = dx * axis.x + dz * axis.z;
    const depth = extent - Math.abs(distance);
    if (depth < best.depth) {
      const direction = distance < 0 ? -1 : 1;
      best = { x: axis.x * direction, z: axis.z * direction, depth: Math.max(0, depth) };
    }
  }
  return best;
}

function emitImpact(car, state, speed, other, onImpact) {
  const key = other || STATIC_CONTACT;
  const previous = state.contacts.get(key);
  const continuedContact = previous && state.clock - previous.seen < .18;
  const coolingDown = previous && state.clock - previous.emitted < .55;
  const contact = { seen: state.clock, emitted: previous?.emitted ?? -Infinity };
  state.contacts.set(key, contact);
  if (speed < 1.2 || continuedContact || coolingDown) return;
  contact.emitted = state.clock;
  const pos = car.model.mesh.position;
  const position = typeof pos.clone === 'function' ? pos.clone() : { x: pos.x, y: pos.y || 0, z: pos.z };
  const impact = { speed, other, position };
  if (!state.impact || speed > state.impact.speed) state.impact = impact;
  state.heaveVelocity += Math.min(.16, speed * .007);
  onImpact?.(impact);
}

function resolveCarContact(car, other, state, normal, onImpact) {
  const otherState = stateFor(other);
  synchronize(other, otherState);
  const relativeX = state.vx - otherState.vx, relativeZ = state.vz - otherState.vz;
  const closing = -(relativeX * normal.x + relativeZ * normal.z);
  if (closing > 0) {
    const inverseMass = 1 / tuningFor(car).mass;
    // A parked car resists the initial shove, but is never an immovable wall.
    const otherInverseMass = (other.occupied || other.traffic || Math.abs(other.speed) > .5 ? 1 : .65) / tuningFor(other).mass;
    const impulse = closing * 1.12 / (inverseMass + otherInverseMass);
    state.vx += normal.x * impulse * inverseMass;
    state.vz += normal.z * impulse * inverseMass;
    otherState.vx -= normal.x * impulse * otherInverseMass;
    otherState.vz -= normal.z * impulse * otherInverseMass;
    // Tangential contact friction makes a side swipe scrub speed instead of
    // bouncing the whole vehicle directly backward.
    const tx = -normal.z, tz = normal.x;
    const tangent = clamp(-(relativeX * tx + relativeZ * tz) / (inverseMass + otherInverseMass), -impulse * .17, impulse * .17);
    state.vx += tx * tangent * inverseMass;
    state.vz += tz * tangent * inverseMass;
    otherState.vx -= tx * tangent * otherInverseMass;
    otherState.vz -= tz * tangent * otherInverseMass;
    other.speed = otherState.vx * Math.sin(other.heading) + otherState.vz * Math.cos(other.heading);
    otherState.lastSpeed = other.speed;
  }
  state.yawRate *= .4;
  emitImpact(car, state, Math.max(0, closing), other, onImpact);
}

function advance(car, state, nextHeading, dt, options) {
  const position = car.model.mesh.position;
  const moveBody = options.moveBody || moveUnobstructed;
  const distance = Math.hypot(state.vx, state.vz) * dt;
  // Even externally supplied extreme speeds cannot jump over a thin obstacle.
  const slices = Math.max(1, Math.ceil(distance / .22));
  const headingStep = angleDelta(car.heading, nextHeading) / slices;
  for (let i = 0; i < slices; i++) {
    const previous = { x: position.x, y: position.y || 0, z: position.z };
    const previousHeading = car.heading;
    let candidateHeading = previousHeading + headingStep;
    let x = previous.x + state.vx * dt / slices;
    let z = previous.z + state.vz * dt / slices;
    let obstruction = probeHull(previous, previousHeading, x, z, candidateHeading, moveBody);
    if (obstruction.hit && Math.abs(headingStep) > 1e-7) {
      candidateHeading = previousHeading;
      obstruction = probeHull(previous, previousHeading, x, z, candidateHeading, moveBody);
      state.yawRate *= .5;
    }
    if (obstruction.hit) {
      const impactSpeed = Math.hypot(obstruction.blockedX ? state.vx : 0, obstruction.blockedZ ? state.vz : 0);
      if (obstruction.blockedX) { x = previous.x; state.vx *= Math.abs(state.vx) > 3 ? -.1 : 0; }
      if (obstruction.blockedZ) { z = previous.z; state.vz *= Math.abs(state.vz) > 3 ? -.1 : 0; }
      emitImpact(car, state, impactSpeed, null, options.onImpact);
    }
    position.x = x;
    position.z = z;
    car.heading = candidateHeading;

    if (options.carsOverlap && options.vehicles) {
      for (const other of options.vehicles) {
        if (other === car || !other?.model?.mesh) continue;
        const otherPosition = other.model.mesh.position;
        if (Math.hypot(position.x - otherPosition.x, position.z - otherPosition.z) > 6) continue;
        if (!options.carsOverlap(position, car.heading, otherPosition, other.heading)) continue;
        const normal = contactNormal(position, car.heading, otherPosition, other.heading);
        const wasOverlapping = options.carsOverlap(previous, previousHeading, otherPosition, other.heading);
        position.x = previous.x;
        position.z = previous.z;
        car.heading = previousHeading;

        // Keep the tangential part of this step when glancing off another car.
        // If a spawn/traffic edit left cars intersecting, gently separate them.
        const dx = x - previous.x, dz = z - previous.z;
        const inward = Math.min(0, dx * normal.x + dz * normal.z);
        const separation = wasOverlapping ? Math.min(.5, normal.depth + .025) : .006;
        const slideX = previous.x + dx - normal.x * inward + normal.x * separation;
        const slideZ = previous.z + dz - normal.z * inward + normal.z * separation;
        const staticHit = probeHull(previous, previousHeading, slideX, slideZ, previousHeading, moveBody).hit;
        const slide = { x: slideX, y: previous.y, z: slideZ };
        const hitsAnother = options.vehicles.some(candidate => candidate !== car && candidate !== other && candidate?.model?.mesh
          && options.carsOverlap(slide, previousHeading, candidate.model.mesh.position, candidate.heading));
        if (!staticHit && !hitsAnother && (wasOverlapping || !options.carsOverlap(slide, previousHeading, otherPosition, other.heading))) {
          position.x = slideX;
          position.z = slideZ;
        }
        resolveCarContact(car, other, state, normal, options.onImpact);
      }
    }
  }
}

function suspension(state, lateralAcceleration, dt) {
  const targetRoll = clamp(lateralAcceleration * .0065, -.095, .095);
  const targetPitch = clamp(-state.acceleration * .0035, -.05, .075);
  state.rollVelocity += ((targetRoll - state.roll) * 70 - state.rollVelocity * 13) * dt;
  state.pitchVelocity += ((targetPitch - state.pitch) * 64 - state.pitchVelocity * 12) * dt;
  state.heaveVelocity += (-state.heave * 110 - state.heaveVelocity * 14) * dt;
  state.roll += state.rollVelocity * dt;
  state.pitch += state.pitchVelocity * dt;
  state.heave += state.heaveVelocity * dt;
}

function transmission(car, state, throttle, dt) {
  const speed = Math.abs(car.speed);
  if (speed < 1.2) state.gear = 1;
  let coupledRPM = speed * 109 * GEAR_RATIOS[state.gear - 1];
  if (state.clock - state.lastShift > .25) {
    if (coupledRPM > 5400 && state.gear < 6) { state.gear++; state.lastShift = state.clock; }
    else if (coupledRPM < 2050 && state.gear > 1) { state.gear--; state.lastShift = state.clock; }
  }
  coupledRPM = speed * 109 * (car.speed < -.3 ? 4.4 : GEAR_RATIOS[state.gear - 1]);
  const targetRPM = car.health <= 0 ? 0 : clamp(Math.max(850 + Math.abs(throttle) * 450, coupledRPM + state.slip * 650), 0, 6500);
  state.rpm = approach(state.rpm, targetRPM, 11, dt);
}

function simulate(car, state, dt, options) {
  state.clock += dt;
  const tuning = tuningFor(car);
  const throttle = clamp(Number(options.throttle) || 0, -1, 1);
  const steering = clamp(Number(options.steering) || 0, -1, 1);
  const handbrake = Boolean(options.handbrake);
  const alive = !(car.health <= 0);
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let longitudinal = state.vx * fx + state.vz * fz;
  const speed = Math.hypot(state.vx, state.vz);
  const serviceBrake = throttle * longitudinal < -.45;
  state.brake = handbrake ? 1 : serviceBrake ? Math.abs(throttle) : alive ? 0 : .35;

  const maxSteer = tuning.steering / (1 + Math.abs(longitudinal) * .057);
  car.steer = approach(car.steer, steering * maxSteer, 8.5, dt);
  const healthFactor = alive ? .68 + .32 * clamp((car.health ?? 100) / 100, 0, 1) : 0;
  const speedLimit = longitudinal < -.25 || throttle < 0 && Math.abs(longitudinal) < .25 ? tuning.reverse : tuning.maxSpeed * healthFactor;
  let acceleration = 0;
  if (alive && throttle !== 0 && !serviceBrake) {
    const torque = Math.max(.15, 1 - .7 * Math.pow(Math.abs(longitudinal) / Math.max(1, speedLimit), 1.5));
    acceleration = throttle * tuning.acceleration * torque * healthFactor * (handbrake ? .35 : 1);
    if (throttle < 0) acceleration *= .65;
  }
  const resistance = .38 + .0018 * speed * speed + (throttle === 0 ? .65 : 0)
    + (handbrake ? 5.6 : 0) + (serviceBrake ? tuning.brake * Math.abs(throttle) : 0) + (alive ? 0 : 2.5);
  const dragStep = Math.min(Math.abs(longitudinal), resistance * dt);
  let nextLongitudinal = longitudinal - Math.sign(longitudinal) * dragStep + acceleration * dt;
  // A disabled engine can roll to a stop but can never accelerate or reverse.
  nextLongitudinal = clamp(nextLongitudinal, -tuning.reverse, tuning.maxSpeed * Math.max(.68, healthFactor));
  const driveDelta = nextLongitudinal - longitudinal;
  state.vx += fx * driveDelta;
  state.vz += fz * driveDelta;

  const desiredBicycleYaw = nextLongitudinal * Math.tan(car.steer) / tuning.wheelbase;
  const yawLimit = tuning.grip / Math.max(3.2, Math.abs(nextLongitudinal)) * (handbrake ? 1.75 : 1);
  const desiredYaw = yawLimit * Math.tanh(desiredBicycleYaw / Math.max(.01, yawLimit));
  state.yawRate = approach(state.yawRate, desiredYaw, handbrake ? 4.6 : 7.5, dt);
  if (speed < .1) state.yawRate = 0;
  const nextHeading = car.heading + state.yawRate * dt;
  const rightX = Math.cos(nextHeading), rightZ = -Math.sin(nextHeading);
  const lateral = state.vx * rightX + state.vz * rightZ;
  const grip = tuning.grip * (handbrake ? .29 : 1);
  const lateralDelta = clamp(-lateral * (1 - Math.exp(-(handbrake ? 1.8 : 8.5) * dt)), -grip * dt, grip * dt);
  state.vx += rightX * lateralDelta;
  state.vz += rightZ * lateralDelta;

  if (Math.hypot(state.vx, state.vz) < .06 && (throttle === 0 || !alive)) {
    state.vx = state.vz = state.yawRate = 0;
  }
  advance(car, state, nextHeading, dt, options);
  car.speed = state.vx * Math.sin(car.heading) + state.vz * Math.cos(car.heading);
  longitudinal = state.vx * Math.cos(car.heading) - state.vz * Math.sin(car.heading);
  state.slip = clamp(Math.abs(Math.atan2(longitudinal, Math.max(2, Math.abs(car.speed)))) / .6, 0, 1);
  state.acceleration = approach(state.acceleration, clamp(driveDelta / dt, -25, 14), 9, dt);
  suspension(state, lateralDelta / dt, dt);
  transmission(car, state, throttle, dt);
}

/**
 * Advance a car in metres/seconds. Controls use throttle/steering in [-1, 1];
 * steering is a normalized input, while car.steer is the actual wheel angle.
 * moveBody mutates its position and returns whether world geometry blocked it.
 * onImpact runs once per new contact, with { speed, other, position }.
 * The model may implement setDynamics to apply suspension to its chassis only.
 */
export function updateVehiclePhysics(car, dt, options = {}) {
  if (!car?.model?.mesh?.position) throw new TypeError('A vehicle with model.mesh.position is required.');
  const state = stateFor(car);
  synchronize(car, state);
  state.impact = null;
  const frameTime = Number.isFinite(dt) ? clamp(dt, 0, MAX_FRAME_TIME) : 0;
  state.accumulator += frameTime;
  let steps = 0;
  while (state.accumulator + 1e-10 >= STEP && steps < 60) {
    simulate(car, state, STEP, options);
    state.accumulator = Math.max(0, state.accumulator - STEP);
    steps++;
  }

  const mesh = car.model.mesh;
  if (mesh.rotation) mesh.rotation.y = car.heading;
  const dynamics = {
    roll: state.roll, pitch: state.pitch, heave: state.heave,
    slip: state.slip, speed: car.speed, brake: state.brake, acceleration: state.acceleration,
  };
  if (typeof car.model.setDynamics === 'function') car.model.setDynamics(dynamics);
  else if (mesh.rotation) { mesh.rotation.z = state.roll; mesh.rotation.x = state.pitch; }
  state.lastX = mesh.position.x;
  state.lastZ = mesh.position.z;
  state.lastHeading = car.heading;
  state.lastSpeed = car.speed;
  const throttle = Number(options.throttle) || 0;
  const gear = car.speed < -.35 || throttle < 0 && Math.abs(car.speed) < .35 ? 'R'
    : Math.abs(car.speed) < .35 && throttle === 0 ? 'N' : state.gear;
  return { speed: car.speed, gear, rpm: Math.round(state.rpm), slip: state.slip, impact: state.impact };
}
