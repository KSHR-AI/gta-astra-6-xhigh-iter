import * as THREE from 'three';

// These are the six shader states reachable in the existing game. Light
// intensities/positions are uniforms; clone their actual transforms without
// changing gameplay time, real light visibility, or capturing another map.
export function warmKnownEffectVariants({ renderer, camera, scene, materials, retainedMaterials,
  sun, hemisphere, streetLights, headlights, dayEnvironment, nightEnvironment }) {
  if (!sun?.isDirectionalLight || !hemisphere?.isHemisphereLight ||
      streetLights.length !== 4 || headlights.length !== 2 ||
      streetLights.some(light => !light.isPointLight) || headlights.some(light => !light.isSpotLight) ||
      !dayEnvironment?.isTexture) throw new Error('Unexpected shot-effect lighting setup');
  const base = [sun, hemisphere];
  const modes = [
    { lights: base, environment: dayEnvironment },
    { lights: [...base, ...streetLights], environment: nightEnvironment || dayEnvironment },
    { lights: [...base, ...streetLights, ...headlights], environment: nightEnvironment || dayEnvironment },
  ];
  const variants = modes.flatMap(mode => [true, false].map(shadowEnabled => ({ ...mode, shadowEnabled })));
  return drawEffectVariants({ renderer, camera, scene, materials, retainedMaterials, variants });
}

// Retain the single-current-state entry point for isolated verification.
export function warmCurrentEffectVariant(options) {
  const { renderer, camera, scene } = options;
  const lights = [];
  scene.traverseVisible(light => {
    if (light.isLight && light.layers.test(camera.layers)) lights.push(light);
  });
  return drawEffectVariants({ ...options, variants: [{ lights, environment: scene.environment,
    shadowEnabled: renderer.shadowMap.enabled }] });
}

function drawEffectVariants({ renderer, camera, scene, materials, retainedMaterials, variants }) {
  if (renderer.getContext().isContextLost()) return false;
  const saved = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    xr: renderer.xr.enabled, shadowEnabled: renderer.shadowMap.enabled, autoShadow: renderer.shadowMap.autoUpdate, shadowUpdate: renderer.shadowMap.needsUpdate,
  };
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const warm = new THREE.Scene(), ownedGeometry = [], leased = [];
  warm.fog = scene.fog;
  warm.environment = scene.environment;
  warm.environmentRotation.copy(scene.environmentRotation);
  warm.environmentIntensity = scene.environmentIntensity;
  const view = camera.clone();
  view.position.set(0, 0, 1); view.quaternion.identity(); view.updateMatrixWorld(true);
  function material(kind) {
    const value = retainedMaterials ? retainedMaterials[kind] : materials.acquire(kind);
    if (value && !retainedMaterials) leased.push(value);
    return value;
  }
  function geometry(value) { ownedGeometry.push(value); return value; }
  try {
    const copies = new Map();
    for (const light of new Set(variants.flatMap(variant => variant.lights))) {
      // Never reparent actual lights. Match their world transforms and shader
      // counts without owning any of the original scene's GPU resources.
      light.updateWorldMatrix(true, false);
      const copy = light.clone(false);
      light.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      if (light.target && copy.target) {
        light.target.updateWorldMatrix(true, false);
        copy.target.position.setFromMatrixPosition(light.target.matrixWorld);
        copy.target.updateMatrixWorld(true);
      }
      warm.add(copy); copies.set(light, copy);
    }
    const flash = material('flash'), shell = material('shell');
    const tracer = material('tracer'), particle = material('particle');
    if (!flash || !shell || !tracer || !particle) return false;
    const objects = [
      new THREE.Sprite(flash),
      new THREE.Mesh(geometry(new THREE.CylinderGeometry(.007, .007, .024, 6)), shell),
      new THREE.Line(geometry(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.1, 0, 0), new THREE.Vector3(.1, 0, 0),
      ])), tracer),
      new THREE.Mesh(geometry(new THREE.SphereGeometry(.025, 4, 4)), particle),
    ];
    for (const object of objects) { object.frustumCulled = false; object.layers.mask = view.layers.mask; warm.add(object); }
    // Match the non-XR HDR scene pass. Do not allocate cloned shadow maps;
    // enabled is selected per variant, while the actual shadow type is kept.
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(target);
    // Actual hidden draws force Three's first-use reflection/info-log checks.
    // Browser profiling must still establish whether driver work remains; tiny
    // overlapping geometry does not guarantee fragments for every family.
    for (const variant of variants) {
      if (renderer.getContext().isContextLost()) return false;
      const visible = new Set(variant.lights);
      for (const [original, copy] of copies) copy.visible = visible.has(original);
      warm.environment = variant.environment;
      renderer.shadowMap.enabled = variant.shadowEnabled;
      // Unlit families also have light counts/shadow flags in Three's key,
      // but do not automatically react to changes in light-state version.
      // Force key evaluation so each retained owner holds every variant.
      for (const object of objects) object.material.needsUpdate = true;
      renderer.render(warm, view);
    }
    return !renderer.getContext().isContextLost();
  } finally {
    renderer.setRenderTarget(saved.target, saved.face, saved.mip);
    renderer.xr.enabled = saved.xr;
    renderer.shadowMap.enabled = saved.shadowEnabled;
    renderer.shadowMap.autoUpdate = saved.autoShadow;
    renderer.shadowMap.needsUpdate = saved.shadowUpdate;
    warm.clear();
    for (const item of ownedGeometry) item.dispose();
    // Sprite.geometry is globally shared by Three; never dispose it here.
    for (const value of leased) materials.release(value);
    target.dispose();
  }
}

/** Run once after each environment rebuild, before simulation resumes. */
export function createEffectShaderWarmup({ renderer, prepare, materials, onError = () => {} }) {
  // Four dedicated leases retain global program-cache references even when
  // live transient effects overflow the normal pool. The pool still owns them.
  let retainedMaterials = null;
  function retainMaterials() {
    if (!materials || retainedMaterials) return retainedMaterials;
    const next = {};
    try {
      for (const kind of ['flash', 'shell', 'tracer', 'particle']) {
        const value = materials.acquire(kind);
        if (!value) throw new Error('Unable to retain shot-effect material');
        next[kind] = value;
      }
      retainedMaterials = next;
      return next;
    } catch (failure) {
      for (const value of Object.values(next)) materials.release(value);
      throw failure;
    }
  }
  let revision = null, attempted = null, warms = 0, error = null, disposed = false;
  const lost = () => renderer.getContext().isContextLost();
  return {
    update(nextRevision) {
      if (disposed || lost()) return false;
      if (revision === nextRevision) return true;
      if (attempted === nextRevision && error) return true;
      attempted = nextRevision; error = null;
      try {
        const prepared = prepare(retainMaterials());
        if (disposed || lost()) return false;
        if (!prepared) throw new Error('Unable to prepare shot effects');
        revision = nextRevision; warms++;
        return true;
      } catch (failure) {
        if (disposed || lost()) return false;
        error = failure instanceof Error ? failure.message : String(failure);
        // Warmup is an optimization: keep normal rendering available if it
        // fails, and avoid repeating the failed attempt on every frame.
        onError(failure);
        return true;
      }
    },
    getInfo() {
      return { ready: !disposed && !lost() && revision !== null && revision === attempted && !error,
        revision, warms, error, disposed };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (retainedMaterials) for (const value of Object.values(retainedMaterials)) materials.release(value);
      retainedMaterials = null;
    },
  };
}
