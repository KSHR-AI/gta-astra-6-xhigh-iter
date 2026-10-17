import * as THREE from 'three';
import { createCharacterSelfShadow } from './character-self-shadow.js';

const materialList = value => Array.isArray(value) ? value : [value];
const depthSurface = material => material?.isMeshStandardMaterial && material.visible
  && !(material.transparent && material.alphaTest === 0 && !material.alphaHash);
const vertex = new THREE.Vector3();

/** Bound submitted, posed caster vertices, not unused bind-pose payload/helpers. */
export function getCharacterShadowBounds(root, target = new THREE.Box3()) {
  target.makeEmpty();
  root.traverseVisible(object => {
    if (!object.isMesh || !materialList(object.material).every(material => material?.isMeshStandardMaterial)) return;
    const geometry = object.geometry, materials = materialList(object.material);
    if (!materials.some(depthSurface)) return;
    const position = geometry.attributes.position;
    if (!position) return;
    const count = geometry.index?.count ?? position.count, used = new Set();
    const groups = Array.isArray(object.material) ? geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const group of groups) {
      if (!depthSurface(materials[group.materialIndex])) continue;
      const start = Math.max(0, geometry.drawRange.start, group.start);
      const end = Math.min(count, geometry.drawRange.start + geometry.drawRange.count, group.start + group.count);
      for (let i = start; i < end; i++) used.add(geometry.index ? geometry.index.getX(i) : i);
    }
    const local = new THREE.Box3();
    for (const index of used) {
      object.getVertexPosition(index, vertex).applyMatrix4(object.matrixWorld);
      if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)) throw new Error('Nonfinite posed caster vertex');
      local.expandByPoint(vertex);
    }
    if (local.isEmpty()) return;
    // Current characters have no displacement maps. Keep ordinary bounded
    // [0,1] displacement conservative if an authored surface adds one later.
    let displacement = 0;
    for (const material of materials) if (depthSurface(material) && material.displacementMap) {
      displacement = Math.max(displacement, Math.abs(material.displacementBias) + Math.abs(material.displacementScale));
    }
    if (displacement) {
      const e = object.matrixWorld.elements;
      local.expandByScalar(displacement * Math.hypot(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]));
    }
    target.union(local);
  });
  if (target.isEmpty()) throw new Error('Selected actor has no visible depth surfaces');
  return target;
}

function visible(object) {
  for (let node = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}
function descendant(object, root) {
  for (let node = object; node; node = node.parent) if (node === root) return true;
  return false;
}
const opaque = material => material?.visible && material.opacity > .95 && !material.transparent && !(material.transmission > 0);

/** Close daylight photos only; normal gameplay never allocates a local map. */
export function createPhotoCharacterShadow({ renderer, camera, scene, getActors, sun, enterPixels = 64, leavePixels = 48, helperFactory = createCharacterSelfShadow }) {
  const config = { enabled: true, resolution: 1024, normalBias: .0008, depthBias: .00015 };
  const viewProjection = new THREE.Matrix4(), frustum = new THREE.Frustum(), view = new THREE.Vector3(), projected = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3(), size = new THREE.Vector2(), direction = new THREE.Vector3(), sunPosition = new THREE.Vector3(), sunTarget = new THREE.Vector3();
  const raycaster = new THREE.Raycaster(), captureBounds = new THREE.Box3();
  let occlusionCache = new WeakMap(), occlusionDirty = false;
  let helper = null, selected = null, disposed = false, contextLost = false, updateNumber = 0;
  const info = { reason: 'not-photo', candidate: null, projectedHeadPixels: 0, boundsEvaluations: 0, frameCalls: 0, frameTriangles: 0, rejectedOccluded: 0, occlusionQueries: 0, occlusionMeshTests: 0, error: null };
  const readBounds = () => { info.boundsEvaluations++; return getCharacterShadowBounds(selected.mesh, captureBounds); };

  function release(reason = 'released', invalidateOcclusion = true) {
    helper?.release(); selected = null; info.candidate = null; info.projectedHeadPixels = 0;
    info.frameCalls = info.frameTriangles = 0; info.reason = reason;
    // A photo round trip can move cars/other actors even when this camera and
    // head return to exactly the same place. Do not reuse their former cover.
    if (invalidateOcclusion && occlusionDirty) { occlusionCache = new WeakMap(); occlusionDirty = false; }
  }
  function discardResources(reason = 'released') { release(reason); helper?.dispose(); helper = null; }
  function configure(patch = {}) {
    if (disposed) return;
    if (patch.resolution !== undefined && ![512, 1024].includes(patch.resolution)) throw new Error('Local shadow resolution must be 512 or 1024');
    for (const property of ['normalBias', 'depthBias']) if (patch[property] !== undefined && !(Number.isFinite(patch[property]) && patch[property] >= 0)) throw new Error('Nonnegative biases required');
    if (patch.resolution !== undefined && patch.resolution !== config.resolution) { discardResources(); config.resolution = patch.resolution; }
    for (const property of ['normalBias', 'depthBias']) if (patch[property] !== undefined) config[property] = patch[property];
    helper?.setBiases({ normalBias: config.normalBias, depthBias: config.depthBias });
    if (typeof patch.enabled === 'boolean') config.enabled = patch.enabled;
    if (!config.enabled) discardResources('disabled');
    info.error = null;
  }
  function headUnoccluded(actor, sphere, readOccluders, intersections) {
    const signature = [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements, ...sphere.center, sphere.radius];
    const prior = occlusionCache.get(actor);
    if (prior && updateNumber - prior.update < 20 && signature.every((value, i) => value === prior.signature[i])) return prior.visible;
    info.occlusionQueries++;
    direction.copy(sphere.center).sub(cameraPosition);
    const distance = direction.length();
    raycaster.set(cameraPosition, direction.divideScalar(distance));
    raycaster.near = 0; raycaster.far = Math.max(0, distance - sphere.radius * .4);
    let blocked = false;
    for (const object of readOccluders()) {
      if (descendant(object, actor.mesh)) continue;
      intersections.length = 0;
      info.occlusionMeshTests++;
      raycaster.intersectObject(object, false, intersections);
      if (intersections.some(hit => opaque(materialList(hit.object.material)[hit.face?.materialIndex ?? 0]))) { blocked = true; break; }
    }
    occlusionCache.set(actor, { signature, visible: !blocked, update: updateNumber }); occlusionDirty = true;
    return !blocked;
  }
  function update({ photoActive = false, night = false, started = true } = {}) {
    info.frameCalls = info.frameTriangles = 0;
    info.occlusionQueries = info.occlusionMeshTests = info.rejectedOccluded = 0;
    if (disposed) return false;
    if (!config.enabled || !photoActive || night || !started || renderer.shadowMap?.enabled === false) {
      discardResources(!config.enabled ? 'disabled' : night ? 'night' : !photoActive ? 'not-photo' : !started ? 'not-started' : 'shadows-disabled'); return false;
    }
    if (contextLost || renderer.getContext?.().isContextLost?.()) { discardResources('context-lost'); return false; }
    updateNumber++;
    camera.updateMatrixWorld(true); camera.getWorldPosition(cameraPosition);
    renderer.getDrawingBufferSize(size);
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.getEffectiveFOV()) * .5);
    const candidates = [];
    for (const actor of new Set(getActors().filter(Boolean))) {
      if (!visible(actor.mesh) || !actor.getFaceInfo?.().supported || (actor.getLODInfo?.().level ?? 0) !== 0) continue;
      const sphere = actor.getHitVolumes?.().spheres?.[0];
      if (!sphere?.center?.isVector3 || !(sphere.radius > 0)) continue;
      const head = new THREE.Sphere(sphere.center, sphere.radius);
      if (!frustum.intersectsSphere(head)) continue;
      view.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse);
      const depth = -view.z;
      if (depth <= camera.near + sphere.radius) continue;
      const pixels = size.y * sphere.radius / (depth * tanHalf);
      if (pixels < (actor === selected ? leavePixels : enterPixels)) continue;
      projected.copy(sphere.center).applyMatrix4(viewProjection);
      if (Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;
      const score = pixels / (1 + projected.x * projected.x + projected.y * projected.y);
      candidates.push({ actor, sphere, pixels, score });
    }
    candidates.sort((a, b) => b.score - a.score);
    // Rank cheap projection candidates before exact mesh intersections. Lower
    // scores cannot win, and one retained face needs a 25% stronger challenger.
    // Build the shared list only if a visibility cache actually misses.
    let occluders = null;
    const intersections = [];
    const readOccluders = () => {
      if (occluders) return occluders;
      occluders = [];
      scene.traverseVisible(object => {
        if (object.isMesh && materialList(object.material).some(opaque)) occluders.push(object);
      });
      return occluders;
    };
    const unoccluded = item => {
      const result = headUnoccluded(item.actor, item.sphere, readOccluders, intersections);
      // Count only queried contenders, not every eligible actor in the scene.
      if (!result) info.rejectedOccluded++;
      return result;
    };
    const retained = candidates.find(item => item.actor === selected);
    const retain = retained && unoccluded(retained);
    let choice = retain ? retained : null;
    for (const candidate of candidates) {
      if (candidate === retained) continue;
      if (retain && candidate.score < retained.score * 1.25) break;
      if (unoccluded(candidate)) { choice = candidate; break; }
    }
    if (!choice) { release('no-close-visible-face', false); return false; }
    try {
      helper ??= helperFactory(renderer, { resolution: config.resolution, normalBias: config.normalBias, depthBias: config.depthBias });
      selected = choice.actor;
      // updateMatrixWorld (not only updateWorldMatrix) refreshes attached
      // SkinnedMesh.bindMatrixInverse as well as the final bone transforms.
      selected.mesh.updateMatrixWorld(true);
      helper.select(selected.mesh);
      sun.getWorldPosition(sunPosition); sun.target.getWorldPosition(sunTarget);
      direction.copy(sunPosition).sub(sunTarget).normalize();
      const captured = helper.update({ active: true, bounds: readBounds, sunDirection: direction });
      const shadow = helper.getInfo();
      info.candidate = { name: selected.mesh.name, uuid: selected.mesh.uuid, asset: selected.mesh.userData.characterAsset ?? null };
      info.projectedHeadPixels = choice.pixels;
      info.frameCalls = captured ? shadow.calls : 0;
      info.frameTriangles = captured ? shadow.triangles : 0;
      info.reason = shadow.reason; info.error = null;
      return captured;
    } catch (error) {
      discardResources('error'); info.error = String(error?.message ?? error);
      config.enabled = false;
      console.warn('Photo character shadows disabled:', error);
      return false;
    }
  }
  const onContextLost = () => { contextLost = true; discardResources('context-lost'); };
  const onContextRestored = () => { contextLost = false; info.reason = 'context-restored'; };
  renderer.domElement?.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement?.addEventListener('webglcontextrestored', onContextRestored);
  return {
    configure, update, release: discardResources,
    getInfo: () => ({ ...info, config: { ...config }, candidate: info.candidate && { ...info.candidate }, shadow: helper?.getInfo() ?? null, disposed }),
    dispose() {
      if (disposed) return;
      discardResources('disposed');
      renderer.domElement?.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement?.removeEventListener('webglcontextrestored', onContextRestored);
      disposed = true;
    },
  };
}
