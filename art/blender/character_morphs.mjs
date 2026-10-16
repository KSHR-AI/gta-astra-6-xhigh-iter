import * as THREE from 'three';

/** Both inputs must already occupy the destination mesh's bind space. */
export function matchNeckBoundaryNormal(authored, boundary, blend) {
  return authored.clone().normalize().lerp(boundary.clone().normalize(), blend).normalize();
}

/** Only our zero-rest paired blink contract may be suppressed at far LOD. */
export function suppressibleBlinkTargets(names, targetCount, defaults = []) {
  if (targetCount !== 2 || !Array.isArray(names) || names.length !== 2 || new Set(names).size !== 2 || !names.includes('blinkLeft') || !names.includes('blinkRight')) return [];
  if (defaults.some(weights => weights !== undefined && (!Array.isArray(weights) || weights.length !== 2 || weights.some(weight => weight !== 0)))) return [];
  return ['blinkLeft', 'blinkRight'];
}

/** Transform relative deltas without translation. Normal deltas use the same
 * base-normal divisor so partial and combined morph weights remain linear. */
export function transformMorphDeltas(positionDeltas, normalDeltas, baseNormals, transform) {
  const linear = new THREE.Matrix3().setFromMatrix4(transform);
  const normal = new THREE.Matrix3().getNormalMatrix(transform);
  const vector = new THREE.Vector3(), base = new THREE.Vector3();
  const output = {};
  if (positionDeltas) {
    output.POSITION = new Float32Array(positionDeltas.length);
    for (let i = 0; i < positionDeltas.length; i += 3) vector.fromArray(positionDeltas, i).applyMatrix3(linear).toArray(output.POSITION, i);
  }
  if (normalDeltas) {
    if (!baseNormals || baseNormals.length !== normalDeltas.length) throw new Error('Morph normals require matching base normals');
    output.NORMAL = new Float32Array(normalDeltas.length);
    for (let i = 0; i < normalDeltas.length; i += 3) {
      const divisor = base.fromArray(baseNormals, i).applyMatrix3(normal).length();
      if (divisor < 1e-12) throw new Error('Degenerate transformed base normal');
      vector.fromArray(normalDeltas, i).applyMatrix3(normal).divideScalar(divisor).toArray(output.NORMAL, i);
    }
  }
  return output;
}

/** Morph-active vertices are locked during geometric simplification, and exact
 * welding includes every target's deltas, protecting eyelid/lash boundaries. */
export function prepareMorphVertices(targets, count) {
  const arrays = targets.flatMap(target => Object.entries(target).sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => {
    if (!['POSITION', 'NORMAL'].includes(name) || values.length !== count * 3 || !values.every(Number.isFinite)) throw new Error('Invalid morph simplification attributes');
    return values;
  }));
  const locked = new Uint8Array(count), signatures = new Array(count);
  for (let i = 0; i < count; i++) {
    signatures[i] = arrays.map(values => Array.from(values.subarray(i * 3, i * 3 + 3)).join(',')).join('|');
    if (arrays.some(values => values.subarray(i * 3, i * 3 + 3).some(value => value !== 0))) locked[i] = 1;
  }
  return { locked, signatures };
}
