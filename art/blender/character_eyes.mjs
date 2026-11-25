import * as THREE from 'three';

const vector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) throw new Error(`Invalid eye ${name}`);
  return new THREE.Vector3().fromArray(value);
};

/** The eye surface is an affine part of the head fit. Iris axes are plane
 * normals, hence inverse-transpose, while up is an ordinary direction. */
export function fitEyeMetadata(eyes, sourceWorld, fit) {
  if (!Array.isArray(eyes) || eyes.length !== 2) throw new Error('Eye metadata must contain exactly two eyes');
  return eyes.map(eye => {
    const native = vector(eye.pivot, 'pivot').applyMatrix4(sourceWorld);
    const linear = fit.linear(native, false).multiply(sourceWorld);
    const axis = vector(eye.neutralAxis, 'neutralAxis').applyMatrix3(new THREE.Matrix3().getNormalMatrix(linear)).normalize();
    const up = vector(eye.upAxis, 'upAxis').transformDirection(linear);
    return { ...eye, pivot: fit.position(native, false).toArray(), neutralAxis: axis.toArray(), upAxis: up.toArray() };
  });
}

/** Append two translation-only children without replacing any original joint.
 * If E is the child bind transform, IBM_eye = inverse(E) * IBM_head gives
 * HeadWorld * E * IBM_eye === HeadWorld * IBM_head at zero gaze in every pose.
 * `body` is the graft GLB writer; eyes are in the existing body bind world. */
export function appendEyeRig(body, { skin, headJoint, headWorldMatrix, eyes }) {
  if (!Array.isArray(eyes) || eyes.length !== 2 || new Set(eyes.map(e => e.label)).size !== 2
    || eyes.some(e => e.version !== 1 || ![1, 2].includes(e.label) || e.side !== (e.label === 1 ? 'left' : 'right'))) throw new Error('Invalid eye side metadata');
  const json = body.json, headNodeIndex = skin.joints[headJoint], head = json.nodes[headNodeIndex];
  if (!head || !Number.isInteger(headJoint)) throw new Error('Eye rig requires an existing Head joint');
  if (json.nodes.some(node => /^AstraEye(?:Left|Right)$/.test(node.name ?? ''))) throw new Error('Eye rig is already present');
  if (!headWorldMatrix.elements.every(Number.isFinite) || Math.abs(headWorldMatrix.determinant()) < 1e-12) throw new Error('Invalid eye parent bind matrix');
  const inverse = body.read(skin.inverseBindMatrices).values;
  if (inverse.length !== skin.joints.length * 16 || !inverse.every(Number.isFinite)) throw new Error('Invalid original skin inverse binds');
  const inverseHead = headWorldMatrix.clone().invert(), headIBM = new THREE.Matrix4().fromArray(inverse, headJoint * 16);
  const matrices = Array.from(inverse), jointsByLabel = {}, proof = [];
  // Validate every entry before mutating the source rig.
  const entries = eyes.map(eye => {
    const pivot = vector(eye.pivot, 'pivot').applyMatrix4(inverseHead);
    const axis = vector(eye.neutralAxis, 'neutralAxis').transformDirection(inverseHead);
    const up = vector(eye.upAxis, 'upAxis').transformDirection(inverseHead);
    if (axis.lengthSq() < .9 || up.lengthSq() < .9 || Math.abs(axis.dot(up)) > .95
      || !(eye.maxYawDegrees > 0 && eye.maxYawDegrees <= 10) || !(eye.maxPitchDegrees > 0 && eye.maxPitchDegrees <= 8)) throw new Error('Invalid eye axes or limits');
    const local = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
    const ibm = local.clone().invert().multiply(headIBM);
    const original = headWorldMatrix.clone().multiply(headIBM);
    const result = headWorldMatrix.clone().multiply(local).multiply(ibm);
    const neutralMatrixError = Math.max(...result.elements.map((value, i) => Math.abs(value-original.elements[i])));
    return { eye, pivot, axis, up, ibm, neutralMatrixError };
  });
  for (const { eye, pivot, axis, up, ibm, neutralMatrixError } of entries) {
    const nodeIndex = json.nodes.length, joint = skin.joints.length;
    json.nodes.push({ name: `AstraEye${eye.side === 'left' ? 'Left' : 'Right'}`, translation: pivot.toArray(),
      extras: { astraEye: { version: 1, side: eye.side, neutralAxis: axis.toArray(), upAxis: up.toArray(),
        maxYawDegrees: eye.maxYawDegrees, maxPitchDegrees: eye.maxPitchDegrees } } });
    (head.children ??= []).push(nodeIndex); skin.joints.push(nodeIndex); jointsByLabel[eye.label] = joint;
    matrices.push(...ibm.toArray()); proof.push({ side: eye.side, joint, node: nodeIndex, neutralMatrixError });
  }
  skin.inverseBindMatrices = body.attribute(matrices, 'MAT4');
  return { jointsByLabel, proof };
}
