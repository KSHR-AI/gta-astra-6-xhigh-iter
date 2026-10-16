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

/**
 * Only authored eyelid morphs are animated. Time advances with simulation,
 * while visible morph weights are sampled once at final presentation. No eye,
 * head or neck transforms are changed, and legacy rigs remain a cheap no-op.
 */
export function createCharacterFace(model, root, { seed = 1, initialTime = 0, maxDistance = 22 } = {}) {
  const bindings = [];
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
    advance(dt, { dead = false } = {}) {
      if (!bindings.length) return;
      const step = clamp(Number.isFinite(dt) ? dt : 0, 0, .25);
      time += step;
      deadWeight = THREE.MathUtils.damp(deadWeight, dead ? 1 : 0, dead ? 6 : 9, step);
    },
    update(camera, level = 0) {
      if (!bindings.length) return false;
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
      if (!active) { if (left || right) apply(0, 0); appliedTime = NaN; return false; }
      if (appliedTime === time && appliedDeadWeight === deadWeight) return true;
      const blink = sampleCharacterBlink(time, seed); samples++;
      apply(THREE.MathUtils.lerp(blink.left, .94, deadWeight), THREE.MathUtils.lerp(blink.right, .94, deadWeight));
      appliedTime = time; appliedDeadWeight = deadWeight;
      return true;
    },
    getInfo() {
      const sample = sampleCharacterBlink(time, seed);
      return { supported: bindings.length > 0, meshes: bindings.length, seed, time, active, lodLevel,
        blinkLeft: left, blinkRight: right, cycle: sample.cycle, phase: sample.phase,
        doubleBlink: sample.doubleBlink, deadWeight, samples, writes };
    },
  };
}
