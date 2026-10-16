import * as THREE from 'three';

// Sphere.applyMatrix4 uses the largest basis-column length. That is a safe
// radius multiplier for orthogonal scale/rotation, but not a sheared basis.
function safeSphereTransform(matrix) {
  const e = matrix.elements;
  if (!e.every(Number.isFinite) || Math.abs(e[3]) > 1e-10 || Math.abs(e[7]) > 1e-10 || Math.abs(e[11]) > 1e-10 || Math.abs(e[15] - 1) > 1e-10) return false;
  const lengths = [Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10])];
  if (lengths.some(length => !Number.isFinite(length) || length < 1e-10)) return false;
  for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) {
    const offsetA = a * 4, offsetB = b * 4;
    const dot = e[offsetA] * e[offsetB] + e[offsetA + 1] * e[offsetB + 1] + e[offsetA + 2] * e[offsetB + 2];
    if (Math.abs(dot / lengths[a] / lengths[b]) > 1e-6) return false;
  }
  return true;
}

function containedSkeleton(object, root) {
  const skeleton = object.skeleton;
  if (!(skeleton instanceof THREE.Skeleton) || !Array.isArray(skeleton.bones) || !skeleton.bones.length || skeleton.boneInverses?.length !== skeleton.bones.length) return false;
  if (skeleton.boneInverses.some(matrix => !matrix?.isMatrix4 || !matrix.elements.every(Number.isFinite))) return false;
  // Checking all joints (including unused end bones) is deliberately stricter
  // than checking only positive-weight influences and also handles LOD swaps.
  for (const bone of skeleton.bones) {
    if (!bone?.isBone) return false;
    let ancestor = bone;
    while (ancestor && ancestor !== root) ancestor = ancestor.parent;
    if (ancestor !== root) return false;
  }
  return true;
}

/**
 * Stable actor envelopes for native, per-camera skinned-mesh frustum tests.
 * The standing-height envelope includes a complete body laid horizontally,
 * a lowered seated pelvis, extended arms and the airborne/recoil pose layers.
 * A 25 cm allowance protects silhouette edges and authored clothing variation.
 * It deliberately trades tight culling for no silhouette/shadow clipping.
 */
export function createCharacterBounds(model, root, { height }) {
  const envelope = new THREE.Sphere(new THREE.Vector3(0, height * .35, 0), height * 1.5 + .25);
  const rootToMesh = new THREE.Matrix4();
  const meshes = [];
  model.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  function update() {
    root.updateWorldMatrix(true, false);
    for (const object of meshes) {
      // Detached rigs can intentionally use bones outside the actor transform;
      // morph targets can exceed any skeleton-derived envelope. Keep their
      // existing always-submit behavior until those deformations are bounded.
      if (object.bindMode !== THREE.AttachedBindMode || object.geometry.morphAttributes.position?.length || !containedSkeleton(object, root)) {
        object.frustumCulled = false;
        continue;
      }
      object.updateWorldMatrix(true, false);
      if (!safeSphereTransform(object.matrixWorld)) { object.frustumCulled = false; continue; }
      rootToMesh.copy(object.matrixWorld).invert().multiply(root.matrixWorld);
      if (!safeSphereTransform(rootToMesh)) { object.frustumCulled = false; continue; }
      object.boundingSphere ??= new THREE.Sphere();
      object.boundingSphere.copy(envelope).applyMatrix4(rootToMesh);
      object.frustumCulled = true;
    }
  }
  update();
  return { update, getInfo: () => ({ radius: envelope.radius, center: envelope.center.toArray(), meshes: meshes.length, culledMeshes: meshes.filter(mesh => mesh.frustumCulled).length }) };
}
