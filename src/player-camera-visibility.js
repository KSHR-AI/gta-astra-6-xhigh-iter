import * as THREE from 'three';

/**
 * Hide only the player's colour/depth contribution when its camera boom folds
 * into the body. Gameplay visibility, bones, weapons and shadow casters stay
 * intact. Attach once after the complete character and contact shadow exist.
 */
export function createPlayerCameraVisibility(root, {
  hideDistance = .55, restoreDistance = .75, pivotHeight = 1.48,
} = {}) {
  if (!root?.isObject3D) throw new TypeError('Player camera visibility needs an Object3D root.');
  if (![hideDistance, restoreDistance, pivotHeight].every(Number.isFinite)
    || hideDistance < 0 || restoreDistance <= hideDistance || pivotHeight < 0) {
    throw new RangeError('Camera visibility needs finite, ordered distances and a nonnegative pivot height.');
  }

  const materials = new Map(), originals = new Map(), bindings = [];
  function isolate(source) {
    if (!source?.isMaterial) return source;
    if (!materials.has(source)) {
      const material = source.clone();
      // Material.copy does not preserve these callbacks. The authored skin,
      // cloth and hair shaders must keep their existing code and cache keys.
      material.onBeforeCompile = source.onBeforeCompile;
      material.onBeforeRender = source.onBeforeRender;
      material.customProgramCacheKey = source.customProgramCacheKey;
      materials.set(source, { material, colorWrite: source.colorWrite, depthWrite: source.depthWrite });
      originals.set(material, source);
    }
    return materials.get(source).material;
  }
  function visit(object) {
    if (object.name === 'contact-shadow') return;
    if ((object.isMesh || object.isLine || object.isPoints) && object.material) {
      const original = object.material;
      object.material = Array.isArray(original) ? original.map(isolate) : isolate(original);
      bindings.push({ object, original });
    }
    for (const child of object.children) visit(child);
  }
  visit(root);

  const owned = [...materials.values()];
  const maskableCount = owned.filter(record => record.colorWrite || record.depthWrite).length;
  const pivot = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  let hidden = false, proximityHidden = false, distance = null, eligibleLastUpdate = false, disposed = false;

  function setHidden(value) {
    if (hidden === value) return;
    hidden = value;
    for (const record of owned) {
      record.material.colorWrite = value ? false : record.colorWrite;
      record.material.depthWrite = value ? false : record.depthWrite;
    }
    // No transparency, opacity, material.visible or needsUpdate changes. The
    // renderer's separate PCF depth materials retain the full player shadow.
  }
  function getState() {
    return { hidden, distance, materialCount: owned.length,
      maskedMaterialCount: hidden ? maskableCount : 0, disposed };
  }

  return {
    update(camera, { started = true, photoActive = false, inCar = false, interacting = false, paused = false } = {}) {
      if (disposed) return getState();
      if (!started || inCar || interacting) {
        proximityHidden = false;
        eligibleLastUpdate = false; distance = null; setHidden(false);
        return getState();
      }
      if (photoActive) {
        // Photo restores drawing temporarily, not the gameplay hysteresis.
        // Otherwise returning to a paused camera inside the threshold band
        // would lose its hidden state without moving the camera at all.
        eligibleLastUpdate = false; distance = null; setHidden(false);
        return getState();
      }
      // Ordinary pause freezes presentation state. Returning from photo mode
      // still evaluates once against the restored gameplay camera, even when
      // that gameplay session was already paused before entering photo mode.
      if (paused && eligibleLastUpdate) return getState();
      if (!camera?.isCamera) {
        proximityHidden = false;
        eligibleLastUpdate = false; distance = null; setHidden(false);
        return getState();
      }
      root.getWorldPosition(pivot); pivot.y += pivotHeight;
      camera.getWorldPosition(cameraPosition);
      const nextDistance = cameraPosition.distanceTo(pivot);
      if (!Number.isFinite(nextDistance)) {
        proximityHidden = false;
        eligibleLastUpdate = false; distance = null; setHidden(false);
        return getState();
      }
      eligibleLastUpdate = true; distance = nextDistance;
      proximityHidden = proximityHidden ? distance <= restoreDistance : distance < hideDistance;
      setHidden(proximityHidden);
      return getState();
    },
    getState,
    dispose() {
      if (disposed) return;
      setHidden(false);
      // Restore only references still owned by this controller, preserving an
      // external appearance/material replacement performed after attachment.
      for (const { object, original } of bindings) {
        if (Array.isArray(object.material)) {
          const restored = object.material.map(material => originals.get(material) ?? material);
          if (restored.some((material, index) => material !== object.material[index])) {
            object.material = Array.isArray(original) && restored.length === original.length
              && restored.every((material, index) => material === original[index]) ? original : restored;
          }
        } else if (originals.has(object.material)) object.material = originals.get(object.material);
      }
      for (const { material } of owned) material.dispose();
      disposed = true; proximityHidden = false; eligibleLastUpdate = false; distance = null;
    },
  };
}
