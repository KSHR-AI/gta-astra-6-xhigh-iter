import * as THREE from 'three';

/** Half-extents of a square enclosing the near plane at any camera roll.
 * Using the diagonal keeps driving lean from exposing a corner between frames.
 * Call after changing the perspective projection, or use the current camera
 * values while its field of view eases toward the next frame's target.
 */
export function getCameraSweep(camera) {
  const { near, fov, aspect, zoom = 1 } = camera;
  if (![near, fov, aspect, zoom].every(Number.isFinite) || near <= 0 || fov <= 0 || fov >= 180 || aspect <= 0 || zoom <= 0) {
    throw new RangeError('A camera sweep needs a valid perspective projection.');
  }
  const halfHeight = near * Math.tan(THREE.MathUtils.degToRad(fov) / 2) / zoom;
  const halfWidth = halfHeight * aspect;
  const rolledExtent = Math.hypot(halfWidth, halfHeight);
  return { halfWidth: rolledExtent, halfHeight: rolledExtent };
}

// Sweep the camera's centre, near-plane corners and edge centres. Vehicle surfaces provide
// exact intersections, so an open cabin no longer behaves like a solid box.
export function clipCameraSegment(origin, target, {
  boxes = [], surfaces = [], clearance = .16, radius = .12,
  halfWidth = radius, halfHeight = radius,
} = {}) {
  const direction = target.clone().sub(origin);
  const length = direction.length();
  if (length < 1e-8) return target.clone();
  direction.divideScalar(length);
  const right = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(right, direction).normalize();
  let distance = length;
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  for (const [x, y] of [[0, 0], [-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    ray.origin.copy(origin).addScaledVector(right, x * halfWidth).addScaledVector(up, y * halfHeight);
    ray.direction.copy(direction);
    for (const box of boxes) {
      if (box.containsPoint(ray.origin)) return origin.clone();
      if (ray.intersectBox(box, hit)) distance = Math.min(distance, Math.max(0, hit.distanceTo(ray.origin) - clearance));
    }
    for (const surface of surfaces) {
      const result = surface(ray, Math.min(length, distance + clearance));
      if (result && Number.isFinite(result.distance) && result.distance >= 0 && result.distance <= length) {
        distance = Math.min(distance, Math.max(0, result.distance - clearance));
      }
    }
    if (distance === 0) break;
  }
  return origin.clone().addScaledVector(direction, distance);
}
