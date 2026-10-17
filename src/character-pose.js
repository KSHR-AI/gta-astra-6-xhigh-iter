import * as THREE from 'three';

/**
 * Pose helpers for an actor whose gameplay root may be translated or rotated.
 * Directions, targets, and pole points use that root's coordinates; the solver
 * measures the actual skeleton in world space, including imported model scale.
 */
export function createPoseTools(root, bones) {
  // Every character owns its scratch state. Never share it between skeletons.
  const bonePosition = new THREE.Vector3();
  const childPosition = new THREE.Vector3();
  const currentDirection = new THREE.Vector3();
  const desiredDirection = new THREE.Vector3();
  const deltaRotation = new THREE.Quaternion();
  const worldRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const localRotation = new THREE.Quaternion();
  const start = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const end = new THREE.Vector3();
  const target = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const bend = new THREE.Vector3();
  const wantedMiddle = new THREE.Vector3();
  const wantedEnd = new THREE.Vector3();
  const upperDirection = new THREE.Vector3();
  const lowerDirection = new THREE.Vector3();
  const fallbackAxis = new THREE.Vector3();

  function copyVector(out, value) {
    return Array.isArray(value) ? out.fromArray(value) : out.copy(value);
  }

  function pointWorld(bone, child, direction, weight) {
    if (!bone || !child || !bone.parent || weight <= 0 || direction.lengthSq() < 1e-12) return false;
    // The getters refresh only the ancestor chains we need. Updating every
    // descendant here repeats the whole hand/finger rig for each IK joint.
    bone.getWorldPosition(bonePosition);
    child.getWorldPosition(childPosition);
    currentDirection.subVectors(childPosition, bonePosition);
    if (currentDirection.lengthSq() < 1e-12) return false;
    currentDirection.normalize();
    desiredDirection.copy(direction).normalize();
    // The shortest rotation changes the direction while retaining animation roll.
    deltaRotation.setFromUnitVectors(currentDirection, desiredDirection);
    bone.getWorldQuaternion(worldRotation).premultiply(deltaRotation);
    bone.parent.getWorldQuaternion(parentRotation).invert();
    localRotation.copy(parentRotation).multiply(worldRotation);
    bone.quaternion.slerp(localRotation.normalize(), THREE.MathUtils.clamp(weight, 0, 1)).normalize();
    return true;
  }

  function point(name, childName, localDirection, weight = 1) {
    root.updateWorldMatrix(true, false);
    copyVector(upperDirection, localDirection).transformDirection(root.matrixWorld);
    return pointWorld(bones[name], bones[childName], upperDirection, weight);
  }

  /**
   * Analytic two-bone IK. poleLocal is a POINT toward which the joint bends,
   * in the same actor-local coordinate system as targetLocal.
   */
  function reach(upperName, middleName, endName, targetLocal, poleLocal, weight = 1) {
    const upperBone = bones[upperName];
    const middleBone = bones[middleName];
    const endBone = bones[endName];
    if (!upperBone || !middleBone || !endBone || weight <= 0) return false;
    root.updateWorldMatrix(true, false);
    upperBone.getWorldPosition(start);
    middleBone.getWorldPosition(middle);
    endBone.getWorldPosition(end);
    const upperLength = start.distanceTo(middle);
    const lowerLength = middle.distanceTo(end);
    if (upperLength < 1e-6 || lowerLength < 1e-6) return false;

    root.localToWorld(copyVector(target, targetLocal));
    root.localToWorld(copyVector(pole, poleLocal));
    forward.subVectors(target, start);
    let distance = forward.length();
    if (distance < 1e-8) {
      // A target exactly at the shoulder/hip still needs a stable fold axis.
      forward.subVectors(end, start);
      if (forward.lengthSq() < 1e-12) forward.subVectors(middle, start);
      forward.normalize();
    } else {
      forward.multiplyScalar(1 / distance);
    }
    const epsilon = Math.min(upperLength, lowerLength) * 1e-5;
    distance = THREE.MathUtils.clamp(distance, Math.abs(upperLength - lowerLength) + epsilon, upperLength + lowerLength - epsilon);
    wantedEnd.copy(start).addScaledVector(forward, distance);

    bend.subVectors(pole, start);
    bend.addScaledVector(forward, -bend.dot(forward));
    if (bend.lengthSq() < 1e-10) {
      // Preserve the current bend when the pole lies on the target axis.
      bend.subVectors(middle, start);
      bend.addScaledVector(forward, -bend.dot(forward));
    }
    if (bend.lengthSq() < 1e-10) {
      fallbackAxis.set(Math.abs(forward.x) < 0.8 ? 1 : 0, Math.abs(forward.x) < 0.8 ? 0 : 1, 0);
      bend.copy(fallbackAxis).addScaledVector(forward, -fallbackAxis.dot(forward));
    }
    bend.normalize();
    const along = (upperLength * upperLength + distance * distance - lowerLength * lowerLength) / (2 * distance);
    const perpendicular = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    wantedMiddle.copy(start).addScaledVector(forward, along).addScaledVector(bend, perpendicular);

    upperDirection.subVectors(wantedMiddle, start);
    pointWorld(upperBone, middleBone, upperDirection, weight);
    middleBone.getWorldPosition(middle);
    lowerDirection.subVectors(wantedEnd, middle);
    pointWorld(middleBone, endBone, lowerDirection, weight);
    return true;
  }

  function position(name, out = new THREE.Vector3()) {
    const bone = bones[name];
    if (!bone) return out.set(0, 0, 0);
    root.updateWorldMatrix(true, false);
    bone.getWorldPosition(out);
    return root.worldToLocal(out);
  }

  return { point, reach, position };
}
