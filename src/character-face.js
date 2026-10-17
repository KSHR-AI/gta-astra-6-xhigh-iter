import * as THREE from 'three';

const CYCLE = 5.2;
const REFERENCE_FOV = Math.tan(55 * Math.PI / 360);
const clamp = THREE.MathUtils.clamp;
const smooth = value => { const x = clamp(value, 0, 1); return x * x * (3 - 2 * x); };

// Integer hashing gives each actor a reproducible schedule without consuming
// gameplay randomness or retaining an event queue while it is out of view.
function noise(seed, cycle, salt) {
  let value = (seed | 0) ^ Math.imul(cycle | 0, 0x9e3779b1) ^ salt;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function eyelid(time) {
  if (time < 0 || time >= .21) return 0;
  if (time < .055) return smooth(time / .055);
  if (time < .078) return 1;
  return 1 - smooth((time - .078) / .132);
}

/** Stateless, reproducible eyelid sampling also permits exact pose fixtures. */
export function sampleCharacterBlink(time, seed = 1) {
  const clock = Math.max(0, Number.isFinite(time) ? time : 0) + noise(seed, 0, 0x13579bdf) * CYCLE;
  const cycle = Math.floor(clock / CYCLE), phase = clock - cycle * CYCLE;
  const start = .7 + noise(seed, cycle, 0x2468ace) * 1.8;
  const delay = .004 + noise(seed, cycle, 0x71ed270b) * .007;
  const doubleBlink = noise(seed, cycle, 0x4f1bbcdc) < .12;
  const second = start + .32 + noise(seed, cycle, 0x5bd1e995) * .09;
  const at = offset => Math.max(eyelid(phase - start - offset), doubleBlink ? eyelid(phase - second - offset) : 0);
  return { left: at(0), right: at(delay), cycle, phase, doubleBlink };
}

/** Held, seeded fixations with a brief smooth saccade between each hold. */
export function sampleCharacterGaze(time, seed = 1) {
  const duration = 2.8, clock = Math.max(0, Number.isFinite(time) ? time : 0) + noise(seed, 0, 0x3471fa21) * duration;
  const cycle = Math.floor(clock / duration), phase = clock - cycle * duration;
  const fixation = index => ({ yaw: (noise(seed, index, 0x78251) - .5) * THREE.MathUtils.degToRad(5.6),
    pitch: (noise(seed, index, 0x183719) - .5) * THREE.MathUtils.degToRad(2.6) });
  const previous = fixation(cycle - 1), next = fixation(cycle), blend = smooth(phase / .075);
  return { yaw: THREE.MathUtils.lerp(previous.yaw, next.yaw, blend), pitch: THREE.MathUtils.lerp(previous.pitch, next.pitch, blend), cycle, phase };
}

function eyeBindings(model) {
  const eyes = [];
  model.traverse(bone => {
    const data = bone.userData?.astraEye;
    if (!bone.isBone || data?.version !== 1 || !['left', 'right'].includes(data.side)) return;
    const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? new THREE.Vector3().fromArray(value) : null;
    const forward = vector(data.neutralAxis), up = vector(data.upAxis);
    if (!forward || !up || forward.lengthSq() < 1e-10 || up.lengthSq() < 1e-10 ||
        !Number.isFinite(data.maxYawDegrees) || data.maxYawDegrees <= 0 || data.maxYawDegrees > 8 ||
        !Number.isFinite(data.maxPitchDegrees) || data.maxPitchDegrees <= 0 || data.maxPitchDegrees > 5) return;
    forward.normalize(); up.addScaledVector(forward, -up.dot(forward));
    if (up.lengthSq() < 1e-10 || !bone.parent || !bone.quaternion.toArray().every(Number.isFinite) || Math.abs(bone.quaternion.lengthSq() - 1) > 1e-6) return;
    up.normalize();
    const rest = bone.quaternion.clone();
    eyes.push({ bone, side: data.side, forward, up, right: new THREE.Vector3().crossVectors(up, forward).normalize(),
      rest, inverseRest: rest.clone().invert(), applied: rest.clone(), yaw: 0, pitch: 0,
      maxYaw: THREE.MathUtils.degToRad(data.maxYawDegrees), maxPitch: THREE.MathUtils.degToRad(data.maxPitchDegrees) });
  });
  return eyes.length === 2 && new Set(eyes.map(eye => eye.side)).size === 2 ? eyes : [];
}

/** Authored lids and explicitly tagged eye joints only; legacy rigs are safe. */
export function createCharacterFace(model, root, { seed = 1, initialTime = 0, maxDistance = 22 } = {}) {
  const bindings = [], eyes = eyeBindings(model);
  model.traverse(object => {
    const dictionary = object.morphTargetDictionary, influences = object.morphTargetInfluences;
    if (!object.isMesh || !dictionary || !influences) return;
    const index = name => Number.isInteger(dictionary[name]) && dictionary[name] >= 0 && dictionary[name] < influences.length ? dictionary[name] : -1;
    const left = index('blinkLeft'), right = index('blinkRight');
    if (left !== -1 || right !== -1) bindings.push({ influences, left, right });
  });
  const position = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  let time = Math.max(0, Number.isFinite(initialTime) ? initialTime : 0), deadWeight = 0;
  let active = false, lodLevel = 0, left = 0, right = 0, samples = 0, writes = 0;
  let appliedTime = NaN, appliedDeadWeight = NaN;
  let gazeTime = NaN, gazeSamples = 0, gazeWrites = 0, gazeMode = 'idle';
  let target = null, intent = 'idle';
  let shotTarget = null, shotGazeUntil = -Infinity, idleReturnStart = -Infinity;
  const hasLeftLid = bindings.some(binding => binding.left !== -1), hasRightLid = bindings.some(binding => binding.right !== -1);
  const renderedEye = new THREE.Quaternion();
  const direction = new THREE.Vector3(), desired = new THREE.Vector3(), rotation = new THREE.Quaternion(), inverseParent = new THREE.Matrix4();
  function applyEyes(neutral = false) {
    for (const eye of eyes) {
      const blink = eye.side === 'left' ? (hasLeftLid ? left : 0) : (hasRightLid ? right : 0);
      const factor = neutral ? 0 : 1 - smooth((blink - .55) / .4);
      // Keep the sampled gaze untouched while the closing lid covers an eye.
      // Full closure uses the audited authored neutral socket configuration.
      const quaternion = factor === 0 ? eye.rest : factor === 1 ? eye.applied : renderedEye.copy(eye.rest).slerp(eye.applied, factor);
      if (!eye.bone.quaternion.equals(quaternion)) { eye.bone.quaternion.copy(quaternion); gazeWrites++; }
      eye.bone.updateWorldMatrix(true, true);
    }
  }
  function sampleEyes() {
    if (!eyes.length) return;
    if (gazeTime === time) { applyEyes(); return; }
    const dt = Number.isFinite(gazeTime) ? Math.max(0, time - gazeTime) : time;
    const idle = sampleCharacterGaze(time, seed);
    const nextMode = target ? intent : 'idle';
    if (gazeMode !== 'idle' && nextMode === 'idle') {
      idleReturnStart = time;
      for (const eye of eyes) { eye.returnYaw = eye.yaw; eye.returnPitch = eye.pitch; }
    }
    gazeMode = nextMode;
    for (const eye of eyes) {
      let yaw = idle.yaw, pitch = idle.pitch;
      if (target) {
        eye.bone.parent.updateWorldMatrix(true, false);
        inverseParent.copy(eye.bone.parent.matrixWorld).invert();
        direction.copy(target).applyMatrix4(inverseParent).sub(eye.bone.position).applyQuaternion(eye.inverseRest);
        if (direction.lengthSq() > 1e-12) {
          direction.normalize();
          yaw = Math.atan2(direction.dot(eye.right), direction.dot(eye.forward));
          pitch = Math.atan2(direction.dot(eye.up), Math.hypot(direction.dot(eye.right), direction.dot(eye.forward)));
        } else { yaw = 0; pitch = 0; }
        const ellipse = Math.max(1, Math.hypot(yaw / eye.maxYaw, pitch / eye.maxPitch));
        yaw /= ellipse; pitch /= ellipse;
        const blend = 1 - Math.exp(-35 * dt);
        yaw = THREE.MathUtils.lerp(eye.yaw, yaw, blend); pitch = THREE.MathUtils.lerp(eye.pitch, pitch, blend);
      } else if (time < idleReturnStart + .12) {
        const blend = smooth((time - idleReturnStart) / .12);
        yaw = THREE.MathUtils.lerp(eye.returnYaw, yaw, blend);
        pitch = THREE.MathUtils.lerp(eye.returnPitch, pitch, blend);
      }
      const bound = Math.max(1, Math.hypot(yaw / eye.maxYaw, pitch / eye.maxPitch));
      yaw /= bound; pitch /= bound;
      const alive = 1 - deadWeight;
      eye.yaw = yaw * alive; eye.pitch = pitch * alive;
      // Local axes are authored iris axes, not an invented generic forward.
      desired.copy(eye.forward).multiplyScalar(Math.cos(eye.pitch) * Math.cos(eye.yaw))
        .addScaledVector(eye.right, Math.cos(eye.pitch) * Math.sin(eye.yaw)).addScaledVector(eye.up, Math.sin(eye.pitch)).normalize();
      rotation.setFromUnitVectors(eye.forward, desired);
      eye.applied.copy(eye.rest).multiply(rotation);
    }
    gazeTime = time; gazeSamples++; applyEyes();
  }
  function visible() {
    for (let ancestor = root; ancestor; ancestor = ancestor.parent) if (!ancestor.visible) return false;
    return true;
  }
  function apply(nextLeft, nextRight) {
    left = nextLeft; right = nextRight;
    for (const binding of bindings) {
      if (binding.left !== -1 && binding.influences[binding.left] !== left) { binding.influences[binding.left] = left; writes++; }
      if (binding.right !== -1 && binding.influences[binding.right] !== right) { binding.influences[binding.right] = right; writes++; }
    }
  }
  return {
    getEyePosition(target) {
      if (eyes.length !== 2) return null;
      target.set(0, 0, 0);
      for (const eye of eyes) {
        eye.bone.updateWorldMatrix(true, false);
        target.add(position.setFromMatrixPosition(eye.bone.matrixWorld));
      }
      return target.multiplyScalar(.5);
    },
    advance(dt, { dead = false, aiming = false, shooting = false, aimTarget, lookTarget } = {}) {
      if (!bindings.length && !eyes.length) return;
      const step = clamp(Number.isFinite(dt) ? dt : 0, 0, .25);
      if (step > 0) {
        const valid = candidate => candidate && [candidate.x, candidate.y, candidate.z].every(Number.isFinite);
        if (shooting && valid(aimTarget)) { shotTarget = new THREE.Vector3(aimTarget.x, aimTarget.y, aimTarget.z); shotGazeUntil = time + step + .18; }
        const shotHeld = shotTarget && time + step < shotGazeUntil;
        const candidate = aiming || shooting ? aimTarget : shotHeld ? shotTarget : lookTarget;
        target = candidate && [candidate.x, candidate.y, candidate.z].every(Number.isFinite) ? new THREE.Vector3(candidate.x, candidate.y, candidate.z) : null;
        intent = aiming || shooting || shotHeld ? 'aim' : 'look';
      }
      time += step;
      deadWeight = THREE.MathUtils.damp(deadWeight, dead ? 1 : 0, dead ? 6 : 9, step);
    },
    update(camera, level = 0) {
      if (!bindings.length && !eyes.length) return false;
      lodLevel = level;
      // Far topology may simplify the neutral eyelids. Never reintroduce a
      // blink after the LOD controller has selected that geometry, even when
      // distance thresholds or photo-camera settings change independently.
      active = lodLevel < 2 && visible();
      if (active && camera?.isCamera) {
        root.getWorldPosition(position); camera.getWorldPosition(cameraPosition);
        // A zoomed photo camera deserves the same eye detail as moving closer.
        const fovScale = camera.isPerspectiveCamera ? Math.tan(clamp(camera.fov, 1, 120) * Math.PI / 360) / REFERENCE_FOV : 1;
        active = position.distanceToSquared(cameraPosition) * fovScale * fovScale <= maxDistance * maxDistance;
      }
      if (!active) { if (left || right) apply(0, 0); applyEyes(true); appliedTime = NaN; return false; }
      if (appliedTime !== time || appliedDeadWeight !== deadWeight) {
        const blink = sampleCharacterBlink(time, seed); samples++;
        apply(THREE.MathUtils.lerp(blink.left, .94, deadWeight), THREE.MathUtils.lerp(blink.right, .94, deadWeight));
        appliedTime = time; appliedDeadWeight = deadWeight;
      }
      sampleEyes();
      return true;
    },
    getInfo() {
      const sample = sampleCharacterBlink(time, seed);
      return { supported: bindings.length > 0 || eyes.length > 0, meshes: bindings.length, seed, time, active, lodLevel,
        blinkLeft: left, blinkRight: right, cycle: sample.cycle, phase: sample.phase,
        doubleBlink: sample.doubleBlink, deadWeight, samples, writes,
        gazeSupported: eyes.length === 2, gazeMode, gazeSamples, gazeWrites,
        eyes: eyes.map(eye => ({ side: eye.side, yaw: active ? eye.yaw : 0, pitch: active ? eye.pitch : 0,
          maxYaw: eye.maxYaw, maxPitch: eye.maxPitch,
          presentedAngle: eye.rest.angleTo(eye.bone.quaternion) })) };
    },
  };
}
