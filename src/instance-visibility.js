import * as THREE from 'three';

// InstancedMesh culls its aggregate bounds, not individual instances. Keep the
// same draw batches and compact only off-camera instances out of their buffers.
// Source transforms remain immutable so shadows/reflections can restore them.
export function createInstanceVisibility() {
  const batches = [];
  const projection = new THREE.Matrix4();
  const localProjection = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const transform = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const worldSphere = new THREE.Sphere();
  let totalInstances = 0, visibleInstances = 0, totalTriangles = 0, visibleTriangles = 0;
  let cameraOccludedInstances = 0, cameraOccludedTriangles = 0;

  function add(mesh, { padding = 0 } = {}) {
    if (!mesh.isInstancedMesh || mesh.morphTexture) return;
    mesh.geometry.computeBoundingSphere();
    const sourceSphere = mesh.geometry.boundingSphere.clone();
    // Vertex-shader deformation is measured before the instance transform.
    sourceSphere.radius += padding;
    const spheres = new Float32Array(mesh.count * 4);
    let maxScale = 1;
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, transform);
      maxScale = Math.max(maxScale, transform.getMaxScaleOnAxis());
      sphere.copy(sourceSphere).applyMatrix4(transform);
      spheres.set([sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius], index * 4);
    }
    if (padding > 0) {
      if (!mesh.boundingSphere) mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += padding * maxScale;
    }
    const triangles = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    batches.push({ mesh, count: mesh.count, matrices: mesh.instanceMatrix.array.slice(),
      colors: mesh.instanceColor?.array.slice(), spheres, triangles,
      selected: Int32Array.from({ length: mesh.count }, (_, index) => index),
      next: new Int32Array(mesh.count), selectedCount: mesh.count });
    totalInstances += mesh.count; totalTriangles += mesh.count * triangles;
    visibleInstances = totalInstances; visibleTriangles = totalTriangles;
  }

  function restore() {
    for (const batch of batches) {
      if (batch.selectedCount === batch.count) continue;
      batch.mesh.instanceMatrix.array.set(batch.matrices);
      batch.mesh.instanceMatrix.needsUpdate = true;
      if (batch.colors) {
        batch.mesh.instanceColor.array.set(batch.colors);
        batch.mesh.instanceColor.needsUpdate = true;
      }
      batch.mesh.count = batch.count;
      batch.selectedCount = batch.count;
      for (let i = 0; i < batch.count; i++) batch.selected[i] = i;
    }
    visibleInstances = totalInstances; visibleTriangles = totalTriangles;
    cameraOccludedInstances = 0; cameraOccludedTriangles = 0;
  }

  function update(camera, { preserveShadows = false, shadowFrusta, occlusion } = {}) {
    // Refresh frames need off-camera casters too. Valid light frusta permit a
    // conservative union; callers without those bounds retain the safe full set.
    const cullShadows = preserveShadows && Array.isArray(shadowFrusta)
      && shadowFrusta.length > 0 && shadowFrusta.every(value => value instanceof THREE.Frustum);
    if (preserveShadows && !cullShadows) { restore(); return; }
    camera.updateWorldMatrix(true, false);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    visibleInstances = 0; visibleTriangles = 0;
    cameraOccludedInstances = 0; cameraOccludedTriangles = 0;
    for (const batch of batches) {
      const { mesh, spheres } = batch;
      mesh.updateWorldMatrix(true, false);
      localProjection.multiplyMatrices(projection, mesh.matrixWorld);
      frustum.setFromProjectionMatrix(localProjection, camera.coordinateSystem);
      let count = 0;
      for (let index = 0; index < batch.count; index++) {
        const offset = index * 4;
        sphere.center.set(spheres[offset], spheres[offset + 1], spheres[offset + 2]);
        sphere.radius = spheres[offset + 3];
        let visible = frustum.intersectsSphere(sphere);
        if (visible && occlusion) {
          worldSphere.copy(sphere).applyMatrix4(mesh.matrixWorld);
          if (occlusion.isOccluded(worldSphere)) {
            visible = false; cameraOccludedInstances++; cameraOccludedTriangles += batch.triangles;
          }
        }
        if (!visible && cullShadows && mesh.castShadow) {
          worldSphere.copy(sphere).applyMatrix4(mesh.matrixWorld);
          for (const lightFrustum of shadowFrusta) {
            if (lightFrustum.intersectsSphere(worldSphere)) { visible = true; break; }
          }
        }
        if (visible) batch.next[count++] = index;
      }
      let changed = count !== batch.selectedCount;
      for (let i = 0; i < count && !changed; i++) changed = batch.next[i] !== batch.selected[i];
      if (changed) {
        for (let i = 0; i < count; i++) {
          const index = batch.next[i];
          mesh.instanceMatrix.array.set(batch.matrices.subarray(index * 16, index * 16 + 16), i * 16);
          if (batch.colors) mesh.instanceColor.array.set(batch.colors.subarray(index * 3, index * 3 + 3), i * 3);
          batch.selected[i] = index;
        }
        mesh.count = count; batch.selectedCount = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (batch.colors) mesh.instanceColor.needsUpdate = true;
      }
      visibleInstances += count; visibleTriangles += count * batch.triangles;
    }
  }
  return { add, update, restore, getStats: () => ({ totalInstances, visibleInstances, totalTriangles, visibleTriangles, cameraOccludedInstances, cameraOccludedTriangles }) };
}
