import * as THREE from 'three';

// One isolated character depth map supplements the city sun shadow in close photos.
const KEY = 'astra-local-sun-receiver-plane-v1';
const BIAS_MATRIX = new THREE.Matrix4().set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
const DIRECT_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
const BEGIN_DIRECTIONAL = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const END_DIRECTIONAL = '#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )';

export function localSunLightingChunk(chunk = THREE.ShaderChunk.lights_fragment_begin) {
  const begin = chunk.indexOf(BEGIN_DIRECTIONAL), end = chunk.indexOf(END_DIRECTIONAL);
  if (begin < 0 || end <= begin) throw new Error('Unsupported Three directional-light chunk');
  const directional = chunk.slice(begin, end);
  if (directional.split(DIRECT_CALL).length !== 2) throw new Error('Expected exactly one directional RE_Direct call');
  return chunk.slice(0, begin) + directional.replace(DIRECT_CALL, `
    if ( UNROLLED_LOOP_INDEX == astraLocalSunIndex ) {
      directLight.color *= astraLocalSunVisibility();
    }
    ${DIRECT_CALL}`) + chunk.slice(end);
}

const VERTEX_DECLARATIONS = `
uniform mat4 astraLocalSunMatrix;
uniform float astraLocalSunNormalBias;
varying vec4 vAstraLocalSunCoord;
`;
const VERTEX_COORDINATE = `
// transformed includes the same morph, skinning and displacement as the visible mesh.
vec3 astraLocalWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
vec4 astraLocalWorldPosition = modelMatrix * vec4( transformed, 1.0 );
astraLocalWorldPosition.xyz += astraLocalWorldNormal * astraLocalSunNormalBias;
vAstraLocalSunCoord = astraLocalSunMatrix * astraLocalWorldPosition;
`;
const FRAGMENT_DECLARATIONS = `
uniform sampler2D astraLocalSunDepth;
uniform float astraLocalSunEnabled;
uniform float astraLocalSunDepthBias;
uniform vec2 astraLocalSunTexel;
uniform int astraLocalSunIndex;
varying vec4 vAstraLocalSunCoord;
float astraLocalSunVisibility() {
  vec3 coord = vAstraLocalSunCoord.xyz / vAstraLocalSunCoord.w;
  // Derivatives must precede every fragment-dependent return/branch. The
  // current directional-light-index branch is uniform over the draw.
  vec3 dx = dFdx( coord );
  vec3 dy = dFdy( coord );
  vec2 receiverGradient = vec2( 0.0 );
  // Normalize before inversion so the condition guard is independent of
  // magnification. A singular/grazing projection retains constant-bias PCF.
  float uvScale = max( max( abs(dx.x), abs(dx.y) ), max( abs(dy.x), abs(dy.y) ) );
  if ( uvScale > 1e-12 ) {
    dx /= uvScale;
    dy /= uvScale;
    float determinant = dx.x * dy.y - dx.y * dy.x;
    float jacobianSize = dot( dx.xy, dx.xy ) + dot( dy.xy, dy.xy );
    if ( abs(determinant) > 1e-4 * jacobianSize ) {
      vec2 gradient = vec2( dy.y * dx.z - dx.y * dy.z,
                           dx.x * dy.z - dy.x * dx.z ) / determinant;
      // Invalid/absurd derivatives do not create unbounded comparison depths.
      if ( all( lessThan( abs(gradient), vec2(1e4) ) ) ) receiverGradient = gradient;
    }
  }
  if ( astraLocalSunEnabled < 0.5 ) return 1.0;
  // Outside the capture is unshadowed, never a clamped edge/stale texture.
  vec2 guard = astraLocalSunTexel * 1.5;
  if ( coord.z <= 0.0 || coord.z >= 1.0 ||
       any( lessThan( coord.xy, guard ) ) || any( greaterThan( coord.xy, vec2(1.0) - guard ) ) ) return 1.0;
  // Depth is NearestFilter. Correct to the sampled texel's actual center,
  // including the subtexel displacement of the nominal central tap.
  vec2 center = ( floor( coord.xy / astraLocalSunTexel ) + vec2(0.5) ) * astraLocalSunTexel;
  float visibility = 0.0;
  for ( int y = -1; y <= 1; y++ ) {
    for ( int x = -1; x <= 1; x++ ) {
      vec2 sampleUV = center + vec2( float(x), float(y) ) * astraLocalSunTexel;
      // Bound extrapolation near silhouettes/discontinuities. This is signed
      // receiver-plane depth, not an additional constant shadow offset.
      float planeCorrection = clamp( dot( receiverGradient, sampleUV - coord.xy ), -0.02, 0.02 );
      float receiverDepth = coord.z + planeCorrection - astraLocalSunDepthBias;
      float blocker = texture2D( astraLocalSunDepth, sampleUV ).r;
      visibility += step( receiverDepth, blocker );
    }
  }
  return visibility / 9.0;
}
`;

/** Clone so material sharing elsewhere cannot change other actors' lighting. */
export function cloneLocalSunReceiver(source, uniforms) {
  if (!source.isMeshStandardMaterial) throw new Error('Local sun receiver requires Standard/Physical material');
  const material = source.clone();
  // Material.copy omits callbacks; preserve visible-pass behaviour explicitly.
  material.onBeforeRender = source.onBeforeRender;
  const priorCompile = source.onBeforeCompile;
  // Capture the original callback result now: Three's default key reads this.onBeforeCompile.
  // Calling that default on our wrapped material would accidentally key the wrapper instead.
  const priorKey = source.customProgramCacheKey.call(source);
  material.onBeforeCompile = function(shader, renderer) {
    priorCompile.call(this, shader, renderer);
    for (const marker of ['#include <project_vertex>']) {
      if (!shader.vertexShader.includes(marker)) throw new Error(`Missing shader marker: ${marker}`);
    }
    if (!shader.fragmentShader.includes('#include <lights_fragment_begin>')) throw new Error('Lighting hook was already expanded/replaced');
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_COORDINATE}`);
    shader.fragmentShader = FRAGMENT_DECLARATIONS + shader.fragmentShader.replace('#include <lights_fragment_begin>', localSunLightingChunk());
  };
  material.customProgramCacheKey = () => `${priorKey}|${KEY}`;
  material.needsUpdate = true;
  return material;
}

/** World-space conservative bounds; direction points from subject toward the sun. */
export function fitLocalSunCamera(camera, bounds, direction, { resolution = 1024, minSpan = 2.5, padding = .06, depthPadding = .1 } = {}) {
  if (!bounds?.isBox3 || bounds.isEmpty() || ![...bounds.min, ...bounds.max, ...direction].every(Number.isFinite) || direction.lengthSq() < 1e-12) throw new Error('Finite bounds and nonzero sun direction required');
  if (![512, 1024].includes(resolution)) throw new Error('Local shadow resolution must be 512 or 1024');
  if (![minSpan, padding, depthPadding].every(v => Number.isFinite(v) && v > 0)) throw new Error('Positive fit dimensions required');
  const towardSun = direction.clone().normalize();
  camera.position.set(0, 0, 0);
  camera.up.set(0, 1, 0);
  if (Math.abs(towardSun.y) > .999) camera.up.set(0, 0, 1);
  camera.lookAt(towardSun.clone().negate());
  const basis = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
  const inverseBasis = basis.clone().invert();
  const lightBounds = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) lightBounds.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inverseBasis));
  const size = lightBounds.getSize(new THREE.Vector3());
  // A fixed minimum keeps ordinary small pose changes from resizing the map.
  // Larger bounds expand rather than silently clipping outstretched limbs/weapon.
  const span = Math.max(minSpan, size.x + padding * 2, size.y + padding * 2);
  const texelWorld = span / resolution;
  const center = lightBounds.getCenter(new THREE.Vector3());
  center.x = Math.round(center.x / texelWorld) * texelWorld;
  center.y = Math.round(center.y / texelWorld) * texelWorld;
  center.z = lightBounds.max.z + depthPadding;
  camera.position.copy(center.applyMatrix4(basis));
  camera.left = camera.bottom = -span / 2;
  camera.right = camera.top = span / 2;
  camera.near = depthPadding * .5;
  camera.far = size.z + depthPadding * 2;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const matrix = BIAS_MATRIX.clone().multiply(camera.projectionMatrix).multiply(camera.matrixWorldInverse);
  return { matrix, span, texelWorld, near: camera.near, far: camera.far, expanded: span > minSpan };
}

export function makeDepthProxy(source, material) {
  if (!source.isMesh || source.isInstancedMesh || source.isBatchedMesh) throw new Error('Only ordinary/skinned meshes supported');
  const proxy = source.isSkinnedMesh ? new THREE.SkinnedMesh(source.geometry, material) : new THREE.Mesh(source.geometry, material);
  proxy.name = `local-depth:${source.name}`;
  proxy.matrixAutoUpdate = false;
  proxy.matrixWorldAutoUpdate = false;
  proxy.frustumCulled = false;
  proxy.castShadow = proxy.receiveShadow = false;
  syncDepthProxy(source, proxy);
  return proxy;
}

export function syncDepthProxy(source, proxy) {
  proxy.geometry = source.geometry;
  proxy.matrix.copy(source.matrixWorld);
  proxy.matrixWorld.copy(source.matrixWorld);
  proxy.morphTargetInfluences = source.morphTargetInfluences;
  proxy.morphTargetDictionary = source.morphTargetDictionary;
  if (source.isSkinnedMesh) {
    proxy.skeleton = source.skeleton;
    proxy.bindMode = source.bindMode;
    proxy.bindMatrix.copy(source.bindMatrix);
    proxy.bindMatrixInverse.copy(source.bindMatrixInverse);
  }
}

const DEPTH_PROPERTIES = ['map', 'alphaMap', 'alphaTest', 'alphaHash', 'opacity', 'side', 'visible', 'displacementMap', 'displacementScale', 'displacementBias', 'clippingPlanes', 'clipIntersection'];
function castsDepth(material) {
  return material.visible && !(material.transparent && material.alphaTest === 0 && !material.alphaHash);
}
function syncDepthMaterial(source, target) {
  const oldKey = [target.map, target.alphaMap, target.alphaTest > 0, target.alphaHash, target.side, target.displacementMap, target.clippingPlanes?.length];
  for (const property of DEPTH_PROPERTIES) target[property] = source[property];
  // Blend-only surfaces do not have a well-defined binary depth silhouette. Do
  // not invent an alpha threshold for transparent corneas or translucent cloth.
  target.visible = castsDepth(source);
  const newKey = [target.map, target.alphaMap, target.alphaTest > 0, target.alphaHash, target.side, target.displacementMap, target.clippingPlanes?.length];
  if (newKey.some((value, i) => value !== oldKey[i])) target.needsUpdate = true;
}
function makeDepthMaterial(source) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, colorWrite: false, blending: THREE.NoBlending });
  syncDepthMaterial(source, material);
  return material;
}
function visibleInHierarchy(object, root) {
  for (let node = object; node; node = node.parent) {
    if (!node.visible) return false;
    if (node === root) break;
  }
  return true;
}
function materialList(value) { return Array.isArray(value) ? value : [value]; }
function standardSurface(object) {
  return object.isMesh && materialList(object.material).every(material => material?.isMeshStandardMaterial);
}
function selectionOptions({ receiverFilter = standardSurface, casterFilter = standardSurface, extraCasters = [] } = {}) {
  if (typeof receiverFilter !== 'function' || typeof casterFilter !== 'function') throw new Error('Selection filters must be functions');
  if (!Array.isArray(extraCasters) || extraCasters.some(object => !object?.isObject3D)) throw new Error('Extra casters must be Object3D roots');
  return { receiverFilter, casterFilter, extraCasters: [...new Set(extraCasters)] };
}
function sameOptions(a, b) {
  return a && a.receiverFilter === b.receiverFilter && a.casterFilter === b.casterFilter
    && a.extraCasters.length === b.extraCasters.length && a.extraCasters.every((root, i) => root === b.extraCasters[i]);
}
function collectSelection(root, options) {
  const selected = new Map();
  function add(object, receive, cast) {
    if (!object.isMesh || (!receive && !cast)) return;
    const existing = selected.get(object);
    if (existing) { existing.receive ||= receive; existing.cast ||= cast; }
    else selected.set(object, { source: object, receive, cast });
  }
  root.traverse(object => {
    if (object.isMesh) add(object, Boolean(options.receiverFilter(object)), Boolean(options.casterFilter(object)));
  });
  for (const extra of options.extraCasters) extra.traverse(object => {
    if (object.isMesh) add(object, false, Boolean(options.casterFilter(object)));
  });
  return [...selected.values()];
}
function pushAttributeState(out, attribute) {
  if (attribute) out.push(attribute, attribute.version ?? attribute.data?.version ?? 0, attribute.count);
}
const opaqueAlphaCache = new WeakMap();
function assertOpaqueVertexAlpha(source) {
  const color = source.geometry.attributes.color;
  if (color?.itemSize !== 4 || !materialList(source.material).some(material => castsDepth(material) && material.vertexColors)) return;
  // The shipped body GLBs carry RGBA vertex colors with alpha exactly one.
  // Three's depth material omits color chunks, so accept only that proven
  // neutral alpha; retain a hard rejection for meaningful/morphed alpha.
  if (source.geometry.morphAttributes.color?.length) throw new Error('Morphed vertex alpha needs a matching depth hook');
  const version = color.version ?? color.data?.version ?? 0;
  let cached = opaqueAlphaCache.get(color);
  if (!cached || cached.version !== version || cached.count !== color.count) {
    let opaque = true;
    for (let i = 0; i < color.count; i++) if (color.getW(i) !== 1) { opaque = false; break; }
    cached = { version, count: color.count, opaque }; opaqueAlphaCache.set(color, cached);
  }
  if (!cached.opaque) throw new Error('Nonopaque vertex alpha needs a matching depth hook');
}

function appendDepthState(out, source, root) {
  const materials = materialList(source.material);
  const casting = materials.map(castsDepth);
  out.push(source, ...casting);
  // Blend-only eyebrows/lashes cannot affect this binary depth pass. In
  // particular, Three's two-sided transparent pass bumps material.version
  // every display frame; program churn is not a change to depth geometry.
  if (!casting.some(Boolean)) return;
  const geometry = source.geometry;
  out.push(source, geometry, visibleInHierarchy(source, root), geometry.drawRange.start, geometry.drawRange.count, ...source.matrixWorld.elements);
  for (const group of geometry.groups) out.push(group.start, group.count, group.materialIndex);
  pushAttributeState(out, geometry.index);
  for (const attribute of Object.values(geometry.attributes)) pushAttributeState(out, attribute);
  for (const targets of Object.values(geometry.morphAttributes)) for (const attribute of targets) pushAttributeState(out, attribute);
  out.push(geometry.morphTargetsRelative, ...(source.morphTargetInfluences ?? []));
  if (source.isSkinnedMesh) {
    out.push(source.skeleton, source.bindMode, ...source.bindMatrix.elements, ...source.bindMatrixInverse.elements);
    for (let i = 0; i < source.skeleton.bones.length; i++) out.push(...source.skeleton.bones[i].matrixWorld.elements, ...source.skeleton.boneInverses[i].elements);
  }
  for (const material of materials) {
    if (!castsDepth(material)) continue;
    out.push(material.visible, material.transparent, material.side, material.alphaTest, material.alphaHash, material.opacity, material.displacementScale, material.displacementBias, material.clipIntersection);
    for (const texture of [material.map, material.alphaMap, material.displacementMap]) {
      out.push(texture, texture?.version, texture?.source?.version);
      if (texture) {
        if (texture.matrixAutoUpdate) texture.updateMatrix();
        out.push(texture.channel, ...texture.matrix.elements);
      }
    }
    for (const plane of material.clippingPlanes ?? []) out.push(...plane.normal, plane.constant);
  }
}

/**
 * One-actor auxiliary visibility for a frozen, close daylight photo. Call update AFTER displayed-pose,
 * face/morph and world-matrix updates, but BEFORE main-scene rendering.
 * No callbacks that animate the source mesh may run during its later render.
 * The caller owns projected-head-size/photo gating and the correct sun index.
 * active:false releases all receiver references; select again on photo entry.
 * enabled:false is the within-photo A/B switch and deliberately retains clones.
 * Run player-camera-visibility's photo restoration BEFORE select/update.
 * Invoke at a render-pass boundary, with the current target's normal viewport
 * and scissor; arbitrary raw-GL or custom in-pass state is outside this contract.
 */
export function createCharacterSelfShadow(renderer, { resolution = 1024, minSpan = 2.5, normalBias = .0008, depthBias = .00015, directionalLightIndex = 0 } = {}) {
  if (THREE.REVISION !== '180') throw new Error('Revalidate shader contract for this Three version');
  if (renderer.capabilities.logarithmicDepthBuffer || renderer.capabilities.reversedDepthBuffer || renderer.capabilities.reverseDepthBuffer) throw new Error('Local shadows require ordinary linear depth');
  if (![512, 1024].includes(resolution)) throw new Error('Resolution must be 512 or 1024');
  if (!Number.isInteger(directionalLightIndex) || directionalLightIndex < 0) throw new Error('Explicit nonnegative sun index required');
  if (![normalBias, depthBias].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Nonnegative biases required');
  const depthTexture = new THREE.DepthTexture(resolution, resolution, THREE.UnsignedIntType);
  depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(resolution, resolution, { depthTexture, depthBuffer: true, stencilBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  target.texture.generateMipmaps = false;
  const scene = new THREE.Scene(); scene.matrixWorldAutoUpdate = false;
  const camera = new THREE.OrthographicCamera();
  const uniforms = {
    astraLocalSunMatrix: { value: new THREE.Matrix4() },
    astraLocalSunDepth: { value: depthTexture },
    astraLocalSunEnabled: { value: 0 },
    astraLocalSunNormalBias: { value: normalBias },
    astraLocalSunDepthBias: { value: depthBias },
    astraLocalSunTexel: { value: new THREE.Vector2(1 / resolution, 1 / resolution) },
    astraLocalSunIndex: { value: directionalLightIndex },
  };
  let root = null, selection = null, entries = [], lastState = null, disposed = false;
  const stats = { captures: 0, cacheHits: 0, enabled: false, selected: null, submittedMeshes: 0, calls: 0, triangles: 0, resolution, estimatedTargetBytes: resolution * resolution * 8, fit: null, reason: 'unselected' };

  function setBiases(patch = {}) {
    const nextNormal = patch.normalBias === undefined ? uniforms.astraLocalSunNormalBias.value : patch.normalBias;
    const nextDepth = patch.depthBias === undefined ? uniforms.astraLocalSunDepthBias.value : patch.depthBias;
    if (![nextNormal, nextDepth].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Nonnegative biases required');
    if (disposed) throw new Error('Self-shadow helper disposed');
    // Both values affect receiver lookup only. Keep the exact frozen depth
    // capture and shader program while changing receiver lookup settings.
    uniforms.astraLocalSunNormalBias.value = nextNormal;
    uniforms.astraLocalSunDepthBias.value = nextDepth;
  }

  function releaseSelection() {
    uniforms.astraLocalSunEnabled.value = 0;
    // Keep ownership independent of the live material arrays. An appearance
    // controller may replace or reorder a slot while this selection is active.
    const receiverOriginals = new Map(), depthSet = new Set();
    for (const entry of entries) if (entry.receive) {
      entry.receiverSlots.forEach((material, i) => receiverOriginals.set(material, entry.originalSlots[i]));
    }
    for (const entry of entries) {
      if (entry.receive) {
        const current = entry.source.material;
        if (Array.isArray(current)) {
          const restored = current.map(material => receiverOriginals.get(material) ?? material);
          if (restored.some((material, i) => material !== current[i])) {
            entry.source.material = Array.isArray(entry.original) && restored.length === entry.original.length
              && restored.every((material, i) => material === entry.original[i]) ? entry.original : restored;
          }
        } else if (receiverOriginals.has(current)) entry.source.material = receiverOriginals.get(current);
      }
      if (entry.proxy) {
        for (const material of materialList(entry.proxy.material)) depthSet.add(material);
        scene.remove(entry.proxy);
      }
    }
    for (const material of [...receiverOriginals.keys(), ...depthSet]) material.dispose();
    entries = []; lastState = null; root = null; selection = null;
    stats.enabled = false; stats.selected = null; stats.reason = 'unselected';
  }
  function select(nextRoot, options) {
    if (disposed) throw new Error('Self-shadow helper disposed');
    const nextOptions = selectionOptions(options);
    if (root === nextRoot && sameOptions(selection, nextOptions)) return;
    releaseSelection();
    if (!nextRoot) return;
    if (!nextRoot.isObject3D) throw new Error('Selection root must be Object3D');
    const selected = collectSelection(nextRoot, nextOptions);
    // Validate before mutation so errors cannot strand a partially patched actor.
    for (const { source, receive, cast } of selected) {
      if (source.isInstancedMesh || source.isBatchedMesh || (cast && source.customDepthMaterial)) throw new Error('Unsupported actor mesh/custom depth material');
      for (const material of materialList(source.material)) {
        if (receive && !material.isMeshStandardMaterial) throw new Error('Receivers must use Standard/Physical materials');
        if (cast) assertOpaqueVertexAlpha(source);
      }
    }
    root = nextRoot; selection = nextOptions;
    const clones = new Map();
    try {
      for (const item of selected) {
        const { source, receive, cast } = item;
        const original = source.material;
        const receiverList = materialList(original).map(material => {
          if (!receive) return material;
          if (!clones.has(material)) clones.set(material, cloneLocalSunReceiver(material, uniforms));
          return clones.get(material);
        });
        const receivers = Array.isArray(original) ? receiverList : receiverList[0];
        let proxy = null;
        if (cast) {
          const depthList = receiverList.map(makeDepthMaterial);
          proxy = makeDepthProxy(source, Array.isArray(original) ? depthList : depthList[0]);
          scene.add(proxy);
        }
        if (receive) source.material = receivers;
        entries.push({ ...item, original, originalSlots: [...materialList(original)],
          receivers: receive ? receivers : original, receiverSlots: [...receiverList], proxy });
      }
    } catch (error) { releaseSelection(); throw error; }
    stats.selected = nextRoot.name || nextRoot.uuid;
  }

  function update({ active = false, enabled = true, bounds, sunDirection, revision = 0, directionalLightIndex: nextIndex = uniforms.astraLocalSunIndex.value } = {}) {
    if (disposed) throw new Error('Self-shadow helper disposed');
    uniforms.astraLocalSunEnabled.value = 0;
    stats.enabled = false;
    // Gameplay controllers cache material references. Merely disabling the
    // shader would leave those controllers writing detached originals.
    if (!active) { releaseSelection(); stats.reason = 'inactive/released'; return false; }
    if (!root || !visibleInHierarchy(root, null)) { stats.reason = 'hidden/unselected'; return false; }
    if (!Number.isInteger(nextIndex) || nextIndex < 0) throw new Error('Nonnegative sun index required');
    uniforms.astraLocalSunIndex.value = nextIndex;
    const selected = collectSelection(root, selection);
    if (selected.length !== entries.length || selected.some((item, i) => item.source !== entries[i].source
        || item.receive !== entries[i].receive || item.cast !== entries[i].cast || item.source.material !== entries[i].receivers
        || materialList(item.source.material).length !== entries[i].receiverSlots.length
        || materialList(item.source.material).some((material, j) => material !== entries[i].receiverSlots[j]))) {
      const selectedRoot = root, options = selection; releaseSelection(); select(selectedRoot, options);
    }
    // Preserve the current controller's draw flags while photo owns temporary
    // shader variants. Ordering still matters: camera visibility updates first.
    for (const entry of entries) if (entry.receive) {
      const originals = entry.originalSlots;
      materialList(entry.receivers).forEach((material, i) => {
        material.colorWrite = originals[i].colorWrite;
        material.depthWrite = originals[i].depthWrite;
      });
    }
    if (!enabled) { stats.reason = 'photo A/B disabled'; return false; }
    if (!(bounds?.isBox3 || typeof bounds === 'function')) throw new Error('A bounds box or lazy bounds reader is required');
    const state = [revision, ...sunDirection];
    if (typeof bounds === 'function') state.push(bounds);
    else state.push(...bounds.min, ...bounds.max);
    for (const entry of entries) if (entry.cast) {
      assertOpaqueVertexAlpha(entry.source);
      appendDepthState(state, entry.source, null);
    }
    if (lastState && state.length === lastState.length && state.every((value, i) => value === lastState[i])) {
      uniforms.astraLocalSunEnabled.value = 1; stats.enabled = true; stats.cacheHits++; stats.reason = 'cache'; return false;
    }
    // A failed/partial recapture invalidates the previous texture too.
    lastState = null;
    const captureBounds = typeof bounds === 'function' ? bounds() : bounds;
    const fit = fitLocalSunCamera(camera, captureBounds, sunDirection, { resolution, minSpan });
    uniforms.astraLocalSunMatrix.value.copy(fit.matrix);
    for (const entry of entries) {
      if (!entry.proxy) continue;
      syncDepthProxy(entry.source, entry.proxy);
      entry.proxy.visible = visibleInHierarchy(entry.source, null);
      materialList(entry.source.material).forEach((material, i) => syncDepthMaterial(material, materialList(entry.proxy.material)[i]));
    }
    const saved = {
      target: renderer.getRenderTarget(), cubeFace: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
      clearColor: renderer.getClearColor(new THREE.Color()), clearAlpha: renderer.getClearAlpha(),
      autoClear: renderer.autoClear, xrEnabled: renderer.xr.enabled, shadowEnabled: renderer.shadowMap.enabled, infoAutoReset: renderer.info.autoReset,
    };
    const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
    try {
      renderer.xr.enabled = false;
      renderer.shadowMap.enabled = false;
      renderer.info.autoReset = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      // setRenderTarget uses target.viewport/scissor in physical pixels. Calling
      // setViewport here would incorrectly multiply them by renderer pixel ratio.
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
    } finally {
      // No global viewport/scissor setters are changed during this pass.
      renderer.setRenderTarget(saved.target, saved.cubeFace, saved.mip);
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
      renderer.autoClear = saved.autoClear;
      renderer.xr.enabled = saved.xrEnabled;
      renderer.shadowMap.enabled = saved.shadowEnabled;
      renderer.info.autoReset = saved.infoAutoReset;
    }
    stats.calls = renderer.info.render.calls - calls;
    stats.triangles = renderer.info.render.triangles - triangles;
    stats.submittedMeshes = entries.filter(entry => entry.proxy?.visible && materialList(entry.proxy.material).some(material => material.visible)).length;
    stats.fit = { span: fit.span, texelWorld: fit.texelWorld, near: fit.near, far: fit.far, expanded: fit.expanded };
    stats.captures++; stats.enabled = true; stats.reason = 'captured';
    lastState = state;
    uniforms.astraLocalSunEnabled.value = 1;
    return true;
  }
  return {
    select, update, setBiases, release: releaseSelection,
    getInfo: () => ({ ...stats, normalBias: uniforms.astraLocalSunNormalBias.value, depthBias: uniforms.astraLocalSunDepthBias.value, fit: stats.fit && { ...stats.fit } }),
    dispose() { if (disposed) return; releaseSelection(); target.dispose(); disposed = true; },
  };
}
