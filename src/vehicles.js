import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { instanceFarVehicleWheels } from './vehicle-wheel-instances.js';

// A metre-scale original coupe. The chassis points along +Z; every wheel is
// genuinely round, and the body has open wheel arches rather than black decals.
const steel = new THREE.MeshStandardMaterial({ color: 0xaab0b6, metalness: 0.92, roughness: 0.21 });
const polished = new THREE.MeshStandardMaterial({ color: 0xe5e7e7, metalness: 0.95, roughness: 0.14 });
const charcoal = new THREE.MeshStandardMaterial({ color: 0x15191b, metalness: 0.27, roughness: 0.55 });
const rubber = new THREE.MeshStandardMaterial({ color: 0x151718, roughness: 0.91 });
const tread = new THREE.MeshStandardMaterial({ color: 0x080909, roughness: 0.95 });
const cabinTrim = new THREE.MeshStandardMaterial({ color: 0x202526, roughness: 0.84 });
const leather = new THREE.MeshStandardMaterial({ color: 0x393a35, roughness: 0.85 });
const glass = new THREE.MeshStandardMaterial({ color: 0x30464c, metalness: 0.3, roughness: 0.14, transparent: true, opacity: 0.84, side: THREE.DoubleSide });
glass.forceSinglePass = true;
const bodyBottom = new THREE.MeshStandardMaterial({ color: 0x222624, roughness: 0.78 });
const redBrake = new THREE.MeshStandardMaterial({ color: 0xb73525, roughness: 0.4, metalness: 0.45 });
const blackPaint = new THREE.MeshStandardMaterial({ color: 0x10191c, metalness: 0.5, roughness: 0.26 });
const geometryCache = new Map();
let plateTexture;
let policeTexture;

function cached(key, factory) {
  if (!geometryCache.has(key)) geometryCache.set(key, factory());
  return geometryCache.get(key);
}
// Merge fixed pieces by material. A detailed car remains inexpensive enough to
// populate a city: trim details do not each require their own rendering call.
function batchParts(root, excludeDynamic = false) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert();
  const buckets = new Map(), sources = [];
  root.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    let parent = object;
    while (parent !== root && parent) {
      if (excludeDynamic && parent.userData.dynamic) return;
      parent = parent.parent;
    }
    let geometry = object.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld));
    if (geometry.index) { const indexed = geometry; geometry = indexed.toNonIndexed(); indexed.dispose(); }
    // Rounded boxes have UVs, simple quads do not. These materials only need
    // positions and normals; textured pieces keep their UV attribute.
    if (!object.material.map) geometry.deleteAttribute('uv');
    geometry.deleteAttribute('uv1'); geometry.clearGroups();
    if (!buckets.has(object.material)) buckets.set(object.material, []);
    buckets.get(object.material).push(geometry);
    sources.push(object);
  });
  for (const [material, geometries] of buckets) {
    const merged = mergeGeometries(geometries, false);
    if (merged) part(root, merged, material);
    for (const geometry of geometries) geometry.dispose();
  }
  for (const object of sources) object.removeFromParent();
}
function rounded(w, h, d, r = 0.04) {
  return cached(`round-${w}-${h}-${d}-${r}`, () => {
    if (Math.min(w, h, d) < 0.035) return new THREE.BoxGeometry(w, h, d);
    return new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));
  });
}
function part(parent, geometry, material, x = 0, y = 0, z = 0) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(x, y, z);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}
function box(parent, material, dimensions, position, radius = 0.025) {
  return part(parent, rounded(...dimensions, radius), material, ...position);
}
function quad(parent, material, vertices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return part(parent, geometry, material);
}
function bar(parent, a, b, radius, material) {
  const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
  const direction = end.clone().sub(start);
  const object = part(parent, new THREE.CylinderGeometry(radius, radius, direction.length(), 6), material);
  object.position.copy(start.add(end).multiplyScalar(0.5));
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return object;
}
function drawPlate() {
  if (plateTexture || typeof document === 'undefined') return plateTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 224;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e7e4ce'; ctx.fillRect(0, 0, 512, 224);
  ctx.strokeStyle = '#7a807c'; ctx.lineWidth = 12; ctx.strokeRect(7, 7, 498, 210);
  ctx.fillStyle = '#a84737'; ctx.font = 'italic bold 39px Georgia'; ctx.textAlign = 'center'; ctx.fillText('Pacific Coast', 256, 53);
  ctx.fillStyle = '#253840'; ctx.font = 'bold 83px monospace'; ctx.fillText('ASTRA 01', 256, 153);
  ctx.fillStyle = '#6b706c'; ctx.font = '17px sans-serif'; ctx.fillText('THE SUNSHINE STATE', 256, 195);
  plateTexture = new THREE.CanvasTexture(canvas); plateTexture.colorSpace = THREE.SRGBColorSpace;
  return plateTexture;
}
function policeDecal() {
  if (policeTexture || typeof document === 'undefined') return policeTexture;
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 384;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 384);
  ctx.fillStyle = '#172a37'; ctx.strokeStyle = '#bc9c57'; ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(105, 67); ctx.lineTo(256, 67); ctx.lineTo(264, 191);
  ctx.quadraticCurveTo(253, 245, 180, 286); ctx.quadraticCurveTo(106, 245, 96, 191); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#d4bb78'; ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 27 : 61;
    const x = 180 + Math.cos(a) * r, y = 165 + Math.sin(a) * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = '#172a37';
  ctx.font = 'italic bold 122px sans-serif'; ctx.fillText('POLICE', 638, 185);
  ctx.font = 'bold 34px sans-serif'; ctx.fillText('LOS PACIFICOS', 638, 242);
  ctx.fillStyle = '#ad8c48'; ctx.fillRect(345, 271, 582, 5);
  ctx.font = '20px sans-serif'; ctx.fillText('PUBLIC SAFETY  •  EST. 1987', 638, 312);
  policeTexture = new THREE.CanvasTexture(canvas); policeTexture.colorSpace = THREE.SRGBColorSpace;
  return policeTexture;
}

const profile = [
  [-2.2, 0.79, 0.72], [-2.08, 0.87, 0.82], [-1.7, 0.945, 0.90],
  [-1.32, 0.96, 0.94], [-0.8, 0.91, 0.91], [-0.1, 0.89, 0.88],
  [0.7, 0.92, 0.89], [1.35, 0.96, 0.91], [1.82, 0.92, 0.81],
  [2.10, 0.85, 0.70], [2.24, 0.76, 0.60],
];
function section(z) {
  let a = profile[0], b = profile[1];
  for (let i = 1; i < profile.length; i++) {
    b = profile[i];
    if (z <= b[0]) break;
    a = b;
  }
  const t = THREE.MathUtils.clamp((z - a[0]) / (b[0] - a[0] || 1), 0, 1);
  const smooth = t * t * (3 - 2 * t);
  return { width: THREE.MathUtils.lerp(a[1], b[1], smooth), top: THREE.MathUtils.lerp(a[2], b[2], smooth) };
}
function wheelArch(z) {
  for (const center of [-1.39, 1.38]) {
    const distance = Math.abs(z - center);
    if (distance < 0.435) return 0.365 + Math.sqrt(0.435 ** 2 - distance ** 2);
  }
  return 0.33;
}
function bodyShell(material) {
  const group = new THREE.Group();
  const vertices = [], indices = [];
  const n = 96, cross = 10;
  // The gently crowned bonnet, fenders and rear deck form a continuous surface.
  for (let i = 0; i <= n; i++) {
    const z = -2.2 + 4.44 * i / n;
    const { width, top } = section(z);
    for (let j = 0; j <= cross; j++) {
      const u = -1 + 2 * j / cross;
      const fender = Math.exp(-(((Math.abs(z) - 1.38) / 0.48) ** 2)) * Math.pow(Math.abs(u), 3) * 0.068;
      vertices.push(u * width, top + (1 - u * u) * 0.055 + fender, z);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < cross; j++) {
    const a = i * (cross + 1) + j, b = a + cross + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); topGeometry.setIndex(indices); topGeometry.computeVertexNormals();
  part(group, topGeometry, material);
  for (const side of [-1, 1]) {
    const verts = [], faces = [];
    for (let i = 0; i <= n; i++) {
      const z = -2.2 + 4.44 * i / n, { width, top } = section(z);
      const fender = Math.exp(-(((Math.abs(z) - 1.38) / 0.48) ** 2)) * 0.068;
      const low = wheelArch(z), shoulder = top + fender;
      verts.push(side * width, shoulder, z, side * (width + 0.008), THREE.MathUtils.lerp(low, shoulder, 0.68), z, side * (width - 0.035), low, z);
    }
    for (let i = 0; i < n; i++) {
      const z = -2.2 + 4.44 * (i + 0.5) / n;
      if (z > -0.755 && z < 0.765) continue; // The real moving door fills this aperture.
      for (let row = 0; row < 2; row++) {
        const a = i * 3 + row, b = a + 3;
        if (side > 0) faces.push(a, b, a + 1, a + 1, b, b + 1);
        else faces.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geometry.setIndex(faces); geometry.computeVertexNormals();
    part(group, geometry, material);
    // A fine body-coloured rolled wheel arch gives the fender an actual edge.
    for (const zc of [-1.39, 1.38]) {
      const points = [];
      for (let i = 0; i <= 26; i++) {
        const angle = i / 26 * Math.PI, z = zc + Math.cos(angle) * 0.436;
        points.push(new THREE.Vector3(side * (section(z).width + 0.006), 0.365 + Math.sin(angle) * 0.436, z));
      }
      part(group, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 20, 0.014, 4, false), material);
    }
  }
  for (const z of [-2.2, 2.24]) {
    const { width, top } = section(z);
    const vertices = [[-width, 0.34, z], [width, 0.34, z], [width, top, z], [-width, top, z]];
    quad(group, material, z > 0 ? vertices : vertices.reverse());
  }
  box(group, bodyBottom, [1.65, 0.12, 3.95], [0, 0.33, -0.01]);
  return group;
}

function makeWheel() {
  const group = new THREE.Group();
  const tireGeometry = cached('tire', () => {
    const shape = [[0.251, -0.13], [0.312, -0.129], [0.351, -0.105], [0.369, -0.053], [0.369, 0.053], [0.351, 0.105], [0.312, 0.129], [0.251, 0.13]];
    const geometry = new THREE.LatheGeometry(shape.map(p => new THREE.Vector2(...p)), 28); geometry.rotateZ(Math.PI / 2); return geometry;
  });
  part(group, tireGeometry, rubber);
  const torus = cached('tire-groove', () => { const g = new THREE.TorusGeometry(0.3675, 0.003, 3, 28); g.rotateY(Math.PI / 2); return g; });
  for (const offset of [-0.045, 0.045]) part(group, torus, tread, offset, 0, 0);
  const rim = cached('rim', () => { const g = new THREE.CylinderGeometry(0.25, 0.25, 0.022, 28); g.rotateZ(Math.PI / 2); return g; });
  part(group, rim, charcoal, 0.116, 0, 0);
  const disc = cached('brake-disc', () => { const g = new THREE.CylinderGeometry(0.207, 0.207, 0.012, 24); g.rotateZ(Math.PI / 2); return g; });
  part(group, disc, steel, 0.135, 0, 0);
  const rimLip = cached('rim-lip', () => { const g = new THREE.TorusGeometry(0.238, 0.012, 4, 28); g.rotateY(Math.PI / 2); return g; });
  part(group, rimLip, polished, 0.151, 0, 0);
  for (let spoke = 0; spoke < 5; spoke++) {
    for (const split of [-1, 1]) {
      const angle = spoke / 5 * Math.PI * 2 + split * 0.095;
      const object = box(group, polished, [0.024, 0.028, 0.205], [0.153, -Math.sin(angle) * 0.125, Math.cos(angle) * 0.125], 0.008);
      object.rotation.x = angle + split * 0.11;
    }
    const angle = spoke / 5 * Math.PI * 2;
    const bolt = part(group, cached('wheel-bolt', () => new THREE.OctahedronGeometry(0.009, 0)), charcoal, 0.174, Math.cos(angle) * 0.046, Math.sin(angle) * 0.046);
    bolt.scale.x = 0.45;
  }
  const hub = part(group, cached('hub', () => { const g = new THREE.CylinderGeometry(0.056, 0.056, 0.022, 12); g.rotateZ(Math.PI / 2); return g; }), steel, 0.16, 0, 0);
  hub.castShadow = false;
  batchParts(group);
  return group;
}

/**
 * @returns {{mesh: THREE.Group, wheels: THREE.Group[], frontWheels: THREE.Group[],
 * update: (dt:number,speed:number,steer:number)=>void, setLights:(enabled:boolean)=>void,
 * setDoor:(open:boolean)=>void}}
 */
function createOriginalCar({ color = 0xe4bb67, type = 'sport', police = false } = {}) {
  const mesh = new THREE.Group(); mesh.name = police ? 'Pacific Coast patrol coupe' : 'Comet GT';
  const paint = new THREE.MeshPhysicalMaterial({ color: police ? 0xe8e8df : color, metalness: 0.22, roughness: 0.34, clearcoat: 0.55, clearcoatRoughness: 0.24, envMapIntensity: 0.7 });
  paint.name = 'body';
  const headlight = new THREE.MeshStandardMaterial({ color: 0xeaf8ee, metalness: 0.2, roughness: 0.12, emissive: 0xf4ffc9, emissiveIntensity: 0.8 });
  const tailLight = new THREE.MeshStandardMaterial({ color: 0x8b1010, metalness: 0.25, roughness: 0.16, emissive: 0xff2615, emissiveIntensity: 0.8 });
  headlight.name = 'headlight_left'; tailLight.name = 'taillight_left';
  const rightHeadlight = headlight.clone(); rightHeadlight.name = 'headlight_right';
  const rightTailLight = tailLight.clone(); rightTailLight.name = 'taillight_right';
  mesh.add(bodyShell(paint));

  // Low glasshouse with full-height raked windscreen, rear glass, and a curved roof.
  const roof = box(mesh, police ? blackPaint : paint, [1.28, 0.085, 0.97], [0, 1.402, -0.14], 0.042);
  quad(mesh, glass, [[-0.76, 0.955, 0.91], [0.76, 0.955, 0.91], [0.615, 1.385, 0.345], [-0.615, 1.385, 0.345]]);
  quad(mesh, glass, [[0.76, 0.985, -1.24], [-0.76, 0.985, -1.24], [-0.615, 1.365, -0.64], [0.615, 1.365, -0.64]]);
  for (const side of [-1, 1]) {
    bar(mesh, [side * 0.78, 0.95, 0.94], [side * 0.625, 1.4, 0.345], 0.032, paint);
    bar(mesh, [side * 0.625, 1.4, -0.63], [side * 0.79, 0.95, -1.27], 0.065, police ? blackPaint : paint);
    quad(mesh, glass, [[side * 0.802, 0.94, -1.1], [side * 0.82, 0.94, -0.77], [side * 0.637, 1.35, -0.59], [side * 0.65, 1.31, -0.7]]);
    bar(mesh, [side * 0.637, 1.36, -0.6], [side * 0.82, 0.91, -0.77], 0.024, charcoal);
    // Rocker panel and subtle body crease.
    box(mesh, charcoal, [0.055, 0.075, 1.72], [side * 0.88, 0.335, 0.0], 0.02);
  }
  box(mesh, charcoal, [1.48, 0.09, 0.05], [0, 0.965, 0.9]);
  for (const side of [-1, 1]) {
    const wiper = box(mesh, charcoal, [0.48, 0.014, 0.016], [side * 0.31, 1.003, 0.855], 0.004); wiper.rotation.y = side * -0.13;
  }

  // The driver's door is a separate rigid panel, including its frameless glass.
  const doors = [];
  for (const side of [-1, 1]) {
    const door = new THREE.Group(); door.userData.dynamic = true; door.position.set(side * 0.9, 0, 0.765); mesh.add(door);
    const local = (x, y, z) => [x - side * 0.9, y, z - 0.765];
    const exterior = [local(side * 0.873, 0.34, -0.77), local(side * 0.891, 0.34, 0.77), local(side * 0.93, 0.91, 0.77), local(side * 0.91, 0.934, -0.77)];
    const panel = quad(door, paint, side < 0 ? exterior : exterior.reverse());
    panel.material.side = THREE.DoubleSide;
    quad(door, glass, [local(side * 0.84, 0.945, -0.73), local(side * 0.845, 0.943, 0.75), local(side * 0.628, 1.36, 0.337), local(side * 0.636, 1.36, -0.585)]);
    bar(door, local(side * 0.846, 0.941, -0.75), local(side * 0.85, 0.941, 0.77), 0.015, charcoal);
    box(door, polished, [0.022, 0.034, 0.17], local(side * 0.923, 0.78, -0.58), 0.012);
    box(door, cabinTrim, [0.035, 0.31, 1.28], local(side * 0.858, 0.61, -0.015), 0.015);
    bar(door, local(side * 0.84, 0.95, 0.6), local(side * 1.02, 0.99, 0.55), 0.024, charcoal);
    const mirror = box(door, police ? blackPaint : paint, [0.2, 0.12, 0.22], local(side * 1.05, 1.005, 0.53), 0.05);
    box(door, polished, [0.15, 0.078, 0.011], local(side * 1.05, 1.007, 0.414), 0.016);
    if (police) {
      const decalMaterial = new THREE.MeshStandardMaterial({ map: policeDecal(), transparent: true, depthWrite: false, roughness: 0.65 });
      const decal = part(door, new THREE.PlaneGeometry(0.92, 0.34), decalMaterial, ...local(side * 0.924, 0.65, -0.04));
      decal.rotation.y = side * Math.PI / 2;
    }
    batchParts(door);
    doors.push({ object: door, side });
  }

  // Visible cockpit: sculpted sport seats, headrests, dashboard and steering wheel.
  box(mesh, cabinTrim, [1.48, 0.12, 1.75], [0, 0.52, -0.06]);
  box(mesh, cabinTrim, [1.46, 0.17, 0.31], [0, 0.86, 0.52], 0.065);
  box(mesh, charcoal, [0.23, 0.22, 0.94], [0, 0.68, -0.1], 0.05);
  for (const side of [-1, 1]) {
    box(mesh, leather, [0.47, 0.13, 0.52], [side * 0.4, 0.56, -0.20], 0.06);
    const back = box(mesh, leather, [0.46, 0.5, 0.13], [side * 0.4, 0.82, -0.45], 0.06); back.rotation.x = -0.13;
    box(mesh, leather, [0.25, 0.19, 0.11], [side * 0.4, 1.12, -0.49], 0.04);
  }
  const steering = part(mesh, cached('steering-wheel', () => new THREE.TorusGeometry(0.14, 0.016, 6, 20)), charcoal, -0.4, 0.965, 0.32); steering.rotation.x = -0.38;
  box(mesh, charcoal, [0.2, 0.038, 0.035], [-0.4, 0.965, 0.32], 0.01);

  // Bumpers, cooling intakes and lights are geometrical, not painted on the shell.
  box(mesh, charcoal, [1.52, 0.165, 0.045], [0, 0.455, 2.235], 0.04);
  box(mesh, charcoal, [1.78, 0.055, 0.17], [0, 0.335, 2.13], 0.025);
  for (let i = -5; i <= 5; i++) box(mesh, bodyBottom, [0.018, 0.1, 0.025], [i * 0.1, 0.455, 2.262], 0.003);
  box(mesh, police ? blackPaint : paint, [0.065, 0.145, 0.055], [0, 0.455, 2.268], 0.01);
  for (const side of [-1, 1]) {
    const activeHeadlight = side < 0 ? headlight : rightHeadlight;
    const activeTailLight = side < 0 ? tailLight : rightTailLight;
    const lampHousing = part(mesh, cached('headlight-housing', () => new THREE.SphereGeometry(1, 16, 10)), charcoal, side * 0.645, 0.762, 1.985);
    lampHousing.scale.set(0.202, 0.143, 0.16); lampHousing.rotation.x = -0.53;
    const lens = part(mesh, cached('headlight-lens', () => new THREE.SphereGeometry(1, 16, 10)), activeHeadlight, side * 0.645, 0.789, 2.025);
    lens.scale.set(0.168, 0.114, 0.12); lens.rotation.x = -0.53;
    box(mesh, activeHeadlight, [0.24, 0.028, 0.035], [side * 0.61, 0.435, 2.266], 0.012);
    box(mesh, charcoal, [0.625, 0.12, 0.055], [side * 0.47, 0.735, -2.18], 0.035);
    box(mesh, activeTailLight, [0.572, 0.071, 0.06], [side * 0.47, 0.743, -2.21], 0.023);
    box(mesh, charcoal, [0.28, 0.095, 0.05], [side * 0.64, 0.43, -2.17], 0.02);
    const exhaust = part(mesh, cached('exhaust', () => new THREE.CylinderGeometry(0.045, 0.045, 0.17, 14, 1, true)), polished, side * 0.65, 0.35, -2.19); exhaust.rotation.x = Math.PI / 2;
    part(mesh, cached('exhaust-hole', () => new THREE.CircleGeometry(0.037, 14)), tread, side * 0.65, 0.35, -2.278).rotation.y = Math.PI;
  }
  box(mesh, charcoal, [1.63, 0.14, 0.14], [0, 0.36, -2.13], 0.035);
  const plateMaterial = new THREE.MeshStandardMaterial({ map: drawPlate(), color: 0xffffff, roughness: 0.45 });
  const plate = part(mesh, new THREE.PlaneGeometry(0.38, 0.166), plateMaterial, 0, 0.545, -2.213); plate.rotation.y = Math.PI;
  part(mesh, new THREE.PlaneGeometry(0.32, 0.14), plateMaterial, 0, 0.51, 2.278);
  // Rear engine grille and hood shut-lines.
  for (let i = 0; i < 7; i++) box(mesh, charcoal, [0.92, 0.012, 0.018], [0, 0.952 - i * 0.008, -1.32 - i * 0.064], 0.004);
  for (const side of [-1, 1]) {
    const points = [[side * 0.57, 0.95, 0.88], [side * 0.58, 0.962, 1.15], [side * 0.56, 0.945, 1.43], [side * 0.49, 0.864, 1.82]];
    part(mesh, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))), 16, 0.0035, 3, false), charcoal);
  }
  const badge = part(mesh, cached('badge', () => new THREE.SphereGeometry(0.025, 8, 6)), polished, 0, 0.833, 1.92); badge.scale.set(1, 0.14, 1.4);

  const wheels = [], frontWheels = [];
  for (const z of [-1.39, 1.38]) for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.userData.dynamic = true; pivot.position.set(side * 0.94, 0.37, z); mesh.add(pivot);
    const spin = makeWheel(); spin.scale.x = side; pivot.add(spin); wheels.push(spin);
    const caliper = box(pivot, redBrake, [0.038, 0.14, 0.075], [side * 0.13, 0.015, -0.15], 0.016);
    if (z > 0) frontWheels.push(pivot);
  }

  let lightsEnabled = true, doorTarget = 0, doorPosition = 0, elapsed = Math.random() * 3;
  const strobes = [];
  if (police) {
    box(mesh, charcoal, [1.11, 0.055, 0.29], [0, 1.49, -0.12], 0.02);
    for (const side of [-1, 1]) {
      const material = new THREE.MeshStandardMaterial({ color: side < 0 ? 0x175bcb : 0xc92128, roughness: 0.16, metalness: 0.2, emissive: side < 0 ? 0x126aff : 0xff1324, emissiveIntensity: 2 });
      const light = box(mesh, material, [0.43, 0.105, 0.25], [side * 0.295, 1.55, -0.12], 0.035);
      light.userData.dynamic = true;
      strobes.push(material);
    }
    bar(mesh, [0.43, 1.42, -0.45], [0.43, 1.95, -0.54], 0.006, charcoal);
  }
  if (type === 'sport') {
    // Small ducktail integrated into the rear deck, rather than an oversized wing.
    const spoiler = box(mesh, paint, [1.52, 0.055, 0.19], [0, 0.86, -1.98], 0.027); spoiler.rotation.x = -0.17;
  }
  batchParts(mesh, true);
  mesh.userData.vehicle = true;
  mesh.userData.dimensions = { width: 2.22, length: 4.56, height: police ? 1.95 : 1.45 };
  return {
    mesh, wheels, frontWheels,
    update(dt = 0, speed = 0, steer = 0) {
      elapsed += dt;
      for (const wheel of wheels) wheel.rotation.x += speed * dt / 0.369;
      for (const pivot of frontWheels) pivot.rotation.y = THREE.MathUtils.clamp(steer, -0.65, 0.65);
      doorPosition = THREE.MathUtils.damp(doorPosition, doorTarget, 8, dt);
      doors[0].object.rotation.y = doorPosition;
      if (police) strobes.forEach((material, index) => { material.emissiveIntensity = lightsEnabled && Math.sin(elapsed * 15 + index * Math.PI) > 0 ? 4.5 : 0.15; });
    },
    setLights(enabled) {
      lightsEnabled = Boolean(enabled);
      headlight.emissiveIntensity = lightsEnabled ? 2.0 : 0.12;
      tailLight.emissiveIntensity = lightsEnabled ? 1.5 : 0.2;
    },
    setDoor(open) { doorTarget = open ? 1.05 : 0; },
  };
}

// Keep a consistent projected-size threshold when the photo lens narrows or
// widens. Three's built-in LOD accounts for zoom, but not camera field of view.
const farWheelInstances = new WeakMap();
class VehicleLOD extends THREE.LOD {
  update(camera) {
    const reference = Math.tan(THREE.MathUtils.degToRad(55) / 2);
    const field = camera.isPerspectiveCamera && Number.isFinite(camera.fov)
      ? Math.tan(THREE.MathUtils.degToRad(THREE.MathUtils.clamp(camera.fov, 1, 175)) / 2) : reference;
    const zoom = (Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1) * reference / field;
    super.update({ matrixWorld: camera.matrixWorld, zoom });
    const car = new THREE.Vector3().setFromMatrixPosition(this.matrixWorld);
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    this.userData.effectiveDistance = car.distanceTo(eye) / zoom;
    // Projection precedes GPU buffer upload and shadows. Refresh only the
    // rendered detail level, once per frame rather than each physics substep.
    farWheelInstances.get(this.levels[this.getCurrentLevel()]?.object)?.update();
  }
}

// Authored models keep wheel and door pivots in their exported hierarchy.
// The procedural coupe remains available if local asset loading fails.
let vehicleAssetsPromise;
let auroraVehicleTemplates;
let sedanVehicleTemplates;

function prepareAuroraTemplate(scene) {
  scene.updateMatrixWorld(true);
  const body = scene.getObjectByName('body_group');
  const door = scene.getObjectByName('driver_door');
  const names = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];
  if (!body || !door || names.some(name => !scene.getObjectByName(name) || !scene.getObjectByName(`${name}_spin`))) {
    throw new Error('Aurora model is missing its body, door, or wheel pivots.');
  }
  // Blender's scene wrapper is not part of the gameplay coordinate system.
  // Preserve its world transforms while giving suspension direct root pivots.
  const result = new THREE.Group(); result.name = 'AstraAurora';
  for (const child of [...body.parent.children]) result.attach(child);
  return result;
}

/** Preload the original sports car and sedan; absent optional LODs keep near detail. */
export function loadVehicleAssets(loader = new GLTFLoader()) {
  if (!vehicleAssetsPromise) {
    const sports = Promise.allSettled([
      loader.loadAsync('/models/AstraAurora.glb'), loader.loadAsync('/models/AstraAurora-lod.glb'),
    ]).then(results => {
      if (results[0].status !== 'fulfilled') throw results[0].reason;
      const near = prepareAuroraTemplate(results[0].value.scene);
      auroraVehicleTemplates = [near];
      if (results[1].status === 'fulfilled') {
        try { auroraVehicleTemplates.push(prepareAuroraTemplate(results[1].value.scene)); }
        catch (error) { console.warn('Aurora distance model unavailable; retaining full detail.', error); }
      }
    }).catch(error => console.warn('Aurora sports-car assets unavailable; using the original coupe.', error));
    const sedans = Promise.all([
      loader.loadAsync('/models/vehicles/meridian.glb'), loader.loadAsync('/models/vehicles/meridian-lod.glb'),
    ]).then(models => { sedanVehicleTemplates = models.map(model => model.scene); })
      .catch(error => console.warn('Meridian sedan assets unavailable; using the original coupe.', error));
    vehicleAssetsPromise = Promise.all([sports, sedans]).then(() => Boolean(auroraVehicleTemplates || sedanVehicleTemplates));
  }
  return vehicleAssetsPromise;
}

function vehiclePalette(color) {
  const palette = {
    body: new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.33, clearcoat: 0.55, clearcoatRoughness: 0.23, envMapIntensity: 0.72 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xadb5b2, metalness: 0.87, roughness: 0.29, envMapIntensity: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xbec8ca, metalness: 1, roughness: 0.17 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x505757, metalness: 0.83, roughness: 0.34 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x171b1a, metalness: 0.12, roughness: 0.77 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x483a2f, metalness: 0.02, roughness: 0.68 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111516, metalness: 0, roughness: 0.92 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x708884, metalness: 0.18, roughness: 0.12, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 0.85 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xe9f4ed, roughness: 0.12, metalness: 0.25, emissive: 0xe5f4d9, emissiveIntensity: 0.35 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0xa60909, roughness: 0.16, metalness: 0.2, emissive: 0xff130a, emissiveIntensity: 0.4 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xeb9224, roughness: 0.25, emissive: 0xfda52a, emissiveIntensity: 0.25 }),
    badge: new THREE.MeshStandardMaterial({ color: 0xc69c2e, roughness: 0.3, metalness: 0.7 }),
  };
  palette.headlight_left = palette.headlight; palette.headlight_right = palette.headlight.clone();
  palette.taillight_left = palette.taillight; palette.taillight_right = palette.taillight.clone();
  palette.glass.forceSinglePass = true;
  for (const [name, material] of Object.entries(palette)) { material.name = name; material.side = THREE.DoubleSide; }
  return palette;
}

function createAuroraCar({ color }) {
  const mesh = new THREE.Group(); mesh.name = 'Astra Aurora — coastal roadster';
  const lod = new VehicleLOD(); mesh.add(lod);
  const palette = new Map();
  const materialFor = source => {
    if (!palette.has(source.name)) {
      let material = source.clone();
      if (source.name === 'body' || source.name === 'upper') {
        material = new THREE.MeshPhysicalMaterial({ color, metalness: 0.32, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.13, envMapIntensity: 1 });
        material.name = 'body';
      }
      if (source.name === 'glass') {
        material.transparent = true; material.opacity = 0.27;
        material.depthWrite = false; material.side = THREE.DoubleSide;
        material.forceSinglePass = true;
      } else material.side = THREE.FrontSide;
      palette.set(source.name, material);
    }
    return palette.get(source.name);
  };
  const levels = auroraVehicleTemplates.map((template, index) => {
    const level = template.clone(true);
    level.traverse(object => {
      if (!object.isMesh) return;
      object.material = Array.isArray(object.material) ? object.material.map(materialFor) : materialFor(object.material);
      object.castShadow = ![].concat(object.material).some(material => material.name === 'glass');
      object.receiveShadow = true;
    });
    const wheels = [], frontWheels = [];
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      wheels.push(level.getObjectByName(`${name}_spin`));
      if (name.startsWith('wheel_f')) frontWheels.push(level.getObjectByName(name));
    }
    lod.addLevel(level, index ? 32 : 0, index ? 0.12 : 0);
    level.visible = index === 0;
    return { mesh: level, wheels, frontWheels, door: level.getObjectByName('driver_door'), steering: level.getObjectByName('steering_wheel') };
  });
  mesh.updateMatrixWorld(true);
  const anchorPosition = (name, fallback) => levels[0].mesh.getObjectByName(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(...fallback);
  mesh.userData.driverSeat = anchorPosition('driver_seat', [-0.43, 0.50, -0.34]);
  mesh.userData.doorEntry = anchorPosition('door_entry', [-1.65, 0, -0.15]);
  mesh.userData.doorEntry.x = Math.min(-1.65, mesh.userData.doorEntry.x);
  mesh.userData.enginePosition = anchorPosition('engine_anchor', [0, 0.63, 1.25]);
  const plateMap = drawPlate();
  const plateMaterial = new THREE.MeshStandardMaterial({ ...(plateMap ? { map: plateMap } : {}), color: 0xe1e2d5, roughness: 0.52 });
  const plate = part(mesh, new THREE.PlaneGeometry(0.36, 0.155), plateMaterial, 0, 0.52, -2.265); plate.rotation.y = Math.PI;
  let doorTarget = 0, doorAngle = 0, wheelAngle = 0;
  mesh.userData.vehicle = true;
  mesh.userData.originalAurora = true;
  mesh.userData.model = 'Astra Aurora — original Blender asset';
  const dimensions = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  mesh.userData.dimensions = { width: dimensions.x, length: dimensions.z, height: dimensions.y };
  mesh.userData.detailLevels = { near: 0, far: 0, transitionMetres: 32 };
  for (const [index, level] of levels.entries()) level.mesh.traverse(object => {
    if (object.isMesh) mesh.userData.detailLevels[index ? 'far' : 'near'] += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  if (levels.length === 1) mesh.userData.detailLevels.far = mesh.userData.detailLevels.near;
  return {
    mesh, wheels: levels[0].wheels, frontWheels: levels[0].frontWheels,
    update(dt = 0, speed = 0, steer = 0) {
      wheelAngle = (wheelAngle + speed * dt / 0.352) % (Math.PI * 2);
      doorAngle = THREE.MathUtils.damp(doorAngle, doorTarget, 9, dt);
      for (const level of levels) {
        level.door.rotation.y = doorAngle;
        if (level.steering) level.steering.rotation.z = THREE.MathUtils.clamp(steer, -1, 1) * 0.8;
        for (const wheel of level.wheels) wheel.rotation.x = wheelAngle;
        for (const pivot of level.frontWheels) pivot.rotation.y = THREE.MathUtils.clamp(steer, -0.65, 0.65);
      }
    },
    // The shared enhancement owns running, brake and damaged-lamp intensities.
    setLights() {},
    setDoor(open) { doorTarget = open ? 1.12 : 0; },
  };
}

function sedanPalette(color, police) {
  const palette = vehiclePalette(police ? 0xe9e7df : color);
  palette.body.roughness = 0.25;
  palette.body.clearcoat = 1.0;
  palette.body.clearcoatRoughness = 0.14;
  palette.body.envMapIntensity = 1.0;
  palette.upper = palette.body.clone(); palette.upper.name = 'body';
  if (police) palette.upper.color.setHex(0x14212b);
  palette.dark = new THREE.MeshStandardMaterial({ color: 0x161d22, roughness: 0.61, metalness: 0.15 });
  palette.brake = new THREE.MeshStandardMaterial({ color: 0x535a5c, roughness: 0.54, metalness: 0.55 });
  palette.lamp_lens = new THREE.MeshStandardMaterial({ color: 0x537885, roughness: 0.14, metalness: 0.28 });
  palette.screen = new THREE.MeshStandardMaterial({ color: 0x102126, emissive: 0x266474, emissiveIntensity: 0.3, roughness: 0.4 });
  palette.glass.color.setHex(0x8caaaf); palette.glass.opacity = 0.29;
  palette.leather.color.setHex(police ? 0x262e31 : 0x514335);
  for (const material of new Set(Object.values(palette))) material.side = material === palette.glass ? THREE.DoubleSide : THREE.FrontSide;
  return palette;
}

function addPatrolEquipment(level, palette, strobes) {
  const body = level.getObjectByName('body_group'), door = level.getObjectByName('driver_door');
  const equipment = new THREE.Group(); body.add(equipment);
  box(equipment, palette.dark, [1.13, 0.045, 0.27], [0, 1.548, -0.13], 0.02);
  for (const side of [-1, 1]) {
    box(equipment, palette.dark, [0.12, 0.055, 0.23], [side * 0.39, 1.511, -0.13], 0.014);
    const strobe = strobes[side < 0 ? 0 : 1];
    for (let i = 0; i < 3; i++) box(equipment, strobe, [0.145, 0.067, 0.236], [side * (0.102 + i * 0.16), 1.601, -0.13], 0.02);
    // Rubber-faced push bar, radio aerial and bumper strobes identify the patrol variant.
    bar(equipment, [side * 0.44, 0.37, 2.36], [side * 0.44, 0.79, 2.36], 0.035, palette.dark);
    box(equipment, strobe, [0.1, 0.028, 0.02], [side * 0.19, 0.635, 2.335], 0.006);
  }
  bar(equipment, [-0.5, 0.72, 2.36], [0.5, 0.72, 2.36], 0.026, palette.dark);
  bar(equipment, [0.4, 1.447, -0.87], [0.4, 1.97, -0.98], 0.005, palette.dark);
  batchParts(equipment);
  const decalMaterial = new THREE.MeshStandardMaterial({ map: policeDecal(), transparent: true, depthWrite: false, roughness: 0.64, polygonOffset: true, polygonOffsetFactor: -1 });
  for (const side of [-1, 1]) {
    const target = side < 0 ? door : body;
    const decal = part(target, new THREE.PlaneGeometry(1.04, 0.39), decalMaterial, side * 0.989, 0.748, 0.182);
    if (side < 0) decal.position.sub(door.position);
    decal.rotation.y = side * Math.PI / 2;
    decal.castShadow = false;
  }
}

// Original Blender-authored four-door sedan. The source GLBs contain real
// driver-door and wheel pivots; no topology guessing or per-car remeshing.
function createSedanCar({ color, police }) {
  const mesh = new THREE.Group();
  mesh.name = police ? 'Astra Meridian — Los Pacificos patrol' : 'Astra Meridian — executive sedan';
  const lod = new VehicleLOD(); mesh.add(lod);
  const palette = sedanPalette(color, police);
  const strobes = police ? [0x135eff, 0xff172a].map(color => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: 0.27, metalness: 0.08 })) : [];
  const levels = sedanVehicleTemplates.map((template, index) => {
    const level = template.clone(true);
    level.traverse(object => {
      if (!object.isMesh) return;
      object.material = palette[object.material.name] || palette.dark;
      object.castShadow = object.material !== palette.glass;
      object.receiveShadow = true;
    });
    if (police) addPatrolEquipment(level, palette, strobes);
    const wheels = [], frontWheels = [];
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const pivot = level.getObjectByName(name);
      wheels.push(level.getObjectByName(`${name}_spin`));
      if (name.startsWith('wheel_f')) frontWheels.push(pivot);
    }
    lod.addLevel(level, index ? 26 : 0, index ? 0.12 : 0);
    level.visible = index === 0;
    return { mesh: level, wheels, frontWheels, door: level.getObjectByName('driver_door') };
  });
  const map = drawPlate();
  const plateMaterial = new THREE.MeshStandardMaterial({ ...(map ? { map } : {}), color: 0xe1e2d5, roughness: 0.55 });
  const rearPlate = part(mesh, new THREE.PlaneGeometry(0.423, 0.185), plateMaterial, 0, 0.693, -2.333); rearPlate.rotation.y = Math.PI;
  part(mesh, new THREE.PlaneGeometry(0.34, 0.149), plateMaterial, 0, 0.519, 2.332);
  let doorTarget = 0, doorAngle = 0, wheelAngle = 0, elapsed = 0, lightsEnabled = true;
  mesh.userData.vehicle = true;
  mesh.userData.originalSedan = true;
  mesh.userData.model = 'Astra Meridian — original Blender asset';
  mesh.userData.dimensions = { width: 2.27, length: 4.68, height: police ? 1.98 : 1.51 };
  mesh.userData.detailLevels = { near: 0, far: 0, transitionMetres: 26 };
  for (const [index, level] of levels.entries()) level.mesh.traverse(object => {
    if (object.isMesh) mesh.userData.detailLevels[index ? 'far' : 'near'] += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
  });
  return {
    mesh, wheels: levels[0].wheels, frontWheels: levels[0].frontWheels,
    update(dt = 0, speed = 0, steer = 0) {
      elapsed += dt;
      wheelAngle = (wheelAngle + speed * dt / 0.344) % (Math.PI * 2);
      doorAngle = THREE.MathUtils.damp(doorAngle, doorTarget, 9, dt);
      for (const level of levels) {
        level.door.rotation.y = doorAngle;
        for (const wheel of level.wheels) wheel.rotation.x = wheelAngle;
        for (const pivot of level.frontWheels) pivot.rotation.y = THREE.MathUtils.clamp(steer, -0.65, 0.65);
      }
      strobes.forEach((material, index) => {
        const phase = (elapsed * 3.5 + index * 0.5) % 1;
        material.emissiveIntensity = lightsEnabled && (phase < 0.14 || phase > 0.21 && phase < 0.35) ? 5 : 0.1;
      });
    },
    setLights(enabled) { lightsEnabled = Boolean(enabled); },
    setDoor(open) { doorTarget = open ? 1.15 : 0; },
  };
}

/** Full vehicle contract with original authored sports and sedan models. */
export function createCar({ color = 0xe4bb67, type = 'sport', police = false } = {}) {
  const roadster = type === 'sport' && !police && Boolean(auroraVehicleTemplates);
  const sedan = Boolean(sedanVehicleTemplates) && (type !== 'sport' || police);
  const vehicle = roadster ? createAuroraCar({ color }) : sedan ? createSedanCar({ color, police }) : createOriginalCar({ color, type, police });
  return enhanceVehicle(vehicle, { type: police ? 'police' : type, roadster });
}

let smokeMap;
function getSmokeMap() {
  if (smokeMap) return smokeMap;
  const size = 48, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
    const i = (y * size + x) * 4;
    pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
    pixels[i + 3] = Math.round(Math.max(0, (1 - radius) ** 2) * (radius < 1 ? 180 : 0));
  }
  smokeMap = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  smokeMap.needsUpdate = true; smokeMap.magFilter = THREE.LinearFilter; smokeMap.minFilter = THREE.LinearFilter;
  return smokeMap;
}

function makeWindshieldCracks(roadster, sedan = false) {
  const vertices = [];
  const point = (u, v) => roadster
    ? new THREE.Vector3((u - 0.5) * (1.64 - v * 0.18), 0.88 + v * 0.41 + 0.025 * (1 - (u * 2 - 1) ** 2), 0.72 - v * 0.57 + 0.04 * (1 - (u * 2 - 1) ** 2) + 0.008)
    : sedan ? new THREE.Vector3((u - 0.5) * (1.762 - v * 0.27), 1.042 + v * 0.398 + 0.035 * (1 - (u * 2 - 1) ** 2), 0.953 - v * 0.578 + 0.025 * (1 - (u * 2 - 1) ** 2) * Math.sin(v * Math.PI))
      : new THREE.Vector3((u - 0.5) * (1.52 - v * 0.29), 0.963 + v * 0.43, 0.918 - v * 0.565);
  const add = (a, b) => vertices.push(...point(...a).toArray(), ...point(...b).toArray());
  const center = [0.32, 0.48];
  for (let spoke = 0; spoke < 11; spoke++) {
    const angle = spoke * Math.PI * 2 / 11, extent = 0.24 + (spoke % 4) * 0.06;
    let previous = center;
    for (let step = 1; step <= 4; step++) {
      const distance = extent * step / 4;
      const next = [THREE.MathUtils.clamp(center[0] + Math.cos(angle + Math.sin(step * spoke) * 0.12) * distance, 0.02, 0.98), THREE.MathUtils.clamp(center[1] + Math.sin(angle) * distance, 0.02, 0.98)];
      add(previous, next); previous = next;
    }
  }
  for (const radius of [0.07, 0.14]) for (let spoke = 0; spoke < 11; spoke++) {
    const a = spoke / 11 * Math.PI * 2, b = (spoke + 1) / 11 * Math.PI * 2;
    add([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius], [center[0] + Math.cos(b) * radius, center[1] + Math.sin(b) * radius]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const cracks = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0xe4ece3, transparent: true, opacity: 0.58, depthWrite: false }));
  cracks.name = 'damaged_windshield'; cracks.visible = false;
  return cracks;
}

// Geometry trees are shared by undamaged vehicle instances. A broken window or
// dent changes its attribute/index version and rebuilds only that mesh's tree.
const surfaceTrees = new WeakMap();
function vehicleSurfaceTree(geometry) {
  const position = geometry.attributes.position, index = geometry.index;
  const cached = surfaceTrees.get(geometry);
  if (cached && cached.position === position && cached.positionVersion === position.version
    && cached.index === index && cached.indexVersion === index?.version
    && cached.start === geometry.drawRange.start && cached.count === geometry.drawRange.count) return cached;
  const start = Math.ceil(geometry.drawRange.start / 3) * 3;
  const end = Math.floor(Math.min(index?.count ?? position.count, geometry.drawRange.start + geometry.drawRange.count) / 3) * 3;
  const count = Math.max(0, (end - start) / 3);
  const vertices = new Uint32Array(count * 3), bounds = new Float32Array(count * 6);
  const order = new Uint32Array(count);
  for (let face = 0; face < count; face++) {
    order[face] = face;
    const offset = start + face * 3;
    const ids = [0, 1, 2].map(corner => index ? index.getX(offset + corner) : offset + corner);
    vertices.set(ids, face * 3);
    for (let axis = 0; axis < 3; axis++) {
      const values = ids.map(id => position.getComponent(id, axis));
      bounds[face * 6 + axis] = Math.min(...values);
      bounds[face * 6 + axis + 3] = Math.max(...values);
    }
  }
  const build = ids => {
    if (!ids.length) return null;
    const box = new THREE.Box3();
    for (const face of ids) {
      const offset = face * 6;
      box.min.x = Math.min(box.min.x, bounds[offset]); box.max.x = Math.max(box.max.x, bounds[offset + 3]);
      box.min.y = Math.min(box.min.y, bounds[offset + 1]); box.max.y = Math.max(box.max.y, bounds[offset + 4]);
      box.min.z = Math.min(box.min.z, bounds[offset + 2]); box.max.z = Math.max(box.max.z, bounds[offset + 5]);
    }
    // Small leaves bound the number of exact triangle tests for narrow rays.
    if (ids.length <= 12) return { box, faces: ids };
    const size = box.getSize(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? 0 : size.y >= size.z ? 1 : 2;
    ids.sort((a, b) => bounds[a * 6 + axis] + bounds[a * 6 + axis + 3] - bounds[b * 6 + axis] - bounds[b * 6 + axis + 3]);
    const middle = Math.floor(ids.length / 2);
    return { box, left: build(ids.slice(0, middle)), right: build(ids.slice(middle)) };
  };
  const tree = { position, positionVersion: position.version, index, indexVersion: index?.version,
    start: geometry.drawRange.start, count: geometry.drawRange.count, firstTriangle: start / 3, vertices, root: build(order) };
  surfaceTrees.set(geometry, tree);
  return tree;
}

// Entry distance into a bounds volume. Containment is only a broadphase test;
// it never establishes a hit inside an empty cockpit or broken windshield.
function rayBoundsDistance(ray, box, maximum) {
  let near = 0, far = maximum;
  for (const axis of ['x', 'y', 'z']) {
    const direction = ray.direction[axis], origin = ray.origin[axis];
    if (Math.abs(direction) < 1e-12) {
      if (origin < box.min[axis] || origin > box.max[axis]) return Infinity;
      continue;
    }
    const a = (box.min[axis] - origin) / direction, b = (box.max[axis] - origin) / direction;
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return Infinity;
  }
  return near;
}

function addVehicleSurfaceQueries(vehicle, lod, extras, getRevision) {
  const model = vehicle.mesh;
  const roots = lod ? [lod.levels[0].object, extras] : [model];
  const surfaces = [];
  for (const root of roots) root.traverse(object => {
    if (object.isMesh) {
      vehicleSurfaceTree(object.geometry); // Warm shared trees while constructing the scene, before play.
      surfaces.push({ object, root, inverse: new THREE.Matrix4(), normal: new THREE.Matrix3() });
    }
  });
  model.updateWorldMatrix(true, true);
  const inverseModel = model.matrixWorld.clone().invert();
  const broadBounds = new THREE.Box3().setFromObject(roots[0]).applyMatrix4(inverseModel);
  const door = roots[0].getObjectByName('driver_door');
  if (door) {
    const hinge = door.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseModel);
    const bounds = new THREE.Box3().setFromObject(door).applyMatrix4(inverseModel);
    const radius = Math.max(...[bounds.min.x, bounds.max.x].flatMap(x => [bounds.min.z, bounds.max.z].map(z => Math.hypot(x - hinge.x, z - hinge.z))));
    broadBounds.expandByPoint(new THREE.Vector3(hinge.x - radius, bounds.min.y, hinge.z - radius));
    broadBounds.expandByPoint(new THREE.Vector3(hinge.x + radius, bounds.max.y, hinge.z + radius));
  } else {
    // The procedural fallback has unnamed doors but keeps the same full swing.
    broadBounds.expandByScalar(1.5);
  }
  // Includes steering tires, permitted body suspension and small dent offsets.
  broadBounds.expandByScalar(0.35);
  const previousWorld = new THREE.Matrix4(), worldRay = new THREE.Ray(), localRay = new THREE.Ray();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), intersection = new THREE.Vector3();
  const localNormal = new THREE.Vector3(), normalEdge = new THREE.Vector3();
  const stack = [];
  let previousRevision = -1;
  let diagnostics = { broadphaseMiss: false, meshesTested: 0, trianglesTested: 0 };
  const rayInFrame = inverse => {
    localRay.origin.copy(worldRay.origin).applyMatrix4(inverse);
    const e = inverse.elements, d = worldRay.direction;
    localRay.direction.set(e[0] * d.x + e[4] * d.y + e[8] * d.z,
      e[1] * d.x + e[5] * d.y + e[9] * d.z, e[2] * d.x + e[6] * d.y + e[10] * d.z);
    const scale = localRay.direction.length(); localRay.direction.multiplyScalar(1 / scale);
    return scale;
  };
  vehicle.getSurfaceQueryInfo = () => ({ ...diagnostics });
  /** World-space two-sided physical surfaces, independent of rendering LOD.
   * The contact normal faces the incoming ray. Empty bounding space is a miss.
   */
  vehicle.raycastSurface = (ray, maxDistance = Infinity) => {
    if (typeof maxDistance !== 'number' || Number.isNaN(maxDistance) || maxDistance < 0) throw new RangeError('Vehicle ray distance must be nonnegative.');
    diagnostics = { broadphaseMiss: false, meshesTested: 0, trianglesTested: 0 };
    const lengthSq = ray.direction.lengthSq();
    if (!model.visible || !Number.isFinite(lengthSq) || lengthSq < 1e-18
      || ![ray.origin.x, ray.origin.y, ray.origin.z].every(Number.isFinite)) return null;
    worldRay.origin.copy(ray.origin); worldRay.direction.copy(ray.direction).normalize();
    model.updateWorldMatrix(true, false);
    inverseModel.copy(model.matrixWorld).invert();
    const scale = rayInFrame(inverseModel);
    if (rayBoundsDistance(localRay, broadBounds, maxDistance * scale) === Infinity) {
      diagnostics.broadphaseMiss = true; return null;
    }
    const revision = getRevision();
    if (previousRevision !== revision || !previousWorld.equals(model.matrixWorld)) {
      for (const root of roots) root.updateWorldMatrix(true, true);
      for (const entry of surfaces) {
        entry.inverse.copy(entry.object.matrixWorld).invert();
        entry.normal.getNormalMatrix(entry.object.matrixWorld);
      }
      previousRevision = revision; previousWorld.copy(model.matrixWorld);
    }
    let closest = null, nearest = maxDistance;
    for (const { object, root, inverse, normal } of surfaces) {
      let visible = true;
      for (let node = object; node && node !== root; node = node.parent) if (!node.visible) { visible = false; break; }
      if (!visible || !object.visible) continue;
      const tree = vehicleSurfaceTree(object.geometry);
      if (!tree.root) continue;
      const localScale = rayInFrame(inverse);
      let localNearest = nearest * localScale;
      if (rayBoundsDistance(localRay, tree.root.box, localNearest) === Infinity) continue;
      diagnostics.meshesTested++;
      stack.length = 0; stack.push(tree.root);
      while (stack.length) {
        const node = stack.pop();
        if (rayBoundsDistance(localRay, node.box, localNearest) === Infinity) continue;
        if (!node.faces) {
          const left = rayBoundsDistance(localRay, node.left.box, localNearest);
          const right = rayBoundsDistance(localRay, node.right.box, localNearest);
          if (left < right) { if (right !== Infinity) stack.push(node.right); if (left !== Infinity) stack.push(node.left); }
          else { if (left !== Infinity) stack.push(node.left); if (right !== Infinity) stack.push(node.right); }
          continue;
        }
        for (const face of node.faces) {
          const faceIndex = tree.firstTriangle + face;
          const materialIndex = Array.isArray(object.material)
            ? object.geometry.groups.find(group => faceIndex * 3 >= group.start && faceIndex * 3 < group.start + group.count)?.materialIndex ?? 0 : 0;
          const material = Array.isArray(object.material) ? object.material[materialIndex] : object.material;
          if (!material?.visible || material.transparent && material.opacity === 0) continue;
          a.fromBufferAttribute(tree.position, tree.vertices[face * 3]);
          b.fromBufferAttribute(tree.position, tree.vertices[face * 3 + 1]);
          c.fromBufferAttribute(tree.position, tree.vertices[face * 3 + 2]);
          diagnostics.trianglesTested++;
          if (!localRay.intersectTriangle(a, b, c, false, intersection)) continue;
          const distance = intersection.distanceTo(localRay.origin) / localScale;
          if (distance > nearest) continue;
          localNormal.subVectors(b, a).cross(normalEdge.subVectors(c, a)).applyNormalMatrix(normal);
          const frontFace = localNormal.dot(worldRay.direction) <= 0;
          if (!frontFace) localNormal.negate();
          nearest = distance; localNearest = nearest * localScale;
          closest = { distance, point: worldRay.at(distance, new THREE.Vector3()), normal: localNormal.clone(),
            mesh: object, material, faceIndex, frontFace, surfaceName: object.name || material.name || 'vehicle_surface' };
        }
      }
    }
    return closest;
  };
}

/** Adds suspension, staged damage, and consistent local interaction anchors. */
function enhanceVehicle(vehicle, { type, roadster }) {
  vehicle.type = type;
  vehicle.mesh.userData.vehicleType = type;
  vehicle.mesh.userData.damageHealth = 100;
  const chassis = [], wheelPivots = [], paintMeshes = [], glassMeshes = [], headlights = [], taillights = [];
  const chassisFor = (parent, parts) => {
    const body = new THREE.Group(); body.name = 'suspended_chassis'; parent.add(body);
    for (const child of parts) body.add(child);
    chassis.push(body); return body;
  };
  const lod = vehicle.mesh.children.find(child => child.isLOD);
  if (lod) {
    for (const level of lod.levels) {
      const pivots = level.object.children.filter(child => /^wheel_[fr][lr]$/.test(child.name));
      wheelPivots.push(...pivots);
      chassisFor(level.object, level.object.children.filter(child => !pivots.includes(child)));
    }
  } else {
    const pivots = [...new Set(vehicle.wheels.map(wheel => wheel.parent))];
    wheelPivots.push(...pivots);
    chassisFor(vehicle.mesh, vehicle.mesh.children.filter(child => !pivots.includes(child)));
  }
  const extras = new THREE.Group(); extras.name = 'vehicle_damage_effects'; vehicle.mesh.add(extras); chassis.push(extras);
  if (lod) for (const child of [...vehicle.mesh.children]) if (child.isMesh) extras.add(child);
  // Keep shared factory materials immutable; damage to one car never changes
  // another car's windows or bodywork.
  const glassCopies = new Map();
  vehicle.mesh.traverse(object => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    if (object.material === glass || object.material.name === 'glass') {
      if (!glassCopies.has(object.material)) { const copy = object.material.clone(); copy.name = 'glass'; glassCopies.set(object.material, copy); }
      object.material = glassCopies.get(object.material); glassMeshes.push(object);
    }
    if (object.material.name === 'body') paintMeshes.push(object);
    if (object.material.name.startsWith('headlight_')) headlights.push(object.material);
    if (object.material.name.startsWith('taillight_')) taillights.push(object.material);
  });
  const uniqueHeadlights = [...new Set(headlights)], uniqueTaillights = [...new Set(taillights)];
  const originalPaint = new Map();
  for (const object of paintMeshes) if (!originalPaint.has(object.material)) originalPaint.set(object.material, { color: object.material.color.clone(), roughness: object.material.roughness });
  const cracks = makeWindshieldCracks(roadster, vehicle.mesh.userData.originalSedan); extras.add(cracks);
  const smokeGeometry = new THREE.BufferGeometry();
  smokeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  const smoke = new THREE.Points(smokeGeometry, new THREE.PointsMaterial({ color: 0x666c69, map: getSmokeMap(), size: 0.95, transparent: true, opacity: 0.6, depthWrite: false, sizeAttenuation: true }));
  smoke.name = 'engine_smoke'; smoke.visible = false; smoke.frustumCulled = false; extras.add(smoke);
  const dentData = new WeakMap(), brokenGlassData = new WeakMap();
  const wheelRest = wheelPivots.map(pivot => ({ pivot, y: pivot.position.y }));
  const dynamics = { roll: 0, pitch: 0, heave: 0, brake: 0, slip: 0, speed: 0 };
  const spring = { roll: 0, rollVelocity: 0, pitch: 0, pitchVelocity: 0, heave: 0, heaveVelocity: 0 };
  let externalDynamics = false, damageHealth = 100, time = 0, lastSpeed = 0, lights = true, surfaceRevision = 0;
  const baseUpdate = vehicle.update.bind(vehicle), baseLights = vehicle.setLights.bind(vehicle);
  function updateLamps() {
    for (const material of uniqueHeadlights) {
      const broken = damageHealth < (material.name.endsWith('left') ? 62 : 24);
      material.emissiveIntensity = broken ? 0 : lights ? 2.1 : 0.2;
      material.color.setHex(broken ? 0x303932 : 0xe9f2e9);
    }
    for (const material of uniqueTaillights) {
      const broken = damageHealth < (material.name.endsWith('right') ? 18 : 8);
      material.emissiveIntensity = broken ? 0 : 0.35 + (lights ? 0.65 : 0) + dynamics.brake * 3.2;
      material.color.setHex(broken ? 0x2d1514 : 0x9c1110);
    }
  }
  function deformBody(object, health) {
    if (!dentData.has(object)) {
      const source = object.geometry; object.geometry = source.clone();
      const positions = new Float32Array(source.attributes.position.array);
      const normals = new Float32Array(source.attributes.normal.array);
      const groups = new Uint32Array(source.attributes.position.count), groupMap = new Map();
      // Batching makes the geometry non-indexed. Recomputing its normals would
      // turn every triangle into a visible flat facet. Preserve the original
      // smoothing groups, including deliberately sharp seams, while denting.
      for (let i = 0; i < groups.length; i++) {
        const offset = i * 3;
        const key = [0, 1, 2].map(axis => Math.round(positions[offset + axis] * 1e5)).join(',')
          + ':' + [0, 1, 2].map(axis => Math.round(normals[offset + axis] * 1e3)).join(',');
        if (!groupMap.has(key)) groupMap.set(key, groupMap.size);
        groups[i] = groupMap.get(key);
      }
      dentData.set(object, { positions, normals, groups, sums: new Float32Array(groupMap.size * 3) });
    }
    const data = dentData.get(object), attribute = object.geometry.attributes.position, normal = object.geometry.attributes.normal;
    const original = data.positions;
    if (health >= 82) {
      attribute.array.set(original); normal.array.set(data.normals);
      attribute.needsUpdate = normal.needsUpdate = true;
      object.geometry.computeBoundingSphere();
      return;
    }
    vehicle.mesh.updateMatrixWorld(true);
    const intoCar = new THREE.Matrix4().multiplyMatrices(vehicle.mesh.matrixWorld.clone().invert(), object.matrixWorld);
    const fromCar = intoCar.clone().invert();
    const point = new THREE.Vector3();
    const frontDamage = Math.max(0, (82 - health) / 82), rearDamage = Math.max(0, (42 - health) / 42);
    for (let i = 0; i < attribute.count; i++) {
      point.fromArray(original, i * 3).applyMatrix4(intoCar);
      const front = THREE.MathUtils.smoothstep(point.z, 1.3, 2.28) * Math.max(0, 1 - Math.abs(point.y - 0.5) / 0.75);
      const rear = THREE.MathUtils.smoothstep(-point.z, 1.65, 2.28);
      const side = point.x < 0 ? 1 : 0.45;
      point.z -= front * frontDamage * (0.21 + 0.045 * Math.sin(point.x * 17 + point.y * 11)) * side;
      point.x += front * frontDamage * (point.x < 0 ? 0.075 : -0.02);
      point.y -= front * frontDamage * 0.045;
      point.z += rear * rearDamage * 0.14;
      point.applyMatrix4(fromCar); attribute.setXYZ(i, point.x, point.y, point.z);
    }
    const sums = data.sums; sums.fill(0);
    const indices = object.geometry.index?.array;
    const count = indices?.length ?? attribute.count;
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < count; i += 3) {
      const ia = indices ? indices[i] : i, ib = indices ? indices[i + 1] : i + 1, ic = indices ? indices[i + 2] : i + 2;
      a.fromBufferAttribute(attribute, ia); b.fromBufferAttribute(attribute, ib); c.fromBufferAttribute(attribute, ic);
      ab.subVectors(b, a); ac.subVectors(c, a); ab.cross(ac);
      a.fromArray(data.normals, ia * 3); b.fromArray(data.normals, ib * 3); c.fromArray(data.normals, ic * 3);
      // Authored smoothing and any reflected node transforms must retain
      // their existing outward normal orientation after a dent.
      if (ab.dot(a.add(b).add(c)) < 0) ab.negate();
      for (const vertex of [ia, ib, ic]) {
        const offset = data.groups[vertex] * 3;
        sums[offset] += ab.x; sums[offset + 1] += ab.y; sums[offset + 2] += ab.z;
      }
    }
    for (let i = 0; i < attribute.count; i++) {
      const offset = data.groups[i] * 3;
      ab.fromArray(sums, offset);
      if (ab.lengthSq() < 1e-16) ab.fromArray(data.normals, i * 3);
      else ab.normalize();
      a.fromArray(data.normals, i * 3);
      if (ab.dot(a) < 0) ab.negate();
      normal.setXYZ(i, ab.x, ab.y, ab.z);
    }
    attribute.needsUpdate = normal.needsUpdate = true;
    object.geometry.computeBoundingSphere();
  }
  function shatterGlass(object, health) {
    if (!brokenGlassData.has(object)) {
      const geometry = object.geometry.clone(); object.geometry = geometry;
      brokenGlassData.set(object, geometry.index ? Array.from(geometry.index.array) : Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
    }
    const original = brokenGlassData.get(object);
    if (health > 28) { object.geometry.setIndex(original); return; }
    const indices = [], position = object.geometry.attributes.position;
    vehicle.mesh.updateMatrixWorld(true);
    const intoCar = new THREE.Matrix4().multiplyMatrices(vehicle.mesh.matrixWorld.clone().invert(), object.matrixWorld);
    const center = new THREE.Vector3();
    for (let i = 0; i < original.length; i += 3) {
      const a = original[i], b = original[i + 1], c = original[i + 2];
      center.set((position.getX(a) + position.getX(b) + position.getX(c)) / 3,
        (position.getY(a) + position.getY(b) + position.getY(c)) / 3,
        (position.getZ(a) + position.getZ(b) + position.getZ(c)) / 3).applyMatrix4(intoCar);
      const { x, y, z } = center;
      const windshieldHole = y > 0.9 && z > (roadster ? 0.1 : 0.25) && z < 1.14 && Math.abs(x + 0.19) < 0.42;
      if (!windshieldHole) indices.push(a, b, c);
    }
    object.geometry.setIndex(indices);
  }
  vehicle.setDamage = (health = 100) => {
    const next = THREE.MathUtils.clamp(Number.isFinite(health) ? health : 100, 0, 100);
    if (next === damageHealth) return;
    damageHealth = next; vehicle.mesh.userData.damageHealth = next; surfaceRevision++;
    for (const object of paintMeshes) deformBody(object, next);
    for (const [material, original] of originalPaint) {
      material.roughness = original.roughness + (1 - next / 100) * 0.16;
      material.color.copy(original.color).lerp(new THREE.Color(0x44453f), (1 - next / 100) * 0.12);
    }
    cracks.visible = next < 58 && next > 28;
    for (const object of glassMeshes) shatterGlass(object, next);
    smoke.visible = next < 34;
    smoke.material.color.setHex(next < 12 ? 0x32332f : 0x7a807b);
    updateLamps();
  };
  vehicle.setDynamics = values => {
    externalDynamics = true;
    for (const key of ['roll', 'pitch', 'heave', 'brake', 'slip', 'speed']) if (Number.isFinite(values[key])) dynamics[key] = values[key];
  };
  const driverSeat = vehicle.mesh.userData.driverSeat ?? new THREE.Vector3(-0.4, 0.65, -0.15);
  const doorEntry = vehicle.mesh.userData.doorEntry ?? new THREE.Vector3(-1.48, 0, -0.05);
  vehicle.getDriverSeat = (target = new THREE.Vector3()) => {
    target.copy(driverSeat);
    chassis[0].updateMatrix(); return target.applyMatrix4(chassis[0].matrix);
  };
  vehicle.getDoorPosition = (target = new THREE.Vector3()) => target.copy(doorEntry);
  vehicle.getDriverOrientation = (target = new THREE.Quaternion()) => chassis[0].getWorldQuaternion(target);
  let fullTriangles = 0;
  if (!lod) vehicle.mesh.traverse(object => { if (object.isMesh) fullTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3; });
  if (lod) for (const { object } of lod.levels.slice(1)) farWheelInstances.set(object, instanceFarVehicleWheels(object));
  vehicle.getDetailInfo = () => {
    const level = lod?.getCurrentLevel() ?? 0;
    const instancing = farWheelInstances.get(lod?.levels[level]?.object)?.getInfo();
    return { level, wheelDrawsSaved: instancing?.drawsSaved ?? 0, triangles: lod ? vehicle.mesh.userData.detailLevels[level ? 'far' : 'near'] : fullTriangles,
      effectiveDistance: lod?.userData.effectiveDistance ?? null };
  };
  vehicle.setLights = enabled => { lights = Boolean(enabled); baseLights(lights); updateLamps(); };
  vehicle.update = (dt = 0, speed = 0, steer = 0) => {
    const delta = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, 0.3);
    time += delta; baseUpdate(delta, speed, steer); surfaceRevision++;
    if (!externalDynamics) {
      const acceleration = delta > 0 ? THREE.MathUtils.clamp((speed - lastSpeed) / delta, -15, 12) : 0;
      dynamics.roll = steer * speed * speed * 0.00007;
      dynamics.pitch = -acceleration * 0.002;
      dynamics.heave = 0; dynamics.brake = acceleration < -1.5 ? Math.min(1, -acceleration / 10) : 0;
    }
    externalDynamics = false; lastSpeed = speed;
    const steps = Math.max(1, Math.ceil(delta * 120)), step = delta / steps;
    const stiffness = type === 'sport' ? 125 : 85, damping = type === 'sport' ? 19 : 15;
    const targets = { roll: THREE.MathUtils.clamp(dynamics.roll, -0.07, 0.07), pitch: THREE.MathUtils.clamp(dynamics.pitch, -0.055, 0.055), heave: THREE.MathUtils.clamp(dynamics.heave, -0.035, 0.035) };
    for (let substep = 0; substep < steps; substep++) for (const key of ['roll', 'pitch', 'heave']) {
      spring[`${key}Velocity`] += ((targets[key] - spring[key]) * stiffness - spring[`${key}Velocity`] * damping) * step;
      spring[key] += spring[`${key}Velocity`] * step;
    }
    for (const body of chassis) {
      body.rotation.z = spring.roll; body.rotation.x = spring.pitch;
      body.position.y = spring.heave + Math.sin(time * 12) * Math.min(0.0025, Math.abs(speed) * 0.00013);
    }
    for (const { pivot, y } of wheelRest) pivot.position.y = y;
    if (smoke.visible) {
      const position = smokeGeometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const life = (time * 0.37 + i / position.count) % 1;
        const source = vehicle.mesh.userData.enginePosition;
        position.setXYZ(i, (source?.x ?? 0) + Math.sin(i * 2.41 + time * 0.8) * life * 0.38, (source?.y ?? 0.82) + life * 1.9, (source?.z ?? 1.5) - life * Math.min(0.9, Math.abs(speed) * 0.06));
      }
      position.needsUpdate = true;
    }
    updateLamps();
  };
  vehicle.setLights(true);
  addVehicleSurfaceQueries(vehicle, lod, extras, () => surfaceRevision);
  return vehicle;
}
