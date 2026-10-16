import * as THREE from 'three';
import { PERSON_RADIUS, insideVehicle, crossesVehicle, vehicleDetour, vehicleEscape, vehiclePenetration, shouldYieldToVehicle, pedestrianSpeedLimit } from './street-navigation.js';

const clamp = THREE.MathUtils.clamp;
const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const crossroads = [-90, 0, 90];

/** Segment/AABB visibility in the gameplay plane; shared by witnesses and patrols. */
export function hasSight(a, b, colliders) {
  const dx = b.x - a.x, dz = b.z - a.z;
  for (const box of colliders) {
    if (box.occludesSight === false) continue;
    let lo = 0.025, hi = 0.975;
    for (const [p, d, min, max] of [[a.x, dx, box.minX, box.maxX], [a.z, dz, box.minZ, box.maxZ]]) {
      if (Math.abs(d) < 1e-7) { if (p < min || p > max) { lo = 1; hi = 0; break; } }
      else { const s = (min - p) / d, t = (max - p) / d; lo = Math.max(lo, Math.min(s, t)); hi = Math.min(hi, Math.max(s, t)); }
    }
    if (lo <= hi) return false;
  }
  return true;
}

export function createCitySimulation({ vehicles, pedestrians, police, officers = [], world, moveBody, carsOverlap, onPoliceShot, onToast }) {
  const heat = { wanted: 0, policeState: 'clear', searchProgress: 0, reportProgress: 0, lastKnown: null };
  let reportAt = 0, pendingLevel = 0, lastSeen = -100, engagementStarted = -100, nextShot = 0, lostAt = 0;
  const searchDuration = 12;
  const roadTarget = new THREE.Vector3();
  const delta = new THREE.Vector3();

  function reportCrime({ position, level = 1, kind = 'theft', now = 0, force = false }) {
    const seenByPatrol = !police.stolen && !police.occupied && distance(police.model.mesh.position, position) < 62 && hasSight(police.model.mesh.position, position, world.colliders);
    const witness = pedestrians.find(p => !p.down && distance(p.actor.mesh.position, position) < (kind === 'gunshot' ? 65 : 32) && (kind === 'gunshot' || hasSight(p.actor.mesh.position, position, world.colliders)));
    for (const p of pedestrians) {
      if (!p.down && distance(p.actor.mesh.position, position) < (kind === 'gunshot' ? 70 : 21)) {
        p.fleeUntil = now + 6 + Math.random() * 3;
        p.fleeFrom = position.clone();
      }
    }
    if (!force && !witness && !seenByPatrol) return { ...heat };
    if (heat.policeState === 'clear') engagementStarted = now;
    heat.lastKnown = position.clone();
    pendingLevel = Math.max(pendingLevel, clamp(level, 1, 5));
    if (seenByPatrol || heat.wanted > 0) {
      heat.wanted = Math.max(heat.wanted, pendingLevel);
      heat.policeState = 'pursuit';
      lastSeen = now;
      pendingLevel = 0;
    } else if (heat.policeState !== 'reported') {
      reportAt = now + 3.5;
      heat.policeState = 'reported';
      heat.reportProgress = 0;
      if (witness) witness.reportingUntil = reportAt;
      onToast?.('CRIME REPORTED', 'A witness is calling it in. Keep moving.');
    }
    return { ...heat };
  }

  function steerAlongRoad(car, destination, dt, speed) {
    const p = car.model.mesh.position;
    roadTarget.copy(destination);
    const currentRoad = Math.abs(p.x - 80) < Math.abs(p.x) ? 80 : 0;
    const targetRoad = Math.abs(destination.x - 80) < Math.abs(destination.x) ? 80 : 0;
    if (currentRoad !== targetRoad) {
      const crossing = [...crossroads].sort((a, b) => Math.abs(p.z - a) + Math.abs(destination.z - a) - Math.abs(p.z - b) - Math.abs(destination.z - b))[0];
      if (Math.abs(p.z - crossing) > 6) roadTarget.set(currentRoad, 0, crossing);
      else roadTarget.set(targetRoad, 0, crossing);
    } else if (Math.abs(p.z - destination.z) > 20) roadTarget.x = currentRoad + (destination.z > p.z ? -3.5 : 3.5);
    delta.copy(roadTarget).sub(p);
    if (delta.lengthSq() > 2) {
      const angle = turn(car.heading, Math.atan2(delta.x, delta.z));
      car.heading += clamp(angle, -dt * 1.8, dt * 1.8);
      car.steer = clamp(angle, -.5, .5);
    }
    car.speed = THREE.MathUtils.damp(car.speed, speed, 2.3, dt);
    const previous = p.clone();
    const hit = moveBody(p, Math.sin(car.heading) * car.speed * dt, Math.cos(car.heading) * car.speed * dt, 1.05);
    if (vehicles.some(other => other !== car && distance(p, other.model.mesh.position) < 6 && carsOverlap(p, car.heading, other.model.mesh.position, other.heading))) {
      p.copy(previous); car.speed = 0;
      car.blockedTime = (car.blockedTime || 0) + dt;
      if (car.blockedTime > 2) car.heading += dt * .55;
    } else car.blockedTime = 0;
    if (hit) { car.speed *= .85; car.heading += dt * .4; }
    car.model.mesh.rotation.y = car.heading;
  }

  function updateTraffic(dt, time, currentCar, playerPosition) {
    const loop = [[-4, 82], [-4, -86], [84, -86], [84, 86]];
    const people = pedestrians.filter(person => !person.down).map(person => ({ position: person.actor.mesh.position, velocity: person.velocity }));
    if (!currentCar) people.push({ position: playerPosition });
    for (const car of vehicles) {
      if (car.closeDoorAt && time >= car.closeDoorAt) { car.model.setDoor(false); car.closeDoorAt = 0; }
      if (car === currentCar || car.police) continue;
      if (car.traffic && car.health > 0) {
        const p = car.model.mesh.position;
        let [tx, tz] = loop[car.routeIndex % 4];
        if (Math.hypot(tx - p.x, tz - p.z) < 8) { car.routeIndex = (car.routeIndex + 1) % 4; [tx, tz] = loop[car.routeIndex]; }
        const direction = Math.atan2(tx - p.x, tz - p.z);
        const angle = turn(car.heading, direction);
        const headingBefore = car.heading;
        car.heading += clamp(angle, -dt * 1.45, dt * 1.45);
        car.steer = clamp(angle, -.45, .45);
        let desired = Math.abs(angle) > .3 ? 4 : 8.2;
        car.trafficDecision = 'cruising';
        const forward = new THREE.Vector3(Math.sin(car.heading), 0, Math.cos(car.heading));
        for (const other of vehicles) {
          if (other === car) continue;
          delta.copy(other.model.mesh.position).sub(p);
          const ahead = delta.dot(forward), lateral = Math.abs(delta.x * forward.z - delta.z * forward.x);
          if (ahead > 0 && ahead < 11 && lateral < 2.5) {
            const following = Math.max(0, (ahead - 5) * 1.8);
            if (following < desired) { desired = following; car.trafficDecision = 'following'; }
          }
        }
        const walkingLimit = pedestrianSpeedLimit(car, people);
        car.yieldingToPedestrian = walkingLimit < desired;
        if (car.yieldingToPedestrian) car.trafficDecision = 'pedestrian';
        desired = Math.min(desired, walkingLimit);
        const vertical = Math.abs(forward.z) > .7;
        const greenVertical = Math.floor(time / 12) % 2 === 0;
        if (vertical !== greenVertical) {
          const approaching = vertical
            ? crossroads.some(z => (z - p.z) * forward.z > 10 && (z - p.z) * forward.z < 18)
            : [0, 80].some(x => (x - p.x) * forward.x > 12 && (x - p.x) * forward.x < 20);
          if (approaching) { desired = 0; car.trafficDecision = 'signal'; }
        }
        car.desiredSpeed = desired;
        car.speed = THREE.MathUtils.damp(car.speed, desired, 3, dt);
        // This bound prevents damped braking from creeping beyond the safe stop.
        car.speed = Math.min(car.speed, walkingLimit);
        const prev = p.clone();
        moveBody(p, forward.x * car.speed * dt, forward.z * car.speed * dt, 1.05);
        const blockedByPerson = people.some(person => insideVehicle(person.position, car));
        if (blockedByPerson || vehicles.some(other => other !== car && distance(p, other.model.mesh.position) < 6 && carsOverlap(p, car.heading, other.model.mesh.position, other.heading))) { p.copy(prev); car.speed = 0; }
        if (blockedByPerson) {
          car.heading = headingBefore;
          car.desiredSpeed = 0; car.yieldingToPedestrian = true; car.trafficDecision = 'pedestrian';
        }
        car.model.mesh.rotation.y = car.heading;
      }
      car.model.update(dt, car.speed, car.steer);
      car.model.setDamage?.(car.health);
    }
  }

  function updatePedestrians(dt, time, playerPosition) {
    for (let i = 0; i < pedestrians.length; i++) {
      const p = pedestrians[i], pos = p.actor.mesh.position;
      const previous = { x: pos.x, z: pos.z };
      p.velocity = { x: 0, z: 0 };
      p.streetBehavior = 'idle';
      p.yieldReason = null;
      p.actor.mesh.visible = distance(pos, playerPosition) < 95;
      if (p.down) {
        p.streetBehavior = 'down';
        p.detour = null;
        p.actor.update(dt, { speed: 0, dead: true });
        if (time > p.recoverAt) { p.down = false; p.fleeUntil = time + 6; }
        continue;
      }
      if (p.evictedUntil > time) { p.detour = null; p.actor.update(dt, { speed: 0 }); continue; }
      let speed = 1.1, dx = 0, dz = 0;
      const fleeing = p.fleeUntil > time;
      if (fleeing !== p.wasFleeing) p.detour = null;
      p.wasFleeing = fleeing;
      if (fleeing) {
        const from = p.fleeFrom || playerPosition;
        delta.copy(pos).sub(from); delta.y = 0;
        if (delta.lengthSq() < .1) delta.set(i % 2 ? 1 : -1, 0, 1);
        delta.normalize(); dx = delta.x; dz = delta.z; speed = 4.8;
      } else if (p.reportingUntil > time || (Math.floor(time / 9 + i * 2.7) % 7 === 0)) speed = 0;
      else {
        if (!p.route) {
          const x = p.home.x < 0 ? -14 : p.home.x < 40 ? 14 : p.home.x < 80 ? 66 : 94;
          const z = clamp(p.home.z, -160, 145);
          p.route = [new THREE.Vector3(x, 0, z - 16), new THREE.Vector3(x + (x < 0 ? -2.2 : 2.2), 0, z - 16), new THREE.Vector3(x + (x < 0 ? -2.2 : 2.2), 0, z + 16), new THREE.Vector3(x, 0, z + 16)];
          p.waypoint = i % 4;
        }
        delta.copy(p.route[p.waypoint]).sub(pos); delta.y = 0;
        if (delta.lengthSq() < 1.1) {
          p.waypoint = (p.waypoint + 1) % p.route.length;
          p.detour = null;
          delta.copy(p.route[p.waypoint]).sub(pos); delta.y = 0;
        }
        delta.normalize(); dx = delta.x; dz = delta.z;
      }
      if (speed > 0) {
        const overlap = vehicles.find(car => insideVehicle(pos, car));
        const waiting = !overlap && vehicles.some(car => shouldYieldToVehicle(pos, { x: dx * speed, z: dz * speed }, car));
        if (waiting) {
          speed = 0;
          p.streetBehavior = 'yielding';
          p.yieldReason = 'moving-vehicle';
        } else if (overlap) {
          // A player may park over a person. Let that person step out instead of
          // pinning them inside a newly arrived collision footprint.
          const escape = vehicleEscape(pos, overlap);
          dx = escape.x; dz = escape.z; p.detour = null;
          p.streetBehavior = fleeing ? 'fleeing' : 'avoiding';
        } else {
          if (p.detour?.length && vehicles.some(car => crossesVehicle(pos, p.detour[0], car))) p.detour = null;
          if (!p.detour?.length && time >= (p.nextDetourCheck || 0)) {
            const length = fleeing ? 10 : Math.min(10, distance(pos, p.route[p.waypoint]));
            const target = { x: pos.x + dx * length, z: pos.z + dz * length };
            p.detour = vehicleDetour(pos, target, vehicles, world.colliders);
            p.nextDetourCheck = time + .45;
          }
          if (p.detour?.length) {
            const destination = p.detour[0], remaining = distance(pos, destination);
            if (remaining < .15) p.detour.shift();
            if (p.detour.length) {
              const next = p.detour[0], length = distance(pos, next);
              dx = (next.x - pos.x) / Math.max(length, .001); dz = (next.z - pos.z) / Math.max(length, .001);
              speed = Math.min(speed, length / Math.max(dt, .001));
              p.streetBehavior = fleeing ? 'fleeing' : 'avoiding';
            }
          }
          if (p.streetBehavior === 'idle') p.streetBehavior = fleeing ? 'fleeing' : 'walking';
        }
        function step(x, z) {
          const before = { x: pos.x, z: pos.z };
          const hit = moveBody(pos, x, z, PERSON_RADIUS);
          if (vehicles.some(car => insideVehicle(pos, car) && vehiclePenetration(pos, car) >= vehiclePenetration(before, car) - 1e-7)) {
            pos.x = before.x; pos.z = before.z;
            return true;
          }
          return hit;
        }
        const hit = step(dx * speed * dt, dz * speed * dt);
        if (hit && !fleeing && !p.detour?.length && !waiting) {
          p.waypoint = (p.waypoint + 1) % p.route.length;
          p.nextDetourCheck = 0;
        }
        // Separate neighboring pedestrians without synchronized crowd motion.
        for (let j = 0; speed > 0 && j < i; j++) {
          const other = pedestrians[j].actor.mesh.position;
          if (distance(pos, other) < .65) step((pos.x - other.x) * dt * 2, (pos.z - other.z) * dt * 2);
        }
        if (distance(pos, previous) > .0001) {
          const desired = Math.atan2(pos.x - previous.x, pos.z - previous.z);
          p.actor.mesh.rotation.y += turn(p.actor.mesh.rotation.y, desired) * Math.min(1, dt * 8);
        }
      }
      p.velocity.x = (pos.x - previous.x) / Math.max(dt, .001);
      p.velocity.z = (pos.z - previous.z) / Math.max(dt, .001);
      const actualSpeed = Math.hypot(p.velocity.x, p.velocity.z);
      if (actualSpeed < .01 && (p.streetBehavior === 'walking' || p.streetBehavior === 'avoiding')) { p.streetBehavior = 'waiting'; p.yieldReason = 'blocked-path'; }
      p.actor.update(dt, { speed: actualSpeed, dead: false });
    }
  }

  function update(dt, { playerPosition, currentCar, time }) {
    updateTraffic(dt, time, currentCar, playerPosition);
    updatePedestrians(dt, time, playerPosition);
    if (heat.policeState === 'reported') {
      heat.reportProgress = clamp(1 - (reportAt - time) / 3.5, 0, 1);
      if (time >= reportAt) {
        heat.wanted = pendingLevel; pendingLevel = 0; heat.policeState = 'pursuit'; lastSeen = time;
        onToast?.('POLICE DISPATCHED', 'Break line of sight. Find somewhere to hide.');
      }
    }
    const patrolPosition = police.model.mesh.position;
    const patrolDistance = distance(patrolPosition, playerPosition);
    const patrolSeesPlayer = currentCar !== police && !police.stolen && police.health > 0 && patrolDistance < 54 && hasSight(patrolPosition, playerPosition, world.colliders);
    const officerSeesPlayer = officers.some(actor => actor.mesh.visible && (actor.mesh.userData.downUntil || 0) <= time && distance(actor.mesh.position, playerPosition) < 54 && hasSight(actor.mesh.position, playerPosition, world.colliders));
    const seesPlayer = heat.wanted > 0 && (patrolSeesPlayer || officerSeesPlayer);
    if (seesPlayer) {
      heat.lastKnown = playerPosition.clone(); lastSeen = time; heat.policeState = 'pursuit'; heat.searchProgress = 0;
    } else if (heat.wanted > 0 && time - lastSeen > 2.5) {
      if (heat.policeState !== 'searching') { heat.policeState = 'searching'; lostAt = time; onToast?.('OUT OF SIGHT', 'Stay clear while the patrol searches.'); }
      heat.searchProgress = clamp((time - lostAt) / searchDuration, 0, 1);
      if (heat.searchProgress >= 1) {
        heat.wanted = 0; heat.policeState = 'clear'; heat.searchProgress = 0; heat.lastKnown = null;
        onToast?.('HEAT LOST', 'You slipped the search.');
      }
    }
    const deploy = currentCar !== police && !police.stolen && heat.wanted > 0 && police.health > 0 && patrolDistance < 26 && (!currentCar || Math.abs(currentCar.speed) < 4);
    if (police !== currentCar && !police.stolen && police.health > 0) {
      if (heat.wanted > 0 && heat.lastKnown && !deploy) {
        const speed = heat.policeState === 'searching' ? (distance(patrolPosition, heat.lastKnown) > 8 ? 7 : 0) : Math.min(19, 10 + heat.wanted * 2);
        steerAlongRoad(police, heat.lastKnown, dt, speed);
      } else police.speed = THREE.MathUtils.damp(police.speed, 0, 5, dt);
      police.model.update(dt, police.speed, police.steer);
      police.model.setDamage?.(police.health);
    }
    for (let i = 0; i < officers.length; i++) {
      const actor = officers[i];
      if ((actor.mesh.userData.downUntil || 0) > time) { actor.update(dt, { speed: 0, dead: true }); continue; }
      if (deploy) {
        if (!actor.mesh.visible) {
          actor.mesh.position.copy(patrolPosition).add(new THREE.Vector3(i ? 1.8 : -1.8, 0, 1));
          actor.mesh.visible = true;
        }
        const p = actor.mesh.position;
        delta.copy(playerPosition).sub(p); delta.y = 0;
        const d = delta.length(); delta.normalize();
        const speed = d > 14 ? 3.1 : 0;
        if (speed) moveBody(p, delta.x * speed * dt, delta.z * speed * dt, .4);
        actor.mesh.rotation.y = Math.atan2(delta.x, delta.z);
        const firing = d < 26 && hasSight(p, playerPosition, world.colliders) && time > nextShot;
        if (firing) {
          nextShot = time + 1.7;
          const origin = actor.getMuzzlePosition(new THREE.Vector3());
          const target = playerPosition.clone().add(new THREE.Vector3(0, currentCar ? .8 : 1.1, 0));
          // Each encounter grants one warning window; additional crimes cannot renew it.
          const hit = time - engagementStarted > 6 && Math.random() > .45;
          if (!hit) target.x += 1.2;
          onPoliceShot?.({ origin, target, hit, damage: currentCar ? 3 : 7 });
        }
        actor.update(dt, { speed, aiming: true, shooting: firing });
      } else { actor.mesh.visible = false; }
    }
    return { ...heat };
  }
  function reset() {
    Object.assign(heat, { wanted: 0, policeState: 'clear', searchProgress: 0, reportProgress: 0, lastKnown: null });
    pendingLevel = 0; reportAt = 0; lastSeen = engagementStarted = -100; nextShot = 0;
    officers.forEach(actor => { actor.mesh.visible = false; actor.mesh.userData.downUntil = 0; });
    pedestrians.forEach(p => { p.route = null; p.reportingUntil = 0; p.evictedUntil = 0; p.detour = null; p.nextDetourCheck = 0; p.velocity = { x: 0, z: 0 }; p.streetBehavior = 'idle'; p.yieldReason = null; });
    vehicles.forEach(car => { car.yieldingToPedestrian = false; car.desiredSpeed = 0; car.trafficDecision = 'idle'; });
  }
  return { reportCrime, update, reset, getState: () => ({ ...heat }), getDiagnostics: () => ({
    pedestrians: pedestrians.map((p, id) => ({ id, position: p.actor.mesh.position.toArray(), actualSpeed: Math.hypot(p.velocity?.x || 0, p.velocity?.z || 0), behavior: p.streetBehavior || 'idle', yieldReason: p.yieldReason, detourPoints: p.detour?.length || 0, routeTarget: p.route?.[p.waypoint]?.toArray() })),
    traffic: vehicles.filter(car => car.traffic).map(car => ({ id: vehicles.indexOf(car), position: car.model.mesh.position.toArray(), heading: car.heading, speed: car.speed, desiredSpeed: car.desiredSpeed || 0, yielding: !!car.yieldingToPedestrian, decision: car.trafficDecision || 'idle' })),
  }) };
}
