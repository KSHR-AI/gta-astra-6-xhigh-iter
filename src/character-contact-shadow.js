import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const finitePoint = point => point?.isVector3 && [point.x, point.y, point.z].every(Number.isFinite);
const sameFloor = (a, b) => Number.isFinite(a) && Math.abs(a - b) < .004;
let shared;

function shadowResources() {
  if (!shared) {
    const size = 32, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + .5) / size * 2 - 1, (y + .5) / size * 2 - 1);
      pixels[(y * size + x) * 4 + 3] = Math.round(255 * (1 - THREE.MathUtils.smoothstep(radius, .08, 1)) ** 1.5);
    }
    const texture = new THREE.DataTexture(pixels, size, size);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true,
      vertexColors: true, depthWrite: false, depthTest: true, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    material.name = 'Foot contact shadow';
    shared = { texture, material, users: 0 };
  }
  shared.users++;
  return shared;
}

function footprintTarget() {
  return { corners: Array.from({ length: 4 }, () => new THREE.Vector3()),
    center: new THREE.Vector3(), floor: 0, clearance: 0, opacity: 0, width: 0, length: 0 };
}

/**
 * Project the lowest part of a posed sole onto its actual supporting surface.
 * Points are a borrowed, final-pose world-space outsole sample, never ankle
 * guesses. A lifted heel therefore narrows the patch toward the grounded toe.
 * The output stays horizontal: city curb discontinuities are clipped instead
 * of connecting road and pavement with a floating/sloping transparent sheet.
 */
export function projectFootContact(foot, groundHeightAt, target = footprintTarget()) {
  if (typeof groundHeightAt !== 'function' || !Array.isArray(foot?.points)
    || foot.points.length < 3 || foot.points.some(point => !finitePoint(point))
    || !finitePoint(foot.forward)) return null;
  const forward = foot.forward.clone(); forward.y = 0;
  if (forward.lengthSq() < 1e-8) return null;
  forward.normalize();
  const right = new THREE.Vector3().crossVectors(UP, forward);
  const lowest = Math.min(...foot.points.map(point => point.y));
  let minRight = Infinity, maxRight = -Infinity, minForward = Infinity, maxForward = -Infinity;
  for (const point of foot.points) {
    if (point.y > lowest + .028) continue;
    const r = point.dot(right), f = point.dot(forward);
    minRight = Math.min(minRight, r); maxRight = Math.max(maxRight, r);
    minForward = Math.min(minForward, f); maxForward = Math.max(maxForward, f);
  }
  // A small penumbra around the measured contact patch, not a body-sized blob.
  minRight -= .018; maxRight += .018; minForward -= .018; maxForward += .018;
  const width = maxRight - minRight, length = maxForward - minForward;
  if (!Number.isFinite(width + length) || width > 1 || length > 1) return null;
  const centerRight = (minRight + maxRight) / 2, centerForward = (minForward + maxForward) / 2;
  const pointAt = (r, f, point = new THREE.Vector3()) => point.copy(right).multiplyScalar(r).addScaledVector(forward, f);
  const candidates = [];
  // The center catches a curb completely inside the heel/toe footprint. Edge
  // midpoints avoid mistaking a rotated curb for an entirely lower surface.
  for (const r of [centerRight, minRight, maxRight]) for (const f of [centerForward, minForward, maxForward]) {
    const point = pointAt(r, f), height = groundHeightAt(point.x, point.z);
    if (Number.isFinite(height) && height <= lowest + .03) candidates.push({ point, height });
  }
  if (!candidates.length) return null;
  const floor = Math.max(...candidates.map(candidate => candidate.height));
  const anchor = candidates.find(candidate => sameFloor(candidate.height, floor)).point;
  const clearance = Math.max(0, lowest - floor);
  const opacity = .52 * (1 - THREE.MathUtils.smoothstep(clearance, .006, .12));
  if (opacity <= .001) return null;
  const coordinates = [[minRight, minForward], [minRight, maxForward],
    [maxRight, maxForward], [maxRight, minForward]];
  for (let index = 0; index < 4; index++) {
    const corner = pointAt(...coordinates[index], target.corners[index]);
    if (!sameFloor(groundHeightAt(corner.x, corner.z), floor)) {
      const end = corner.clone(); let inside = 0, outside = 1;
      for (let iteration = 0; iteration < 8; iteration++) {
        const fraction = (inside + outside) / 2;
        corner.copy(anchor).lerp(end, fraction);
        if (sameFloor(groundHeightAt(corner.x, corner.z), floor)) inside = fraction;
        else outside = fraction;
      }
      corner.copy(anchor).lerp(end, inside);
    }
    corner.y = floor;
  }
  target.center.set(0, floor, 0);
  for (const corner of target.corners) { target.center.x += corner.x / 4; target.center.z += corner.z / 4; }
  // A concave or too-small support cannot be represented honestly by one quad.
  // Reject it rather than put dark pixels over another surface height.
  const check = new THREE.Vector3();
  for (let index = 0; index < 4; index++) {
    check.copy(target.corners[index]).lerp(target.corners[(index + 1) % 4], .5);
    if (!sameFloor(groundHeightAt(check.x, check.z), floor)) return null;
  }
  if (!sameFloor(groundHeightAt(target.center.x, target.center.z), floor)) return null;
  const diagonalA = new THREE.Vector3().subVectors(target.corners[2], target.corners[0]);
  const diagonalB = new THREE.Vector3().subVectors(target.corners[3], target.corners[1]);
  if (new THREE.Vector3().crossVectors(diagonalA, diagonalB).length() < .0001) return null;
  Object.assign(target, { floor, clearance, opacity, width, length });
  return target;
}

/** Attach after character creation, then update after its final presented pose. */
export function createCharacterContactShadow(actor, { groundHeightAt } = {}) {
  if (!actor?.mesh?.isObject3D || typeof groundHeightAt !== 'function') {
    throw new TypeError('Foot contact shadows require a character root and ground-height query.');
  }
  const resources = shadowResources(), group = new THREE.Group();
  group.name = 'contact-shadow';
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(24), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.Float32BufferAttribute(new Float32Array(32), 4).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', positions); geometry.setAttribute('color', colors);
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  const patches = new THREE.Mesh(geometry, resources.material);
  patches.name = 'Posed foot contacts'; patches.visible = false;
  group.add(patches); actor.mesh.add(group);
  const inverse = new THREE.Matrix4(), lastMatrix = new THREE.Matrix4(), poseToCurrent = new THREE.Matrix4();
  const local = new THREE.Vector3(), targets = [footprintTarget(), footprintTarget()];
  const currentFeet = Array.from({ length: 2 }, () => ({ points: [], forward: new THREE.Vector3(), side: null }));
  let revision = null, disposed = false, updates = 0, sampledPoints = 0, supported = false;
  let info = [];
  const write = (attribute, index, value) => {
    const next = Math.fround(value);
    if (attribute.array[index] === next) return false;
    attribute.array[index] = next; return true;
  };
  return {
    group,
    update() {
      if (disposed || !group.visible) return;
      const snapshot = actor.getFootContactSurfaces?.();
      supported = Boolean(snapshot?.feet);
      group.updateWorldMatrix(true, false);
      const nextRevision = snapshot?.revision ?? -1;
      if (revision === nextRevision && lastMatrix.equals(group.matrixWorld)) return;
      revision = nextRevision; lastMatrix.copy(group.matrixWorld); inverse.copy(group.matrixWorld).invert();
      // A distant actor can move its root without presenting a new skeletal
      // pose. Carry the cached sole with that exact root transform, matching
      // rendered skin, rather than pinning a stale world-space footprint.
      const remap = snapshot?.rootMatrixWorld?.isMatrix4;
      if (remap) poseToCurrent.copy(snapshot.rootMatrixWorld).invert().premultiply(actor.mesh.matrixWorld);
      let moved = false, recolored = false, visible = false; info = []; sampledPoints = 0;
      for (let footIndex = 0; footIndex < 2; footIndex++) {
        let foot = snapshot?.valid ? snapshot.feet?.[footIndex] : null;
        if (foot && remap) {
          const current = currentFeet[footIndex]; current.side = foot.side;
          while (current.points.length < foot.points.length) current.points.push(new THREE.Vector3());
          current.points.length = foot.points.length;
          for (let i = 0; i < foot.points.length; i++) current.points[i].copy(foot.points[i]).applyMatrix4(poseToCurrent);
          current.forward.copy(foot.forward).transformDirection(poseToCurrent);
          foot = current;
        }
        const contact = foot ? projectFootContact(foot, groundHeightAt, targets[footIndex]) : null;
        sampledPoints += foot?.points?.length ?? 0;
        const opacity = contact ? contact.opacity * (1 - THREE.MathUtils.clamp(snapshot.airborneWeight ?? 0, 0, 1)) : 0;
        visible ||= opacity > .001;
        for (let corner = 0; corner < 4; corner++) {
          const vertex = footIndex * 4 + corner;
          if (contact) {
            local.copy(contact.corners[corner]).applyMatrix4(inverse);
            for (let component = 0; component < 3; component++) moved = write(positions, vertex * 3 + component, local.getComponent(component)) || moved;
          }
          for (let component = 0; component < 4; component++) recolored = write(colors, vertex * 4 + component, component === 3 ? opacity : 1) || recolored;
        }
        info.push(contact ? { side: foot.side, floor: contact.floor, clearance: contact.clearance,
          opacity, center: contact.center.toArray(), corners: contact.corners.map(point => point.toArray()) } : { side: foot?.side ?? null, opacity: 0 });
      }
      if (moved) { positions.needsUpdate = true; geometry.computeBoundingSphere(); }
      if (recolored) colors.needsUpdate = true;
      patches.visible = visible; updates++;
    },
    getInfo() { return { supported, updates, revision, sampledPoints,
      visible: !disposed && group.visible && patches.visible, feet: info.map(foot => ({ ...foot,
        ...(foot.center ? { center: [...foot.center], corners: foot.corners.map(point => [...point]) } : {}) })) }; },
    dispose() {
      if (disposed) return;
      disposed = true; group.removeFromParent(); geometry.dispose();
      if (--resources.users === 0) { resources.material.dispose(); resources.texture.dispose(); if (shared === resources) shared = undefined; }
    },
  };
}
