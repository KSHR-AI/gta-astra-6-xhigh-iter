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

// A relative morph is applied before skinning. Bound its displacement first,
// then bound the skin matrix's linear operator, including bind transforms.
// Geometry is immutable during play; versioned attributes also support updates.
const morphBoundsCache = new WeakMap();
function morphDisplacement(object, scratch) {
  const geometry = object.geometry, targets = geometry.morphAttributes.position;
  if (!targets?.length) return 0; // Normal/tangent morphs cannot move a vertex.
  if (!Array.isArray(targets)) return null;
  if (!geometry.morphTargetsRelative || object.morphTargetInfluences?.length !== targets.length) return null;
  const position = geometry.attributes.position, indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
  const attributes = [position, indices, weights, ...targets];
  if (attributes.some(attribute => !attribute || !(attribute.isBufferAttribute || attribute.isInterleavedBufferAttribute))) return null;
  const versions = attributes.map(attribute => attribute.version ?? attribute.data?.version ?? 0);
  let cached = morphBoundsCache.get(geometry);
  if (!cached || attributes.some((attribute, i) => cached.attributes[i] !== attribute || cached.versions[i] !== versions[i]) || cached.attributes.length !== attributes.length) {
    const maximums = [];
    let valid = position.itemSize === 3 && indices.itemSize === 4 && weights.itemSize === 4
      && indices.count === position.count && weights.count === position.count;
    let maxIndex = -1;
    const usedBones = new Set();
    for (let i = 0; valid && i < position.count; i++) {
      let sum = 0;
      for (let component = 0; component < 4; component++) {
        const weight = weights.getComponent(i, component), index = indices.getComponent(i, component);
        if (!Number.isFinite(weight) || weight < 0 || !Number.isInteger(index) || index < 0) { valid = false; break; }
        sum += weight; maxIndex = Math.max(maxIndex, index);
        if (weight > 0) usedBones.add(index);
      }
      if (Math.abs(sum - 1) > 1e-5) valid = false;
    }
    for (const target of targets) {
      if (target.itemSize !== 3 || target.count !== position.count) { valid = false; break; }
      let maximum = 0;
      for (let i = 0; i < target.count; i++) {
        const length = Math.hypot(target.getX(i), target.getY(i), target.getZ(i));
        if (!Number.isFinite(length)) { valid = false; break; }
        maximum = Math.max(maximum, length);
      }
      maximums.push(maximum);
    }
    cached = { attributes, versions, maximums, valid, maxIndex, usedBones };
    morphBoundsCache.set(geometry, cached);
  }
  if (!cached.valid || cached.maxIndex >= object.skeleton.bones.length) return null;
  let displacement = 0;
  for (let i = 0; i < targets.length; i++) {
    const weight = object.morphTargetInfluences[i];
    if (!Number.isFinite(weight) || Math.abs(weight) > 1) return null;
    displacement += Math.abs(weight) * cached.maximums[i];
  }
  if (!displacement) return 0;
  let maximumNorm = 0;
  for (const i of cached.usedBones) {
    const bone = object.skeleton.bones[i]; bone.updateWorldMatrix(true, false);
    scratch.copy(object.bindMatrixInverse).multiply(bone.matrixWorld).multiply(object.skeleton.boneInverses[i]).multiply(object.bindMatrix);
    const e = scratch.elements;
    if (!e.every(Number.isFinite) || Math.abs(e[3]) > 1e-10 || Math.abs(e[7]) > 1e-10 || Math.abs(e[11]) > 1e-10 || Math.abs(e[15] - 1) > 1e-10) return null;
    // Frobenius norm upper-bounds the spectral norm even for sheared joints.
    maximumNorm = Math.max(maximumNorm, Math.hypot(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]));
  }
  // Accepted floating-point skin-weight normalization tolerance is included.
  const radius = displacement * maximumNorm * (1 + 1e-5);
  return Number.isFinite(radius) ? radius : null;
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
  const rootToMesh = new THREE.Matrix4(), skinTransform = new THREE.Matrix4();
  const meshes = [];
  model.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  function update() {
    root.updateWorldMatrix(true, false);
    for (const object of meshes) {
      // Detached rigs can intentionally use bones outside the actor transform;
      // unsupported deformations retain their existing always-submit behavior.
      if (object.bindMode !== THREE.AttachedBindMode || !containedSkeleton(object, root)) {
        object.frustumCulled = false;
        continue;
      }
      object.updateWorldMatrix(true, false);
      if (!safeSphereTransform(object.matrixWorld)) { object.frustumCulled = false; continue; }
      rootToMesh.copy(object.matrixWorld).invert().multiply(root.matrixWorld);
      if (!safeSphereTransform(rootToMesh)) { object.frustumCulled = false; continue; }
      const morphRadius = morphDisplacement(object, skinTransform);
      if (morphRadius === null) { object.frustumCulled = false; continue; }
      object.boundingSphere ??= new THREE.Sphere();
      object.boundingSphere.copy(envelope).applyMatrix4(rootToMesh);
      object.boundingSphere.radius += morphRadius;
      object.frustumCulled = true;
    }
  }
  update();
  return { update, getInfo: () => ({ radius: envelope.radius, center: envelope.center.toArray(), meshes: meshes.length, culledMeshes: meshes.filter(mesh => mesh.frustumCulled).length }) };
}
