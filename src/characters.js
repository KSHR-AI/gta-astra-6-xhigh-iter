import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

let characterAsset;
let pedestrianAsset;
let pedestrianCount = 0;
let loadingPromise;
const localForward = new THREE.Vector3(0, 0, 1);
const tmpPosition = new THREE.Vector3();
const tmpDirection = new THREE.Vector3();
const tmpParentRotation = new THREE.Quaternion();
const tmpRotation = new THREE.Quaternion();
const tmpDelta = new THREE.Quaternion();

/** Load once before creating the player and population. All assets are served locally. */
export async function loadCharacterAssets() {
  if (!loadingPromise) {
    const loader = new GLTFLoader();
    loadingPromise = Promise.allSettled([
      loader.loadAsync('/models/Soldier.glb'),
      Promise.all([
        loader.loadAsync('/models/Michelle.glb'),
        fetch('/models/pedestrian-motion.json').then((response) => {
          if (!response.ok) throw new Error('Pedestrian animation request failed');
          return response.json();
        }),
      ]),
    ]).then(([main, pedestrian]) => {
        if (main.status !== 'fulfilled') throw main.reason;
        characterAsset = main.value;
        if (pedestrian.status === 'fulfilled') {
          pedestrianAsset = pedestrian.value[0];
          pedestrianAsset.animations = pedestrian.value[1].map((clip) => THREE.AnimationClip.parse(clip));
        }
        return { loaded: true, animations: characterAsset.animations.map((clip) => clip.name), variants: pedestrianAsset ? 2 : 1 };
      })
      .catch((error) => {
        console.warn('Character asset could not load; using articulated fallback.', error);
        return { loaded: false, animations: [] };
      });
  }
  return loadingPromise;
}

function handgun() {
  const group = new THREE.Group();
  group.name = 'Service pistol';
  const steel = new THREE.MeshStandardMaterial({ color: 0x25282b, metalness: 0.8, roughness: 0.34 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.92 });
  const part = (geometry, material, x, y, z) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  part(new THREE.BoxGeometry(0.042, 0.053, 0.22), steel, 0, 0.026, 0.065);
  const handle = part(new THREE.BoxGeometry(0.034, 0.108, 0.054), grip, 0, -0.046, -0.012);
  handle.rotation.x = -0.18;
  const barrel = part(new THREE.CylinderGeometry(0.012, 0.012, 0.095, 10), steel, 0, 0.019, 0.15);
  barrel.rotation.x = Math.PI / 2;
  part(new THREE.BoxGeometry(0.007, 0.014, 0.013), steel, 0, 0.059, 0.14);
  const guard = part(new THREE.TorusGeometry(0.025, 0.004, 5, 12), steel, 0, -0.033, 0.042);
  guard.rotation.y = Math.PI / 2;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'Muzzle';
  muzzle.position.set(0, 0.02, 0.205);
  group.add(muzzle);
  return { group, muzzle };
}

/** Point a bone's child toward a direction in world space, preserving animation roll. */
function pointBone(bone, child, direction, weight) {
  if (!bone || !child || weight < 0.001) return;
  bone.updateWorldMatrix(true, true);
  bone.getWorldPosition(tmpPosition);
  child.getWorldPosition(tmpDirection).sub(tmpPosition).normalize();
  tmpDelta.setFromUnitVectors(tmpDirection, direction);
  bone.getWorldQuaternion(tmpRotation).premultiply(tmpDelta);
  bone.parent.getWorldQuaternion(tmpParentRotation).invert();
  tmpRotation.premultiply(tmpParentRotation);
  bone.quaternion.slerp(tmpRotation, weight);
  bone.updateWorldMatrix(false, true);
}

/**
 * Grounded 1.8 m character. The root's +Z axis is forward.
 * Each clone has its own skeleton, materials, mixer, and animation state.
 */
export function createCharacter({ npc = false, color } = {}) {
  if (!characterAsset) return createFallbackCharacter({ npc, color });

  const mesh = new THREE.Group();
  const civilian = Boolean(npc && pedestrianAsset && pedestrianCount++ % 3 !== 2);
  const asset = civilian ? pedestrianAsset : characterAsset;
  mesh.name = npc ? 'Pedestrian' : 'Player';
  mesh.userData.characterAsset = civilian ? 'Mixamo Michelle / Michelle.glb' : 'Mixamo Vanguard / Soldier.glb';
  const visual = new THREE.Group();
  mesh.add(visual);
  const model = cloneSkeleton(asset.scene);
  // The source model faces -Z. Keep the gameplay convention uniformly +Z.
  model.rotation.y = civilian ? 0 : Math.PI;
  visual.add(model);
  const bones = {};
  const materials = [];
  model.traverse((object) => {
    if (object.isBone) bones[object.name.replace(/.*mixamorig[:_]?/i, '')] = object;
    if (!object.isMesh) return;
    object.castShadow = true;
    object.receiveShadow = true;
    // Skinned limbs can extend outside the static bind-pose bounds.
    object.frustumCulled = false;
    const recolor = (original) => {
      const material = original.clone();
      material.roughness = 0.82;
      if (material.name.includes('Visor')) {
        material.metalness = 0.23;
        material.roughness = 0.32;
      } else {
        // Keep the detailed original cloth/skin map; tint each outfit subtly.
        material.color.set(color ?? (npc ? 0xb8b5af : 0xa8b4bb));
        if (civilian) material.color.lerp(new THREE.Color(0xffffff), 0.8);
      }
      materials.push(material);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(recolor) : recolor(object.material);
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of asset.animations) {
    if (clip.name === 'TPose') continue;
    actions[clip.name.toLowerCase()] = mixer.clipAction(clip);
  }
  let currentName = 'idle';
  actions.idle?.play();
  mixer.update(0);
  mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const sourceHeight = bounds.max.y - bounds.min.y;
  visual.scale.setScalar(1.8 / sourceHeight);
  model.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);
  const { group: weapon, muzzle } = handgun();
  mesh.add(weapon);
  let weaponVisible = !npc;
  weapon.visible = weaponVisible;
  let aimWeight = 0;
  let recoil = 0;
  const forward = new THREE.Vector3();
  const rightArmDirection = new THREE.Vector3();
  const leftArmDirection = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion();
  const handPosition = new THREE.Vector3();

  function update(dt, { speed = 0, aiming = false, shooting = false, dead = false } = {}) {
    const step = Math.min(dt, 0.1);
    const velocity = Math.abs(speed);
    const nextName = velocity < 0.15 ? 'idle' : velocity > 3.7 ? 'run' : 'walk';
    if (nextName !== currentName && actions[nextName]) {
      const next = actions[nextName];
      next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      actions[currentName]?.crossFadeTo(next, 0.22, false);
      currentName = nextName;
    }
    if (currentName === 'walk') actions.walk?.setEffectiveTimeScale(THREE.MathUtils.clamp(velocity / 1.7, 0.65, 1.7));
    if (currentName === 'run') actions.run?.setEffectiveTimeScale(THREE.MathUtils.clamp(velocity / 4.7, 0.8, 1.5));
    mixer.update(step);

    aimWeight = THREE.MathUtils.damp(aimWeight, (aiming || shooting) && weaponVisible ? 1 : 0, 14, step);
    recoil = shooting ? 0.075 : THREE.MathUtils.damp(recoil, 0, 20, step);
    mesh.updateWorldMatrix(true, true);
    mesh.getWorldQuaternion(rootRotation);
    forward.copy(localForward).applyQuaternion(rootRotation);
    rightArmDirection.set(-0.1, -0.07 + recoil, 1).normalize().applyQuaternion(rootRotation);
    leftArmDirection.set(0.28, -0.22, 1).normalize().applyQuaternion(rootRotation);
    pointBone(bones.RightArm, bones.RightForeArm, rightArmDirection, aimWeight);
    pointBone(bones.RightForeArm, bones.RightHand, forward, aimWeight);
    pointBone(bones.LeftArm, bones.LeftForeArm, leftArmDirection, aimWeight * 0.9);
    pointBone(bones.LeftForeArm, bones.LeftHand, rightArmDirection, aimWeight * 0.9);

    if (bones.RightHand) {
      // Follow the skinned hand in root-local space, avoiding the source's cm scale.
      bones.RightHand.getWorldPosition(handPosition);
      mesh.worldToLocal(handPosition);
      weapon.position.copy(handPosition);
      weapon.position.y += 0.018;
      weapon.position.z += aimWeight * 0.025;
      weapon.rotation.set((1 - aimWeight) * 1.3 - recoil, 0, (1 - aimWeight) * -0.12);
    }
    visual.rotation.z = THREE.MathUtils.damp(visual.rotation.z, dead ? -Math.PI / 2 : 0, 8, step);
    if (dead) weapon.visible = false;
    else weapon.visible = weaponVisible;
  }

  update(0);
  return {
    mesh,
    mixer,
    weapon,
    muzzle,
    update,
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    setVisible(visible) { mesh.visible = Boolean(visible); },
    getMuzzlePosition(target = new THREE.Vector3()) { return muzzle.getWorldPosition(target); },
    dispose() { mixer.stopAllAction(); materials.forEach((material) => material.dispose()); },
  };
}

// Offline fallback keeps gameplay usable if an asset request is interrupted.
function createFallbackCharacter({ npc, color }) {
  const mesh = new THREE.Group();
  mesh.name = npc ? 'Pedestrian fallback' : 'Player fallback';
  mesh.userData.characterAsset = 'Articulated fallback';
  const cloth = new THREE.MeshStandardMaterial({ color: color ?? 0x273342, roughness: 0.9 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x283245, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xac7c5c, roughness: 0.85 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.8 });
  function capsule(radius, length, material, parent, position) {
    const item = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 9), material);
    item.position.set(...position);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }
  capsule(0.2, 0.34, cloth, mesh, [0, 1.21, 0]);
  capsule(0.12, 0.12, skin, mesh, [0, 1.64, 0]);
  capsule(0.125, 0.04, black, mesh, [0, 1.73, -0.015]);
  const limbs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.115, 0.9, 0);
    mesh.add(leg);
    capsule(0.09, 0.64, denim, leg, [0, -0.36, 0]);
    capsule(0.09, 0.11, black, leg, [0, -0.79, 0.055]).rotation.x = Math.PI / 2;
    const arm = new THREE.Group();
    arm.position.set(side * 0.255, 1.4, 0);
    mesh.add(arm);
    capsule(0.074, 0.38, cloth, arm, [0, -0.23, 0]);
    capsule(0.062, 0.075, skin, arm, [0, -0.49, 0]);
    limbs.push({ leg, arm, side });
  }
  const { group: weapon, muzzle } = handgun();
  limbs[0].arm.add(weapon);
  weapon.position.set(0, -0.5, 0);
  weapon.rotation.x = Math.PI / 2;
  let time = 0;
  let weaponVisible = !npc;
  weapon.visible = weaponVisible;
  return {
    mesh,
    weapon,
    muzzle,
    update(dt, { speed = 0, aiming = false, shooting = false, dead = false } = {}) {
      time += dt * (Math.abs(speed) > 3.7 ? 11 : 7);
      const stride = Math.min(Math.abs(speed) / 4, 0.8);
      for (const limb of limbs) {
        limb.leg.rotation.x = Math.sin(time) * stride * limb.side;
        limb.arm.rotation.x = (aiming || shooting) && limb.side === -1 ? -Math.PI / 2 : -Math.sin(time) * stride * limb.side;
      }
      mesh.rotation.z = THREE.MathUtils.damp(mesh.rotation.z, dead ? -Math.PI / 2 : 0, 8, dt);
      weapon.visible = weaponVisible && !dead;
    },
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    setVisible(visible) { mesh.visible = Boolean(visible); },
    getMuzzlePosition(target = new THREE.Vector3()) { return muzzle.getWorldPosition(target); },
  };
}
