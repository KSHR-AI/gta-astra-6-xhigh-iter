import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createHumanoidAnimator } from './character-animation.js';
import { createCharacterLOD, registerCharacterLODs } from './character-lod.js';
import { createCharacterBounds } from './character-bounds.js';
import { createCharacterFace } from './character-face.js';
import { measureCharacterScale } from './character-scale.js';

let characterAsset;
let pedestrianAsset;
let crowdAsset;
let civilianMaleAsset;
let sidearmAsset;
let pedestrianCount = 0;
let loadingPromise;
const white = new THREE.Color(0xffffff);
const characterScaleReferences = new WeakMap();

function prepareCharacterMaterial(original, { civilian, male, natural, skinTint, hairTint, npc, color, police }) {
  const material = original.clone();
  const authoredCloth = Boolean(original.userData.clothingAuthored && material.roughnessMap);
  const authoredTrousers = authoredCloth && Boolean(original.userData.trousersAuthored);
  // Retain the source's baked textile, seams and normal maps at oblique angles.
  for (const texture of new Set([material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.specularColorMap, material.specularIntensityMap])) {
    if (!texture) continue;
    texture.anisotropy = 8;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.needsUpdate = true;
  }
  if (original.userData.naturalHuman) {
    material.envMapIntensity = 0.72;
    material.metalness = 0;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.skinTint = { value: skinTint };
      shader.uniforms.hairTint = { value: hairTint };
      shader.vertexShader = `attribute float _skin_mask;\nattribute float _hair_mask;\nvarying float vSkinRegion;\nvarying float vHairRegion;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSkinRegion = _skin_mask;\nvHairRegion = _hair_mask;');
      shader.fragmentShader = `uniform vec3 skinTint;\nuniform vec3 hairTint;\nvarying float vSkinRegion;\nvarying float vHairRegion;\n${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        diffuseColor.rgb *= mix(vec3(1.0), skinTint, vSkinRegion);
        // The atlas already carries strand colour and its darkest creases.
        // Multiplicative variation keeps those details without a grey lift.
        diffuseColor.rgb *= mix(vec3(1.0), hairTint, clamp(vHairRegion, 0.0, 1.0));
      `);
      // Skin, hair and eyes share an atlas but retain their authored roughness
      // and normal response. Do not flatten either map into a region constant.
    };
    material.customProgramCacheKey = () => 'natural-human-skin-hair-v4';
    return material;
  }
  material.color.copy(white);
  material.envMapIntensity = civilian ? 0.65 : 0.85;
  if (!authoredCloth) material.normalScale?.setScalar(civilian ? 0.85 : 1.12);
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
  const referenceLuminance = Number.isFinite(original.userData.shirtDyeLuminance) && original.userData.shirtDyeLuminance > .001
    ? original.userData.shirtDyeLuminance : male ? .222696 : .123442;
  const shirtDyeScale = (male ? .65 + referenceLuminance * 2.25 : .45 + referenceLuminance) / referenceLuminance;
  const wardrobe = new THREE.Color(police ? 0x172b43 : color ?? (npc ? 0x647078 : 0x384c58));
  const femaleTrouserMask = 'smoothstep(0.18, 0.42, diffuseColor.g) * smoothstep(0.16, 0.38, diffuseColor.r - diffuseColor.b) * smoothstep(0.12, 0.30, diffuseColor.g - diffuseColor.b)';
  material.roughness = authoredCloth ? 1 : male ? 0.82 : civilian ? 0.9 : 0.72;
  // The imported civilian's metalness factor was 0.5, making skin look metallic.
  material.metalness = civilian ? 0 : 0.14;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wardrobeColor = { value: wardrobe };
    shader.uniforms.shirtDyeScale = { value: shirtDyeScale };
    shader.uniforms.skinTint = { value: skinTint };
    shader.fragmentShader = `uniform vec3 wardrobeColor;\nuniform float shirtDyeScale;\nuniform vec3 skinTint;\n${shader.fragmentShader}`;
    if (male) {
      shader.vertexShader = `attribute float clothDye;\nattribute float trouserRegion;\nvarying float vClothDye;\nvarying float vTrouserRegion;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvClothDye = clothDye;\nvTrouserRegion = trouserRegion;');
      shader.fragmentShader = `varying float vClothDye;\nvarying float vTrouserRegion;\n${shader.fragmentShader}`;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      float wardrobeMask = ${authoredCloth
        ? male || authoredTrousers ? 'clamp(texture2D(roughnessMap, vRoughnessMapUv).r, 0.0, 1.0)'
          : `max(clamp(texture2D(roughnessMap, vRoughnessMapUv).r, 0.0, 1.0), ${femaleTrouserMask})`
        : male
        ? 'vClothDye * (1.0 - smoothstep(0.08, 0.18, (max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b)) / max(max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b), 0.001))) * smoothstep(0.025, 0.09, diffuseColor.g)'
        : civilian
        ? femaleTrouserMask
        : 'smoothstep(0.10, 0.24, diffuseColor.r - diffuseColor.b) * smoothstep(0.035, 0.12, diffuseColor.g - diffuseColor.b)'};
      float sourceLuminance = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
      float skinMask = ${authoredCloth ? 'clamp(texture2D(roughnessMap, vRoughnessMapUv).b, 0.0, 1.0) * (1.0 - wardrobeMask)' : natural ? `smoothstep(0.22, 0.36, (diffuseColor.r - diffuseColor.g) / max(diffuseColor.r, 0.001))
        * smoothstep(0.30, 0.46, (diffuseColor.r - diffuseColor.b) / max(diffuseColor.r, 0.001))
        * smoothstep(0.002, 0.012, sourceLuminance) * (1.0 - wardrobeMask)` : `smoothstep(0.018, 0.075, diffuseColor.r - diffuseColor.b)
        * smoothstep(0.006, 0.035, diffuseColor.r - diffuseColor.g)
        * smoothstep(0.025, 0.13, sourceLuminance) * (1.0 - wardrobeMask)`};
      vec3 dyedSurface = ${authoredCloth ? 'diffuseColor.rgb * wardrobeColor * shirtDyeScale' : `wardrobeColor * (${male ? '0.65 + sourceLuminance * 2.25' : civilian ? '0.45 + sourceLuminance' : '0.45 + sourceLuminance * 1.75'})`};
      diffuseColor.rgb = mix(diffuseColor.rgb, dyedSurface, wardrobeMask * ${civilian ? '0.94' : '0.88'});
      ${natural ? `// Match exposed hands/neck to the new phototextured head while
      // retaining the original body's surface detail and clothing texture.
      // Linear RGB references are sampled at each new head's actual neck cut.
      // Relative chroma above recognizes both source skin palettes, including
      // Michelle's dark albedo; absolute brightness thresholds missed it.
      // The male front-neck seam samples source luminance 0.36203. Normalize
      // its tonal transfer there to the actual new neck median, retaining the
      // source's relative texture variation away from the join.
      vec3 matchedSkin = ${male ? 'vec3(0.7682, 0.4260, 0.2705) * ((0.74 + sourceLuminance * 0.70) / 0.99342)' : 'vec3(0.6918, 0.4451, 0.3076) * (0.74 + sourceLuminance * 3.5)'} * skinTint;
      diffuseColor.rgb = mix(diffuseColor.rgb, matchedSkin, skinMask);` : ''}
      ${male && !authoredTrousers ? `// Dark fabric still reflects light; preserve texture contrast in shade.
      float trouserMask = vTrouserRegion * (1.0 - smoothstep(0.05, 0.14, sourceLuminance));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.011, 0.013, 0.016) + diffuseColor.rgb * 0.90, trouserMask);` : ''}
    `);
    if (civilian) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        // Authored G contains actual weave/seam roughness. Keep it instead of
        // flattening every cloth pixel to one constant; only skin is softened.
        roughnessFactor = mix(${authoredCloth ? 'roughnessFactor' : 'clamp(roughnessFactor, 0.72, 1.0)'}, ${natural ? '0.64' : '0.56'}, skinMask);
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
  material.customProgramCacheKey = () => `${male ? 'civilian-male' : civilian ? 'civilian' : 'player'}-skin-cloth-${natural ? 'natural' : 'legacy'}-${authoredCloth ? 'authored' : 'source'}-${authoredTrousers ? 'denim' : 'legacy-trousers'}-v4`;
  return material;
}

function prepareMaleClothMask(object) {
  // A bind-space mask excludes the face and shoes even when a texture pixel is
  // neutral gray. It deforms with the skin and is shared by all male instances.
  const geometry = object.geometry;
  if (geometry.hasAttribute('clothDye') && geometry.hasAttribute('trouserRegion')) return;
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox;
  const [minHeight, maxHeight] = object.userData.originalBodyHeight ?? [min.y, max.y];
  const positions = geometry.attributes.position;
  const mask = new Float32Array(positions.count);
  const trousers = new Float32Array(positions.count);
  for (let i = 0; i < mask.length; i++) {
    const height = (positions.getY(i) - minHeight) / (maxHeight - minHeight);
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

export function makeSoleProbes(model) {
  const probes = [];
  const vertex = new THREE.Vector3();
  const directions = [
    { vector: new THREE.Vector3(0, -1, 0), footprintOnly: false },
    { vector: new THREE.Vector3(0, 1, 0), footprintOnly: true },
  ];
  for (const tilt of [.35, .7, 1.05, 1.4, 1.75, 2.1, 2.45, 2.8]) {
    for (let i = 0; i < 16; i++) {
      const angle = i * Math.PI / 8;
      directions.push({
        vector: new THREE.Vector3(Math.sin(tilt) * Math.cos(angle), -Math.cos(tilt), Math.sin(tilt) * Math.sin(angle)),
        footprintOnly: tilt > Math.PI / 2,
      });
    }
  }
  model.traverse((object) => {
    if (!object.isSkinnedMesh) return;
    const candidates = new Map();
    // Retopology retains some unused vertex payload. Only rendered shoe
    // vertices may define contact; a removed triangle cannot support a foot.
    const indices = object.geometry.index
      ? new Set(object.geometry.index.array)
      : Array.from({ length: object.geometry.attributes.position.count }, (_, i) => i);
    for (const index of indices) {
      object.getVertexPosition(index, vertex);
      object.localToWorld(vertex);
      if (vertex.y >= .20) continue;
      const joints = object.geometry.attributes.skinIndex, weights = object.geometry.attributes.skinWeight;
      let strongest = 0;
      for (let i = 1; i < 4; i++) if (weights.getComponent(index, i) > weights.getComponent(index, strongest)) strongest = i;
      const joint = object.skeleton.bones[joints.getComponent(index, strongest)]?.name ?? '';
      if (/Leg$/.test(joint)) continue;
      const side = /Left/.test(joint) ? 'Left' : /Right/.test(joint) ? 'Right' : vertex.x > 0 ? 'Left' : 'Right';
      // A retargeted idle may cross the centre line. Classify the shoe by its
      // skinning joint, never by vertex X. Separate heel and articulated toe
      // support so a toe bend cannot reveal an unsampled interior extremum.
      const key = `${side}:${joint}`;
      if (!candidates.has(key)) candidates.set(key, { side, vertices: [] });
      candidates.get(key).vertices.push({ index, position: vertex.clone() });
    }
    for (const { side, vertices } of candidates.values()) {
      const selected = new Map();
      // Contact is a support extremum, not a farthest-point coverage problem.
      // Cover the outsole plus the upper toe/heel silhouette: a shoe pitches
      // during a stride, and its upper toe can cross a curb before its sole.
      // Downward-only probes missed that footprint by 8 mm at neutral scale.
      for (const direction of directions) {
        let maximum = -Infinity, extreme;
        for (const candidate of vertices) {
          const distance = candidate.position.dot(direction.vector);
          if (distance > maximum) { maximum = distance; extreme = candidate.index; }
        }
        if (extreme !== undefined) selected.set(extreme, (selected.get(extreme) ?? true) && direction.footprintOnly);
      }
      for (const [index, footprintOnly] of selected) probes.push({ object, index, side, footprintOnly });
    }
  });
  return probes;
}

/** Load once before creating the player and population. All assets are served locally. */
export async function loadCharacterAssets() {
  if (!loadingPromise) {
    const loader = new GLTFLoader();
    const naturalOrLegacy = (natural, legacy) => loader.loadAsync(natural)
      .then(async (asset) => {
        asset.naturalHuman = true;
        try {
          const response = await fetch(natural.replace('.glb', '.lod.json'));
          if (response.ok) registerCharacterLODs(asset, await response.json());
        } catch { /* The original quality model remains fully usable offline. */ }
        return asset;
      })
      .catch(() => loader.loadAsync(legacy));
    loadingPromise = Promise.allSettled([
      loader.loadAsync('/models/Soldier.glb'),
      Promise.all([
        naturalOrLegacy('/models/CivilianFemaleNatural.glb', '/models/Michelle.glb'),
        loadLocomotion('/models/pedestrian-motion.json'),
      ]),
      loader.loadAsync('/models/Michelle-crowd.glb'),
      Promise.all([
        naturalOrLegacy('/models/CivilianMaleNatural.glb', '/models/CivilianMale.glb'),
        loadLocomotion('/models/civilian-male-motion.json'),
      ]),
      loader.loadAsync('/models/character_sidearm.glb'),
    ]).then(([main, pedestrian, crowd, male, sidearm]) => {
        if (main.status === 'fulfilled') characterAsset = main.value;
        if (pedestrian.status === 'fulfilled') {
          pedestrianAsset = pedestrian.value[0];
          pedestrianAsset.animations = pedestrian.value[1];
          if (pedestrianAsset.naturalHuman) crowdAsset = pedestrianAsset;
          else if (crowd.status === 'fulfilled') {
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

/** Calibrate the skull once, then read small posed combat volumes from bones. */
function createHitVolumeReader(mesh, model, bones) {
  const headBounds = new THREE.Box3(), vertex = new THREE.Vector3();
  model.updateMatrixWorld(true);
  model.traverse(object => {
    if (!object.isSkinnedMesh || !bones.Head) return;
    const headIndex = object.skeleton.bones.indexOf(bones.Head);
    if (headIndex < 0) return;
    const indices = object.geometry.attributes.skinIndex, weights = object.geometry.attributes.skinWeight;
    const hair = object.geometry.attributes._hair_mask;
    for (let index = 0; index < indices.count; index++) {
      let headWeight = 0;
      for (let component = 0; component < 4; component++) {
        if (indices.getComponent(index, component) === headIndex) headWeight += weights.getComponent(index, component);
      }
      // A ponytail and the neck seam must not move the skull's center away
      // from the visible face. Both natural and legacy heads retain weights.
      if (headWeight < 0.8 || hair?.getX(index) > 0.5) continue;
      object.getVertexPosition(index, vertex);
      object.localToWorld(vertex);
      headBounds.expandByPoint(vertex);
    }
  });
  const headNode = bones.Head ?? bones.Neck ?? mesh;
  const headScale = headNode.getWorldScale(new THREE.Vector3());
  const initialScale = Math.max(Math.abs(headScale.x), Math.abs(headScale.y), Math.abs(headScale.z));
  const headCenter = headBounds.isEmpty()
    ? headNode.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.12, 0))
    : headBounds.getCenter(new THREE.Vector3());
  const headSize = headBounds.isEmpty() ? new THREE.Vector3(0.26, 0.28, 0.26) : headBounds.getSize(new THREE.Vector3());
  const headRadius = (Math.max(headSize.x, headSize.y, headSize.z) * 0.5 + 0.015) / initialScale;
  headNode.worldToLocal(headCenter);
  const rootScale = mesh.getWorldScale(new THREE.Vector3());
  const scaleAtSetup = Math.max(Math.abs(rootScale.x), Math.abs(rootScale.y), Math.abs(rootScale.z));
  const shoulderWidth = bones.LeftArm && bones.RightArm
    ? bones.LeftArm.getWorldPosition(new THREE.Vector3()).distanceTo(bones.RightArm.getWorldPosition(new THREE.Vector3())) : 0.36;
  const torsoRadius = THREE.MathUtils.clamp(shoulderWidth * 0.5 + 0.025, 0.18, 0.25) / scaleAtSetup;
  return () => {
    // Fresh vectors make this a read-only snapshot: ray tests may retain or
    // inspect it without sharing mutable scratch data with the next shot.
    const scale = headNode.getWorldScale(new THREE.Vector3());
    const bodyScale = mesh.getWorldScale(new THREE.Vector3());
    return {
      spheres: [{ center: headNode.localToWorld(headCenter.clone()), radius: headRadius * Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)) }],
      capsules: [{ start: (bones.Hips ?? mesh).getWorldPosition(new THREE.Vector3()),
        end: (bones.Spine2 ?? bones.Neck ?? mesh).getWorldPosition(new THREE.Vector3()),
        radius: torsoRadius * Math.max(Math.abs(bodyScale.x), Math.abs(bodyScale.y), Math.abs(bodyScale.z)) }],
    };
  };
}

/**
 * Grounded 1.8 m character. The root's +Z axis is forward.
 * Each clone has its own skeleton, materials, mixer, and animation state.
 */
export function createCharacter({ npc = false, color, police = false, groundHeightAt } = {}) {
  if (!characterAsset && !pedestrianAsset && !civilianMaleAsset) return createFallbackCharacter({ npc, color, police });

  const mesh = new THREE.Group();
  const variant = npc ? pedestrianCount++ : 0;
  const male = Boolean(civilianMaleAsset && (!npc || police || !pedestrianAsset || variant % 2 === 0));
  const civilian = male || Boolean(pedestrianAsset);
  const asset = male ? civilianMaleAsset : civilian ? (npc && crowdAsset ? crowdAsset : pedestrianAsset) : characterAsset;
  // Loaded source scenes are immutable; measure their authored neutral stature
  // once, before a clone's crouched setup clip or accessories alter its extent.
  let scaleReference = characterScaleReferences.get(asset);
  if (!scaleReference) {
    scaleReference = measureCharacterScale(asset.scene, 1);
    if (!scaleReference) return createFallbackCharacter({ npc, color, police });
    characterScaleReferences.set(asset, scaleReference);
  }
  const natural = Boolean(asset.naturalHuman);
  const skinTones = [[1, 1, 1], [0.90, 0.82, 0.72], [0.67, 0.48, 0.34], [0.43, 0.28, 0.19], [0.84, 0.73, 0.57], [0.96, 0.91, 0.85]];
  const hairTones = [[1.0, 0.66, 0.39], [0.44, 0.43, 0.42], [1.4, 0.64, 0.29], [1.8, 1.7, 1.55]];
  const skinTint = new THREE.Color(...skinTones[npc ? Math.floor(variant / 2) % skinTones.length : 0]);
  const hairTint = new THREE.Color(...hairTones[npc ? Math.floor(variant / 2) % hairTones.length : 0]);
  const wardrobeColors = [0x6d6757, 0x375c66, 0x824b49, 0x46594b, 0x74627a, 0x858074];
  color ??= npc ? wardrobeColors[Math.floor(variant / 2) % wardrobeColors.length] : 0x495761;
  mesh.name = police ? 'Police officer' : npc ? 'Pedestrian' : 'Astra';
  mesh.userData.characterAsset = natural ? `MakeHuman CC0 ${male ? 'male' : 'female'} / ${male ? 'CivilianMaleNatural.glb' : 'CivilianFemaleNatural.glb'}` : male ? 'EmoPreben Bald Man / CivilianMale.glb' : civilian ? (npc && crowdAsset ? 'Mixamo Michelle / Michelle-crowd.glb' : 'Mixamo Michelle / Michelle.glb') : 'Mixamo Vanguard / Soldier.glb';
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
    if (male && !object.userData.naturalHuman) prepareMaleClothMask(object);
    object.castShadow = true;
    object.receiveShadow = true;
    // Skinned limbs can extend outside the static bind-pose bounds.
    object.frustumCulled = false;
    const recolor = (original) => {
      const material = prepareCharacterMaterial(original, { civilian, male, natural, skinTint, hairTint, npc, color, police });
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
  const height = male ? (npc ? [1.78, 1.84, 1.72, 1.88][Math.floor(variant / 2) % 4] : 1.82) : npc ? [1.69, 1.76, 1.72, 1.64][Math.floor(variant / 2) % 4] : 1.76;
  visual.scale.setScalar(height / scaleReference.referenceHeight);
  model.position.y += scaleReference.offsetY;
  mesh.updateMatrixWorld(true);
  const soleProbes = makeSoleProbes(model);
  if (police && bones.Head) {
    const cap = new THREE.Group();
    cap.name = 'Police uniform cap';
    const navy = new THREE.MeshStandardMaterial({ color: 0x13283f, roughness: 0.88 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xe4bc62, metalness: 0.7, roughness: 0.4 });
    const crown = new THREE.Mesh(male
      ? new THREE.CylinderGeometry(.0875 * .91, .0875, .075, 24)
      : new THREE.CylinderGeometry(.15, .165, .065, 12), navy);
    if (male) crown.scale.z = .225 / .175;
    const brim = new THREE.Mesh(male
      ? new THREE.BoxGeometry(.185, .009, .080)
      : new THREE.BoxGeometry(.27, .013, .1), navy);
    brim.position.set(0, male ? -.030 : -.027, male ? .120 : .105);
    if (male) brim.rotation.x = .10;
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.027, 0.032, 0.008), gold);
    badge.position.set(0, .005, male ? .108 : .138);
    cap.add(crown, brim, badge);
    const headScale = bones.Head.getWorldScale(new THREE.Vector3()).y;
    const capScale = (male ? height / 1.82 : 1) / headScale;
    cap.scale.setScalar(capScale);
    // Measured against the fitted scalp in the Head bone's identity bind frame.
    // The old fixed center perched a 330 mm crown above the top of the skull.
    cap.position.set(male ? .0006 : 0, male ? .1735 : .29, male ? .0066 : 0).multiplyScalar(capScale);
    for (const part of [crown, brim, badge]) {
      part.castShadow = true;
      part.receiveShadow = true;
    }
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
    mesh, visual, bones, actions, mixer, weapon, magazine, soleProbes, restPose, bindHeadOrientation, npc, groundHeightAt,
    phaseOffset: npc ? ((variant + 1) * 0.381966) % 1 : 0,
  });
  animator.update(0);
  const lod = createCharacterLOD(model, mesh, { enabled: npc });
  const face = createCharacterFace(model, mesh, { seed: npc ? variant + 2 : 1 });
  const renderBounds = createCharacterBounds(model, mesh, { height });
  const getHitVolumes = createHitVolumeReader(mesh, model, bones);
  return {
    mesh, mixer, weapon, muzzle,
    updateLOD(camera) { animator.flushPose(); const level = lod.update(camera); face.update(camera, level); renderBounds.update(); return level; },
    getLODInfo() { return { ...lod.getInfo(), culling: renderBounds.getInfo() }; },
    update(dt, options) { animator.update(dt, options); face.advance(dt, options); },
    advance(dt, options) { animator.advance(dt, options); face.advance(dt, options); },
    flushPose: animator.flushPose,
    resetGrounding: animator.resetGrounding,
    getEvaluationStats: animator.getEvaluationStats,
    seatOffset: animator.seatOffset,
    seatAnchor: animator.seatAnchor,
    setWeapon: animator.setWeapon,
    reactToHit: animator.reactToHit,
    getPoseInfo: animator.getPoseInfo,
    getFootContactSurfaces: animator.getFootContactSurfaces,
    getAimState: animator.getAimState,
    applyShot: animator.applyShot,
    getFaceInfo: face.getInfo,
    getAttentionInfo: animator.getAttentionInfo,
    getLookPosition(target = new THREE.Vector3()) {
      if (face.getEyePosition(target)) return target;
      mesh.getWorldPosition(target); target.y += height * .9; return target;
    },
    getHitVolumes() { animator.flushPose(); return getHitVolumes(); },
    setVisible(visible) { mesh.visible = Boolean(visible); },
    getMuzzlePosition(target = new THREE.Vector3()) { animator.flushPose(); return muzzle.getWorldPosition(target); },
    getMuzzleDirection(target = new THREE.Vector3()) {
      animator.flushPose(); weapon.updateWorldMatrix(true, false);
      return target.set(0, 0, 1).transformDirection(weapon.matrixWorld);
    },
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
  const upperBody = new THREE.Group(); upperBody.position.y = 0.94; visual.add(upperBody);
  capsule(0.18, 0.33, cloth, upperBody, [0, 0.28, 0]);
  capsule(0.115, 0.11, skin, upperBody, [0, 0.65, 0]);
  capsule(0.125, 0.055, black, upperBody, [0, 0.74, -0.025]);
  const limbs = [];
  for (const side of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(side * 0.105, 0.94, 0); visual.add(thigh);
    capsule(0.085, 0.25, denim, thigh, [0, -0.18, 0]);
    const shin = new THREE.Group(); shin.position.y = -0.36; thigh.add(shin);
    capsule(0.074, 0.29, denim, shin, [0, -0.21, 0]);
    capsule(0.08, 0.11, black, shin, [0, -0.47, 0.045]).rotation.x = Math.PI / 2;
    const arm = new THREE.Group(); arm.position.set(side * 0.22, 0.46, 0); upperBody.add(arm);
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
  let aimWeight = 0, recoil = 0, recoilVelocity = 0, lastShotId = 0, wasShooting = false;
  let localAimYaw = 0, localAimPitch = 0, aimTarget = null, aimBlocked = true;
  const rootQuaternion = new THREE.Quaternion(), parentQuaternion = new THREE.Quaternion(), aimQuaternion = new THREE.Quaternion();
  const direction = new THREE.Vector3(), localDirection = new THREE.Vector3(), origin = new THREE.Vector3();
  const aimEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const aimState = { ready:false, raised:0, angleError:0, yaw:0, pitch:0, yawClamped:false, reachLimited:false, recoil:0 };
  const seatOffset = new THREE.Vector3(0, -0.94, 0);
  function aimFrom(point) {
    mesh.getWorldQuaternion(rootQuaternion);
    direction.set(Math.sin(localAimYaw)*Math.cos(localAimPitch), Math.sin(localAimPitch), Math.cos(localAimYaw)*Math.cos(localAimPitch)).applyQuaternion(rootQuaternion);
    if (aimTarget && aimTarget.distanceToSquared(point)>1e-10) direction.copy(aimTarget).sub(point).normalize();
    localDirection.copy(direction).applyQuaternion(aimQuaternion.copy(rootQuaternion).invert());
    const yaw=Math.atan2(localDirection.x,localDirection.z), pitch=Math.atan2(localDirection.y,Math.hypot(localDirection.x,localDirection.z));
    return { yaw:THREE.MathUtils.clamp(yaw,-1.35,1.35), pitch:THREE.MathUtils.clamp(pitch,-1.1,1.1), yawClamped:Math.abs(yaw)>1.35 };
  }
  function refreshAim() {
    let angles=aimFrom(weapon.getWorldPosition(origin));
    if (weapon.visible && !aimBlocked) {
      // Keep the simple articulated hand attachment, but make its barrel use
      // the same world target as the full rig. A second pass accounts for the
      // muzzle's small offset from the wrist during close-range convergence.
      for(let pass=0;pass<2;pass++) {
        angles=aimFrom(pass ? muzzle.getWorldPosition(origin) : weapon.getWorldPosition(origin));
        aimEuler.set((1-aimWeight)*.58-angles.pitch*aimWeight-recoil,angles.yaw*aimWeight,0,'YXZ');
        aimQuaternion.setFromEuler(aimEuler).premultiply(rootQuaternion);
        weapon.parent.getWorldQuaternion(parentQuaternion).invert();
        weapon.quaternion.copy(parentQuaternion).multiply(aimQuaternion);
        weapon.updateWorldMatrix(true,true);
      }
    }
    aimFrom(muzzle.getWorldPosition(origin));
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(weapon.getWorldQuaternion(parentQuaternion));
    const angleError=forward.angleTo(direction);
    Object.assign(aimState,{ready:weapon.visible&&!aimBlocked&&aimWeight>=.94&&angleError<=Math.PI/60,
      raised:aimWeight,angleError,yaw:angles.yaw,pitch:angles.pitch,yawClamped:angles.yawClamped,recoil});
  }
  function applyShot(id) {
    if (!Number.isFinite(id)||id<=lastShotId||!weapon.visible||aimBlocked)return false;
    lastShotId=id; recoil=Math.min(.12,recoil+.012); recoilVelocity+=3.1;
    // Accepted-shot feedback refreshes only the attached weapon. No animation
    // clock, gait, landing, hit reaction, or interaction state advances here.
    refreshAim(); return true;
  }
  return {
    mesh, weapon, muzzle, seatOffset, seatAnchor: 'pelvis',
    advance(dt, options) { this.update(dt, options); },
    flushPose() { return false; },
    update(dt, { speed = 0, armed = weaponVisible, aiming = false, shooting = false, shotId, dead = false, seated = false, steering = 0, jumping = false, verticalVelocity = 0, reloading = false, reloadProgress = 0, aimYaw = 0, aimPitch = 0, aimTarget:target, interactionProgress = 0, interactionPhase = '', hit = false } = {}) {
      const step = Math.min(dt, 0.1); time += step * (Math.abs(speed) > 3.7 ? 11 : 7);
      const interacting = interactionPhase === 'enter' || interactionPhase === 'exit';
      const seatWeight = interacting ? (interactionPhase === 'enter' ? THREE.MathUtils.smoothstep(interactionProgress, 0.22, 1) : 1 - THREE.MathUtils.smoothstep(interactionProgress, 0, 0.78)) : seated ? 1 : 0;
      localAimYaw=aimYaw; localAimPitch=aimPitch; aimTarget=target?.isVector3?target.clone():null;
      aimBlocked=reloading||dead||seated||interacting||!armed;
      aimWeight=THREE.MathUtils.damp(aimWeight,weaponVisible&&!aimBlocked&&(aiming||shooting)?1:0,12,step);
      const recoilSteps=Math.max(1,Math.ceil(step*120)), recoilStep=step/recoilSteps;
      for(let i=0;i<recoilSteps;i++) {
        recoilVelocity+=(-420*recoil-31*recoilVelocity)*recoilStep;
        recoil=THREE.MathUtils.clamp(recoil+recoilVelocity*recoilStep,-.008,.12);
      }
      const airborne = jumping || Math.abs(verticalVelocity) > 0.2;
      if (wasJumping && !airborne) landing = 1; wasJumping = airborne;
      landing = THREE.MathUtils.damp(landing, 0, 8, step);
      if (hit) hitWeight = 1; hitWeight = THREE.MathUtils.damp(hitWeight, 0, 6, step);
      const stride = Math.min(Math.abs(speed) / 4, 0.8) * (1 - seatWeight);
      const angles=aimFrom(upperBody.getWorldPosition(origin));
      for (const limb of limbs) {
        limb.thigh.rotation.x = Math.sin(time) * stride * limb.side - seatWeight * 1.4 - (airborne ? 0.6 : landing * 0.18);
        limb.shin.rotation.x = seatWeight * 0.9 + (airborne ? 1.0 : landing * 0.4);
        limb.arm.rotation.x = seatWeight ? dead ? 0.15 : -1.2 : reloading ? -0.9 : THREE.MathUtils.lerp(-Math.sin(time)*stride*limb.side,-Math.PI/2-angles.pitch-recoil,aimWeight);
        limb.arm.rotation.z = seatWeight ? steering * 0.15 : 0;
        limb.forearm.rotation.x = reloading ? -0.5 - Math.sin(reloadProgress * Math.PI) * 0.4 : seatWeight ? -0.3 : -0.1;
      }
      visual.position.copy(seatOffset).multiplyScalar(seatWeight); visual.position.y -= landing * 0.08;
      visual.rotation.set(hitWeight * 0.18, interacting ? -Math.sin(interactionProgress * Math.PI) * 0.35 : 0, dead ? -(1 - seatWeight) * Math.PI / 2 : 0);
      upperBody.rotation.set(dead?seatWeight*.55:0,angles.yaw*aimWeight*(1-seatWeight),0);
      weapon.visible = weaponVisible && armed && !dead && !seated && !interacting;
      if (aimBlocked)weapon.rotation.set(Math.PI/2,0,0);
      mesh.userData.animationState = dead ? 'down' : interacting ? interactionPhase : seated ? 'driving' : reloading ? 'reloading' : airborne ? 'airborne' : aiming||shooting ? 'aiming' : speed > 0.1 ? 'walking' : 'idle';
      refreshAim();
      if(shooting&&(Number.isFinite(shotId)?shotId>lastShotId:!wasShooting))applyShot(Number.isFinite(shotId)?shotId:lastShotId+1);
      wasShooting=shooting;
    },
    applyShot,
    getAimState() { return {...aimState}; },
    setWeapon(visible) { weaponVisible = Boolean(visible); weapon.visible = weaponVisible; refreshAim(); },
    setVisible(visible) { mesh.visible = Boolean(visible); },
    reactToHit(strength = 1) { hitWeight = strength; },
    getPoseInfo() { return { state: mesh.userData.animationState, pelvis: [0, 0.94 + visual.position.y, 0], aim:{...aimState}, recoil }; },
    getFootContactSurfaces() { return null; },
    getFaceInfo() { return { supported: false, meshes: 0, active: false, blinkLeft: 0, blinkRight: 0, samples: 0, writes: 0 }; },
    getHitVolumes() {
      const scale = visual.getWorldScale(new THREE.Vector3());
      const radiusScale = Math.max(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
      return {
        spheres: [{ center: upperBody.localToWorld(new THREE.Vector3(0, 0.69, 0)), radius: 0.17 * radiusScale }],
        capsules: [{ start: upperBody.localToWorld(new THREE.Vector3(0, 0.115, 0)),
          end: upperBody.localToWorld(new THREE.Vector3(0, 0.445, 0)), radius: 0.18 * radiusScale }],
      };
    },
    getMuzzlePosition(target = new THREE.Vector3()) { return muzzle.getWorldPosition(target); },
    getMuzzleDirection(target = new THREE.Vector3()) { return target.set(0,0,1).applyQuaternion(weapon.getWorldQuaternion(new THREE.Quaternion())).normalize(); },
  };
}
