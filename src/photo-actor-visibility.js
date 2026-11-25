/**
 * Photo mode freezes the simulation's player-distance pedestrian visibility.
 * Make the current ambient actors available to the free camera, retaining each
 * mesh's native frustum culling and the presentation pass's FOV-aware LOD.
 * Registry membership is lifecycle state: inactive drivers and undeployed
 * officers must never be revealed just because their root is hidden.
 */
export function createPhotoActorVisibility({ pedestrians, vehicles }) {
  const saved = new Map(), eligible = new Set();
  let active = false, disposed = false;

  function collect() {
    eligible.clear();
    for (const pedestrian of pedestrians) if (pedestrian.actor?.mesh) eligible.add(pedestrian.actor.mesh);
    for (const car of vehicles) if (car.driverActive && car.driver?.mesh) eligible.add(car.driver.mesh);
  }

  function update() {
    if (!active || disposed) return;
    collect();
    // A removed/disabled actor belongs to its lifecycle owner now. Forget its
    // old snapshot rather than later resurrecting it on photo exit.
    for (const root of saved.keys()) if (!eligible.has(root)) saved.delete(root);
    for (const root of eligible) {
      if (!saved.has(root)) saved.set(root, root.visible);
      root.visible = true;
    }
  }

  function exit() {
    if (!active) return;
    collect();
    for (const [root, visible] of saved) if (eligible.has(root)) root.visible = visible;
    saved.clear(); eligible.clear(); active = false;
  }

  return {
    enter() {
      if (active || disposed) return;
      active = true; update();
    },
    update,
    exit,
    getInfo() {
      let revealedActors = 0;
      for (const visible of saved.values()) if (!visible) revealedActors++;
      return { active, trackedActors: saved.size, revealedActors, disposed };
    },
    dispose() {
      if (disposed) return;
      exit(); disposed = true;
    },
  };
}
