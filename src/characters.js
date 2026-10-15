import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

let characterAsset;
let pedestrianAsset;
let pedestrianCount = 0;
let loadingPromise;
const tmpPosition = new THREE.Vector3();
const tmpDirection = new THREE.Vector3();
const tmpParentRotation = new THREE.Quaternion();
const tmpRotation = new THREE.Quaternion();
const tmpDelta = new THREE.Quaternion();
const white = new THREE.Color(0xffffff);

function prepareCharacterMaterial(original, { civilian, npc, color }) {
  const material = original.clone();
  // Retain the source's baked textile, seams and normal maps at oblique angles.
  for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.specularColorMap]) {
    if (!texture) continue;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  material.color.copy(white);
  material.envMapIntensity = civilian ? 0.65 : 0.85;
  material.normalScale?.setScalar(civilian ? 0.85 : 1.12);
  if (material.name.includes('Visor')) {
    material.color.set(0x839aa5);
    material.metalness = 0.62;
    material.roughness = 0.21;
    return material;
  }

  // Dye only the source's yellow fabric / tan armor. Faces, hands, hair,
  // stitching, worn edges and red insignia retain their original texture.
  const wardrobe = new THREE.Color(color ?? (npc ? 0x647078 : 0x526471));
  material.roughness = civilian ? 0.9 : 0.72;
  // The imported civilian's metalness factor was 0.5, making skin look metallic.
  material.metalness = civilian ? 0 : 0.14;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wardrobeColor = { value: wardrobe };
    shader.fragmentShader = `uniform vec3 wardrobeColor;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float wardrobeMask = ${civilian
        ? 'smoothstep(0.18, 0.42, diffuseColor.g) * smoothstep(0.16, 0.38, diffuseColor.r - diffuseColor.b) * smoothstep(0.12, 0.30, diffuseColor.g - diffuseColor.b)'
        : 'smoothstep(0.10, 0.24, diffuseColor.r - diffuseColor.b) * smoothstep(0.035, 0.12, diffuseColor.g - diffuseColor.b)'};
      float sourceLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 dyedSurface = wardrobeColor * (0.45 + sourceLuminance * ${civilian ? '1.0' : '1.75'});
      diffuseColor.rgb = mix(diffuseColor.rgb, dyedSurface, wardrobeMask * ${civilian ? '0.94' : '0.88'});
    `);
    if (!civilian) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.94, 0.53, wardrobeMask);
      `).replace('#include <metalnessmap_fragment>', `
        #include <metalnessmap_fragment>
        metalnessFactor = mix(0.015, 0.27, wardrobeMask);
      `);
    }
  };
  material.customProgramCacheKey = () => civilian ? 'civilian-fabric-v1' : 'player-armor-v1';
  return material;
}

function makeSoleProbes(model) {
  const probes = [];
  const vertex = new THREE.Vector3();
  model.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const candidates = [];
    for (let index = 0; index < object.geometry.attributes.position.count; index++) {
      object.getVertexPosition(index, vertex);
      object.localToWorld(vertex);
      if (vertex.y < 0.085) candidates.push({ index, position: vertex.clone() });
    }
    candidates.sort((a, b) => a.position.y - b.position.y);
    if (!candidates.length) return;
    const selected = [candidates[0]];
    // Cover both soles with a small set of actual skinned vertices, including
    // toe and heel corners. This avoids recalculating full mesh bounds per frame.
    while (selected.length < Math.min(12, candidates.length)) {
      let farthest;
      let greatestDistance = -1;
      for (const candidate of candidates) {
        let distance = Infinity;
        for (const picked of selected) distance = Math.min(distance, candidate.position.distanceToSquared(picked.position));
        if (distance > greatestDistance) { greatestDistance = distance; farthest = candidate; }
      }
      if (!farthest || greatestDistance < 0.000001) break;
      selected.push(farthest);
    }
    for (const candidate of selected) probes.push({ object, index: candidate.index });
  });
  return probes;
}

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
      const material = prepareCharacterMaterial(original, { civilian, npc, color });
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
  actions.idle?.play();
  mixer.update(0);
  mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const sourceHeight = bounds.max.y - bounds.min.y;
  visual.scale.setScalar(1.8 / sourceHeight);
  model.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);
  const soleProbes = makeSoleProbes(model);
  // Different starting phases prevent the population from marching in unison.
  const phaseOffset = npc ? (pedestrianCount * 0.381966) % 1 : 0;
  let gaitPhase = phaseOffset;
  for (const name of ['walk', 'run']) actions[name]?.play().setEffectiveWeight(0).setEffectiveTimeScale(0);
  if (npc && actions.idle) actions.idle.time = phaseOffset * actions.idle.getClip().duration;
  const { group: weapon, muzzle } = handgun();
  mesh.add(weapon);
  let weaponVisible = !npc;
  weapon.visible = weaponVisible;
  let aimWeight = 0;
  let recoil = 0;
  let wasShooting = false;
  let motionSpeed = 0;
  const rightArmDirection = new THREE.Vector3();
  const leftArmDirection = new THREE.Vector3();
  const rightForearmDirection = new THREE.Vector3();
  const leftForearmDirection = new THREE.Vector3();
  const rootRotation = new THREE.Quaternion();
  const handPosition = new THREE.Vector3();
  const solePosition = new THREE.Vector3();

  function update(dt, { speed = 0, aiming = false, shooting = false, dead = false } = {}) {
    const step = Math.min(dt, 0.1);
    motionSpeed = THREE.MathUtils.damp(motionSpeed, Math.abs(speed), 12, step);
    const movingWeight = THREE.MathUtils.smoothstep(motionSpeed, 0.04, 0.85);
    const runningWeight = THREE.MathUtils.smoothstep(motionSpeed, 2.7, 4.7);
    const strideDuration = THREE.MathUtils.lerp(actions.walk?.getClip().duration ?? 1, actions.run?.getClip().duration ?? 0.7, runningWeight);
    const referenceSpeed = THREE.MathUtils.lerp(1.7, 4.7, runningWeight);
    gaitPhase = (gaitPhase + step * motionSpeed / (referenceSpeed * strideDuration)) % 1;
    actions.idle?.setEffectiveWeight(1 - movingWeight);
    actions.walk?.setEffectiveWeight(movingWeight * (1 - runningWeight));
    actions.run?.setEffectiveWeight(movingWeight * runningWeight);
    for (const name of ['walk', 'run']) if (actions[name]) actions[name].time = gaitPhase * actions[name].getClip().duration;
    mixer.update(step);

    aimWeight = THREE.MathUtils.damp(aimWeight, (aiming || shooting) && weaponVisible ? 1 : 0, 14, step);
    recoil = shooting && !wasShooting ? 0.11 : THREE.MathUtils.damp(recoil, 0, 22, step);
    wasShooting = shooting;
    mesh.updateWorldMatrix(true, true);
    if (!dead && Math.abs(mesh.rotation.z) < 0.2 && soleProbes.length) {
      let soleHeight = Infinity;
      for (const probe of soleProbes) {
        probe.object.getVertexPosition(probe.index, solePosition);
        probe.object.localToWorld(solePosition);
        mesh.worldToLocal(solePosition);
        soleHeight = Math.min(soleHeight, solePosition.y);
      }
      const lift = THREE.MathUtils.clamp(visual.position.y - soleHeight, 0, 0.1);
      visual.position.y = THREE.MathUtils.damp(visual.position.y, lift, lift > visual.position.y ? 35 : 14, step);
      mesh.updateWorldMatrix(false, true);
    }
    mesh.getWorldQuaternion(rootRotation);
    rightArmDirection.set(0.32, -0.36 + recoil, 0.87).normalize().applyQuaternion(rootRotation);
    rightForearmDirection.set(0.3, 0.23 + recoil, 0.92).normalize().applyQuaternion(rootRotation);
    leftArmDirection.set(-0.56, -0.58, 0.59).normalize().applyQuaternion(rootRotation);
    leftForearmDirection.set(-0.35, 0.44, 0.83).normalize().applyQuaternion(rootRotation);
    pointBone(bones.RightArm, bones.RightForeArm, rightArmDirection, aimWeight);
    pointBone(bones.RightForeArm, bones.RightHand, rightForearmDirection, aimWeight);
    pointBone(bones.LeftArm, bones.LeftForeArm, leftArmDirection, aimWeight);
    pointBone(bones.LeftForeArm, bones.LeftHand, leftForearmDirection, aimWeight);

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
