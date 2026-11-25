import * as THREE from 'three';

const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = t => t * t * (3 - 2 * t);
const clamp = THREE.MathUtils.clamp;

/** Stationary support repositioning. Root gameplay facing is never delayed. */
export function createStandingTurnSteps() {
  let feet = null, swing = null, nextSide = null, lastYaw = 0, lastPosition = null, engaged = false;
  const destination = new THREE.Vector3();
  const info = () => {
    if (!feet || !engaged) return null;
    for (const [side, foot] of Object.entries(feet)) {
      foot.position = foot.point;
      foot.lifted = swing?.side === side;
      foot.lift = foot.lifted ? swing.lift : 0;
      foot.phase = foot.lifted ? swing.time / swing.duration : 0;
    }
    return feet;
  };
  function reset() { feet = null; swing = null; nextSide = null; lastPosition = null; engaged = false; }
  function update({ dt, enabled, position, yaw, samples, shapes }) {
    if (!enabled) { reset(); return null; }
    if (!feet) {
      feet = Object.fromEntries(Object.entries(samples).map(([side, point]) => [side, { point: point.clone(), yaw, floorY: point.y }]));
      lastYaw = yaw; lastPosition = position.clone();
    }
    const delta = wrap(yaw - lastYaw);
    if (position.distanceTo(lastPosition) > .14) { reset(); return null; }
    lastYaw = yaw; lastPosition.copy(position);
    if (!(dt > 0)) return info();
    const targetFor = (side, target, prediction = 0) => {
      const sign = side === 'Right' ? -1 : 1;
      target.set(sign * .12, 0, .025 - sign * .025).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw + prediction).add(position);
      target.y = feet[side].floorY;
      return target;
    };
    if (!swing) {
      let largest = 0, chosen = null;
      for (const side of ['Right', 'Left']) {
        const foot = feet[side];
        const angle = Math.abs(wrap(yaw - foot.yaw));
        const distance = targetFor(side, destination).distanceTo(foot.point);
        const need = Math.max(angle / .20, distance / .07);
        if (need > 1 && need > largest) { largest = need; chosen = side; }
      }
      if (chosen) {
        engaged = true;
        if (!nextSide) chosen = wrap(yaw - feet[chosen].yaw) > 0 ? 'Left' : 'Right';
        if (nextSide && Math.abs(wrap(yaw - feet[nextSide].yaw)) > .25) chosen = nextSide;
        const foot = feet[chosen];
        const prediction = clamp(delta / dt * .15, -.45, .45);
        swing = { side: chosen, start: foot.point.clone(), end: targetFor(chosen, new THREE.Vector3(), prediction),
          startYaw: foot.yaw, endYaw: yaw + prediction, duration: Math.max(dt * 1.8, THREE.MathUtils.mapLinear(clamp(Math.abs(delta / dt), 1.57, 3.14), 1.57, 3.14, .30, .22)), time: 0, lift: 0 };
        nextSide = chosen === 'Right' ? 'Left' : 'Right';
        const support = feet[nextSide].point;
        swing.arc = new THREE.Vector3(-(swing.end.z - swing.start.z), 0, swing.end.x - swing.start.x);
        if (swing.arc.lengthSq() < 1e-8) swing.arc.copy(swing.start).sub(support).setY(0);
        swing.arc.normalize();
        destination.copy(swing.start).add(swing.end).multiplyScalar(.5).sub(support);
        if (swing.arc.dot(destination) < 0) swing.arc.negate();
      }
    }
    if (swing) {
      swing.time = Math.min(swing.duration, swing.time + dt);
      const t = swing.time / swing.duration;
      if (t < .45) {
        const prediction = clamp(delta / dt * .15, -.45, .45);
        targetFor(swing.side, swing.end, prediction); swing.endYaw = yaw + prediction;
      }
      const foot = feet[swing.side];
      foot.point.lerpVectors(swing.start, swing.end, smooth(t));
      foot.point.addScaledVector(swing.arc, Math.sin(Math.PI * t) ** 2 * .07);
      swing.lift = Math.sin(Math.PI * t) ** 2 * .055;
      foot.point.y += swing.lift;
      foot.yaw = swing.startYaw + wrap(swing.endYaw - swing.startYaw) * smooth(t);
      // Plan the moving shoe against the supporting shoe's calibrated convex
      // footprint. Longer footwear needs more clearance than ankle distance
      // alone predicts. The support foot remains at its contact position.
      const support = feet[swing.side === 'Right' ? 'Left' : 'Right'];
      if (shapes) separateFootprints(foot, shapes[swing.side], support,
        shapes[swing.side === 'Right' ? 'Left' : 'Right']);
      if (t >= 1) swing = null;
    }
    return info();
  }
  return { update, reset, getInfo: info, isInitialized: () => Boolean(feet) };
}

export function convexFootprint(points) {
  const p = points.map(point => [point.x, point.z]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (o,a,b) => (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const lower=[], upper=[];
  for (const q of p) { while(lower.length>1 && cross(lower.at(-2),lower.at(-1),q)<=0) lower.pop(); lower.push(q); }
  for (const q of p.toReversed()) { while(upper.length>1 && cross(upper.at(-2),upper.at(-1),q)<=0) upper.pop(); upper.push(q); }
  return lower.slice(0,-1).concat(upper.slice(0,-1));
}
function separateFootprints(moving, movingShape, support, supportShape) {
  const transform = (foot, shape) => shape.map(([x,z]) => [foot.point.x+x*Math.cos(foot.yaw)+z*Math.sin(foot.yaw),
    foot.point.z-x*Math.sin(foot.yaw)+z*Math.cos(foot.yaw)]);
  const fixed=transform(support,supportShape), current=transform(moving,movingShape);
  // Preserve the chosen route around the support shoe. Choosing the shortest
  // signed SAT vector independently each frame can switch to the opposite side
  // of that shoe at the swing apex, teleporting the moving foot through it.
  let dx=moving.point.x-support.point.x,dz=moving.point.z-support.point.z;
  const distance=Math.hypot(dx,dz);
  if(distance<1e-5) return;
  dx/=distance; dz/=distance;
  let push=Infinity;
  for(const polygon of [current,fixed]) for(let i=0;i<polygon.length;i++) {
    const a=polygon[i],b=polygon[(i+1)%polygon.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(length<1e-6) continue;
    const x=(b[1]-a[1])/length,z=(a[0]-b[0])/length;
    const c=current.map(p=>p[0]*x+p[1]*z),f=fixed.map(p=>p[0]*x+p[1]*z);
    const positive=Math.max(...f)-Math.min(...c)+.018,negative=Math.max(...c)-Math.min(...f)+.018;
    if(positive<=0||negative<=0) return;
    const projected=dx*x+dz*z;
    if(projected>1e-5) push=Math.min(push,positive/projected);
    else if(projected< -1e-5) push=Math.min(push,negative/-projected);
  }
  if(Number.isFinite(push)) { moving.point.x+=dx*push; moving.point.z+=dz*push; }
}
