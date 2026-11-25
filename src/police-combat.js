import * as THREE from 'three';
import { traceShot } from './combat.js';

export const POLICE_FIRE = Object.freeze({ interval: 1.7, grace: 6, range: 90, spread: .026, movingSpread: .012 });
const UP = new THREE.Vector3(0, 1, 0);

/** Aim at the actual upper torso; a head-only exposed target remains usable. */
export function getPoliceAimPoint(player) {
  const torso = player.volumes?.capsules?.[0];
  if (torso) return torso.end.clone().lerp(torso.start, .12);
  const head = player.volumes?.spheres?.[0];
  if (head) return head.center.clone();
  return player.position.clone().add(new THREE.Vector3(0, (player.headHeight ?? 1.62) - .34, 0));
}

function targetEnvelope(player) {
  const bounds = new THREE.Box3();
  const include = (center, radius) => {
    bounds.expandByPoint(center.clone().addScalar(radius));
    bounds.expandByPoint(center.clone().addScalar(-radius));
  };
  if (player.volumes) {
    for (const sphere of player.volumes.spheres || []) include(sphere.center, sphere.radius);
    for (const capsule of player.volumes.capsules || []) { include(capsule.start, capsule.radius); include(capsule.end, capsule.radius); }
  } else {
    const head = player.headHeight ?? 1.62;
    include(player.position.clone().add(new THREE.Vector3(0, head, 0)), .19);
    include(player.position.clone().add(new THREE.Vector3(0, Math.min(.42, head * .3), 0)), .27);
    include(player.position.clone().add(new THREE.Vector3(0, Math.max(.42, head - .4), 0)), .27);
  }
  return bounds.isEmpty() ? null : bounds.getBoundingSphere(new THREE.Sphere());
}

/**
 * Resolve one physical police round. Randomness changes its visible aim ray;
 * damage is solely a consequence of that ray's first surface intersection.
 * During the warning window the ray clears the entire posed player envelope.
 * At point-blank overlap, hold fire rather than draw a fictitious harmless hit.
 */
export function tracePoliceShot({ origin, player, buildings = [], vehicles = [], actors = [], groundY,
  warning = false, spread = POLICE_FIRE.spread, random = Math.random, maxRange = POLICE_FIRE.range }) {
  const muzzle = origin.clone(), center = getPoliceAimPoint(player);
  const envelope = warning ? targetEnvelope(player) : null;
  if (envelope) center.copy(envelope.center);
  const forward = center.clone().sub(muzzle), distance = forward.length();
  const withheld = () => ({ fired: false, origin: muzzle, target: muzzle.clone(), aimPoint: center.clone(),
    impact: null, hit: false, warning: Boolean(warning) });
  // A miss cannot be guaranteed when the muzzle is in the protected body.
  if (envelope && distance <= envelope.radius + .35) return withheld();
  if (distance < 1e-8) forward.set(0, 0, -1); else forward.divideScalar(distance);
  const right = new THREE.Vector3().crossVectors(forward, Math.abs(forward.y) > .99 ? new THREE.Vector3(1, 0, 0) : UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const angle = THREE.MathUtils.clamp(random(), 0, 1) * Math.PI * 2;
  const radial = Math.sqrt(THREE.MathUtils.clamp(random(), 0, 1));
  let offset = Math.max(0, spread) * Math.max(distance, .5) * radial;
  if (envelope) {
    // Choose a tangent cone beyond the enclosing sphere, not a world-X offset.
    // The closest ray distance is D*offset/sqrt(D²+offset²), so all approach
    // directions and posed heights retain the same physical warning clearance.
    const clearance = envelope.radius + .35;
    offset = clearance * distance / Math.sqrt(distance * distance - clearance * clearance) * (1 + radial * .12);
  }
  const aimPoint = center.clone().addScaledVector(right, Math.cos(angle) * offset).addScaledVector(up, Math.sin(angle) * offset);
  const direction = aimPoint.clone().sub(muzzle);
  if (direction.lengthSq() < 1e-16) direction.copy(forward);
  direction.normalize();
  const impact = traceShot({ cameraRay: new THREE.Ray(muzzle, direction), muzzle,
    buildings, vehicles, actors: [...actors.filter(actor => actor.object !== player.object), player], groundY, maxRange });
  const playerHit = impact.kind === 'actor' && impact.object === player.object;
  if (warning && playerHit) return withheld();
  return { fired: true, origin: muzzle, target: impact.point.clone(), aimPoint, impact,
    hit: playerHit, warning: Boolean(warning) };
}
