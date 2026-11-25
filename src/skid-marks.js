import * as THREE from 'three';

const CAPACITY = 768;
const VERTICES = 8;
const CROSS_SECTION = [-.095, -.057, .057, .095];
const PAVING = new Set(['road', 'base-paving', 'sidewalk', 'district-floor']);

// One mesh holds both rear tire trails. Each segment owns its vertices so
// wrapping the buffer or lifting a tire never draws a line across the map.
export function createSkidMarks(scene, sampleGround) {
  const geometry = new THREE.BufferGeometry();
  const points = new THREE.BufferAttribute(new Float32Array(CAPACITY * VERTICES * 3), 3).setUsage(THREE.DynamicDrawUsage);
  const colors = new THREE.BufferAttribute(new Uint8Array(CAPACITY * VERTICES * 4), 4, true).setUsage(THREE.DynamicDrawUsage);
  colors.array.fill(255);
  geometry.setAttribute('position', points);
  geometry.setAttribute('color', colors);
  const indices = [];
  for (let i = 0; i < CAPACITY; i++) {
    for (let j = 0; j < 3; j++) {
      const a = i * VERTICES + j;
      indices.push(a, a + 4, a + 1, a + 1, a + 4, a + 5);
    }
  }
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color: 0x191916, vertexColors: true, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  material.forceSinglePass = true;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Rear tire marks'; mesh.frustumCulled = false;
  scene.add(mesh);
  let cursor = 0, count = 0, lastCar;
  const previous = [null, null], ground = {};
  const interrupt = () => { previous.fill(null); lastCar = null; };
  function clear() {
    interrupt(); cursor = count = 0; geometry.setDrawRange(0, 0); mesh.visible = false;
  }
  clear();
  function segment(from, to) {
    const first = cursor * VERTICES;
    for (let row = 0; row < 2; row++) {
      const p = row ? to : from;
      for (let j = 0; j < CROSS_SECTION.length; j++) {
        const index = first + row * 4 + j, offset = CROSS_SECTION[j];
        points.setXYZ(index, p.x + p.rightX * offset, p.y, p.z + p.rightZ * offset);
        const alpha = (j === 0 || j === 3) ? 0 : Math.round(p.opacity * 255);
        colors.array[index * 4 + 3] = alpha;
      }
    }
    points.addUpdateRange(first * 3, VERTICES * 3);
    colors.addUpdateRange(first * 4, VERTICES * 4);
    points.needsUpdate = colors.needsUpdate = true;
    cursor = (cursor + 1) % CAPACITY; count = Math.min(CAPACITY, count + 1);
    geometry.setDrawRange(0, count * 18); mesh.visible = true;
  }
  function update(car, slip, handbrake) {
    if (Math.abs(car.speed) < 4 || (!handbrake && slip < .44)) { interrupt(); return; }
    if (lastCar !== car) { interrupt(); lastCar = car; }
    const pos = car.model.mesh.position, sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    for (let wheel = 0; wheel < 2; wheel++) {
      const offset = (wheel === 0 ? -1 : 1) * (car.model.type === 'sport' ? .96 : .8);
      const x = pos.x - sin * 1.38 + cos * offset, z = pos.z - cos * 1.38 - sin * offset;
      const from = previous[wheel], distance = from ? Math.hypot(x - from.x, z - from.z) : Infinity;
      if (distance < .23) continue;
      sampleGround(x, z, ground);
      if (!PAVING.has(ground.kind)) { previous[wheel] = null; continue; }
      // Road stripes and turning arrows are shallow raised meshes.
      const lift = ground.kind === 'road' ? .03 : .009;
      const to = { x, y: ground.height + lift, z, rightX: cos, rightZ: -sin,
        opacity: Math.min(.68, .2 + slip * .35 + (handbrake ? .18 : 0)) };
      if (from && distance < 2.5 && Math.abs(from.y - to.y) < .08) segment(from, to);
      previous[wheel] = to;
    }
  }
  return { update, interrupt, clear };
}
