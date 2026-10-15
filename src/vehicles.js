import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 512, 192); ctx.fillStyle = '#17252b'; ctx.textAlign = 'center';
  ctx.font = 'bold 74px sans-serif'; ctx.fillText('POLICE', 256, 106);
  ctx.font = '22px sans-serif'; ctx.fillText('PACIFIC COAST', 256, 145);
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
  const paint = new THREE.MeshPhysicalMaterial({ color: police ? 0xe8e8df : color, metalness: 0.45, roughness: 0.24, clearcoat: 0.85, clearcoatRoughness: 0.13 });
  const headlight = new THREE.MeshStandardMaterial({ color: 0xeaf8ee, metalness: 0.2, roughness: 0.12, emissive: 0xf4ffc9, emissiveIntensity: 0.8 });
  const tailLight = new THREE.MeshStandardMaterial({ color: 0x8b1010, metalness: 0.25, roughness: 0.16, emissive: 0xff2615, emissiveIntensity: 0.8 });
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
    box(mesh, leather, [0.47, 0.13, 0.52], [side * 0.4, 0.66, -0.28], 0.06);
    const back = box(mesh, leather, [0.46, 0.5, 0.13], [side * 0.4, 0.92, -0.55], 0.06); back.rotation.x = -0.13;
    box(mesh, leather, [0.25, 0.19, 0.11], [side * 0.4, 1.22, -0.59], 0.04);
  }
  const steering = part(mesh, cached('steering-wheel', () => new THREE.TorusGeometry(0.14, 0.016, 6, 20)), charcoal, -0.4, 0.965, 0.32); steering.rotation.x = -0.38;
  box(mesh, charcoal, [0.2, 0.038, 0.035], [-0.4, 0.965, 0.32], 0.01);

  // Bumpers, cooling intakes and lights are geometrical, not painted on the shell.
  box(mesh, charcoal, [1.52, 0.165, 0.045], [0, 0.455, 2.235], 0.04);
  box(mesh, charcoal, [1.78, 0.055, 0.17], [0, 0.335, 2.13], 0.025);
  for (let i = -5; i <= 5; i++) box(mesh, bodyBottom, [0.018, 0.1, 0.025], [i * 0.1, 0.455, 2.262], 0.003);
  box(mesh, police ? blackPaint : paint, [0.065, 0.145, 0.055], [0, 0.455, 2.268], 0.01);
  for (const side of [-1, 1]) {
    const lampHousing = part(mesh, cached('headlight-housing', () => new THREE.SphereGeometry(1, 16, 10)), charcoal, side * 0.645, 0.762, 1.985);
    lampHousing.scale.set(0.202, 0.143, 0.16); lampHousing.rotation.x = -0.53;
    const lens = part(mesh, cached('headlight-lens', () => new THREE.SphereGeometry(1, 16, 10)), headlight, side * 0.645, 0.789, 2.025);
    lens.scale.set(0.168, 0.114, 0.12); lens.rotation.x = -0.53;
    box(mesh, headlight, [0.24, 0.028, 0.035], [side * 0.61, 0.435, 2.266], 0.012);
    box(mesh, charcoal, [0.625, 0.12, 0.055], [side * 0.47, 0.735, -2.18], 0.035);
    box(mesh, tailLight, [0.572, 0.071, 0.06], [side * 0.47, 0.743, -2.21], 0.023);
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

// Ferrari 458 Italia by vicent091036, via the Three.js examples. Locally
// optimized into two geometric detail levels, with real movable door panels.
// No decoder, remote requests, or texture downloads are needed at run time.
let vehicleAssetsPromise;
let importedVehicleTemplates;
const IMPORTED_SCALE = 1.006;

function componentIndices(geometry) {
  const position = geometry.attributes.position;
  const index = geometry.index;
  const parents = new Int32Array(position.count);
  for (let i = 0; i < parents.length; i++) parents[i] = i;
  const find = value => {
    while (parents[value] !== value) { parents[value] = parents[parents[value]]; value = parents[value]; }
    return value;
  };
  for (let i = 0; i < index.count; i += 3) {
    const first = find(index.getX(i));
    parents[find(index.getX(i + 1))] = first;
    parents[find(index.getX(i + 2))] = first;
  }
  const components = new Map();
  const point = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const id = find(index.getX(i));
    if (!components.has(id)) components.set(id, { indices: [], bounds: new THREE.Box3() });
    const component = components.get(id);
    for (let k = 0; k < 3; k++) {
      const vertex = index.getX(i + k);
      component.indices.push(vertex);
      component.bounds.expandByPoint(point.fromBufferAttribute(position, vertex));
    }
  }
  return components.values();
}

function modelMaterialName(name) {
  if (name === 'body') return 'body';
  if (name.startsWith('rim_')) return 'rim';
  if (name.startsWith('tire')) return 'rubber';
  if (name === 'glass') return 'glass';
  if (name === 'lights') return 'headlight';
  if (name === 'lights_red' || name === 'brakes') return 'taillight';
  if (name === 'leds') return 'indicator';
  if (name === 'chrome') return 'chrome';
  if (name === 'yellow_trim' || name.startsWith('centre')) return 'badge';
  if (name === 'leather' || name === 'trim') return 'leather';
  if (name === 'metal' || /^(wheel|brake|nuts)/.test(name)) return 'metal';
  return 'interior';
}

function prepareImportedTemplate(scene) {
  scene.rotation.y = Math.PI;
  scene.scale.setScalar(IMPORTED_SCALE);
  scene.updateMatrixWorld(true);
  const result = new THREE.Group();
  const bodyGroup = new THREE.Group(); bodyGroup.name = 'body_group'; result.add(bodyGroup);
  const door = new THREE.Group(); door.name = 'driver_door';
  door.position.set(-0.82 * IMPORTED_SCALE, 0.55, 0.7 * IMPORTED_SCALE); result.add(door);
  const wheelPivots = new Map();
  const placeholders = new Map();
  const material = name => {
    if (!placeholders.has(name)) { const m = new THREE.MeshStandardMaterial(); m.name = name; placeholders.set(name, m); }
    return placeholders.get(name);
  };
  scene.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld);
    geometry.computeVertexNormals();
    const category = modelMaterialName(object.name);
    let wheelAncestor = object.parent;
    while (wheelAncestor && !/^wheel_[fr][lr]$/.test(wheelAncestor.name)) wheelAncestor = wheelAncestor.parent;
    if (wheelAncestor) {
      if (!wheelPivots.has(wheelAncestor.name)) {
        const pivot = new THREE.Group();
        pivot.name = wheelAncestor.name;
        pivot.position.copy(wheelAncestor.getWorldPosition(new THREE.Vector3()));
        const spin = new THREE.Group(); spin.name = `${wheelAncestor.name}_spin`; pivot.add(spin);
        result.add(pivot); wheelPivots.set(wheelAncestor.name, pivot);
      }
      const pivot = wheelPivots.get(wheelAncestor.name);
      geometry.translate(-pivot.position.x, -pivot.position.y, -pivot.position.z);
      part(pivot.children[0], geometry, material(category));
      return;
    }
    // The original model contains separate topological islands for its door
    // skin, mirror, handle and interior trim. Keep their real edge contours.
    const movingIndices = [], fixedIndices = [];
    for (const component of componentIndices(geometry)) {
      const b = component.bounds;
      const belongsToDoor = b.max.x < -0.66 && b.min.z > -0.63 * IMPORTED_SCALE
        && b.max.z < 0.76 * IMPORTED_SCALE && b.min.y > 0.2 && b.max.y < 1.05;
      (belongsToDoor ? movingIndices : fixedIndices).push(...component.indices);
    }
    if (fixedIndices.length) {
      const fixed = geometry.clone(); fixed.setIndex(fixedIndices);
      part(bodyGroup, fixed, material(category));
    }
    if (movingIndices.length) {
      const moving = geometry.clone(); moving.setIndex(movingIndices);
      moving.translate(-door.position.x, -door.position.y, -door.position.z);
      part(door, moving, material(category));
    }
    geometry.dispose();
  });
  batchParts(bodyGroup);
  batchParts(door);
  for (const pivot of wheelPivots.values()) batchParts(pivot.children[0]);
  result.userData.optimizedModel = true;
  return result;
}

/** Preload once before creating sports cars; returns false if local assets fail. */
export function loadVehicleAssets() {
  if (!vehicleAssetsPromise) {
    const loader = new GLTFLoader();
    vehicleAssetsPromise = Promise.all([
      loader.loadAsync('/models/vehicles/ferrari.glb'),
      loader.loadAsync('/models/vehicles/ferrari-lod.glb'),
    ]).then(models => {
      importedVehicleTemplates = models.map(model => prepareImportedTemplate(model.scene));
      return true;
    }).catch(error => {
      console.warn('Detailed vehicle assets unavailable; using the original coupe.', error);
      return false;
    });
  }
  return vehicleAssetsPromise;
}

function importedPalette(color) {
  const palette = {
    body: new THREE.MeshPhysicalMaterial({ color, metalness: 0.3, roughness: 0.27, clearcoat: 0.8, clearcoatRoughness: 0.16, envMapIntensity: 0.95 }),
    rim: new THREE.MeshStandardMaterial({ color: 0xb9bfbd, metalness: 0.95, roughness: 0.2, envMapIntensity: 1.15 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xbec8ca, metalness: 1, roughness: 0.17 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x505757, metalness: 0.83, roughness: 0.34 }),
    interior: new THREE.MeshStandardMaterial({ color: 0x171b1a, metalness: 0.12, roughness: 0.77 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x483a2f, metalness: 0.02, roughness: 0.68 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111516, metalness: 0, roughness: 0.92 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x819995, metalness: 0.32, roughness: 0.08, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xe9f4ed, roughness: 0.12, metalness: 0.25, emissive: 0xe5f4d9, emissiveIntensity: 0.35 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0xa60909, roughness: 0.16, metalness: 0.2, emissive: 0xff130a, emissiveIntensity: 0.4 }),
    indicator: new THREE.MeshStandardMaterial({ color: 0xeb9224, roughness: 0.25, emissive: 0xfda52a, emissiveIntensity: 0.25 }),
    badge: new THREE.MeshStandardMaterial({ color: 0xc69c2e, roughness: 0.3, metalness: 0.7 }),
  };
  palette.glass.forceSinglePass = true;
  for (const [name, material] of Object.entries(palette)) { material.name = name; material.side = THREE.DoubleSide; }
  return palette;
}

function createImportedCar({ color }) {
  const mesh = new THREE.Group(); mesh.name = 'Astra 458 — Italian grand tourer';
  const lod = new THREE.LOD(); mesh.add(lod);
  const palette = importedPalette(color);
  const levels = importedVehicleTemplates.map(template => {
    const level = template.clone(true);
    level.traverse(object => {
      if (!object.isMesh) return;
      object.material = palette[object.material.name] || palette.interior;
      object.castShadow = object.material !== palette.glass;
      object.receiveShadow = true;
    });
    const wheels = [], frontWheels = [];
    for (const name of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
      const pivot = level.getObjectByName(name);
      wheels.push(pivot.children[0]);
      if (name.startsWith('wheel_f')) frontWheels.push(pivot);
    }
    return { mesh: level, wheels, frontWheels, door: level.getObjectByName('driver_door') };
  });
  lod.addLevel(levels[0].mesh, 0);
  lod.addLevel(levels[1].mesh, 28, 0.12);
  const plateMap = drawPlate();
  const plateMaterial = new THREE.MeshStandardMaterial({ ...(plateMap ? { map: plateMap } : {}), color: 0xe1e2d5, roughness: 0.52 });
  const plate = part(mesh, new THREE.PlaneGeometry(0.36, 0.155), plateMaterial, 0, 0.565, -2.265); plate.rotation.y = Math.PI;
  let doorTarget = 0, doorAngle = 0, wheelAngle = 0;
  mesh.userData.vehicle = true;
  mesh.userData.model = 'Ferrari 458 Italia by vicent091036';
  mesh.userData.dimensions = { width: 2.27, length: 4.56, height: 1.245 };
  mesh.userData.detailLevels = { near: 69096, far: 16572, transitionMetres: 28 };
  return {
    mesh, wheels: levels[0].wheels, frontWheels: levels[0].frontWheels,
    update(dt = 0, speed = 0, steer = 0) {
      wheelAngle = (wheelAngle + speed * dt / 0.36) % (Math.PI * 2);
      doorAngle = THREE.MathUtils.damp(doorAngle, doorTarget, 9, dt);
      for (const level of levels) {
        level.door.rotation.y = doorAngle;
        for (const wheel of level.wheels) wheel.rotation.x = wheelAngle;
        for (const pivot of level.frontWheels) pivot.rotation.y = THREE.MathUtils.clamp(steer, -0.65, 0.65);
      }
    },
    setLights(enabled) {
      palette.headlight.emissiveIntensity = enabled ? 3 : 0.3;
      palette.taillight.emissiveIntensity = enabled ? 2 : 0.4;
      palette.indicator.emissiveIntensity = enabled ? 0.8 : 0.15;
    },
    setDoor(open) { doorTarget = open ? 1.12 : 0; },
  };
}

/** Full vehicle contract; original sedans keep traffic visually varied. */
export function createCar({ color = 0xe4bb67, type = 'sport', police = false } = {}) {
  if (type === 'sport' && !police && importedVehicleTemplates) return createImportedCar({ color });
  return createOriginalCar({ color, type, police });
}
