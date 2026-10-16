import * as THREE from 'three';
import { createPoseTools } from './character-pose.js';
import { createHandPoseController } from './character-grip.js';

const X_AXIS = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;

/** Layered skeletal performance over the locally stored motion-capture clips. */
export function createHumanoidAnimator({ mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, bindHeadOrientation, npc, phaseOffset = 0, groundHeightAt }) {
  const pose = createPoseTools(mesh, bones);
  const hands = createHandPoseController({ mesh, bones, restPose });
  const rootRotation = new THREE.Quaternion();
  const inverseRotation = new THREE.Quaternion();
  const previousPosition = mesh.getWorldPosition(new THREE.Vector3());
  const worldPosition = new THREE.Vector3();
  const movement = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const legHip = new THREE.Vector3();
  const legKnee = new THREE.Vector3();
  const legFoot = new THREE.Vector3();
  const legToe = new THREE.Vector3();
  const footDirection = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const hand = new THREE.Vector3();
  const pelvis = new THREE.Vector3();
  const headLook = new THREE.Quaternion();
  const wantedLook = new THREE.Quaternion();
  const headWorld = new THREE.Quaternion();
  const headParentInverse = new THREE.Quaternion();
  const footWorld = new THREE.Quaternion();
  const footParentInverse = new THREE.Quaternion();
  const footYaw = new THREE.Quaternion();
  const groundPoint = new THREE.Vector3();
  const actorInverse = new THREE.Matrix4();
  const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  let headInitialized = false;
  const seatOffset = pose.position('Hips', new THREE.Vector3()).multiplyScalar(-1);
  const initialHipHeight = -seatOffset.y;
  const previousHeading = { value: mesh.rotation.y };
  let gaitPhase = phaseOffset;
  let motionSpeed = 0;
  let movementAngle = 0;
  let legYaw = 0;
  let gaitDirection = 1;
  let strideScale = 1;
  let runningWeight = 0;
  let locomotionWeight = 0;
  let hipCenter = initialHipHeight;
  let aimWeight = 0;
  let readyWeight = 0;
  let reloadWeight = 0;
  let recoil = 0;
  let recoilVelocity = 0;
  let lastShotId = null;
  let wasShooting = false;
  let wasAirborne = false;
  let landing = 0;
  let airWeight = 0;
  let surfaceOffset = 0;
  let hasAdvancedTime = false;
  let feetCalibrated = false;
  let neutralPelvisLift = 0, standingWeight = 1, displayedPostureLift = 0;
  let hitReaction = 0;
  let deathWeight = 0;
  let turnLean = 0;
  let elapsed = phaseOffset * 12;
  let weaponVisible = false;
  let lastHitInput = false;
  let reloadElapsed = 0, currentReloadProgress = 1;
  let pendingPose = null, pendingPoseTime = 0;
  let advanceCount = 0, poseCount = 0;
  const restRotations = new Map(Object.entries(bones).map(([name, bone]) => [bone, restPose[name]]));
  function restFrame(bone) {
    const chain = [];
    for (let node = bone; node && node !== mesh; node = node.parent) chain.unshift(node);
    return chain.reduce((rotation, node) => rotation.multiply(restRotations.get(node) ?? node.quaternion), new THREE.Quaternion());
  }
  const footPlants = ['Right', 'Left'].map((side) => ({
    side, anchor: new THREE.Vector3(), target: new THREE.Vector3(),
    raw: new THREE.Vector3(), previousRaw: new THREE.Vector3(), hip: new THREE.Vector3(),
    sampled: false, active: false, armed: true, weight: 0, pendingLift: false,
    corrected: new THREE.Vector3(), rotation: new THREE.Quaternion(),
    height: .13, floor: 0, worldFloor: NaN, soleHeight: 0, frame: restFrame(bones[`${side}Foot`]),
    bounds: new THREE.Box3(),
    probes: soleProbes.filter((probe) => probe.side === side),
    reach: pose.position(`${side}UpLeg`).distanceTo(pose.position(`${side}Leg`))
      + pose.position(`${side}Leg`).distanceTo(pose.position(`${side}Foot`)),
  }));

  for (const name of ['walk', 'run']) actions[name]?.play().setEffectiveWeight(0).setEffectiveTimeScale(0);
  if (actions.idle) actions.idle.time = phaseOffset * actions.idle.getClip().duration;

  function point(name, child, x, y, z, weight = 1, pitch = 0) {
    direction.set(x, y, z);
    if (pitch) direction.applyAxisAngle(X_AXIS, -pitch);
    pose.point(name, child, direction, weight);
  }

  function reachArm(side, x, y, z, poleX, poleY, poleZ, weight = 1) {
    pose.reach(`${side}Arm`, `${side}ForeArm`, `${side}Hand`, [x, y, z], [poleX, poleY, poleZ], weight);
  }

  function reachFoot(side, x, y, z, kneeX, kneeY, kneeZ, weight = 1) {
    pose.reach(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, [x, y, z], [kneeX, kneeY, kneeZ], weight);
    point(`${side}Foot`, `${side}ToeBase`, 0, -0.05, 1, weight);
  }

  function orientSole(plant, weight, yaw = 0) {
    const foot = bones[`${plant.side}Foot`], toe = bones[`${plant.side}ToeBase`];
    if (!foot?.parent || weight <= 0) return;
    footWorld.copy(rootRotation).multiply(footYaw.setFromAxisAngle(UP, yaw)).multiply(plant.frame);
    foot.parent.getWorldQuaternion(footParentInverse).invert();
    foot.quaternion.slerp(footWorld.premultiply(footParentInverse), weight);
    if (toe && restPose[`${plant.side}ToeBase`]) toe.quaternion.slerp(restPose[`${plant.side}ToeBase`], weight);
  }

  function sampleGround(plant) {
    if (typeof groundHeightAt !== 'function') return 0;
    let floor = -Infinity;
    for (let sample = 0; sample < 5; sample++) {
      // A city curb can fit between heel and toe corners. The center sample
      // catches that supporting ridge without querying every shoe vertex.
      groundPoint.set(sample === 4 ? (plant.bounds.min.x + plant.bounds.max.x) / 2
        : sample & 1 ? plant.bounds.max.x : plant.bounds.min.x, 0,
      sample === 4 ? (plant.bounds.min.z + plant.bounds.max.z) / 2
        : sample & 2 ? plant.bounds.max.z : plant.bounds.min.z);
      const height = groundHeightAt(groundPoint.x, groundPoint.z);
      if (!Number.isFinite(height)) continue;
      groundPoint.y = height;
      groundPoint.applyMatrix4(actorInverse);
      floor = Math.max(floor, groundPoint.y);
    }
    const bounded = Number.isFinite(floor) ? clamp(floor, -.36, .36) : 0;
    plant.worldFloor = groundPoint.set(0, bounded, 0).applyMatrix4(mesh.matrixWorld).y;
    return bounded;
  }

  function advance(dt, options = {}, deferred = true) {
    advanceCount++;
    const {
      speed = 0, armed = weaponVisible, aiming = false, shooting = false, shotId, dead = false,
      seated = false, steering = 0, jumping = false, verticalVelocity = 0,
      reloading = false, reloadProgress, aimPitch = 0,
      interactionProgress = 0, interactionPhase = '', hit = false,
    } = options;
    const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.25);
    elapsed += step;
    const interaction = interactionPhase === 'enter' || interactionPhase === 'exit';
    const canUseWeapon = !interaction && !seated && !dead;
    const carrying = Boolean(armed && weaponVisible && canUseWeapon);
    const progress = clamp(interactionProgress, 0, 1);
    const seatedWeight = interaction
      ? (interactionPhase === 'enter' ? smooth(progress, 0.22, 1) : 1 - smooth(progress, 0, 0.78))
      : seated ? 1 : 0;
    const airborne = !seated && !interaction && (jumping || Math.abs(verticalVelocity) > 0.2);
    if (wasAirborne && !airborne) landing = 1;
    wasAirborne = airborne;
    airWeight = THREE.MathUtils.damp(airWeight, airborne ? 1 : 0, 17, step);
    landing = THREE.MathUtils.damp(landing, 0, 8, step);
    deathWeight = THREE.MathUtils.damp(deathWeight, dead ? 1 : 0, dead ? 5 : 3.5, step);
    if (hit && !lastHitInput) hitReaction = 1;
    lastHitInput = Boolean(hit);
    hitReaction = THREE.MathUtils.damp(hitReaction, 0, 6, step);
    readyWeight = THREE.MathUtils.damp(readyWeight, carrying ? 1 : 0, 11, step);
    const aimTarget = carrying && reloading ? aimWeight : carrying && (aiming || shooting) ? 1 : 0;
    aimWeight = THREE.MathUtils.damp(aimWeight, aimTarget, 12, step);
    reloadWeight = THREE.MathUtils.damp(reloadWeight, carrying && reloading ? 1 : 0, 10, step);
    // A queued raise is not a shot. Discrete IDs preserve recoil on every round
    // even while a sustained firing/follow-through boolean remains true.
    const shot = Number.isFinite(shotId)
      ? shooting && (lastShotId !== null ? shotId !== lastShotId : shotId > 0)
      : shooting && !wasShooting;
    if (Number.isFinite(shotId)) lastShotId = shotId;
    if (shot && carrying && !reloading) recoilVelocity += 3.1;
    wasShooting = shooting;
    const recoilSteps = Math.max(1, Math.ceil(step * 120)), recoilStep = step / recoilSteps;
    for (let i = 0; i < recoilSteps; i++) {
      recoilVelocity += (-420 * recoil - 31 * recoilVelocity) * recoilStep;
      recoil = clamp(recoil + recoilVelocity * recoilStep, -0.008, 0.12);
    }

    mesh.updateWorldMatrix(true, false);
    mesh.getWorldQuaternion(rootRotation);
    inverseRotation.copy(rootRotation).invert();
    mesh.getWorldPosition(worldPosition);
    const surfaceStep = worldPosition.y - previousPosition.y;
    if (hasAdvancedTime && step < .25 && worldPosition.distanceToSquared(previousPosition) < 1
      && !interaction && !seated && !airborne && airWeight < .05 && Math.abs(surfaceStep) < .4) {
      // Gameplay roots follow the exact pavement height. Let the torso cross
      // a step over a short interval while the legs reach its real surfaces.
      surfaceOffset = THREE.MathUtils.damp(surfaceOffset - surfaceStep, 0, 12, step);
    } else surfaceOffset = 0;
    if (step > 0) hasAdvancedTime = true;
    movement.copy(worldPosition).sub(previousPosition).applyQuaternion(inverseRotation);
    movement.y = 0;
    previousPosition.copy(worldPosition);
    if (movement.lengthSq() > 0.000002 && !interaction && !seated) {
      const measuredAngle = Math.atan2(movement.x, movement.z);
      const angleDelta = Math.atan2(Math.sin(measuredAngle - movementAngle), Math.cos(measuredAngle - movementAngle));
      movementAngle += angleDelta * (1 - Math.exp(-18 * step));
      movementAngle = Math.atan2(Math.sin(movementAngle), Math.cos(movementAngle));
    }
    const backwards = Math.abs(movementAngle) > Math.PI * 0.65;
    const strafeAngle = backwards ? movementAngle - Math.sign(movementAngle) * Math.PI : movementAngle;
    // Crossing from a side step to a backward step reverses the source cycle.
    // Limit the accompanying leg turn so its new basis cannot flip the ankle
    // across the body in one frame while the torso remains aimed forward.
    const wantedLegYaw = THREE.MathUtils.damp(legYaw, clamp(strafeAngle, -1.35, 1.35), 16, step);
    legYaw += clamp(wantedLegYaw - legYaw, -6 * step, 6 * step);
    gaitDirection = THREE.MathUtils.damp(gaitDirection, backwards ? -1 : 1, 16, step);
    const headingDelta = Math.atan2(Math.sin(mesh.rotation.y - previousHeading.value), Math.cos(mesh.rotation.y - previousHeading.value));
    previousHeading.value = mesh.rotation.y;
    turnLean = THREE.MathUtils.damp(turnLean, clamp(headingDelta / Math.max(step, 0.016), -3, 3), 9, step);

    const targetSpeed = seated || interaction || dead ? 0 : Math.abs(speed);
    motionSpeed = THREE.MathUtils.damp(motionSpeed, targetSpeed, 12, step);
    locomotionWeight = THREE.MathUtils.damp(locomotionWeight, smooth(motionSpeed, 0.06, 0.95), targetSpeed > 0.1 ? 10 : 14, step);
    const movingWeight = locomotionWeight * (1 - airWeight * 0.8) * (1 - deathWeight);
    standingWeight = 1 - movingWeight;
    // Brisk walking is still a walk. Blending the rifle-run clip at 2.1 m/s
    // gave the normal 2.35 m/s walk a high-knee jog, particularly near cars.
    runningWeight = THREE.MathUtils.damp(runningWeight, smooth(motionSpeed, 2.65, 4.6), 8, step);
    // A slow pedestrian takes shorter steps, not the player's full metre-long
    // arc played in slow motion. Preserve the source's contact timing while
    // scaling its distance and the corresponding phase speed together.
    strideScale = THREE.MathUtils.lerp(clamp(Math.sqrt(motionSpeed / 2.35), 0.36, 1), 1, runningWeight);
    const strideDuration = THREE.MathUtils.lerp(actions.walk?.getClip().duration ?? 1, actions.run?.getClip().duration ?? 0.7, runningWeight);
    const referenceSpeed = THREE.MathUtils.lerp(1.85, 4.9, runningWeight);
    const travelled = movement.length();
    const measuredTravel = targetSpeed > 0.1 && travelled > 0.0001 && travelled < targetSpeed * step * 2 + 0.08;
    const strideTravel = measuredTravel ? travelled : step * motionSpeed;
    gaitPhase = (gaitPhase + strideTravel / (referenceSpeed * strideDuration * strideScale) * gaitDirection + 1) % 1;
    actions.idle?.setEffectiveWeight(1 - movingWeight);
    actions.walk?.setEffectiveWeight(movingWeight * (1 - runningWeight));
    actions.run?.setEffectiveWeight(movingWeight * runningWeight);
    for (const name of ['walk', 'run']) if (actions[name]) actions[name].time = gaitPhase * actions[name].getClip().duration;
    mixer.update(step);
    // A rendered frame may span an entire foot swing on a slow device. Retain
    // lift/rearm events from the inexpensive source ankle sample, even when the
    // expensive procedural pose is deferred past the swing's highest point.
    if (deferred && movingWeight > .15 && seatedWeight < .001 && airWeight < .05 && !interaction && !dead) {
      const clearance = THREE.MathUtils.lerp(.52, .78, runningWeight) * Math.sqrt(strideScale);
      for (const plant of footPlants) {
        const floor = plant.height + plant.floor;
        pose.position(`${plant.side}Foot`, temp);
        // The last rendered stance may lift the torso. That procedural lift
        // is not a source-clip swing event between displayed poses.
        if ((temp.y - displayedPostureLift - floor) * clearance > .075) plant.pendingLift = true;
      }
    }

    reloadElapsed = reloading ? reloadElapsed + step : 0;
    const reloadT = clamp(reloading ? reloadProgress ?? reloadElapsed / 1.45 : 1, 0, 1);
    currentReloadProgress = reloadT;
    pendingPoseTime += step;
    pendingPose = { interaction, canUseWeapon, carrying, progress, seatedWeight, airborne,
      movingWeight, aiming, shooting, dead, seated, steering, verticalVelocity,
      reloading, reloadT, aimPitch, interactionPhase };
    mesh.userData.animationState = dead ? 'down' : interaction ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : landing > 0.08 ? 'landing' : hitReaction > 0.05 ? 'hit' : aiming || shooting ? 'aiming' : motionSpeed > 3.7 ? 'running' : motionSpeed > 0.15 ? 'walking' : carrying ? 'low-ready' : 'idle';
  }

  function flushPose() {
    if (!pendingPose) return false;
    const { interaction, canUseWeapon, carrying, progress, seatedWeight, airborne,
      movingWeight, aiming, shooting, dead, seated, steering, verticalVelocity,
      reloading, reloadT, aimPitch, interactionPhase } = pendingPose;
    const step = pendingPoseTime;
    pendingPose = null; pendingPoseTime = 0; poseCount++;
    mesh.getWorldQuaternion(rootRotation);

    // Remove the source soldier's rifle-ready idle twist from the civilian rig.
    const neutralWeight = Math.max((1 - movingWeight) * 0.94, seatedWeight);
    const idleLife = (1 - movingWeight) * (1 - seatedWeight) * (1 - airWeight) * (1 - deathWeight);
    const breathing = Math.sin(elapsed * 1.7);
    const weightShift = Math.sin(elapsed * 0.53) * 0.008;
    if (bones.Hips && restPose.Hips) bones.Hips.quaternion.slerp(restPose.Hips, neutralWeight);
    for (const name of ['Spine', 'Spine1', 'Spine2', 'Neck', 'RightShoulder', 'LeftShoulder']) {
      if (bones[name] && restPose[name]) bones[name].quaternion.slerp(restPose[name], THREE.MathUtils.lerp(0.88, 0.55, movingWeight) * (1 - deathWeight));
    }
    const standingInfluence = standingWeight * (1 - seatedWeight) * (1 - airWeight) * (1 - deathWeight) * (1 - landing);
    displayedPostureLift = 0;
    // Grounded foot correction is suspended during entry/exit, but its neutral
    // torso posture must blend into the seat instead of dropping at progress 0.
    const interactionPostureLift = interaction ? neutralPelvisLift * standingInfluence : 0;
    displayedPostureLift = interactionPostureLift * (1 - seatedWeight);
    visual.position.set(weightShift * idleLife,
      (seatedWeight > 0 || airWeight > 0.1 ? 0 : surfaceOffset - landing * 0.085) + interactionPostureLift, 0);
    visual.rotation.set(0, interaction ? -Math.sin(progress * Math.PI) * 0.35 : 0, -turnLean * movingWeight * 0.025);
    mesh.updateWorldMatrix(false, true);
    pose.position('Hips', pelvis);
    // Retargeted mocap contains roughly 9 cm of walking pelvis bounce. Preserve
    // each gait's moving mean while reducing its vertical oscillation; using a
    // fixed idle height instead would overextend the shorter civilian legs.
    const sourceHip = pelvis.y - surfaceOffset - interactionPostureLift;
    if (movingWeight < 0.01 || seatedWeight > 0 || airWeight > 0.05) hipCenter = sourceHip;
    else {
      hipCenter = THREE.MathUtils.damp(hipCenter, sourceHip, 2.8, step);
      visual.position.y += (hipCenter - sourceHip) * 0.4 * movingWeight;
      mesh.updateWorldMatrix(false, true);
      pose.position('Hips', pelvis);
    }
    if (seatedWeight > 0) {
      visual.position.addScaledVector(pelvis, -seatedWeight);
      mesh.updateWorldMatrix(false, true);
      pose.position('Hips', pelvis);
    }
    const hipY = pelvis.y;
    if (!interaction && !seated && airWeight < .05) {
      mesh.getWorldPosition(groundPoint);
      for (const plant of footPlants) plant.floor = Number.isFinite(plant.worldFloor) ? plant.worldFloor - groundPoint.y : 0;
    }
    const bodyLean = landing * 0.20 + hitReaction * 0.26 + airWeight * 0.08 + movingWeight * runningWeight * 0.07 + aimWeight * 0.035 - recoil * 0.2;
    point('Spine', 'Spine1', -weightShift * idleLife, 1, bodyLean - seatedWeight * 0.13 + breathing * idleLife * 0.012, Math.max(neutralWeight * 0.55, airWeight, landing, hitReaction));
    point('Spine2', 'Neck', -turnLean * (1 - seatedWeight) * 0.025 + weightShift * idleLife * 0.6, 1, bodyLean * 0.25 + breathing * idleLife * 0.009, Math.max(neutralWeight * 0.4, hitReaction));

    // Warp the authored ankle trajectory, retaining its alternating contact and
    // swing timing. Shorten low-speed steps and reduce the soldier's exaggerated
    // clearance. Rotate knee, ankle and toe direction together for side steps;
    // rotating only the thigh left the original shin/foot fighting its parent.
    if (movingWeight > 0.001 && seatedWeight < 0.001 && airWeight < 0.05 && !interaction) {
      const sideWeight = Math.abs(Math.sin(legYaw));
      const horizontalScale = strideScale * THREE.MathUtils.lerp(1, 0.68, sideWeight);
      const clearanceScale = THREE.MathUtils.lerp(0.52, 0.78, runningWeight) * Math.sqrt(strideScale);
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        pose.position(`${side}UpLeg`, legHip);
        pose.position(`${side}Leg`, legKnee);
        pose.position(`${side}Foot`, legFoot);
        pose.position(`${side}ToeBase`, legToe);
        footDirection.subVectors(legToe, legFoot).applyAxisAngle(UP, legYaw * 0.45);
        legKnee.sub(legHip);
        legKnee.z *= horizontalScale;
        legKnee.applyAxisAngle(UP, legYaw).add(legHip);
        legFoot.sub(legHip);
        legFoot.z *= horizontalScale;
        legFoot.applyAxisAngle(UP, legYaw).add(legHip);
        // Keep each shoe on its own side during a sidestep: the source forward
        // stride must not become a pair of crossing scissor steps.
        if (sideWeight > 0.1) legFoot.x = sign * Math.max(0.055, sign * legFoot.x);
        const plant = footPlants.find((candidate) => candidate.side === side);
        const floor = plant.height + plant.floor;
        legFoot.y = floor + Math.max(0, legFoot.y - floor) * clearanceScale;
        pose.reach(`${side}UpLeg`, `${side}Leg`, `${side}Foot`, legFoot, legKnee, movingWeight);
        pose.point(`${side}Foot`, `${side}ToeBase`, footDirection, movingWeight);
      }
    }

    // The source locomotion was captured with a rifle. Replace its locked arms
    // throughout the gait, using the opposite leg's motion to drive arm swing.
    const relaxed = (1 - movingWeight) * (1 - seatedWeight);
    for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
      const foot = pose.position(`${side}Foot`, temp);
      const swing = clamp(-(foot.z - pelvis.z) * THREE.MathUtils.lerp(1.35, 1.8, runningWeight), -0.72, 0.72) * movingWeight;
      const armLayer = (1 - seatedWeight) * (1 - airWeight * 0.75) * (1 - deathWeight);
      point(`${side}Arm`, `${side}ForeArm`, sign * (0.085 + runningWeight * 0.025), -1, swing - 0.025 + breathing * 0.006 * idleLife, armLayer);
      point(`${side}ForeArm`, `${side}Hand`, sign * 0.025,
        THREE.MathUtils.lerp(-0.96, -0.35, runningWeight),
        THREE.MathUtils.lerp(swing + 0.23 + sign * 0.025, 0.88 + swing * 0.45, runningWeight), armLayer);
      if (airWeight < 0.05 && seatedWeight < (interaction ? .999 : .001)) {
        const plant = footPlants.find((candidate) => candidate.side === side);
        reachFoot(side, sign * 0.10, plant.height + plant.floor, 0.06 - sign * 0.025, sign * 0.10, 0.55, 0.28, relaxed);
        orientSole(plant, relaxed);
      }
    }

    if (airWeight > 0.001) {
      const tuck = verticalVelocity > 0 ? 0.65 : 0.28;
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        point(`${side}UpLeg`, `${side}Leg`, sign * 0.08, -0.8, tuck, airWeight);
        point(`${side}Leg`, `${side}Foot`, 0, -0.92, -0.4, airWeight);
        point(`${side}Arm`, `${side}ForeArm`, sign * 0.35, -0.6, -0.3, airWeight * (weaponVisible ? 0.3 : 1));
      }
    }
    if (landing > 0.02 && !airborne && seatedWeight === 0) {
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        const plant = footPlants.find((candidate) => candidate.side === side);
        reachFoot(side, sign * .09, plant.height + plant.floor, .06, sign * .1, .6, .38, landing);
        orientSole(plant, landing);
      }
    }

    // Keep a planted foot at its contact point while the body advances. The
    // source motion still controls swing height and when each foot lifts off.
    const canPlant = !interaction && seatedWeight < 0.001 && airWeight < 0.05
      && landing < 0.05 && !dead && deathWeight < 0.03 && movingWeight > 0.15;
    for (const plant of footPlants) {
      if (plant.pendingLift) { plant.active = false; plant.armed = true; plant.pendingLift = false; }
      plant.previousRaw.copy(plant.raw);
      pose.position(`${plant.side}Foot`, plant.raw);
      const forwardVelocity = plant.sampled && step > 0
        ? ((plant.raw.x - plant.previousRaw.x) * Math.sin(movementAngle)
          + (plant.raw.z - plant.previousRaw.z) * Math.cos(movementAngle)) / step : 0;
      plant.sampled = true;
      const floor = plant.height + plant.floor;
      if (plant.raw.y > floor + 0.075) plant.armed = true;
      if (!canPlant) {
        plant.active = false;
        plant.armed = true;
        plant.weight = 0;
        continue;
      }
      // A low forward-swinging foot has not landed yet. Locking it here creates
      // a short false contact, consumes its rearm, and misses the real step.
      if (!plant.active && plant.armed && forwardVelocity <= 0.15 && plant.raw.y < floor + 0.035) {
        plant.anchor.copy(plant.raw);
        plant.anchor.y = floor;
        mesh.localToWorld(plant.anchor);
        plant.active = true;
        plant.armed = false;
      }
      plant.target.copy(plant.anchor);
      mesh.worldToLocal(plant.target);
      plant.target.y = floor;
      pose.position(`${plant.side}UpLeg`, plant.hip);
      const reachRatio = plant.hip.distanceTo(plant.target) / Math.max(plant.reach, 0.01);
      const behindTravel = (plant.target.x - plant.hip.x) * Math.sin(movementAngle)
        + (plant.target.z - plant.hip.z) * Math.cos(movementAngle) < -0.05;
      // Release before a leg locks straight at the back of support. A fixed
      // displacement threshold let shorter rigs drag an unreachable anchor.
      const side = plant.side === 'Right' ? -1 : 1;
      const crossesStance = Math.abs(Math.sin(legYaw)) > 0.1 && plant.target.x * side < 0.045;
      const overextended = behindTravel && reachRatio > 0.985 || crossesStance
        || Math.abs(plant.target.z) > 1 || Math.abs(plant.target.x) > 0.7;
      // A lateral stance ends as the pelvis passes over it. Holding the anchor
      // beyond this point pulls one shoe through the other during side steps.
      if (crossesStance) plant.target.x = side * 0.045;
      if (plant.raw.y > floor + 0.06 || overextended) plant.active = false;
      plant.weight = THREE.MathUtils.damp(plant.weight, plant.active ? 1 : 0, plant.active ? 28 : 13, step);
      if (plant.weight > 0.015) {
        const sign = plant.side === 'Right' ? -1 : 1;
        // Ease the last part of settling so residual exponential blending does
        // not drag a supported shoe. Retaining half the original response keeps
        // contact acquisition stable when several physics steps share a frame.
        const contactWeight = (plant.weight + smooth(plant.weight, 0, 1)) * .5 * movingWeight;
        // Blend the end-effector target before solving, rather than multiplying
        // a rapidly falling reach limit into joint-space weights. That old
        // combination snapped the ankle 20–25 cm as a lateral anchor released.
        plant.target.lerp(plant.raw, 1 - contactWeight);
        pose.position(`${plant.side}Leg`, legKnee);
        direction.set(sign * 0.12, hipY - 0.38, plant.target.z + 0.35);
        legKnee.lerp(direction, contactWeight);
        pose.reach(`${plant.side}UpLeg`, `${plant.side}Leg`, `${plant.side}Foot`, plant.target, legKnee);
        orientSole(plant, contactWeight, legYaw * .45);
      }
    }

    if (seatedWeight > 0.001) {
      // The root is the seat/pelvis anchor. Hands meet the wheel, feet reach the
      // pedal well; the hips and knees remain genuinely articulated on the rig.
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        reachFoot(side, sign * 0.12, hipY - 0.30, 0.80, sign * 0.12, hipY + 0.12, 0.45, seatedWeight);
        const wheelAngle = clamp(steering, -1, 1) * 0.8;
        const wheelX = sign * 0.17 * Math.cos(wheelAngle);
        const wheelY = 0.35 + sign * 0.17 * Math.sin(wheelAngle);
        reachArm(side, wheelX, hipY + wheelY, 0.47, sign * 0.42, hipY + 0.12, 0.20, seatedWeight);
      }
    }

    if (interaction && seatedWeight < 0.9) {
      const reachWeight = Math.sin(Math.PI * clamp(interactionPhase === 'enter' ? progress / 0.7 : (1 - progress) / 0.7, 0, 1));
      reachArm('Left', 0.40, hipY + 0.20, 0.27, 0.44, hipY + 0.02, 0.08, reachWeight);
      point('Spine', 'Spine1', 0.1, 1, 0.25, Math.sin(progress * Math.PI) * 0.8);
    }

    // A pistol at low ready is supported below the chest with bent elbows. It
    // rises as one continuous pose, instead of remaining at eye level whenever
    // equipped. A sprint lowers the firing hand and frees the other arm.
    const lowRun = runningWeight * (1 - aimWeight);
    reachArm('Right', -0.10 - lowRun * 0.07, hipY + 0.115 - lowRun * 0.16,
      0.32 - lowRun * 0.16, -0.34, hipY + 0.04, 0.08, readyWeight);
    reachArm('Left', -0.028, hipY + 0.10, 0.31, 0.32, hipY + 0.04, 0.1, readyWeight * (1 - lowRun * 0.82));
    const pitch = clamp(aimPitch, -1.1, 1.1);
    const aimY = Math.sin(pitch);
    const aimZ = Math.cos(pitch);
    reachArm('Right', -0.055, hipY + 0.40 + aimY * 0.49 + recoil * 0.12,
      aimZ * 0.49 - recoil * 0.20, -0.34, hipY + 0.18 + aimY * 0.12, 0.20, aimWeight);
    reachArm('Left', -0.025, hipY + 0.38 + aimY * 0.46 + recoil * 0.10,
      aimZ * 0.46 - recoil * 0.18, 0.32, hipY + 0.17 + aimY * 0.12, 0.19, aimWeight);

    if (reloadWeight > 0.005 && canUseWeapon) {
      const rack = Math.sin(smooth(reloadT, 0.67, 0.88) * Math.PI);
      // Blend wrist targets rather than two joint rotations: an almost straight
      // aiming arm otherwise sweeps a large arc at the first reload frame.
      pose.position('RightHand', hand);
      direction.set(-0.10, hipY + 0.25 + rack * 0.015, 0.30);
      hand.lerp(direction, reloadWeight);
      reachArm('Right', hand.x, hand.y, hand.z, -0.34, hipY + 0.08, 0.12);
      const retrieve = smooth(reloadT, 0.02, 0.22), insert = smooth(reloadT, 0.28, 0.59);
      const handX = THREE.MathUtils.lerp(THREE.MathUtils.lerp(-0.025, 0.20, retrieve), -0.045, insert);
      const handY = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.13, -0.12, retrieve), 0.155, insert) + rack * 0.12;
      const handZ = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.32, 0.04, retrieve), 0.29, insert) - rack * 0.055;
      pose.position('LeftHand', hand);
      direction.set(handX, hipY + handY, handZ);
      hand.lerp(direction, reloadWeight);
      reachArm('Left', hand.x, hand.y, hand.z, 0.33, hipY + 0.02, 0.10);
    }

    if (hitReaction > 0.05 && !seated) {
      point('Spine2', 'Neck', hitReaction * 0.18, 1, hitReaction * 0.35, hitReaction);
    }
    if (bones.Head && bindHeadOrientation) {
      // The male rig's Head→HeadTop axis leans forward by ~21° in bind pose.
      // Pointing that axis vertically raised his chin and retained rifle-idle
      // neck twist. Rotate the authored head frame toward actor-forward instead.
      const attentive = !aiming && !shooting && !reloading;
      const lookPitch = (aiming || shooting ? pitch * 0.75 : Math.sin(elapsed * 0.29) * 0.018 * idleLife)
        + hitReaction * 0.22 - landing * 0.06 - seatedWeight * 0.015;
      const lookYaw = attentive ? Math.sin(elapsed * 0.37) * 0.065 * idleLife + steering * seatedWeight * 0.10 : 0;
      lookEuler.set(-clamp(lookPitch, -0.82, 0.82), lookYaw, 0);
      wantedLook.setFromEuler(lookEuler);
      headLook.slerp(wantedLook, headInitialized ? 1 - Math.exp(-12 * step) : 1);
      headInitialized = true;
      headWorld.copy(rootRotation).multiply(headLook).multiply(bindHeadOrientation);
      bones.Head.parent.getWorldQuaternion(headParentInverse).invert();
      headWorld.premultiply(headParentInverse);
      bones.Head.quaternion.slerp(headWorld, (1 - movingWeight * 0.12) * (1 - deathWeight));
    }
    if (deathWeight > 0.01) {
      const seatedSlump = deathWeight * seatedWeight;
      if (seatedSlump > 0.001) {
        // A disabled driver folds over the lap while the pelvis remains at the
        // seat anchor. Rotating the entire visual through 90 degrees drove the
        // torso through the door and detached it from the suspended cockpit.
        point('Spine', 'Spine1', 0.08, 1, 0.72, seatedSlump);
        point('Spine1', 'Spine2', 0.10, 1, 0.88, seatedSlump);
        point('Spine2', 'Neck', 0.12, 1, 0.78, seatedSlump);
        for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
          reachArm(side, sign * 0.19, hipY + 0.055, 0.31,
            sign * 0.35, hipY + 0.12, 0.17, seatedSlump);
        }
        if (bones.Head && bindHeadOrientation) {
          lookEuler.set(0.70, 0.10, 0.08);
          headWorld.copy(rootRotation).multiply(wantedLook.setFromEuler(lookEuler)).multiply(bindHeadOrientation);
          bones.Head.parent.getWorldQuaternion(headParentInverse).invert();
          bones.Head.quaternion.slerp(headWorld.premultiply(headParentInverse), seatedSlump);
        }
      }
      const groundFall = deathWeight * (1 - seatedWeight);
      if (groundFall > 0.001) {
        point('LeftUpLeg', 'LeftLeg', 0.1, -0.9, 0.4, groundFall);
        point('LeftLeg', 'LeftFoot', 0, -0.8, -0.6, groundFall);
        reachArm('Left', 0.20, hipY + 0.15, 0.32, 0.45, hipY, 0.14, groundFall);
        visual.rotation.z -= groundFall * Math.PI / 2;
        visual.position.y += groundFall * 0.14;
      }
    }
    // SkinnedMesh.updateMatrixWorld also refreshes its inverse bind transform;
    // CPU sole sampling must see the same transform the renderer will use.
    mesh.updateMatrixWorld(true);

    if (!dead && deathWeight < 0.03 && !interaction && !seated && !airborne && soleProbes.length) {
      // Root and skinned-mesh matrices are current from the update above.
      // Reuse the inverse instead of updating/inverting ancestors per probe.
      actorInverse.copy(mesh.matrixWorld).invert();
      const sampleSoleHeight = (probes = soleProbes, bounds) => {
        let height = Infinity;
        bounds?.makeEmpty();
        for (const probe of probes) {
          // Upper shoe extrema expand the terrain footprint once per pose;
          // repeated sole-height corrections only need outsole probes.
          if (probe.footprintOnly && !bounds) continue;
          probe.object.getVertexPosition(probe.index, temp);
          temp.applyMatrix4(probe.object.matrixWorld);
          bounds?.expandByPoint(temp);
          temp.applyMatrix4(actorInverse);
          height = Math.min(height, temp.y);
        }
        return height;
      };
      if (!feetCalibrated && relaxed > 0.99) {
        // Measure each anatomical ankle against its own fully oriented sole.
        // The joint-to-toe direction is not the shoe's contact plane, and left
        // and right shoes need not have the same ankle offset.
        for (const plant of footPlants) {
          const height = sampleSoleHeight(plant.probes.length ? plant.probes : soleProbes);
          plant.height = clamp(pose.position(`${plant.side}Foot`, temp).y - height, .04, .22);
        }
        feetCalibrated = true;
        for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
          const plant = footPlants.find((candidate) => candidate.side === side);
          reachFoot(side, sign * 0.10, plant.height + plant.floor, 0.06 - sign * 0.025, sign * 0.10, 0.55, 0.28);
          orientSole(plant, 1);
        }
        // The rifle idle bends the knees about 45 degrees even after its
        // upper-body twist is removed. Calibrate a relaxed standing pelvis
        // from both measured legs, leaving a small bend instead of locking.
        let lift = Infinity;
        for (const plant of footPlants) {
          pose.position(`${plant.side}UpLeg`, plant.hip);
          pose.position(`${plant.side}Foot`, plant.target);
          const horizontal = Math.hypot(plant.target.x - plant.hip.x, plant.target.z - plant.hip.z);
          const neutralHip = plant.target.y + Math.sqrt(Math.max(0, (plant.reach * .983) ** 2 - horizontal ** 2));
          lift = Math.min(lift, neutralHip - plant.hip.y);
        }
        neutralPelvisLift = clamp(Number.isFinite(lift) ? lift : 0, 0, .12);
        mesh.updateMatrixWorld(true);
      }
      // Capture foot targets before lifting the neutral pelvis. Applying that
      // posture before gait/contact detection would change touchdown timing.
      // The final leg solve extends toward these same targets, preserving both
      // soles; terrain penetration never feeds into the averaged source hips.
      const postureLift = neutralPelvisLift * standingInfluence;
      let lowerPelvis = 0;
      for (const plant of footPlants) {
        const soleHeight = sampleSoleHeight(plant.probes.length ? plant.probes : soleProbes, plant.bounds);
        const previousFloor = plant.floor;
        plant.floor = sampleGround(plant);
        const height = soleHeight - plant.floor;
        // A forward foot can leave the upper tread before the body steps down.
        // A contact inferred against last frame's tread has not actually landed
        // on the lower one yet. Keep its swing rather than stretching to it.
        if (plant.floor < previousFloor - .03 && height > .04) {
          plant.active = false; plant.armed = true;
        }
        const support = Math.max(relaxed, plant.active ? (plant.weight + smooth(plant.weight, 0, 1)) * .5 * movingWeight : 0);
        pose.position(`${plant.side}Foot`, plant.corrected);
        plant.corrected.y += (.001 - height) * (height < .001 ? 1 : support);
        bones[`${plant.side}Foot`]?.getWorldQuaternion(plant.rotation);
        pose.position(`${plant.side}UpLeg`, plant.hip);
        const horizontal = Math.hypot(plant.corrected.x - plant.hip.x, plant.corrected.z - plant.hip.z);
        const maximumHeight = plant.corrected.y + Math.sqrt(Math.max(0, (plant.reach * .985) ** 2 - horizontal ** 2));
        lowerPelvis = Math.max(lowerPelvis, (plant.hip.y + postureLift - maximumHeight) * support);
      }
      displayedPostureLift = postureLift;
      if (postureLift || lowerPelvis > 0) {
        visual.position.y += postureLift - Math.min(lowerPelvis, .12);
        mesh.updateMatrixWorld(true);
      }
      for (const plant of footPlants) {
        for (let iteration = 0; iteration < 2; iteration++) {
          pose.position(`${plant.side}Leg`, legKnee);
          pose.reach(`${plant.side}UpLeg`, `${plant.side}Leg`, `${plant.side}Foot`, plant.corrected, legKnee);
          const foot = bones[`${plant.side}Foot`];
          if (foot?.parent) {
            foot.parent.getWorldQuaternion(footParentInverse).invert();
            foot.quaternion.copy(footParentInverse).multiply(plant.rotation);
          }
          bones[`${plant.side}UpLeg`]?.updateWorldMatrix(true, true);
          const height = sampleSoleHeight(plant.probes.length ? plant.probes : soleProbes) - plant.floor;
          plant.soleHeight = height;
          if (height >= .0009) break;
          plant.corrected.y += .001 - height;
        }
      }

    }

    pose.position('RightHand', hand);
    weapon.position.copy(hand);
    weapon.position.y += 0.018;
    weapon.rotation.set(
      THREE.MathUtils.lerp((1 - aimWeight) * (0.58 + lowRun * 0.35) - pitch * aimWeight - recoil, -0.48, reloadWeight),
      THREE.MathUtils.lerp((1 - aimWeight) * -0.035, -0.12, reloadWeight),
      THREE.MathUtils.lerp((1 - aimWeight) * -0.055, -0.24, reloadWeight));
    weapon.visible = carrying;
    const supportWeight = Math.max(aimWeight, readyWeight * (1 - lowRun * 0.82)) * (1 - reloadWeight);
    const wheelHold = seatedWeight * (1 - smooth(deathWeight, 0.05, 0.7));
    hands.update({ dt: step, weapon, armed: weapon.visible, aimWeight, readyWeight: supportWeight,
      reloading: reloading && canUseWeapon, reloadProgress: reloadT, seated: wheelHold, steering });
    if (wheelHold > 0.001) {
      // The arm solve initially reaches with the wrist joint. After posing the
      // fingers, use each rig's measured palm offset to put the actual grip on
      // the steering rim. The full actor quaternion carries this local cockpit
      // frame through suspension pitch/roll and world heading together.
      const wheelAngle = clamp(steering, -1, 1) * 0.8;
      for (const [side, sign] of [['Right', -1], ['Left', 1]]) {
        temp.set(sign * 0.15 * Math.cos(wheelAngle), hipY + 0.35 + sign * 0.15 * Math.sin(wheelAngle), 0.47);
        hands.getGripTarget(side, temp, temp);
        reachArm(side, temp.x, temp.y, temp.z, sign * 0.42, hipY + 0.12, 0.20, wheelHold);
        hands.refreshWrist(side);
      }
    }
    if (weapon.visible) {
      if (supportWeight > 0.01 && !reloading) {
        // Place the support palm on the same measured grip as the firing hand,
        // then restore its wrist orientation after this final arm adjustment.
        hands.getSupportTarget(temp);
        reachArm('Left', temp.x, temp.y, temp.z, 0.32, hipY + 0.14, 0.18, supportWeight);
        hands.refreshWrist('Left');
      }
      weapon.position.copy(hands.getWeaponPosition(hand));
    }
    magazine.visible = Boolean(reloading && carrying && reloadT > 0.16 && reloadT < 0.61);
    if (magazine.visible) {
      pose.position('LeftHand', magazine.position);
      magazine.quaternion.copy(weapon.quaternion);
      temp.set(0, -0.037, 0).applyQuaternion(magazine.quaternion);
      magazine.position.add(temp);
    }
    mesh.userData.animationState = dead ? 'down' : interaction ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : landing > 0.08 ? 'landing' : hitReaction > 0.05 ? 'hit' : aiming || shooting ? 'aiming' : motionSpeed > 3.7 ? 'running' : motionSpeed > 0.15 ? 'walking' : carrying ? 'low-ready' : 'idle';
    return true;
  }

  function update(dt, options = {}) { advance(dt, options, false); flushPose(); }
  function resetGrounding() {
    surfaceOffset = 0;
    mesh.getWorldPosition(previousPosition);
    for (const plant of footPlants) {
      plant.active = false; plant.armed = true; plant.sampled = false;
      plant.weight = 0; plant.pendingLift = false; plant.floor = 0; plant.worldFloor = NaN;
    }
  }

  return {
    update, advance, flushPose, resetGrounding,
    getEvaluationStats: () => ({ advances: advanceCount, poses: poseCount, pending: Boolean(pendingPose), pendingTime: pendingPoseTime }),
    seatOffset,
    seatAnchor: 'pelvis',
    setWeapon(visible) { flushPose(); weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    reactToHit(strength = 1) { flushPose(); hitReaction = clamp(strength, 0.2, 1); },
    getPoseInfo() { flushPose(); return { evaluations: { advances: advanceCount, poses: poseCount }, locomotion: { speed: motionSpeed, gaitPhase, strideScale, runningWeight, movementAngle }, state: mesh.userData.animationState, pelvis: pose.position('Hips', new THREE.Vector3()).toArray(), pelvisHeight: initialHipHeight, surfaceOffset, neutralPelvisLift, standingWeight, weaponVisible, armed: Boolean(weapon.visible), aimWeight, readyWeight, reloadWeight, reloadProgress: currentReloadProgress, landingWeight: landing, hitWeight: hitReaction, airborneWeight: airWeight, deathWeight, recoil, grip: hands.getGripInfo(), footContacts: footPlants.map((plant) => ({ side: plant.side, planted: plant.active, weight: plant.weight, anchor: plant.anchor.toArray(), ankleHeight: plant.height, floor: plant.floor, soleClearance: plant.soleHeight, probes: plant.probes.length })) }; },
  };
}
