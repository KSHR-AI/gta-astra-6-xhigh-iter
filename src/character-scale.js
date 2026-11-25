import * as THREE from 'three';

/**
 * Measure the authored neutral stature before any clip, procedural pose, LOD,
 * or accessory is applied. A crouched setup clip must not define body scale.
 * Measurements use the model parent's axes, independent of world placement.
 */
export function measureCharacterScale(model, height) {
  if (!Number.isFinite(height) || height <= 0) throw new RangeError('Character height must be finite and positive');
  model.updateWorldMatrix(true, false);
  // SkinnedMesh.updateMatrixWorld refreshes inverse bind transforms too.
  model.updateMatrixWorld(true);
  const referenceInverse = model.parent
    ? model.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const point = new THREE.Vector3();
  let minimum = Infinity, maximum = -Infinity, vertices = 0, invalid = false;
  model.traverse(object => {
    const geometry = object.geometry;
    if (!object.isMesh || !geometry?.attributes.position) return;
    const position = geometry.attributes.position, index = geometry.index;
    const count = index ? index.count : position.count;
    const start = Math.max(0, geometry.drawRange.start);
    const end = Math.min(count, start + geometry.drawRange.count);
    const referenced = new Set();
    for (let entry = start; entry < end; entry++) referenced.add(index ? index.getX(entry) : entry);
    for (const vertex of referenced) {
      // Raw POSITION is not world-space rest geometry on every imported rig.
      // Skinning retains the authored inverse-bind transforms (notably female).
      object.getVertexPosition(vertex, point);
      point.applyMatrix4(object.matrixWorld).applyMatrix4(referenceInverse);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) { invalid = true; continue; }
      minimum = Math.min(minimum, point.y); maximum = Math.max(maximum, point.y); vertices++;
    }
  });
  const referenceHeight = maximum - minimum;
  if (invalid || !vertices || !Number.isFinite(referenceHeight) || referenceHeight <= 1e-6) return null;
  return { scale: height / referenceHeight, offsetY: -minimum, referenceHeight, minimum, maximum, vertices };
}
