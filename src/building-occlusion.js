import * as THREE from 'three';

// Conservative occlusion volumes from explicitly registered solid boxes. A
// sphere is hidden only beyond the box's far face and inside its full silhouette.
// Collision bounds and hollow storefront/interior bounds must never be supplied.
function isRigidCamera(camera) {
  const m = camera.matrixWorld.elements;
  if (!m.every(Number.isFinite) || !camera.matrixWorldInverse.elements.every(Number.isFinite)
    || !camera.projectionMatrix.elements.every(Number.isFinite)) return false;
  const tolerance = 1e-8;
  for (const offset of [0, 4, 8]) {
    if (Math.abs(m[offset] ** 2 + m[offset + 1] ** 2 + m[offset + 2] ** 2 - 1) > tolerance) return false;
  }
  for (const [a, b] of [[0, 4], [0, 8], [4, 8]]) {
    if (Math.abs(m[a] * m[b] + m[a + 1] * m[b + 1] + m[a + 2] * m[b + 2]) > tolerance) return false;
  }
  return Math.abs(camera.matrixWorld.determinant() - 1) <= tolerance
    && Math.abs(m[3]) <= tolerance && Math.abs(m[7]) <= tolerance
    && Math.abs(m[11]) <= tolerance && Math.abs(m[15] - 1) <= tolerance;
}

export function createBuildingOcclusion(boxes, { maxOccluders = 8 } = {}) {
  const candidates = boxes.map(box => ({ box: box.clone(), corners: Array.from({ length: 8 }, () => new THREE.Vector3()) }));
  const cameraPosition = new THREE.Vector3(), forward = new THREE.Vector3();
  const viewPoint = new THREE.Vector3(), center = new THREE.Vector3();
  const projection = new THREE.Matrix4(), frustum = new THREE.Frustum();
  let volumes = [], cached = false, revision = 0;
  let lastCoordinateSystem, lastNear;
  const lastView = new THREE.Matrix4(), lastProjection = new THREE.Matrix4();
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  function hull(points) {
    points.sort((a, b) => a.x - b.x || a.y - b.y);
    const lower = [], upper = [];
    for (const point of points) {
      while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), point) <= 1e-10) lower.pop();
      lower.push(point);
    }
    for (let i = points.length - 1; i >= 0; i--) {
      const point = points[i];
      while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), point) <= 1e-10) upper.pop();
      upper.push(point);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }
  function clear() {
    if (cached || volumes.length) revision++;
    volumes = []; cached = false;
  }
  function update(camera, { enabled = true } = {}) {
    if (!enabled || !camera.isPerspectiveCamera) { clear(); return; }
    camera.updateWorldMatrix(true, false);
    // Cone depths are world metres. Scaled, reflected or sheared camera frames
    // cannot safely mix view-space depth with world-space sphere distances.
    if (!isRigidCamera(camera)) { clear(); return; }
    if (cached && lastCoordinateSystem === camera.coordinateSystem && lastNear === camera.near
      && lastView.equals(camera.matrixWorldInverse) && lastProjection.equals(camera.projectionMatrix)) return;
    cached = true; lastView.copy(camera.matrixWorldInverse); lastProjection.copy(camera.projectionMatrix);
    lastCoordinateSystem = camera.coordinateSystem; lastNear = camera.near;
    revision++;
    volumes = [];
    camera.getWorldPosition(cameraPosition); camera.getWorldDirection(forward);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem);
    for (const { box, corners } of candidates) {
      if (box.containsPoint(cameraPosition) || !frustum.intersectsBox(box)) continue;
      const points = []; let farDepth = 0, stable = true;
      for (let i = 0; i < 8; i++) {
        const point = corners[i].set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
        viewPoint.copy(point).applyMatrix4(camera.matrixWorldInverse);
        const depth = -viewPoint.z;
        // Never construct a cone across the eye/near plane or very near camera.
        if (depth <= Math.max(.5, camera.near * 2)) { stable = false; break; }
        farDepth = Math.max(farDepth, depth);
        points.push({ x: viewPoint.x / depth, y: viewPoint.y / depth, point });
      }
      if (!stable) continue;
      const silhouette = hull(points);
      if (silhouette.length < 3) continue;
      let area = 0;
      for (let i = 0; i < silhouette.length; i++) {
        const a = silhouette[i], b = silhouette[(i + 1) % silhouette.length];
        area += a.x * b.y - a.y * b.x;
      }
      area = Math.abs(area) * .5;
      if (!Number.isFinite(area) || area < 1e-8) continue;
      box.getCenter(center);
      const planes = [];
      for (let i = 0; i < silhouette.length; i++) {
        const plane = new THREE.Plane().setFromCoplanarPoints(cameraPosition, silhouette[i].point, silhouette[(i + 1) % silhouette.length].point);
        if (plane.distanceToPoint(center) < 0) plane.negate();
        planes.push(plane);
      }
      planes.push(new THREE.Plane(forward.clone(), -forward.dot(cameraPosition) - farDepth));
      volumes.push({ planes, area });
    }
    volumes.sort((a, b) => b.area - a.area);
    volumes.length = Math.min(volumes.length, maxOccluders);
  }
  function isOccluded(sphere) {
    if (!Number.isFinite(sphere.radius) || sphere.radius < 0
      || !Number.isFinite(sphere.center.x) || !Number.isFinite(sphere.center.y)
      || !Number.isFinite(sphere.center.z)) return false;
    for (const { planes } of volumes) {
      let inside = true;
      for (const plane of planes) {
        // Positive padding makes silhouette-edge and floating-point cases visible.
        if (plane.distanceToPoint(sphere.center) <= sphere.radius + .002) { inside = false; break; }
      }
      if (inside) return true;
    }
    return false;
  }
  return { update, isOccluded, getRevision: () => revision, getStats: () => ({ registered: candidates.length, active: volumes.length }) };
}
