import * as THREE from 'three';

/**
 * PMREM outputs contain only GPU-rendered pixels. Unlike their retained HDR
 * sources, those pixels cannot be uploaded again after a WebGL context loss.
 * Rebuild all three maps before publishing them or advancing the visible game.
 */
export function createEnvironmentLighting({ renderer, captureVehicleCube, apply,
  createPMREM = () => new THREE.PMREMGenerator(renderer) }) {
  const canvas = renderer.domElement;
  let source, targets, pending = false, disposed = false, error = null;
  let builds = 0, restores = 0;
  const lost = () => renderer.getContext().isContextLost();
  const maps = value => ({ day: value?.day.texture ?? null,
    night: value?.night.texture ?? null, vehicle: value?.vehicle.texture ?? null });
  const disposeTargets = value => {
    for (const target of new Set(Object.values(value ?? {}))) target?.dispose();
  };
  const onLost = event => { event.preventDefault(); pending = true; error = null; };
  const onRestored = () => {
    if (disposed) return;
    restores++; pending = true; error = null; renderer.shadowMap.needsUpdate = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    setSky(value) {
      if (disposed) return;
      source = value; pending = true; error = null;
    },
    update() {
      if (disposed || lost() || !source?.texture || error) return false;
      if (!pending) return Boolean(targets);
      const sky = source;
      const renderTarget = renderer.getRenderTarget(), cubeFace = renderer.getActiveCubeFace();
      const mipLevel = renderer.getActiveMipmapLevel(), xrEnabled = renderer.xr.enabled;
      let pmrem, capture, publishing = false;
      const next = {};
      try {
        pmrem = createPMREM();
        next.day = pmrem.fromEquirectangular(sky.lightingTexture || sky.texture);
        next.night = sky.nightTexture ? pmrem.fromEquirectangular(sky.nightTexture) : next.day;
        // The capture must use this new day map: the previous one lost its GPU
        // contents, and would bake dark buildings into the replacement map.
        capture = captureVehicleCube(next.day.texture, sky);
        next.vehicle = pmrem.fromCubemap(capture.texture);
        if (disposed || lost()) return false;
        publishing = true; apply(maps(next)); publishing = false;
        disposeTargets(targets); targets = next; pending = false;
        builds++; renderer.shadowMap.needsUpdate = true;
        return true;
      } catch (failure) {
        if (publishing) {
          try { apply(maps(targets)); }
          catch (rollbackFailure) { console.error('Unable to restore previous environment bindings.', rollbackFailure); }
        }
        if (!lost()) {
          error = failure instanceof Error ? failure.message : String(failure);
          console.error('Unable to rebuild environment lighting.', failure);
        }
        return false;
      } finally {
        renderer.xr.enabled = xrEnabled;
        renderer.setRenderTarget(renderTarget, cubeFace, mipLevel);
        if (targets !== next) disposeTargets(next);
        capture?.dispose(); pmrem?.dispose();
        // DataTexture.dispose releases its temporary GPU upload, not its CPU
        // image. The atmosphere's ready result retains those source pixels.
        if (sky.lightingTexture && sky.lightingTexture !== sky.texture) sky.lightingTexture.dispose();
      }
    },
    getInfo() { return { ready: Boolean(targets) && !pending && !error && !disposed,
      pending, builds, restores, error, disposed }; },
    get revision() { return builds; },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      disposeTargets(targets); targets = undefined; source = undefined; pending = false;
    },
  };
}
