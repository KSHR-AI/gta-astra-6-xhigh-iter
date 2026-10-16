import * as THREE from 'three';

// A free camera over the live scene. Entry freezes simulation in main.js; this
// controller never moves actors or changes their saved gameplay state.
export function createPhotoMode({ camera, renderer, rendering, canvas, bounds, ui }) {
  const settings = { fov: 50, roll: 0, exposure: 1, focus: 8, aperture: 0, hideUI: false };
  const direction = new THREE.Vector3(), right = new THREE.Vector3();
  const rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  let saved, captureRequested = false, busy = false;
  const clamp = THREE.MathUtils.clamp;
  function apply() {
    camera.fov = settings.fov;
    camera.updateProjectionMatrix();
    camera.quaternion.setFromEuler(rotation);
    camera.rotateZ(THREE.MathUtils.degToRad(settings.roll));
    renderer.toneMappingExposure = saved.exposure * settings.exposure;
    rendering.setLens(settings.focus, settings.aperture);
    ui.updatePhoto(settings);
  }
  return {
    get active() { return Boolean(saved); },
    get settings() { return { ...settings }; },
    enter() {
      if (saved) return;
      saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(),
        fov: camera.fov, exposure: renderer.toneMappingExposure, ratio: renderer.getPixelRatio() };
      rotation.setFromQuaternion(camera.quaternion, 'YXZ');
      rotation.z = 0;
      Object.assign(settings, { fov: camera.fov, roll: 0, exposure: 1, focus: 8, aperture: 0, hideUI: false });
      // A still photograph can afford native resolution, even in a CPU preview.
      renderer.setPixelRatio(Math.max(saved.ratio, Math.min(devicePixelRatio, 1.5)));
      rendering.setPhotoQuality(true); rendering.resize();
      ui.setPhotoMode(true);
      apply();
    },
    exit() {
      if (!saved) return;
      camera.position.copy(saved.position); camera.quaternion.copy(saved.quaternion);
      camera.fov = saved.fov; camera.updateProjectionMatrix();
      renderer.toneMappingExposure = saved.exposure;
      renderer.setPixelRatio(saved.ratio); rendering.setPhotoQuality(false); rendering.resize(); rendering.setLens(8, 0);
      saved = undefined; captureRequested = false;
      ui.setPhotoMode(false);
    },
    change(patch) {
      if (!saved) return;
      for (const [key, min, max] of [['fov',20,90],['roll',-20,20],['exposure',.5,1.8],['focus',1,80],['aperture',0,1]]) {
        if (Number.isFinite(patch[key])) settings[key] = clamp(patch[key], min, max);
      }
      if (typeof patch.hideUI === 'boolean') settings.hideUI = patch.hideUI;
      apply();
    },
    reset() {
      if (!saved) return;
      camera.position.copy(saved.position); rotation.setFromQuaternion(saved.quaternion, 'YXZ'); rotation.z = 0;
      Object.assign(settings, { fov: saved.fov, roll: 0, exposure: 1, focus: 8, aperture: 0, hideUI: false });
      apply();
    },
    look(dx, dy) {
      if (!saved) return;
      rotation.y -= dx * .003;
      rotation.x = clamp(rotation.x - dy * .003, -Math.PI * .48, Math.PI * .48);
      apply();
    },
    update(dt, keys) {
      if (!saved) return;
      const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
      const lateral = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
      const vertical = Number(keys.has('KeyE')) - Number(keys.has('KeyQ'));
      if (!(forward || lateral || vertical)) return;
      const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 20 : 5) * dt;
      camera.getWorldDirection(direction);
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      camera.position.addScaledVector(direction, forward * speed).addScaledVector(right, lateral * speed);
      camera.position.y = clamp(camera.position.y + vertical * speed, .25, 100);
      camera.position.x = clamp(camera.position.x, bounds.minX - 40, bounds.maxX + 40);
      camera.position.z = clamp(camera.position.z, bounds.minZ - 40, bounds.maxZ + 40);
    },
    capture() {
      if (!saved || busy) return;
      captureRequested = true; ui.photoStatus('Preparing photograph…');
    },
    afterRender() {
      if (!captureRequested || busy) return;
      captureRequested = false; busy = true;
      // Read immediately after rendering, before the browser discards the buffer.
      try { canvas.toBlob(blob => {
        busy = false;
        if (!blob) { ui.photoStatus('Could not save this photograph. Try again.'); return; }
        try {
          const url = URL.createObjectURL(blob), link = document.createElement('a');
          link.href = url; link.download = `Grand-Theft-Astra-${new Date().toISOString().replace(/[:.]/g,'-')}.png`;
          setTimeout(() => URL.revokeObjectURL(url), 30000); link.click();
          ui.photoStatus('Photograph saved · PNG');
        } catch { ui.photoStatus('Could not download this photograph. Try again.'); }
      }, 'image/png'); }
      catch { busy = false; ui.photoStatus('Could not save this photograph. Try again.'); }
    },
  };
}
