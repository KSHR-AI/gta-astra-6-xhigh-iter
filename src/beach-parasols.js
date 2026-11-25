import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Original asset: art/blender/beach_parasol.py/.blend. Each level has three
// shared material batches, independently tintable cloth and baked metre units.
// This owns its LOD matrices; do not also register these with instanceVisibility.
export function createBeachParasols(parent, placements, {
  loader = new GLTFLoader(),
  nearUrl = '/models/city/BeachParasol.glb',
  farUrl = '/models/city/BeachParasol-lod.glb',
  nearDistance = 34,
} = {}) {
  const root = new THREE.Group();
  root.name = 'Original eight-panel beach parasols';
  parent.add(root);
  const matrices = [], colors = [], centers = [];
  const transform = new THREE.Object3D();
  for (const placement of placements) {
    transform.position.set(placement.x, placement.y ?? 0, placement.z);
    transform.rotation.set(0, placement.yaw ?? 0, 0);
    transform.scale.setScalar(placement.scale ?? 1);
    transform.updateMatrix();
    matrices.push(transform.matrix.clone());
    colors.push(new THREE.Color(placement.canvasColor ?? '#ffffff'));
    centers.push(new THREE.Vector3(0, 1.3, 0).applyMatrix4(transform.matrix));
  }
  const geometries = new Set(), materials = new Set(), textures = new Set();
  const worldCenter = new THREE.Vector3(), cameraPosition = new THREE.Vector3();
  const scratch = new THREE.Matrix4();
  let batches = [], disposed = false, lastCamera = null;
  let hasFar = false;
  const selected = placements.map(() => 'near');
  const stats = { status: 'loading', placements: placements.length, nearInstances: 0,
    farInstances: 0, activeBatches: 0, submittedTriangles: 0, errors: [] };

  function own(gltf) {
    gltf.scene.traverse(part => {
      if (!part.isMesh) return;
      geometries.add(part.geometry);
      for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
  }

  function collect(gltf, level, sharedMaterials) {
    const result = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(part => {
      if (!part.isMesh) return;
      if (Array.isArray(part.material)) throw new Error('Parasol requires one material per mesh');
      const cloth = part.name.includes('Canopy');
      const key = cloth ? 'Canopy' : part.name.includes('Hardware') ? 'Hardware' : 'Frame';
      const material = sharedMaterials.get(key) ?? part.material;
      sharedMaterials.set(key, material);
      material.envMapIntensity = .45;
      if (material.normalMap) material.normalMap.anisotropy = 4;
      const mesh = new THREE.InstancedMesh(part.geometry, material, placements.length);
      mesh.name = `BeachParasol / ${level} / ${key}`;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const sourceMatrix = part.matrixWorld.clone();
      // Bounds cover every placement permanently. LOD compaction cannot narrow
      // a batch bound and accidentally drop a distant shadow caster.
      for (let index = 0; index < placements.length; index++) {
        mesh.setMatrixAt(index, scratch.copy(matrices[index]).multiply(sourceMatrix));
        if (cloth) mesh.setColorAt(index, colors[index]);
      }
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
      mesh.count = 0;
      root.add(mesh);
      result.push({ mesh, cloth, level, sourceMatrix, indices: [],
        triangles: (part.geometry.index?.count ?? part.geometry.attributes.position.count) / 3 });
    });
    return result;
  }

  function apply(forceNear = false) {
    const active = forceNear ? selected.map(() => 'near') : selected;
    stats.nearInstances = active.filter(level => level === 'near').length;
    stats.farInstances = active.length - stats.nearInstances;
    stats.activeBatches = 0;
    stats.submittedTriangles = 0;
    for (const batch of batches) {
      const indices = [];
      for (let i = 0; i < active.length; i++) if (active[i] === batch.level) indices.push(i);
      const changed = indices.length !== batch.indices.length || indices.some((index, i) => index !== batch.indices[i]);
      if (changed) {
        for (let i = 0; i < indices.length; i++) {
          const index = indices[i];
          batch.mesh.setMatrixAt(i, scratch.copy(matrices[index]).multiply(batch.sourceMatrix));
          if (batch.cloth) batch.mesh.setColorAt(i, colors[index]);
        }
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
        batch.indices = indices;
      }
      batch.mesh.count = indices.length;
      batch.mesh.visible = indices.length > 0;
      if (indices.length) stats.activeBatches++;
      stats.submittedTriangles += indices.length * batch.triangles;
    }
  }

  function update(camera) {
    lastCamera = camera;
    if (disposed || !batches.length) return;
    if (!camera || !hasFar) { restore(); return; }
    root.updateWorldMatrix(true, false);
    camera.getWorldPosition(cameraPosition);
    // Narrow photo lenses deserve near detail farther away, matching their
    // projected object size. Hysteresis prevents switching at a fixed boundary.
    const projection = camera.isPerspectiveCamera
      ? Math.tan(Math.PI / 6) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.zoom
      : 1;
    const distance = nearDistance * projection * root.matrixWorld.getMaxScaleOnAxis();
    for (let index = 0; index < centers.length; index++) {
      worldCenter.copy(centers[index]).applyMatrix4(root.matrixWorld);
      const threshold = distance * (selected[index] === 'near' ? 1.1 : .9);
      selected[index] = worldCenter.distanceTo(cameraPosition) <= threshold ? 'near' : 'far';
    }
    apply();
  }

  function restore() {
    if (disposed) return;
    apply(true);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    root.removeFromParent();
    for (const batch of batches) batch.mesh.dispose();
    root.clear();
    batches = [];
    Object.assign(stats, { status: 'disposed', nearInstances: 0, farInstances: 0,
      activeBatches: 0, submittedTriangles: 0 });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    geometries.clear(); materials.clear(); textures.clear();
  }

  const ready = Promise.allSettled([loader.loadAsync(nearUrl), loader.loadAsync(farUrl)]).then(results => {
    for (const result of results) if (result.status === 'fulfilled') own(result.value);
    if (disposed) {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear(); materials.clear(); textures.clear();
      return { ...stats, status: 'disposed' };
    }
    const [near, far] = results;
    const sharedMaterials = new Map();
    if (near.status === 'fulfilled') {
      batches = collect(near.value, 'near', sharedMaterials);
      if (far.status === 'fulfilled') {
        batches.push(...collect(far.value, 'far', sharedMaterials));
        hasFar = true;
      }
      stats.status = 'authored';
    } else if (far.status === 'fulfilled') {
      // A missing high-detail asset still retains the authored silhouette.
      batches = collect(far.value, 'near', sharedMaterials);
      stats.status = 'authored-far-only';
    } else {
      const fallback = createFallback();
      own(fallback);
      batches = collect(fallback, 'near', sharedMaterials);
      stats.status = 'fallback';
    }
    for (const result of results) if (result.status === 'rejected') stats.errors.push(String(result.reason?.message ?? result.reason));
    update(lastCamera);
    return getStats();
  });

  function getStats() { return { ...stats, errors: [...stats.errors] }; }
  return { root, ready, update, restore, getStats, dispose };
}

function createFallback() {
  const scene = new THREE.Group();
  const canopy = new THREE.MeshStandardMaterial({ color: '#d9d0ba', roughness: .91, side: THREE.DoubleSide });
  const frame = new THREE.MeshStandardMaterial({ color: '#b9b5a7', roughness: .49, metalness: .65 });
  const hardware = new THREE.MeshStandardMaterial({ color: '#53534a', roughness: .67 });
  const vertices = [0, 2.56, 0], indices = [];
  const sides = 32, rings = 4;
  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    for (let k = 0; k < sides; k++) {
      const angle = k * Math.PI * 2 / sides;
      vertices.push(1.5 * t * Math.cos(angle), 2.08 + .48 * (1 - t ** 1.5), 1.5 * t * Math.sin(angle));
    }
  }
  for (let k = 0; k < sides; k++) indices.push(0, 1 + (k + 1) % sides, 1 + k);
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let k = 0; k < sides; k++) {
      const a = 1 + ring * sides + k, b = 1 + ring * sides + (k + 1) % sides;
      indices.push(a, b, b + sides, a, b + sides, a + sides);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  const cloth = new THREE.Mesh(geometry, canopy); cloth.name = 'BeachParasol_Canopy'; scene.add(cloth);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.019, .019, 2.64, 8), frame);
  pole.position.y = 1.24; pole.name = 'BeachParasol_Frame'; scene.add(pole);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.03, .07, .09, 8), hardware);
  base.position.y = .035; base.name = 'BeachParasol_Hardware'; scene.add(base);
  return { scene };
}
