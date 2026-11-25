import * as THREE from 'three';

const geometryMatches = new WeakMap();

function sameArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.constructor !== b.constructor || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// A GLB may export identical front/rear wheels as separate geometry objects.
// Match all render attributes and triangle indices, not just their silhouette.
function sameGeometry(a, b) {
  if (a === b) return true;
  let matches = geometryMatches.get(a);
  if (!matches) { matches = new WeakMap(); geometryMatches.set(a, matches); }
  if (matches.has(b)) return matches.get(b);
  const names = Object.keys(a.attributes).sort(), otherNames = Object.keys(b.attributes).sort();
  const equal = names.length === otherNames.length && names.every((name, i) => {
    const left = a.attributes[name], right = b.attributes[name];
    return name === otherNames[i] && left.itemSize === right.itemSize && left.normalized === right.normalized
      && left.gpuType === right.gpuType && sameArray(left.array, right.array);
  }) && sameArray(a.index?.array, b.index?.array)
    && a.drawRange.start === b.drawRange.start && a.drawRange.count === b.drawRange.count
    && a.groups.length === b.groups.length && a.groups.every((group, i) => {
      const other = b.groups[i];
      return group.start === other.start && group.count === other.count && group.materialIndex === other.materialIndex;
    });
  matches.set(b, equal);
  return equal;
}

function pathTo(object, root) {
  const path = [];
  for (let current = object; current && current !== root; current = current.parent) path.push(current);
  return path;
}

function matrixAlong(path, target) {
  target.identity();
  for (const object of path) target.premultiply(object.matrix);
  return target;
}

/** Batch only exact wheel-part duplicates. Original pivots remain authoritative,
 * including stationary calipers and independent front steering/rear rotation.
 * Call update during LOD projection, before instance buffers are uploaded.
 */
export function instanceFarVehicleWheels(level) {
  const parts = [];
  for (const wheel of level.children.filter(child => /^wheel_[fr][lr]$/.test(child.name))) {
    wheel.traverse(object => {
      if (!object.isMesh || object.isSkinnedMesh || !object.visible || Array.isArray(object.material)
        || object.material.transparent || Object.keys(object.geometry.morphAttributes).length
        || Object.values(object.geometry.attributes).some(attribute => attribute.isInterleavedBufferAttribute)) return;
      const path = pathTo(object, level);
      for (const node of path) if (node.matrixAutoUpdate) node.updateMatrix();
      if (matrixAlong(path, new THREE.Matrix4()).determinant() <= 0) return;
      parts.push({ object, path });
    });
  }
  const groups = [];
  for (const part of parts) {
    const object = part.object;
    let group = groups.find(candidate => {
      const first = candidate[0].object;
      return first.material === object.material && first.castShadow === object.castShadow
        && first.receiveShadow === object.receiveShadow && first.renderOrder === object.renderOrder
        && first.layers.mask === object.layers.mask && sameGeometry(first.geometry, object.geometry);
    });
    if (!group) { group = []; groups.push(group); }
    group.push(part);
  }
  const batches = [];
  for (const group of groups.filter(group => group.length > 1)) {
    const source = group[0].object;
    const batch = new THREE.InstancedMesh(source.geometry, source.material, group.length);
    batch.name = `wheel_instances_${source.name}`;
    batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder; batch.layers.mask = source.layers.mask;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.userData.wheelSources = group.map(part => part.object.name);
    level.add(batch);
    for (const part of group) part.object.visible = false;
    batches.push({ mesh: batch, sources: group, previous: group.map(() => null) });
  }
  const nodes = new Set(batches.flatMap(batch => batch.sources.flatMap(source => source.path)));
  const matrix = new THREE.Matrix4();
  const update = () => {
    for (const node of nodes) if (node.matrixAutoUpdate) node.updateMatrix();
    for (const batch of batches) {
      let changed = false;
      for (const [index, source] of batch.sources.entries()) {
        matrixAlong(source.path, matrix);
        if (!batch.previous[index] || !batch.previous[index].equals(matrix)) {
          batch.mesh.setMatrixAt(index, matrix);
          if (!batch.previous[index]) batch.previous[index] = new THREE.Matrix4();
          batch.previous[index].copy(matrix); changed = true;
        }
      }
      if (changed) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.mesh.computeBoundingSphere();
        batch.mesh.computeBoundingBox();
      }
    }
  };
  update();
  const sourceMeshes = batches.reduce((sum, batch) => sum + batch.sources.length, 0);
  return { update, getInfo: () => ({ batches: batches.length, sourceMeshes, drawsSaved: sourceMeshes - batches.length }) };
}
