import * as THREE from 'three';

const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
const DEG = Math.PI / 180;
const GRIP_CENTER = new THREE.Vector3(0, -0.046, -0.012);
const clamp = THREE.MathUtils.clamp;

/**
 * Pose wrists and fingers after arm IK. Geometry supplies each rig's palm frame
 * and flexion axes, including its existing bind-pose curl; no Euler-axis or
 * imported-unit assumptions are needed. The caller owns weapon orientation.
 */
export function createHandPoseController({ mesh, bones, restPose = {} }) {
  const hands = [];
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const q3 = new THREE.Quaternion();
  const matrix = new THREE.Matrix4();
  const weaponWorldQ = new THREE.Quaternion();
  const rootWorldQ = new THREE.Quaternion();
  const forward = new THREE.Vector3();
  const across = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const worldAnchor = new THREE.Vector3();
  const worldOffset = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const targetQ = new THREE.Quaternion();
  const gripRotation = new THREE.Quaternion();
  const relaxedRotation = new THREE.Quaternion();
  const steeringRotation = new THREE.Quaternion();
  let activeWeapon = null;
  let initialized = false;

  // Inspect the bind geometry briefly, then restore every animated transform.
  const saved = [];
  for (const [name, bone] of Object.entries(bones)) {
    if (!/Hand(?:Thumb|Index|Middle|Ring|Pinky)\d+$/.test(name)) continue;
    saved.push([bone, bone.quaternion.clone()]);
    if (restPose[name]) bone.quaternion.copy(restPose[name]);
  }
  mesh.updateWorldMatrix(true, true);

  for (const side of ['Right', 'Left']) {
    const bone = bones[`${side}Hand`];
    const middle = bones[`${side}HandMiddle1`];
    const index = bones[`${side}HandIndex1`];
    const pinky = bones[`${side}HandPinky1`];
    const thumb = bones[`${side}HandThumb1`];
    if (!bone || !middle || !index || !pinky || !thumb) continue;
    const inHand = (joint) => bone.worldToLocal(joint.getWorldPosition(new THREE.Vector3()));
    const palmForward = inHand(middle).normalize();
    const palmAcross = inHand(index).sub(inHand(pinky));
    palmAcross.addScaledVector(palmForward, -palmAcross.dot(palmForward)).normalize();
    const palmNormal = new THREE.Vector3().crossVectors(palmForward, palmAcross).normalize();
    if (palmNormal.dot(inHand(thumb)) < 0) palmNormal.negate();
    const basisNormal = new THREE.Vector3().crossVectors(palmAcross, palmForward).normalize();
    const inverseBasis = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(palmAcross, palmForward, basisNormal),
    ).invert();
    const palmCenter = inHand(middle).multiplyScalar(0.78);
    const palmWidth = inHand(index).distanceTo(inHand(pinky));
    const hand = {
      side, bone, palmForward, palmAcross, palmNormal, inverseBasis, palmCenter, palmWidth,
      digits: [], thumbs: [], wristWeight: 0, desiredWorldQ: bone.getWorldQuaternion(new THREE.Quaternion()),
      mode: 'relaxed',
    };

    for (const finger of [...FINGERS, 'Thumb']) {
      let previousDirection = palmForward;
      for (let joint = 1; joint <= 3; joint++) {
        const name = `${side}Hand${finger}${joint}`;
        const digit = bones[name];
        const next = bones[`${side}Hand${finger}${joint + 1}`];
        if (!digit) continue;
        const digitPosition = inHand(digit);
        let tipLocal;
        let digitDirection;
        let segmentLength;
        if (next) {
          tipLocal = next.position.clone();
          digitDirection = inHand(next).sub(digitPosition);
          segmentLength = digitDirection.length();
          digitDirection.normalize();
        } else {
          // Unweighted fingertip nodes are absent in some exported rigs. Infer
          // the distal axis from its preceding segment's geometric direction.
          const parent = digit.parent;
          parent.getWorldQuaternion(q1).invert();
          bone.getWorldQuaternion(q2);
          tipLocal = previousDirection.clone().applyQuaternion(q2).applyQuaternion(q1);
          tipLocal.multiplyScalar(digit.position.length() * 0.65);
          segmentLength = tipLocal.length();
          digit.getWorldQuaternion(q1);
          bone.getWorldQuaternion(q2).invert();
          digitDirection = tipLocal.clone().normalize().applyQuaternion(q1).applyQuaternion(q2);
        }
        const flexAxisHand = new THREE.Vector3().crossVectors(digitDirection, palmNormal).normalize();
        bone.getWorldQuaternion(q1);
        digit.getWorldQuaternion(q2).invert();
        const flexAxisLocal = flexAxisHand.clone().applyQuaternion(q1).applyQuaternion(q2).normalize();
        const bindFlex = joint === 1
          ? Math.atan2(digitDirection.dot(palmNormal), digitDirection.dot(palmForward))
          : Math.atan2(new THREE.Vector3().crossVectors(previousDirection, digitDirection).dot(flexAxisHand), previousDirection.dot(digitDirection));
        const entry = {
          bone: digit, finger, joint, tipLocal, bindFlex, flexAxisLocal,
          restQ: (restPose[name] ?? digit.quaternion).clone(), angle: bindFlex,
          thumbDirection: digitDirection.clone(),
          thumbBaseNormal: digitPosition.dot(palmNormal), segmentLength,
          parentChain: [],
        };
        for (let parent = digit.parent; parent && parent !== bone; parent = parent.parent) entry.parentChain.unshift(parent);
        (finger === 'Thumb' ? hand.thumbs : hand.digits).push(entry);
        previousDirection = digitDirection;
      }
    }
    hands.push(hand);
  }
  for (const [bone, quaternion] of saved) bone.quaternion.copy(quaternion);
  mesh.updateWorldMatrix(true, true);

  function desiredFrame(hand, worldReference, forwardLocal, acrossLocal, out) {
    forward.copy(forwardLocal).normalize();
    across.copy(acrossLocal).addScaledVector(forward, -acrossLocal.dot(forward)).normalize();
    normal.crossVectors(across, forward).normalize();
    matrix.makeBasis(across, forward, normal);
    return out.setFromRotationMatrix(matrix).premultiply(worldReference).multiply(hand.inverseBasis).normalize();
  }

  function orientWrist(hand, weight = hand.wristWeight) {
    hand.bone.parent.getWorldQuaternion(q1).invert();
    targetQ.copy(q1).multiply(hand.desiredWorldQ);
    hand.bone.quaternion.slerp(targetQ.normalize(), weight).normalize();
    hand.bone.updateWorldMatrix(false, false);
  }

  function aimThumb(entry) {
    // Work entirely in hand coordinates. This avoids traversing the full rig
    // once per thumb joint for every pedestrian on every frame.
    q2.identity();
    for (const parent of entry.parentChain) q2.multiply(parent.quaternion);
    q1.copy(q2).multiply(entry.restQ);
    v1.copy(entry.tipLocal).normalize().applyQuaternion(q1);
    q3.setFromUnitVectors(v1, entry.thumbDirection);
    q1.premultiply(q3);
    q2.invert();
    entry.bone.quaternion.copy(q2.multiply(q1)).normalize();
  }

  function update({ dt = 1 / 60, weapon = null, armed = Boolean(weapon?.visible), aimWeight = 0, readyWeight = aimWeight,
    reloading = false, reloadProgress = 0, seated = 0, steering = 0 } = {}) {
    const step = clamp(dt, 0, 0.25);
    const blend = initialized ? 1 - Math.exp(-18 * step) : 1;
    const drive = clamp(Number(seated), 0, 1);
    const aim = clamp(aimWeight, 0, 1);
    activeWeapon = armed ? weapon : null;
    mesh.updateWorldMatrix(true, false);
    mesh.getWorldQuaternion(rootWorldQ);
    if (weapon) weapon.getWorldQuaternion(weaponWorldQ);
    else weaponWorldQ.copy(rootWorldQ);
    const wheelAngle = clamp(steering, -1, 1) * 0.8;

    for (const hand of hands) {
      const right = hand.side === 'Right';
      const hold = armed ? (right ? 1 : reloading ? 1 : clamp(readyWeight, 0, 1)) : 0;
      const wristTarget = Math.max(hold, drive);
      hand.wristWeight = THREE.MathUtils.lerp(hand.wristWeight, wristTarget, blend);
      hand.mode = drive > 0.5 ? 'steering' : hold > 0.5 ? (reloading ? 'reload' : right ? 'pistol' : 'support') : 'relaxed';

      // A relaxed wrist follows the forearm, with its thumb pointing forward
      // when the arm hangs and upward when the elbow bends. Rifle-capture wrist
      // rotations otherwise survive even after civilian arms are lowered.
      hand.bone.getWorldPosition(v1);
      hand.bone.parent.getWorldPosition(v2);
      q1.copy(rootWorldQ).invert();
      v1.sub(v2).applyQuaternion(q1).normalize();
      v2.set(0, Math.max(0, v1.z), -v1.y);
      if (v2.lengthSq() < 0.001) v2.set(0, 0, 1);
      desiredFrame(hand, rootWorldQ, v1, v2, relaxedRotation);
      hand.desiredWorldQ.copy(relaxedRotation);
      if (hand.wristWeight > 0.001) {
        // Both thumbs point upward along the pistol; palms face each other.
        v1.set(0, -0.07, 1); v2.set(0, 1, 0.07);
        desiredFrame(hand, weaponWorldQ, v1, v2, gripRotation);
        // At the wheel, palms face forward; thumbs point toward its center.
        v1.set(-Math.sin(wheelAngle), Math.cos(wheelAngle), 0);
        const sign = right ? 1 : -1;
        v2.set(sign * Math.cos(wheelAngle), sign * Math.sin(wheelAngle), 0);
        desiredFrame(hand, rootWorldQ, v1, v2, steeringRotation);
        hand.desiredWorldQ.slerp(gripRotation, hand.wristWeight).slerp(steeringRotation, drive);
      }
      orientWrist(hand, 1);

      for (const entry of hand.digits) {
        const j = entry.joint - 1;
        const order = FINGERS.indexOf(entry.finger);
        // Absolute anatomical flexion keeps the already curled male bind pose
        // and the straighter female bind pose consistent.
        let targetAngle = [10 + order * 3, 17 + order * 2, 8 + order][j];
        let gripAngle = [60 + order * 2, 78, 40][j];
        if (right && entry.finger === 'Index') gripAngle = THREE.MathUtils.lerp([8, 10, 5][j], [24, 53, 22][j], aim * (reloading ? 0 : 1));
        if (!right && reloading) {
          const rack = Math.sin(THREE.MathUtils.smoothstep(reloadProgress, 0.68, 0.94) * Math.PI);
          gripAngle = THREE.MathUtils.lerp([45, 58, 30][j], [28, 45, 22][j], rack);
        }
        targetAngle = THREE.MathUtils.lerp(targetAngle, gripAngle, hold);
        targetAngle = THREE.MathUtils.lerp(targetAngle, [52 + order * 2, 65, 35][j], drive) * DEG;
        entry.angle = THREE.MathUtils.lerp(entry.angle, targetAngle, blend);
        q1.setFromAxisAngle(entry.flexAxisLocal, entry.angle - entry.bindFlex);
        entry.bone.quaternion.copy(entry.restQ).multiply(q1).normalize();
      }
      for (const entry of hand.thumbs) {
        const j = entry.joint - 1;
        const relaxed = [[0.55, 0.22, 0.81], [0.30, 0.15, 0.94], [0.20, 0.16, 0.96]][j];
        // The thumb's base sits inside the palm plane. Oppose it outward enough
        // that the next joint rests beside the grip, then extend along the slide.
        const opposition = clamp(-entry.thumbBaseNormal / Math.max(entry.segmentLength, 1e-6), -0.55, 0);
        const gripping = j === 0
          ? [0.42, opposition, Math.sqrt(1 - 0.42 ** 2 - opposition ** 2)]
          : j === 1 ? [0.05, 0, 1] : [0, 0, 1];
        const weight = Math.max(hold, drive);
        v1.copy(hand.palmAcross).multiplyScalar(THREE.MathUtils.lerp(relaxed[0], gripping[0], weight));
        v1.addScaledVector(hand.palmNormal, THREE.MathUtils.lerp(relaxed[1], gripping[1], weight));
        v1.addScaledVector(hand.palmForward, THREE.MathUtils.lerp(relaxed[2], gripping[2], weight)).normalize();
        entry.thumbDirection.lerp(v1, blend).normalize();
        aimThumb(entry);
      }
    }
    initialized = true;
  }

  function handAnchor(hand, out) {
    hand.bone.updateWorldMatrix(true, false);
    out.copy(hand.palmCenter);
    hand.bone.localToWorld(out);
    hand.bone.getWorldQuaternion(q1);
    hand.bone.getWorldScale(scale);
    const palmPadding = hand.palmWidth * Math.abs(scale.x) * 0.11;
    // Palm skin meets the pistol grip's side; its center is half a grip-width
    // farther inward. Weapon dimensions use actor-root units (meters).
    mesh.getWorldScale(v3);
    const gripHalfWidth = 0.017 * Math.abs(v3.x);
    v1.copy(hand.palmNormal).applyQuaternion(q1).normalize();
    return out.addScaledVector(v1, palmPadding + gripHalfWidth);
  }

  function weaponGripCenter(out) {
    const center = activeWeapon?.userData.gripCenter;
    return Array.isArray(center) && center.length === 3 && center.every(Number.isFinite)
      ? out.fromArray(center) : out.copy(GRIP_CENTER);
  }

  function getWeaponPosition(out = new THREE.Vector3()) {
    const right = hands.find((hand) => hand.side === 'Right');
    if (!right || !activeWeapon) return out.copy(activeWeapon?.position ?? v1.set(0, 0, 0));
    handAnchor(right, worldAnchor);
    activeWeapon.getWorldQuaternion(q1);
    activeWeapon.getWorldScale(scale);
    weaponGripCenter(worldOffset).multiply(scale).applyQuaternion(q1);
    return mesh.worldToLocal(out.copy(worldAnchor).sub(worldOffset));
  }

  /** Optional second-pass arm IK target that puts the support palm on the grip. */
  function getSupportTarget(out = new THREE.Vector3()) {
    const right = hands.find((hand) => hand.side === 'Right');
    const left = hands.find((hand) => hand.side === 'Left');
    if (!right || !left) return out.set(0, 0, 0);
    handAnchor(right, worldAnchor);
    handAnchor(left, worldOffset);
    left.bone.getWorldPosition(v2);
    worldOffset.sub(v2);
    return mesh.worldToLocal(out.copy(worldAnchor).sub(worldOffset));
  }

  /** Wrist target that places this posed palm around a root-local grip center. */
  function getGripTarget(side, center, out = new THREE.Vector3()) {
    const hand = hands.find((item) => item.side === side);
    if (!hand) return out.copy(center);
    mesh.localToWorld(worldAnchor.copy(center));
    handAnchor(hand, worldOffset);
    hand.bone.getWorldPosition(v2);
    worldOffset.sub(v2);
    return mesh.worldToLocal(out.copy(worldAnchor).sub(worldOffset));
  }

  /** Restore only the wrist after a second arm-IK pass; fingers stay posed. */
  function refreshWrist(side = 'Left') {
    const hand = hands.find((item) => item.side === side);
    if (hand && hand.wristWeight > 0.001) orientWrist(hand);
  }

  function getGripInfo() {
    const info = { hands: {}, weaponAnchorError: null };
    for (const hand of hands) {
      const middle = hand.digits.find((entry) => entry.finger === 'Middle' && entry.joint === 3);
      handAnchor(hand, worldAnchor);
      mesh.worldToLocal(worldAnchor);
      if (middle) {
        v1.copy(middle.tipLocal); middle.bone.localToWorld(v1); mesh.worldToLocal(v1);
        hand.bone.getWorldPosition(v2); mesh.worldToLocal(v2);
      }
      info.hands[hand.side.toLowerCase()] = {
        mode: hand.mode, palmGripCenter: worldAnchor.toArray(),
        middleTipWristDistance: middle ? v1.distanceTo(v2) : null,
      };
    }
    if (activeWeapon && info.hands.right) {
      weaponGripCenter(v1); activeWeapon.localToWorld(v1); mesh.worldToLocal(v1);
      v2.fromArray(info.hands.right.palmGripCenter);
      info.weaponAnchorError = v1.distanceTo(v2);
    }
    return info;
  }

  return { update, refreshWrist, getWeaponPosition, getSupportTarget, getGripTarget, getGripInfo };
}
