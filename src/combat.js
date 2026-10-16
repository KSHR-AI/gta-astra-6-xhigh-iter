import * as THREE from 'three';

const EPSILON = 1e-8;
const NEAR_COVER_DISTANCE = 1.1;

function normalizedRay(source) {
  const direction = source.direction.clone();
  if (direction.lengthSq() < EPSILON) throw new RangeError('A shot needs a nonzero camera direction.');
  return new THREE.Ray(source.origin.clone(), direction.normalize());
}

function checkedRange(maxRange) {
  if (!Number.isFinite(maxRange) || maxRange < 0) throw new RangeError('Shot range must be finite and nonnegative.');
  return maxRange;
}

function boxHit(ray, box) {
  if (box.isEmpty()) return null;
  // Ray.intersectBox returns the exit face for an embedded origin. A muzzle
  // already inside cover must stop immediately instead of firing through it.
  if (box.containsPoint(ray.origin)) return { distance: 0, normal: ray.direction.clone().negate() };
  const point = ray.intersectBox(box, new THREE.Vector3());
  if (!point) return null;
  const faces = [
    [Math.abs(point.x - box.min.x), -1, 0, 0], [Math.abs(point.x - box.max.x), 1, 0, 0],
    [Math.abs(point.y - box.min.y), 0, -1, 0], [Math.abs(point.y - box.max.y), 0, 1, 0],
    [Math.abs(point.z - box.min.z), 0, 0, -1], [Math.abs(point.z - box.max.z), 0, 0, 1],
  ];
  const face = faces.reduce((nearest, candidate) => candidate[0] < nearest[0] ? candidate : nearest);
  return { distance: point.distanceTo(ray.origin), normal: new THREE.Vector3(face[1], face[2], face[3]) };
}

function sphereHit(ray, center, radius) {
  if (ray.origin.distanceToSquared(center) <= radius * radius) {
    return { distance: 0, normal: ray.direction.clone().negate() };
  }
  const point = ray.intersectSphere(new THREE.Sphere(center, radius), new THREE.Vector3());
  return point ? { distance: point.distanceTo(ray.origin), normal: point.sub(center).normalize() } : null;
}

// A vertical capsule is the union of a finite cylinder and its spherical ends.
// Unlike a torso AABB, it does not award hits through the empty box corners.
function capsuleHit(ray, bottom, top, radius) {
  const nearestAxisPoint = new THREE.Vector3(bottom.x, THREE.MathUtils.clamp(ray.origin.y, bottom.y, top.y), bottom.z);
  if (ray.origin.distanceToSquared(nearestAxisPoint) <= radius * radius) {
    return { distance: 0, normal: ray.direction.clone().negate() };
  }
  let closest = sphereHit(ray, bottom, radius);
  const upper = sphereHit(ray, top, radius);
  if (upper && (!closest || upper.distance < closest.distance)) closest = upper;

  const dx = ray.origin.x - bottom.x, dz = ray.origin.z - bottom.z;
  const a = ray.direction.x ** 2 + ray.direction.z ** 2;
  const b = 2 * (dx * ray.direction.x + dz * ray.direction.z);
  const c = dx ** 2 + dz ** 2 - radius ** 2;
  const discriminant = b ** 2 - 4 * a * c;
  if (a > EPSILON && discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    for (const distance of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      if (distance < 0 || (closest && distance >= closest.distance)) continue;
      const y = ray.origin.y + ray.direction.y * distance;
      if (y < bottom.y || y > top.y) continue;
      const point = ray.at(distance, new THREE.Vector3());
      closest = { distance, normal: new THREE.Vector3(point.x - bottom.x, 0, point.z - bottom.z).normalize() };
    }
  }
  return closest;
}

function actorHit(ray, actor) {
  // position is the feet origin. headHeight is the head-centre offset, not
  // total character height. Defaults produce an approximately 1.81 m figure.
  const headHeight = actor.headHeight ?? 1.62;
  const position = actor.position;
  const head = sphereHit(ray, position.clone().add(new THREE.Vector3(0, headHeight, 0)), .19);
  const body = capsuleHit(
    ray,
    position.clone().add(new THREE.Vector3(0, Math.min(.42, headHeight * .3), 0)),
    position.clone().add(new THREE.Vector3(0, Math.max(.42, headHeight - .4), 0)),
    .27,
  );
  return !head ? body : !body || head.distance <= body.distance ? head : body;
}

function groundHit(ray, groundY) {
  if (groundY === undefined) return null;
  if (!Number.isFinite(groundY)) throw new RangeError('Ground height must be finite.');
  // Ground is a solid half-space, so a muzzle beneath the floor cannot fire
  // back through it. Every ground impact has the upward surface normal.
  if (ray.origin.y <= groundY) return { distance: 0, normal: new THREE.Vector3(0, 1, 0) };
  if (ray.direction.y >= 0) return null;
  return { distance: (groundY - ray.origin.y) / ray.direction.y, normal: new THREE.Vector3(0, 1, 0) };
}

function nearestHit(ray, { buildings = [], vehicles = [], actors = [], groundY }, maxRange, ignoreOriginOverlaps = false) {
  let nearest = null;
  const consider = (hit, object, kind) => {
    // The camera can temporarily overlap an obstacle during a shoulder/orbit
    // transition. A zero-distance camera target is behind the muzzle and would
    // reverse the bullet. Ignore it here; the muzzle pass still checks cover.
    if (ignoreOriginOverlaps && hit?.distance === 0) return;
    if (!hit || hit.distance > maxRange || (nearest && hit.distance >= nearest.distance)) return;
    nearest = { ...hit, object, kind };
  };
  // Exact ties favor solid cover, so coincident actor/vehicle bounds cannot
  // turn a surface strike into a hit on someone behind the surface.
  for (const box of buildings) consider(boxHit(ray, box), box, 'building');
  for (const vehicle of vehicles) consider(boxHit(ray, vehicle.box), vehicle.object, 'vehicle');
  consider(groundHit(ray, groundY), null, 'ground');
  for (const actor of actors) consider(actorHit(ray, actor), actor.object, 'actor');
  return nearest;
}

/** Camera convergence point; does not mutate rays, positions, or collider data. */
export function getAimPoint({ cameraRay, buildings = [], vehicles = [], actors = [], groundY, maxRange = 90 }) {
  checkedRange(maxRange);
  const ray = normalizedRay(cameraRay);
  const hit = nearestHit(ray, { buildings, vehicles, actors, groundY }, maxRange, true);
  return ray.at(hit?.distance ?? maxRange, new THREE.Vector3());
}

/**
 * Resolve an aimed shot in two passes. The camera chooses the convergence
 * point; the muzzle checks every collider again along the actual bullet path.
 *
 * Inputs: cameraRay: Ray, muzzle: Vector3, buildings: Box3[], vehicles:
 * { object, box: Box3 }[], actors: { object, position: Vector3, headHeight? }[].
 * Optional groundY adds an infinite horizontal floor, with object=null.
 * Callers exclude the shooter, downed actors, and any other ignored targets.
 * maxRange is measured from the muzzle. The return's kind is 'building',
 * 'vehicle', 'actor', 'ground', or 'none'; point/distance are on the muzzle ray.
 * Normal is outward at a hit, zero for a miss, and opposite the shot when the
 * muzzle starts inside a volume. blocked marks solid cover within 1.1 metres.
 */
export function traceShot({ cameraRay, muzzle, buildings = [], vehicles = [], actors = [], groundY, maxRange = 90 }) {
  checkedRange(maxRange);
  const ray = normalizedRay(cameraRay);
  const colliders = { buildings, vehicles, actors, groundY };
  const cameraHit = nearestHit(ray, colliders, maxRange, true);
  const aimPoint = ray.at(cameraHit?.distance ?? maxRange, new THREE.Vector3());
  const direction = aimPoint.sub(muzzle);
  // A valid camera hit can still sit behind the gun, between the shoulder
  // camera and player. Converge forward instead of firing backward into it.
  // Include the camera/muzzle separation so even very short ranges remain
  // forward; the physical trace below still enforces maxRange from the gun.
  if (direction.dot(ray.direction) <= 0) {
    ray.at(ray.origin.distanceTo(muzzle) + maxRange, direction).sub(muzzle);
  }
  if (direction.lengthSq() < EPSILON) direction.copy(ray.direction);
  const muzzleRay = new THREE.Ray(muzzle.clone(), direction.normalize());
  const hit = nearestHit(muzzleRay, colliders, maxRange);
  const distance = hit?.distance ?? maxRange;
  return {
    point: muzzleRay.at(distance, new THREE.Vector3()),
    distance,
    object: hit?.object ?? null,
    kind: hit?.kind ?? 'none',
    blocked: !!hit && hit.kind !== 'actor' && distance <= NEAR_COVER_DISTANCE,
    normal: hit?.normal ?? new THREE.Vector3(),
  };
}
