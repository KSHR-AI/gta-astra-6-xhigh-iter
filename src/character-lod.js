import * as THREE from 'three';

const levelsByGeometry = new WeakMap();
const geometryCache = new WeakMap();
const referenceFov = Math.tan(55 * Math.PI / 360);
const cameraPosition = new THREE.Vector3();
const characterPosition = new THREE.Vector3();

/** FOV-aware distance means zooming a photo camera restores facial detail. */
export function chooseCharacterLOD(distance, fov = 55, current = 0) {
  const apparentDistance = Math.max(0, distance) * Math.tan(Math.min(120, Math.max(1, fov)) * Math.PI / 360) / referenceFov;
  const boundaries = [14, 30];
  let level = current;
  while (level < 2 && apparentDistance > boundaries[level] * 1.15) level++;
  while (level > 0 && apparentDistance < boundaries[level - 1] * 0.85) level--;
  return level;
}

/** Missing or stale optional LOD data never prevents the original model loading. */
export function registerCharacterLODs(asset, data) {
  if (data?.version !== 1 || !Array.isArray(data.meshes)) return 0;
  let registered = 0;
  asset.scene.traverse(object => {
    if (!object.isSkinnedMesh) return;
    const association = asset.parser.associations.get(object);
    const entry = data.meshes.find(item => item && item.mesh === association?.meshes && item.primitive === association?.primitives);
    const geometry = object.geometry;
    if (!entry || entry.vertices !== geometry.attributes.position.count || !Array.isArray(entry.levels) || entry.levels.length !== 2) return;
    if (entry.levels.some(level => !level || !Array.isArray(level.indices) || !level.indices.length || level.indices.length % 3 || level.indices.some(index => !Number.isInteger(index) || index < 0 || index >= entry.vertices))) return;
    levelsByGeometry.set(geometry, entry.levels);
    registered++;
  });
  return registered;
}

function geometriesFor(base) {
  if (geometryCache.has(base)) return geometryCache.get(base);
  const definitions = levelsByGeometry.get(base);
  if (!definitions) return null;
  const geometries = [base, ...definitions.map(definition => {
    const geometry = new THREE.BufferGeometry();
    // Reuse the exact attributes, including runtime wardrobe masks. Retaining
    // vertex numbers also leaves the animator's sole probes valid at every LOD.
    for (const [name, attribute] of Object.entries(base.attributes)) geometry.setAttribute(name, attribute);
    geometry.morphAttributes = base.morphAttributes;
    geometry.morphTargetsRelative = base.morphTargetsRelative;
    geometry.setIndex(definition.indices);
    geometry.boundingBox = base.boundingBox;
    geometry.boundingSphere = base.boundingSphere;
    return geometry;
  })];
  geometryCache.set(base, geometries);
  return geometries;
}

export function createCharacterLOD(model, root, { enabled = true } = {}) {
  const meshes = [];
  model.traverse(object => {
    if (!object.isSkinnedMesh) return;
    const geometries = geometriesFor(object.geometry);
    if (geometries) meshes.push({ object, geometries });
  });
  let level = 0;
  const info = () => ({ level, meshes: meshes.length, triangles: meshes.reduce((total, item) => {
    const geometry = item.geometries[level];
    return total + (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  }, 0) });
  return {
    update(camera) {
      if (!enabled || !meshes.length || !camera?.isPerspectiveCamera) return level;
      camera.getWorldPosition(cameraPosition);
      root.getWorldPosition(characterPosition);
      const next = chooseCharacterLOD(cameraPosition.distanceTo(characterPosition), camera.fov, level);
      if (next !== level) {
        level = next;
        for (const item of meshes) item.object.geometry = item.geometries[level];
      }
      root.userData.characterLOD = level;
      return level;
    },
    getInfo: info,
  };
}
