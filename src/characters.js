import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createHumanoidAnimator } from './character-animation.js';

let characterAsset;
let pedestrianAsset;
let crowdAsset;
let civilianMaleAsset;
let sidearmAsset;
let pedestrianCount = 0;
let loadingPromise;
const white = new THREE.Color(0xffffff);

function prepareCharacterMaterial(original, { civilian, male, npc, color, police }) {
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
  // UV V was flipped for glTF without altering the original bitmap, so the
  // tangent-space bitangent must flip too to preserve the sculpted normal detail.
  if (male && material.normalScale) material.normalScale.y *= -1;
  if (material.name.includes('Visor')) {
    material.color.set(0x839aa5);
    material.metalness = 0.62;
    material.roughness = 0.21;
    return material;
  }

  // Dye the civilian fabric while preserving skin, hair and baked textile detail.
  const wardrobe = new THREE.Color(police ? 0x172b43 : color ?? (npc ? 0x647078 : 0x384c58));
  material.roughness = male ? 0.82 : civilian ? 0.9 : 0.72;
  // The imported civilian's metalness factor was 0.5, making skin look metallic.
  material.metalness = civilian ? 0 : 0.14;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wardrobeColor = { value: wardrobe };
    shader.fragmentShader = `uniform vec3 wardrobeColor;\n${shader.fragmentShader}`;
    if (male) {
      shader.vertexShader = `attribute float clothDye;\nattribute float trouserRegion;\nvarying float vClothDye;\nvarying float vTrouserRegion;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothDye = clothDye;\nvTrouserRegion = trouserRegion;');
      shader.fragmentShader = `varying float vClothDye;\nvarying float vTrouserRegion;\n${shader.fragmentShader}`;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float wardrobeMask = ${male
        ? 'vClothDye * (1.0 - smoothstep(0.08, 0.18, (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b)) / max(max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b), 0.001))) * smoothstep(0.025, 0.09, diffuseColor.g)'
        : civilian
        ? 'smoothstep(0.18, 0.42, diffuseColor.g) * smoothstep(0.16, 0.38, diffuseColor.r - diffuseColor.b) * smoothstep(0.12, 0.30, diffuseColor.g - diffuseColor.b)'
        : 'smoothstep(0.10, 0.24, diffuseColor.r - diffuseColor.b) * smoothstep(0.035, 0.12, diffuseColor.g - diffuseColor.b)'};
      float sourceLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float skinMask = smoothstep(0.018, 0.075, diffuseColor.r - diffuseColor.b)
        * smoothstep(0.006, 0.035, diffuseColor.r - diffuseColor.g)
        * smoothstep(0.025, 0.13, sourceLuminance) * (1.0 - wardrobeMask);
      vec3 dyedSurface = wardrobeColor * (${male ? '0.65 + sourceLuminance * 2.25' : civilian ? '0.45 + sourceLuminance' : '0.45 + sourceLuminance * 1.75'});
      diffuseColor.rgb = mix(diffuseColor.rgb, dyedSurface, wardrobeMask * ${civilian ? '0.94' : '0.88'});
      ${male ? `// Dark fabric still reflects light; preserve texture contrast in shade.
      float trouserMask = vTrouserRegion * (1.0 - smoothstep(0.05, 0.14, sourceLuminance));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.011, 0.013, 0.016) + diffuseColor.rgb * 0.90, trouserMask);` : ''}
    `);
    if (civilian) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        // Skin has a broad soft highlight; woven clothing remains matte.
        roughnessFactor = mix(${male ? '0.86' : '0.90'}, 0.56, skinMask);
      `);
    } else {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(0.94, 0.53, wardrobeMask);
      `).replace('#include <metalnessmap_fragment>', `
        #include <metalnessmap_fragment>
        metalnessFactor = mix(0.015, 0.27, wardrobeMask);
      `);
    }
  };
  material.customProgramCacheKey = () => male ? 'civilian-male-skin-cloth-v2' : civilian ? 'civilian-skin-cloth-v2' : 'player-armor-v1';
  return material;
}

function prepareMaleClothMask(object) {
  // A bind-space mask excludes the face and shoes even when a texture pixel is
  // neutral gray. It deforms with the skin and is shared by all male instances.
  const geometry = object.geometry;
  if (geometry.hasAttribute('clothDye') && geometry.hasAttribute('trouserRegion')) return;
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const positions = geometry.attributes.position;
  const mask = new Float32Array(positions.count);
  const trousers = new Float32Array(positions.count);
  for (let i = 0; i < mask.length; i++) {
    const height = (positions.getY(i) - min.y) / (max.y - min.y);
    mask[i] = THREE.MathUtils.smoothstep(height, 0.46, 0.51) * (1 - THREE.MathUtils.smoothstep(height, 0.81, 0.84));
    trousers[i] = THREE.MathUtils.smoothstep(height, 0.07, 0.14) * (1 - THREE.MathUtils.smoothstep(height, 0.49, 0.55));
  }
  geometry.setAttribute('clothDye', new THREE.BufferAttribute(mask, 1));
  geometry.setAttribute('trouserRegion', new THREE.BufferAttribute(trousers, 1));
}

function parseLocomotion(clips) {
  return clips.map((clip) => THREE.AnimationClip.parse({
    ...clip,
    // Unmapped end bones keep their bind pose, rather than receiving empty tracks.
    tracks: clip.tracks.filter((track) => track.times.length && track.values.length === track.times.length * (track.type.toLowerCase() === 'quaternion' ? 4 : 3)),
  }));
}

async function loadLocomotion(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Character animation request failed: ${path}`);
  return parseLocomotion(await response.json());
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
        loadLocomotion('/models/pedestrian-motion.json'),
      ]),
      loader.loadAsync('/models/Michelle-crowd.glb'),
      Promise.all([
        loader.loadAsync('/models/CivilianMale.glb'),
        loadLocomotion('/models/civilian-male-motion.json'),
      ]),
      loader.loadAsync('/models/character_sidearm.glb'),
    ]).then(([main, pedestrian, crowd, male, sidearm]) => {
        if (main.status === 'fulfilled') characterAsset = main.value;
        if (pedestrian.status === 'fulfilled') {
          pedestrianAsset = pedestrian.value[0];
          pedestrianAsset.animations = pedestrian.value[1];
          if (crowd.status === 'fulfilled') {
            crowdAsset = crowd.value;
            crowdAsset.animations = pedestrianAsset.animations;
          }
        }
        if (male.status === 'fulfilled') {
          civilianMaleAsset = male.value[0];
          civilianMaleAsset.animations = male.value[1];
        }
        if (sidearm.status === 'fulfilled') sidearmAsset = sidearm.value;
        if (!civilianMaleAsset && !pedestrianAsset && !characterAsset) throw main.reason;
        return { loaded: true, animations: (civilianMaleAsset ?? pedestrianAsset ?? characterAsset).animations.map((clip) => clip.name), variants: civilianMaleAsset && pedestrianAsset ? 12 : pedestrianAsset ? 6 : 1, crowdOptimized: Boolean(crowdAsset), civilianMale: Boolean(civilianMaleAsset) };
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
  if (sidearmAsset) {
    // Center of the contoured grip cross-section at the palm's height.
    group.userData.gripCenter = [0, -0.046, -0.037];
    const model = sidearmAsset.scene.clone(true);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    group.add(model);
    const muzzle = new THREE.Object3D();
    muzzle.name = 'Muzzle';
    muzzle.position.set(0, 0.024, 0.202);
    group.add(muzzle);
    return { group, muzzle };
  }
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

/**
 * Grounded 1.8 m character. The root's +Z axis is forward.
 * Each clone has its own skeleton, materials, mixer, and animation state.
 */
export function createCharacter({ npc = false, color, police = false } = {}) {
  if (!characterAsset && !pedestrianAsset && !civilianMaleAsset) return createFallbackCharacter({ npc, color, police });

  const mesh = new THREE.Group();
  const variant = npc ? pedestrianCount++ : 0;
  const male = Boolean(civilianMaleAsset && (!npc || police || !pedestrianAsset || variant % 2 === 0));
  const civilian = male || Boolean(pedestrianAsset);
  const asset = male ? civilianMaleAsset : civilian ? (npc && crowdAsset ? crowdAsset : pedestrianAsset) : characterAsset;
  const wardrobeColors = [0x6d6757, 0x375c66, 0x824b49, 0x46594b, 0x74627a, 0x858074];
  color ??= npc ? wardrobeColors[Math.floor(variant / 2) % wardrobeColors.length] : 0x495761;
  mesh.name = police ? 'Police officer' : npc ? 'Pedestrian' : 'Astra';
  mesh.userData.characterAsset = male ? 'EmoPreben Bald Man / CivilianMale.glb' : civilian ? (npc && crowdAsset ? 'Mixamo Michelle / Michelle-crowd.glb' : 'Mixamo Michelle / Michelle.glb') : 'Mixamo Vanguard / Soldier.glb';
  const visual = new THREE.Group();
  mesh.add(visual);
  const model = cloneSkeleton(asset.scene);
  // The source model faces -Z. Keep the gameplay convention uniformly +Z.
  model.rotation.y = civilian ? 0 : Math.PI;
  visual.add(model);
  const bones = {};
  const restPose = {};
  const materials = [];
  model.traverse((object) => {
    if (object.isBone || /^mixamorig[:_]?/i.test(object.name)) {
      const name = object.name.replace(/.*mixamorig[:_]?/i, '');
      bones[name] = object;
      restPose[name] = object.quaternion.clone();
    }
    if (!object.isMesh) return;
    if (male) prepareMaleClothMask(object);
    object.castShadow = true;
    object.receiveShadow = true;
    // Skinned limbs can extend outside the static bind-pose bounds.
    object.frustumCulled = false;
    const recolor = (original) => {
      const material = prepareCharacterMaterial(original, { civilian, male, npc, color, police });
      materials.push(material);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(recolor) : recolor(object.material);
  });

  // Head-tip bones are not anatomically vertical on every imported rig. Keep
  // the authored bind orientation before mocap changes the neck/head chain.
  const bindHeadOrientation = bones.Head
    ? mesh.getWorldQuaternion(new THREE.Quaternion()).invert()
      .multiply(bones.Head.getWorldQuaternion(new THREE.Quaternion()))
    : null;
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
  const height = male ? (npc ? [1.78, 1.84, 1.72, 1.88][Math.floor(variant / 2) % 4] : 1.82) : npc ? [1.69, 1.76, 1.72, 1.64][Math.floor(variant / 2) % 4] : 1.76;
  visual.scale.setScalar(height / sourceHeight);
  model.position.y -= bounds.min.y;
  mesh.updateMatrixWorld(true);
  const soleProbes = makeSoleProbes(model);
  if (police && bones.Head) {
    const cap = new THREE.Group();
    cap.name = 'Police uniform cap';
    const navy = new THREE.MeshStandardMaterial({ color: 0x13283f, roughness: 0.88 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe4bc62, metalness: 0.7, roughness: 0.4 });
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.165, 0.065, 12), navy);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.013, 0.1), navy);
    brim.position.set(0, -0.027, 0.105);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.032, 0.008), gold);
    badge.position.set(0, 0.005, 0.138);
    cap.add(crown, brim, badge);
    const headScale = bones.Head.getWorldScale(new THREE.Vector3()).y;
    cap.scale.setScalar(1 / headScale);
    cap.position.y = (male ? 0.235 : 0.29) / headScale;
    bones.Head.add(cap);
    materials.push(navy, gold);
  }
  const { group: weapon, muzzle } = handgun();
  mesh.add(weapon);
  const magazine = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.085, 0.042), new THREE.MeshStandardMaterial({ color: 0x282c30, metalness: 0.65, roughness: 0.48 }));
  magazine.name = 'Reload magazine';
  magazine.visible = false;
  mesh.add(magazine);
  const animator = createHumanoidAnimator({
    mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, bindHeadOrientation, npc,
    phaseOffset: npc ? ((variant + 1) * 0.381966) % 1 : 0,
  });
  animator.update(0);
  return {
    mesh, mixer, weapon, muzzle,
    update: animator.update,
    seatOffset: animator.seatOffset,
    seatAnchor: animator.seatAnchor,
    setWeapon: animator.setWeapon,
    reactToHit: animator.reactToHit,
    getPoseInfo: animator.getPoseInfo,
    setVisible(visible) { mesh.visible = Boolean(visible); },
    getMuzzlePosition(target = new THREE.Vector3()) { return muzzle.getWorldPosition(target); },
    dispose() { mixer.stopAllAction(); materials.forEach((material) => material.dispose()); },
  };
}

// Articulated network-failure fallback uses the same interaction/driver contract.
function createFallbackCharacter({ npc, color, police }) {
  const mesh = new THREE.Group();
  const visual = new THREE.Group();
  mesh.add(visual);
  mesh.name = npc ? 'Civilian fallback' : 'Astra fallback';
  mesh.userData.characterAsset = 'Articulated fallback';
  const cloth = new THREE.MeshStandardMaterial({ color: police ? 0x172b43 : color ?? 0x384c58, roughness: 0.9 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x283245, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x81583d, roughness: 0.85 });
  const black = new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.8 });
  function capsule(radius, length, material, parent, position) {
    const item = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 5, 9), material);
    item.position.set(...position); item.castShadow = true; item.receiveShadow = true; parent.add(item); return item;
  }
  capsule(0.18, 0.33, cloth, visual, [0, 1.22, 0]);
  capsule(0.115, 0.11, skin, visual, [0, 1.59, 0]);
  capsule(0.125, 0.055, black, visual, [0, 1.68, -0.025]);
  const limbs = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(side * 0.105, 0.94, 0); visual.add(thigh);
    capsule(0.085, 0.25, denim, thigh, [0, -0.18, 0]);
    const shin = new THREE.Group(); shin.position.y = -0.36; thigh.add(shin);
    capsule(0.074, 0.29, denim, shin, [0, -0.21, 0]);
    capsule(0.08, 0.11, black, shin, [0, -0.47, 0.045]).rotation.x = Math.PI / 2;
    const arm = new THREE.Group(); arm.position.set(side * 0.22, 1.4, 0); visual.add(arm);
    capsule(0.065, 0.17, cloth, arm, [0, -0.14, 0]);
    const forearm = new THREE.Group(); forearm.position.y = -0.27; arm.add(forearm);
    capsule(0.057, 0.14, cloth, forearm, [0, -0.12, 0]);
    const hand = new THREE.Group(); hand.position.y = -0.24; forearm.add(hand);
    capsule(0.052, 0.065, skin, hand, [0, 0, 0]);
    limbs.push({ thigh, shin, arm, forearm, hand, side });
  }
  const { group: weapon, muzzle } = handgun();
  limbs[0].hand.add(weapon); weapon.rotation.x = Math.PI / 2;
  let time = 0, weaponVisible = false, hitWeight = 0, wasJumping = false, landing = 0;
  const seatOffset = new THREE.Vector3(0, -0.94, 0);
  return {
    mesh, weapon, muzzle, seatOffset, seatAnchor: 'pelvis',
    update(dt, { speed = 0, aiming = false, shooting = false, dead = false, seated = false, steering = 0, jumping = false, verticalVelocity = 0, reloading = false, reloadProgress = 0, aimPitch = 0, interactionProgress = 0, interactionPhase = '', hit = false } = {}) {
      const step = Math.min(dt, 0.1); time += step * (Math.abs(speed) > 3.7 ? 11 : 7);
      const interacting = interactionPhase === 'enter' || interactionPhase === 'exit';
      const seatWeight = interacting ? (interactionPhase === 'enter' ? THREE.MathUtils.smoothstep(interactionProgress, 0.22, 1) : 1 - THREE.MathUtils.smoothstep(interactionProgress, 0, 0.78)) : seated ? 1 : 0;
      const airborne = jumping || Math.abs(verticalVelocity) > 0.2;
      if (wasJumping && !airborne) landing = 1; wasJumping = airborne;
      landing = THREE.MathUtils.damp(landing, 0, 8, step);
      if (hit) hitWeight = 1; hitWeight = THREE.MathUtils.damp(hitWeight, 0, 6, step);
      const stride = Math.min(Math.abs(speed) / 4, 0.8) * (1 - seatWeight);
      for (const limb of limbs) {
        limb.thigh.rotation.x = Math.sin(time) * stride * limb.side - seatWeight * 1.4 - (airborne ? 0.6 : landing * 0.18);
        limb.shin.rotation.x = seatWeight * 0.9 + (airborne ? 1.0 : landing * 0.4);
        limb.arm.rotation.x = seatWeight ? -1.2 : reloading ? -0.9 : (aiming || shooting) ? -Math.PI / 2 - aimPitch : -Math.sin(time) * stride * limb.side;
        limb.arm.rotation.z = seatWeight ? steering * 0.15 : 0;
        limb.forearm.rotation.x = reloading ? -0.5 - Math.sin(reloadProgress * Math.PI) * 0.4 : seatWeight ? -0.3 : -0.1;
      }
      visual.position.copy(seatOffset).multiplyScalar(seatWeight); visual.position.y -= landing * 0.08;
      visual.rotation.set(hitWeight * 0.18, interacting ? -Math.sin(interactionProgress * Math.PI) * 0.35 : 0, dead ? -Math.PI / 2 : 0);
      weapon.visible = weaponVisible && !dead && !seated && !interacting;
      mesh.userData.animationState = dead ? 'down' : interacting ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : speed > 0.1 ? 'walking' : 'idle';
    },
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; },
    setVisible(visible) { mesh.visible = Boolean(visible); },
    reactToHit(strength = 1) { hitWeight = strength; },
    getPoseInfo() { return { state: mesh.userData.animationState, pelvis: [0, 0.94 + visual.position.y, 0] }; },
    getMuzzlePosition(target = new THREE.Vector3()) { return muzzle.getWorldPosition(target); },
  };
}
