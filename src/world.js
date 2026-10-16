import * as THREE from 'three';
import { applyCityMaterials } from './world-materials.js';
import { addAuthoredDistrict } from './world-district.js';
import { addStreetDetails } from './world-streets.js';
import { createPalmAssets } from './world-palms.js';
import { createShrubBuilder } from './world-shrubs.js';
import { createOcean } from './world-ocean.js';
import { createCityProps } from './world-props.js';
import { createInstanceVisibility } from './instance-visibility.js';
import { createBuildingOcclusion } from './building-occlusion.js';

// Everything in the district is real geometry. Repeated architectural details
// share instanced meshes, so the dense streetscape stays inexpensive to render.
export function createWorld(scene) {
  const root = new THREE.Group();
  root.name = 'Grand Theft Astra — Pacific district';
  scene.add(root);
  const colliders = [];
  const solidBuildingBounds = [];
  const lampPositions = [];
  const illuminatedSigns = [];
  const batches = new Map();
  const instanceVisibility = createInstanceVisibility();
  const object = new THREE.Object3D();
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const panelGeometry = new THREE.PlaneGeometry(1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 10);
  const bayGeometry = new THREE.CylinderGeometry(1, 1, 1, 24);
  const manholeGeometry = new THREE.CylinderGeometry(1, 1, 1, 32);
  const manholeRimGeometry = new THREE.TorusGeometry(0.495, 0.009, 4, 32);
  const trunkGeometry = new THREE.CylinderGeometry(0.86, 1, 1, 9);
  const distantTrunkGeometry = new THREE.CylinderGeometry(0.84, 1, 1, 5);
  const sphereGeometry = new THREE.SphereGeometry(1, 8, 5);
  const coneGeometry = new THREE.ConeGeometry(1, 1, 8);
  let seed = 318221;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const range = (min, max) => min + random() * (max - min);
  const mat = (color, roughness = 0.8, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const materials = {
    limestone: mat('#dacdb5'), white: mat('#e2e0d3'), pale: mat('#c4c0b3'),
    blush: mat('#bd9581'), peach: mat('#cbb699'), terracotta: mat('#785245'),
    sage: mat('#96a399'), teal: mat('#3e5b59'), blue: mat('#728b94'),
    concrete: mat('#b2b0a4'), curb: mat('#d2d2c2'), sidewalk: mat('#b8b8aa'),
    trim: mat('#d7d2c0'), dark: mat('#263033', 0.64), metal: mat('#616965', 0.42, { metalness: 0.65 }),
    blackMetal: mat('#202b2e', 0.42, { metalness: 0.6 }),
    glass: mat('#527c88', 0.22, { metalness: 0.65 }),
    glassDark: mat('#263f49', 0.24, { metalness: 0.55 }),
    glassLight: mat('#91b1b4', 0.2, { metalness: 0.6 }),
    glassWarm: mat('#c1b69a', 0.36, { emissive: '#b58d54', emissiveIntensity: 0.13 }),
    reflection: mat('#a4bec0', 0.23, { metalness: 0.38 }),
    asphalt: mat('#b1b1a9', 0.98, { envMapIntensity: 0.15 }),
    iron: mat('#252a28', 0.98, { metalness: 0.08, envMapIntensity: 0.1 }),
    paint: mat('#dedbc3', 0.96), yellow: mat('#d8b756', 0.9),
    trunk: mat('#857260'), trunkLight: mat('#a39476'),
    leaves: mat('#3d6042', 0.85, { side: THREE.DoubleSide, vertexColors: true }),
    shrub: mat('#486441'), soil: mat('#544e3e'), sand: mat('#cdbb8f', 1),
    red: mat('#b8523e'), lamp: mat('#ffdfa1', 0.4, { emissive: '#ffcf7a', emissiveIntensity: 1.3 }),
    redLight: mat('#ff573e', 0.45, { emissive: '#ff2412', emissiveIntensity: 1.3 }),
    greenLight: mat('#93efbd', 0.45, { emissive: '#39ef9a', emissiveIntensity: 1.5 }),
    pool: mat('#5bada9', 0.22, { metalness: 0.25 }),
  };

  const cellKey = (x, z) => `${Math.floor((x + 48) / 96)},${Math.floor((z + 48) / 96)}`;
  function instance(geometry, material, position, scale, rotation = [0, 0, 0], shadow = true, color = null) {
    const key = `${geometry.uuid}:${material.uuid}:${shadow}:${cellKey(position[0], position[2])}`;
    if (!batches.has(key)) batches.set(key, { geometry, material, matrices: [], colors: [], shadow });
    object.position.set(...position);
    object.scale.set(...scale);
    object.rotation.set(...rotation);
    object.updateMatrix();
    const batch = batches.get(key);
    batch.matrices.push(object.matrix.clone());
    batch.colors.push(color);
  }
  function box(material, x, y, z, w, h, d, rotation = 0, shadow = true) {
    instance(boxGeometry, material, [x, y, z], [w, h, d], [0, rotation, 0], shadow);
  }
  function panel(material, x, y, z, width, height, rotation = 0) {
    instance(panelGeometry, material, [x, y, z], [width, height, 1], [0, rotation, 0], false);
  }
  function cylinder(material, x, y, z, r, h, shadow = true) {
    instance(cylinderGeometry, material, [x, y, z], [r, h, r], [0, 0, 0], shadow);
  }
  function line(material, a, b, radius, geometry = cylinderGeometry, shadow = true) {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    const key = `${geometry.uuid}:${material.uuid}:${shadow}:${cellKey((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)}`;
    if (!batches.has(key)) batches.set(key, { geometry, material, matrices: [], colors: [], shadow });
    object.position.copy(start).add(end).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    object.scale.set(radius, direction.length(), radius);
    object.updateMatrix();
    batches.get(key).matrices.push(object.matrix.clone());
    batches.get(key).colors.push(null);
  }
  function canvasTexture(width, height, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }
  const { ready: materialReady } = applyCityMaterials(materials, canvasTexture, random);
  const shrub = createShrubBuilder({ instance, materials, canvasTexture, random, range });
  const breeze = { value: 0 };
  materials.leaves.onBeforeCompile = shader => {
    shader.uniforms.breezeTime = breeze;
    shader.vertexShader = 'uniform float breezeTime;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float phase = 0.;
      #ifdef USE_INSTANCING
        phase = instanceMatrix[3].x * .07 + instanceMatrix[3].z * .11;
      #endif
      float tip = pow(clamp(position.x / 5.3, 0., 1.), 1.6);
      transformed.y += sin(breezeTime * 1.1 + phase + position.x * .9) * tip * .12;
      transformed.z += cos(breezeTime * .7 + phase + position.x * .5) * tip * .1;
    `);
  };

  // Terrain and street grid. Pavements sit above the roads, with actual curbs.
  // End the land at the beach; a flat slab under the waves would cut through
  // their troughs and expose large triangular patches of sand offshore.
  box(materials.sand, -7.5, -0.24, -25, 295, 0.35, 1200, 0, false);
  box(materials.sidewalk, 51, -0.10, -25, 324, 0.25, 540, 0, false);
  const roads = [
    { x: 0, z: -20, width: 22, length: 440, axis: 'z' },
    { x: 80, z: -20, width: 20, length: 440, axis: 'z' },
    ...[-90, 0, 90].map(z => ({ x: 37, z, width: 20, length: 290, axis: 'x' })),
  ];
  for (const road of roads) box(materials.asphalt, road.x, 0.012, road.z, road.axis === 'x' ? road.length : road.width, 0.045, road.axis === 'x' ? road.width : road.length, 0, false);
  const intersections = [-90, 0, 90];
  const nearCross = (z, margin = 15) => intersections.some(c => Math.abs(z - c) < margin);
  const segments = [[-240, -100], [-80, -10], [10, 80], [100, 200]];
  for (const [start, end] of segments) {
    for (const x of [-14.1, 14.1, 66.8, 93.2]) {
      const curbX = x < 0 ? -11.25 : x < 30 ? 11.25 : x < 80 ? 69.65 : 90.35;
      // The repair shop has a flush, wide driveway through the actual curb.
      const pavement = x === 14.1 && start < -132 && end > -120 ? [[start, -132], [-120, end]] : [[start, end]];
      for (const [a, b] of pavement) {
        box(materials.sidewalk, x, 0.10, (a + b) / 2, 5.7, 0.24, b - a, 0, false);
        box(materials.curb, curbX, 0.18, (a + b) / 2, 0.24, 0.32, b - a, 0, false);
        for (let z = a + 3; z < b; z += 4) box(materials.concrete, x, 0.225, z, 5.5, 0.01, 0.025, 0, false);
      }
    }
    for (const x of [-0.15, 0.15, 79.85, 80.15]) box(materials.yellow, x, 0.039, (start + end) / 2, 0.1, 0.012, end - start, 0, false);
    for (const x of [-10.4, 10.4, 70.6, 89.4]) box(materials.paint, x, 0.04, (start + end) / 2, 0.11, 0.012, end - start, 0, false);
    for (let z = start + 4; z < end - 1; z += 8) {
      for (const x of [-5.25, 5.25, 75, 85]) box(materials.paint, x, 0.045, z, 0.1, 0.013, 3.2, 0, false);
    }
  }
  for (const z of intersections) {
    for (let x = -105; x < 180; x += 8) {
      if (Math.abs(x) < 14 || Math.abs(x - 80) < 13) continue;
      for (const offset of [-0.15, 0.15]) box(materials.yellow, x, 0.047, z + offset, 5, 0.014, 0.09, 0, false);
    }
    for (const xCenter of [0, 80]) {
      for (let x = -9; x <= 9; x += 1.7) for (const side of [-1, 1]) box(materials.paint, xCenter + x, 0.05, z + side * 13, 0.8, 0.014, 3.3, 0, false);
      for (let zz = -8; zz <= 8; zz += 1.6) for (const side of [-1, 1]) box(materials.paint, xCenter + side * 14.6, 0.05, z + zz, 3.3, 0.014, 0.75, 0, false);
      for (const side of [-1, 1]) box(materials.paint, xCenter + side * 5.4, 0.051, z + side * 16, 9.2, 0.014, 0.23, 0, false);
    }
    for (const side of [-1, 1]) {
      box(materials.sidewalk, -55, 0.1, z + side * 13, 88, 0.24, 5.5, 0, false);
      box(materials.sidewalk, 40, 0.1, z + side * 13, 48, 0.24, 5.5, 0, false);
      box(materials.curb, -55, 0.18, z + side * 10.2, 88, 0.3, 0.23, 0, false);
      box(materials.curb, 40, 0.18, z + side * 10.2, 48, 0.3, 0.23, 0, false);
    }
  }
  // Painted turn arrows and manhole covers add scale at eye level.
  for (const z of [-115, -25, 65, 160]) for (const x of [-7.6, 7.6]) {
    const dir = x > 0 ? -1 : 1;
    box(materials.paint, x, 0.055, z, 0.2, 0.014, 2.3, 0, false);
    box(materials.paint, x - 0.35, 0.055, z + dir * 0.9, 0.16, 0.014, 1, dir * 0.78, false);
    box(materials.paint, x + 0.35, 0.055, z + dir * 0.9, 0.16, 0.014, 1, -dir * 0.78, false);
  }
  for (let z = -210; z < 190; z += 39) {
    instance(manholeGeometry, materials.iron, [1.8, 0.037, z], [0.52, 0.008, 0.52], [0, 0, 0], false);
    instance(manholeRimGeometry, materials.dark, [1.8, 0.042, z], [1, 1, 0.2], [-Math.PI / 2, 0, 0], false);
    for (let offset = -0.3; offset <= 0.3; offset += 0.1) {
      box(materials.dark, 1.8, 0.043, z + offset, Math.sqrt(0.17 - offset * offset) * 2, 0.002, 0.012, 0, false);
    }
  }
  // Surface wear stays flat and instanced: tyre arcs, oil staining and repaired
  // asphalt sit on the actual drivable road instead of adding collision bumps.
  for (const [x, z, w, d, rotation] of [[7.6, 28, 2.7, 7, .04], [-7, -31, 3.4, 4.2, -.07], [4.3, -65, 3, 6.2, 0], [-4, 65, 2.5, 9, .04]]) {
    box(materials.patch, x, .037, z, w, .006, d, rotation, false);
  }
  for (let i = 0; i < 29; i++) {
    const x = i % 2 ? 8.4 : -8.4;
    const z = -207 + i * 13.3;
    instance(panelGeometry, materials.stain, [x + range(-1, 1), .058, z], [range(1.8, 4), range(2, 5), 1], [-Math.PI / 2, 0, range(-.5, .5)], false);
  }
  for (const z of [-116, -24, 18, 62, 114]) {
    instance(panelGeometry, materials.tyre, [4.8, .061, z], [2.3, 12, 1], [-Math.PI / 2, 0, -.07], false);
    instance(panelGeometry, materials.tyre, [-5.1, .061, z - 8], [2.2, 9, 1], [-Math.PI / 2, 0, .08], false);
  }
  for (const z of intersections) for (const side of [-1, 1]) {
    box(materials.red, side * 11.23, .19, z + side * 20, .27, .29, 6.5, 0, false);
  }

  function sign(text, x, y, z, width, height, rotation = 0, options = {}) {
    const texture = canvasTexture(1024, 192, (ctx, w, h) => {
      ctx.fillStyle = options.background || '#294342'; ctx.fillRect(0, 0, w, h);
      if (options.border !== false) {
        ctx.strokeStyle = options.color || '#e8d8ab'; ctx.lineWidth = 2;
        ctx.strokeRect(13, 13, w - 26, h - 26);
      }
      ctx.fillStyle = options.color || '#eee5cb';
      ctx.font = `500 ${options.fontSize || 68}px ${options.font || 'Arial'}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 3, w - 60);
    });
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, emissive: '#e1c89c', emissiveMap: texture, emissiveIntensity: options.glow || 0.09 });
    illuminatedSigns.push({material, intensity:material.emissiveIntensity});
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(x, y, z); mesh.rotation.y = rotation; root.add(mesh);
    return mesh;
  }

  function building(x, z, width, depth, floors, style, index, front = 1) {
    const floorHeight = 3.2;
    const height = 4.2 + floors * floorHeight;
    const detailed = Math.abs(x) < 50 && Math.abs(z) < 100;
    const palette = [materials.white, materials.brick, materials.blush, materials.limestone, materials.pale, materials.sage];
    const facade = palette[style % palette.length];
    const accent = style % 3 === 0 ? materials.teal : style % 3 === 1 ? materials.terracotta : materials.dark;
    box(facade, x, height / 2 + 0.2, z, width, height, depth);
    // Exact opaque body bounds, distinct from inflated gameplay collision boxes.
    // Hollow authored interiors are deliberately not registered as occluders.
    solidBuildingBounds.push(new THREE.Box3(
      new THREE.Vector3(x - width / 2, .2, z - depth / 2),
      new THREE.Vector3(x + width / 2, height + .2, z + depth / 2),
    ));
    colliders.push({ minX: x - width / 2 - 0.2, maxX: x + width / 2 + 0.2, minY: 0, maxY: height + 3, minZ: z - depth / 2 - 0.2, maxZ: z + depth / 2 + 0.2 });
    // Separate retail plinth, cornices, roof coping and recessed dark frontage.
    box(accent, x, 2.0, z, width + 0.15, 3.7, depth + 0.15);
    box(materials.trim, x, 4.1, z, width + 0.8, 0.3, depth + 0.8);
    box(materials.trim, x, height + 0.15, z, width + 0.85, 0.3, depth + 0.85);
    box(materials.concrete, x, height + 0.32, z, width - 0.6, 0.15, depth - 0.6);
    for (const dz of [-1, 1]) box(facade, x, height + 0.65, z + dz * (depth / 2 - 0.2), width, 0.8, 0.4);
    for (const dx of [-1, 1]) box(facade, x + dx * (width / 2 - 0.2), height + 0.65, z, 0.4, 0.8, depth);
    if (style === 0 || style === 3) {
      for (let f = 1; f <= floors; f++) box(materials.trim, x, 4.2 + f * floorHeight, z, width + 0.22, 0.13, depth + 0.22, 0, false);
    }
    if (style === 3) {
      // A recessed curtain-wall bay changes the silhouette of the street-facing
      // elevation; existing glass panels sit in front of its dark backing.
      box(materials.dark, x + front * (width / 2 + .013), height / 2 + 2.3, z, .035, height - 4.2, depth * .7, 0, false);
      for (const dz of [-depth * .35, depth * .35]) box(materials.trim, x + front * (width / 2 + .22), height / 2 + 2.1, z + dz, .5, height - 4, .42);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < Math.floor(depth / 3.5); i++) {
        const zz = z - depth / 2 + 2.1 + i * ((depth - 4.2) / Math.max(1, Math.floor(depth / 3.5) - 1));
        panel(materials.glassDark, x + side * (width / 2 + 0.09), 1.92, zz, 2.8, 2.8, side * Math.PI / 2);
        box(materials.trim, x + side * (width / 2 + 0.17), 1.95, zz - 1.45, 0.3, 3.5, 0.2);
        panel(materials.metal, x + side * (width / 2 + 0.19), 1.9, zz, 0.055, 2.8, side * Math.PI / 2);
      }
      for (let i = 0; i < Math.floor(width / 3.5); i++) {
        const xx = x - width / 2 + 2.1 + i * ((width - 4.2) / Math.max(1, Math.floor(width / 3.5) - 1));
        panel(materials.glassDark, xx, 1.92, z + side * (depth / 2 + 0.09), 2.8, 2.8, side < 0 ? Math.PI : 0);
        box(materials.trim, xx - 1.45, 1.95, z + side * (depth / 2 + 0.17), 0.2, 3.5, 0.3);
        panel(materials.metal, xx, 1.9, z + side * (depth / 2 + 0.19), 0.055, 2.8, side < 0 ? Math.PI : 0);
      }
    }
    const windowMaterials = [materials.glass, materials.glass, materials.glassDark, materials.glassLight, materials.glassWarm];
    // Both street-facing and return elevations are modeled, including sills and recessed glazing.
    for (let floor = 0; floor < floors; floor++) {
      const yy = 5.85 + floor * floorHeight;
      for (const side of [-1, 1]) {
        const nx = Math.max(2, Math.floor(width / 3.8));
        for (let col = 0; col < nx; col++) {
          const xx = x - width / 2 + ((col + 0.5) * width) / nx;
          const ww = style === 4 ? 2.6 : 2.05;
          const glass = windowMaterials[Math.floor(random() * windowMaterials.length)];
          const facing = side < 0 ? Math.PI : 0;
          panel(materials.dark, xx, yy, z + side * (depth / 2 + 0.025), ww + 0.16, 2.26, facing);
          panel(glass, xx, yy, z + side * (depth / 2 + 0.069), ww, 2.1, facing);
          if (detailed && floor < 5) box(materials.trim, xx, yy - 1.17, z + side * (depth / 2 + 0.15), ww + 0.3, 0.12, 0.37, 0, false);
          else panel(materials.trim, xx, yy - 1.17, z + side * (depth / 2 + 0.09), ww + 0.3, 0.12, facing);
          panel(materials.metal, xx, yy, z + side * (depth / 2 + 0.11), 0.045, 2.12, facing);
          if ((floor + col + index) % 5 === 0) panel(materials.reflection, xx - ww * 0.28, yy, z + side * (depth / 2 + 0.115), 0.11, 2.0, facing);
        }
        const nz = Math.max(2, Math.floor(depth / 3.9));
        for (let col = 0; col < nz; col++) {
          const zz = z - depth / 2 + ((col + 0.5) * depth) / nz;
          const glass = windowMaterials[Math.floor(random() * windowMaterials.length)];
          const facing = side * Math.PI / 2;
          panel(materials.dark, x + side * (width / 2 + 0.025), yy, zz, 2.2, 2.26, facing);
          panel(glass, x + side * (width / 2 + 0.07), yy, zz, 2.05, 2.1, facing);
          if (detailed && floor < 5 && side === front) box(materials.trim, x + side * (width / 2 + 0.15), yy - 1.17, zz, 0.37, 0.12, 2.35, 0, false);
          else panel(materials.trim, x + side * (width / 2 + 0.09), yy - 1.17, zz, 2.35, 0.12, facing);
          panel(materials.metal, x + side * (width / 2 + 0.11), yy, zz, 0.045, 2.12, facing);
          if ((style === 1 || style === 3) && floor < floors - 1 && col % 2 === 0 && side === front) {
            const bx = x + side * (width / 2 + 0.85);
            box(materials.trim, bx, yy - 1.22, zz, 1.7, 0.18, 2.9);
            box(materials.metal, x + side * (width / 2 + 1.55), yy - 0.28, zz, 0.05, 0.05, 2.85, 0, false);
            panel(materials.glassLight, x + side * (width / 2 + 1.5), yy - 0.72, zz, 2.8, 0.8, facing);
            for (const dz of [-1.35, 1.35]) box(materials.metal, x + side * (width / 2 + 1.52), yy - 0.73, zz + dz, 0.045, 1, 0.045, 0, false);
          }
        }
      }
    }
    // Art deco corner fins, setbacks, and rooftop utility hardware.
    if (style === 0 || style === 2) {
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(materials.trim, x + dx * (width / 2 - 0.7), height / 2 + 2, z + dz * (depth / 2 + 0.15), 0.28, height - 3.4, 0.45);
      box(facade, x, height + 1.4, z, width * 0.32, 2.3, depth * 0.5);
      box(materials.trim, x, height + 2.6, z, width * 0.34, 0.22, depth * 0.52);
    }
    for (let i = 0; i < Math.max(1, Math.floor(width / 10)); i++) {
      const xx = x - width / 3 + i * 6;
      box(materials.metal, xx, height + 1.05, z + 1, 2.7, 1.35, 2.1);
      box(materials.dark, xx, height + 1.73, z + 1, 2.4, 0.08, 1.8, 0, false);
      for (let n = 0; n < (detailed ? 7 : 3); n++) box(materials.concrete, xx - 1.05 + n * (detailed ? 0.35 : 0.9), height + 1.8, z + 1, 0.08, 0.05, 1.7, 0, false);
      cylinder(materials.metal, xx + 2.6, height + 1.0, z - 2, 0.23, 1.4);
      box(materials.metal, xx + 1.9, height + 0.6, z - 2, 2.1, 0.5, 0.55);
    }
    // Distinct building types replace a uniform wall of identical cuboids.
    if (style === 0 && index < 20) {
      const radius = 3.1;
      const bx = x + front * (width / 2 - 2.65), bz = z + depth / 2 - 3.2;
      instance(bayGeometry, facade, [bx, height / 2 + 2.1, bz], [radius, height - 3.6, radius]);
      for (let floor = 0; floor < floors; floor++) {
        const yy = 5.85 + floor * floorHeight;
        instance(bayGeometry, materials.trim, [bx, yy - 1.3, bz], [radius + .13, .16, radius + .13], [0, 0, 0], false);
        for (let col = -2; col <= 2; col++) {
          const angle = (front > 0 ? 0 : Math.PI) + col * .36;
          panel(materials.glass, bx + Math.cos(angle) * (radius + .035), yy, bz + Math.sin(angle) * (radius + .035), .83, 2.1, Math.PI / 2 - angle);
        }
      }
      instance(bayGeometry, materials.trim, [bx, height + .55, bz], [radius + .23, .35, radius + .23]);
    }
    if (style === 1 && detailed) {
      const ex = x + front * (width / 2 + .9), ez = z - depth * .28;
      for (let floor = 0; floor < Math.min(floors, 5); floor++) {
        const yy = 4.6 + floor * floorHeight;
        box(materials.blackMetal, ex, yy, ez, 1.6, .12, 4.5);
        box(materials.blackMetal, ex + front * .75, yy + 1, ez, .045, .05, 4.5, 0, false);
        for (let k = 0; k < 10; k++) box(materials.blackMetal, ex + front * .75, yy + .5, ez - 2.1 + k * .46, .035, 1, .035, 0, false);
        if (floor > 0) {
          for (let step = 0; step < 9; step++) box(materials.blackMetal, ex, yy - step * .355, ez - 1.85 + step * .42, 1.35, .06, .39, 0, false);
          line(materials.blackMetal, [ex + front * .65, yy + .9, ez - 1.85], [ex + front * .65, yy - 2.3, ez + 1.85], .035, cylinderGeometry, false);
        }
      }
      const tx = x - front * width * .2;
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(materials.blackMetal, tx + dx, height + 1.5, z + dz, .12, 2.7, .12);
      instance(bayGeometry, materials.terracotta, [tx, height + 3.4, z], [1.65, 2.5, 1.65]);
      instance(coneGeometry, materials.dark, [tx, height + 4.9, z], [1.8, .7, 1.8]);
    }
    if (style === 2 || style === 3) {
      const terraceY = height + 1.1;
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) box(materials.trunk, x + dx * width * .23, terraceY + 1.4, z + dz * depth * .23, .18, 2.8, .18);
      for (let k = 0; k < 10; k++) box(materials.trunkLight, x - width * .27 + k * width * .06, terraceY + 2.9, z, .14, .17, depth * .58);
      for (const dz of [-1, 1]) {
        box(materials.concrete, x, height + .8, z + dz * depth * .37, width * .72, .8, .8);
        for (let k = 0; k < 5; k++) shrub(x - width * .29 + k * width * .145, height + 1.3, z + dz * depth * .37, 2.2, 1.2, 1);
      }
    }
    if (style === 4) {
      const extra = index % 2 ? 9 : 5;
      box(materials.concrete, x + front * 3, height + extra / 2, z - 1, width * .64, extra, depth * .68);
      for (const side of [-1, 1]) {
        panel(materials.glassDark, x + front * 3, height + extra * .56, z - 1 + side * (depth * .34 + .03), width * .6, extra * .65, side < 0 ? Math.PI : 0);
        panel(materials.glass, x + front * 3 + side * (width * .32 + .03), height + extra * .56, z - 1, depth * .62, extra * .65, side * Math.PI / 2);
      }
      box(materials.trim, x + front * 3, height + extra + .15, z - 1, width * .68, .3, depth * .72);
      cylinder(materials.metal, x, height + extra + 3.3, z, .055, 6.4);
      colliders[colliders.length - 1].maxY = height + extra + 1;
    }
    if (index < 21) {
      const names = ['PALMA SOCIAL', 'THE MARLOW', 'SOL MARKET', 'COASTAL RECORDS', 'MOTEL AZUL', 'PACIFIC COFFEE', 'CASA LUNA', 'MARINA CLUB', 'LAUNDROMAT', 'SUNDOWN STUDIO', 'PALMETTO HOTEL', 'FRESH & LOCAL', 'GOLDEN HOUR', 'OCEAN DRIVE', 'VELOCE MOTORS', 'WAVES SURF CO.', 'CINÉMA', 'FLORIDA ROOM', 'THE TERRACE', 'SUNSET DELI', 'BAR CALYPSO'];
      const sx = x + front * (width / 2 + 0.25);
      sign(names[index], sx, 3.28, z, Math.min(depth - 1.3, 15), 0.82, front * Math.PI / 2, { background: style % 2 ? '#b16d4b' : '#233e3c', fontSize: 58 });
      // Deep fabric awnings shelter the shopfronts.
      const awningColor = style % 2 ? materials.limestone : materials.teal;
      box(awningColor, x + front * (width / 2 + 0.9), 2.9, z, 1.8, 0.17, depth - 0.7);
      box(awningColor, x + front * (width / 2 + 1.73), 2.72, z, 0.12, 0.38, depth - 0.7);
      for (let dz = -depth / 2 + 1; dz < depth / 2; dz += 1.5) box(materials.trim, x + front * (width / 2 + 1.8), 2.72, z + dz, 0.015, 0.38, 0.12, 0, false);
    }
  }

  // A hand-composed main street keeps the first view legible and varied.
  const mainBuildings = [
    [-33, -208, 32, 25, 8, 4], [-32, -178, 30, 27, 6, 1], [-35, -144, 36, 31, 10, 0], [-31, -115, 28, 20, 5, 2],
    [-32, -63, 30, 27, 5, 3], [-34, -32, 34, 26, 5, 3],
    [-33, 31, 32, 26, 6, 1], [-31, 62, 28, 27, 4, 2],
    [-32, 122, 30, 30, 7, 4], [-34, 158, 34, 31, 5, 0],
    [33, -209, 32, 26, 7, 3], [32, -177, 30, 27, 11, 4], [33, -143, 32, 29, 6, 2], [31, -115, 28, 20, 4, 1],
    [34, -63, 34, 27, 5, 2], [32, -32, 30, 26, 6, 1],
    [32, 31, 30, 26, 5, 3], [34, 62, 34, 27, 7, 1],
    [33, 122, 32, 30, 9, 0], [32, 158, 30, 31, 6, 4],
    [-76, -55, 27, 36, 3, 0],
  ];
  const authoredLots = new Set([5, 6, 7, 12, 13, 16, 17]);
  mainBuildings.forEach((b, i) => { if (!authoredLots.has(i)) building(...b, i, b[0] < 0 ? 1 : -1); });
  let index = mainBuildings.length;
  for (const z of [-210, -174, -139, -61, -28, 31, 65, 123, 159]) {
    building(111, z, 31, 25, Math.floor(range(4, 11)), index % 6, index++, -1);
    if (z !== -61 && z !== -28) building(-77, z, 25, 24, Math.floor(range(2, 5)), index % 6, index++, 1);
  }

  // A turquoise courtyard pool and terrace visible from the coastal cross street.
  box(materials.white, -76, 0.28, -27, 28, 0.25, 17);
  box(materials.pool, -76, 0.43, -27, 19, 0.06, 10, 0, false);
  for (const dz of [-1, 1]) box(materials.trim, -76, 0.47, -27 + dz * 5.3, 20, 0.16, 0.5);
  for (const dx of [-1, 1]) box(materials.trim, -76 + dx * 9.8, 0.47, -27, 0.5, 0.16, 11);
  for (let i = 0; i < 5; i++) {
    box(materials.white, -86 + i * 4, 0.7, -34.4, 1.3, 0.3, 2.8);
    box(materials.teal, -86 + i * 4, 0.9, -34.2, 1.15, 0.12, 2.4);
  }

  // Broad curved fronds carry individually painted leaf silhouettes. Three
  // irregular crown tiers produce canopy volume and readable cast shadows.
  const palmAssets = createPalmAssets(canvasTexture, random);
  const frondGeometry = palmAssets.near;
  const distantFrondGeometry = palmAssets.far;
  materials.leaves.map = palmAssets.map;
  materials.leaves.color.set('#e8e9d8');
  materials.leaves.alphaTest = 0;
  materials.leaves.alphaToCoverage = false;
  materials.leaves.roughness = .82;
  materials.leaves.needsUpdate = true;
  function palm(x, z, height = 10, size = 1) {
    const lean = range(-1.25, 1.25);
    const leanZ = range(-.8, .8);
    const detailed = Math.abs(x) < 45 && z > -85 && z < 90;
    const segments = detailed ? 11 : 7;
    for (let i = 0; i < segments; i++) {
      const a = i / segments, b = (i + 1) / segments;
      line(i % 3 === 0 ? materials.trunkLight : materials.trunk,
        [x + lean * a * a, a * height + 0.2, z + leanZ * a * a],
        [x + lean * b * b, b * height + 0.2, z + leanZ * b * b],
        (0.29 - a * 0.09) * size, detailed ? palmAssets.trunkNear : palmAssets.trunkFar);
      // The fine horizontal bands give the trunk its characteristic ring texture.
      if (detailed && i < 9) cylinder(materials.trunkLight, x + lean * a * a, a * height + 0.25, z + leanZ * a * a, (0.295 - a * 0.09) * size, 0.04, false);
    }
    const crown = [x + lean, height + 0.2, z + leanZ];
    instance(sphereGeometry, materials.trunk, [crown[0], crown[1] - .12, crown[2]], [.4 * size, .72 * size, .4 * size]);
    const leaves = detailed ? 25 : 15;
    const phase = random() * Math.PI * 2;
    for (let i = 0; i < leaves; i++) {
      const tier = i % 3;
      const growth = tier === 0 ? range(.3, .55) : tier === 1 ? range(-.12, .18) : range(-.45, -.19);
      const length = (tier === 0 ? .8 : tier === 1 ? 1.05 : .92) * size * range(.85, 1.12);
      instance(detailed ? frondGeometry : distantFrondGeometry, materials.leaves,
        [crown[0], crown[1] + (tier === 0 ? .22 : tier === 1 ? 0 : -.25), crown[2]],
        [length, size * range(.9, 1.1), size * range(.85, 1.1)],
        [range(-.22, .22), phase + i * 2.39996 + range(-.1, .1), growth], true);
    }
    // Upright spears fill the crown; dry retained leaf bases vary the trunk top.
    if (detailed) for (let i = 0; i < 4; i++) {
      instance(frondGeometry, materials.leaves, crown, [size * .53, size * .75, size * .48], [0, phase + i * 1.6, .92 + i * .07]);
      line(materials.trunk, [crown[0], crown[1] - .65, crown[2]],
        [crown[0] + Math.cos(i * 1.6) * .53, crown[1] - 1.5, crown[2] + Math.sin(i * 1.6) * .53], .09, distantTrunkGeometry);
    }
    if (detailed) for (let i = 0; i < 3; i++) instance(sphereGeometry, materials.trunk, [crown[0] + range(-0.2, 0.2), crown[1] - 0.3, crown[2] + range(-0.2, 0.2)], [0.15, 0.18, 0.15]);
  }
  for (let z = -218; z < 190; z += 23) {
    if (nearCross(z, 19)) continue;
    for (const side of [-1, 1]) {
      if (side === 1 && z > -133 && z < -119) continue;
      const x = side * 13.5;
      box(materials.dark, x, 0.24, z, 1.6, 0.06, 1.6, 0, false);
      box(materials.soil, x, 0.28, z, 1.3, 0.04, 1.3, 0, false);
      palm(x, z, range(8, 11.8), range(0.8, 1));
    }
  }
  for (let z = -220; z < 200; z += 26) {
    palm(-103, z, range(9, 13), range(0.9, 1.15));
    if (!nearCross(z, 16)) palm(93.2, z, range(8, 11), 0.8);
  }
  for (const [x, z, height] of [[-13.3, 22.5, 9.2], [13.3, 20.5, 10.2], [-13.3, -16.5, 9.5]]) {
    box(materials.dark, x, 0.24, z, 1.6, 0.06, 1.6, 0, false);
    box(materials.soil, x, 0.28, z, 1.3, 0.04, 1.3, 0, false);
    palm(x, z, height, 0.95);
  }

  const districtAPI = { box, panel, cylinder, line, instance, materials, canvasTexture,
    root, colliders, panelGeometry, random, range, sign, palm, shrub };
  const district = addAuthoredDistrict(districtAPI);
  const streetDetails = addStreetDetails(districtAPI);

  function streetLamp(x, z, inward) {
    lampPositions.push(new THREE.Vector3(x+inward*2.3,7.9,z));
    cylinder(materials.blackMetal, x, 0.45, z, 0.22, 0.6);
    cylinder(materials.metal, x, 3.8, z, 0.075, 7.3);
    line(materials.metal, [x, 7.3, z], [x + inward * 0.8, 8.1, z], 0.06);
    line(materials.metal, [x + inward * 0.8, 8.1, z], [x + inward * 2.2, 8.15, z], 0.06);
    box(materials.dark, x + inward * 2.3, 8.12, z, 1.0, 0.14, 0.4);
    box(materials.lamp, x + inward * 2.3, 8.04, z, 0.85, 0.025, 0.27, 0, false);
  }
  for (let z = -218; z < 190; z += 35) if (!nearCross(z, 17)) {
    streetLamp(-11.9, z, 1);
    streetLamp(11.9, z + 6, -1);
    streetLamp(91.3, z, -1);
  }
  // Two shared lens materials per travel axis keep every intersection in step
  // with simulation.js. Only their uniforms change at the 12-second boundary.
  const signalMaterials = {
    z: { red: materials.redLight, green: materials.greenLight },
    x: { red: materials.redLight.clone(), green: materials.greenLight.clone() },
  };
  for (const axis of ['z', 'x']) for (const color of ['red', 'green']) {
    signalMaterials[axis][color].name = `${axis === 'z' ? 'North-south' : 'East-west'} ${color} signal`;
  }
  let greenVertical = null;
  function updateTrafficSignals(time) {
    const next = Math.floor(time / 12) % 2 === 0;
    if (next === greenVertical) return;
    greenVertical = next;
    for (const axis of ['z', 'x']) {
      const green = axis === 'z' ? next : !next;
      const lenses = signalMaterials[axis];
      lenses.red.color.set(green ? '#35130e' : '#ff573e');
      lenses.red.emissiveIntensity = green ? 0 : 1.8;
      lenses.green.color.set(green ? '#93efbd' : '#102c20');
      lenses.green.emissiveIntensity = green ? 1.8 : 0;
    }
  }
  updateTrafficSignals(0);
  function trafficLight(x, z, side, direction, axis = 'z', pole = true) {
    const horizontal = axis === 'x';
    const headX = x + (horizontal ? 0 : side * 5.8);
    const headZ = z + (horizontal ? side * 5.8 : 0);
    const rotation = horizontal ? Math.PI / 2 : 0;
    if (pole) cylinder(materials.blackMetal, x, 3.6, z, 0.095, 7.0);
    line(materials.blackMetal, [x, 6.7, z], [x + (horizontal ? 0 : side * 6.7), 6.7, z + (horizontal ? side * 6.7 : 0)], 0.085);
    box(materials.dark, headX, 5.95, headZ, 0.6, 1.65, 0.36, rotation);
    for (let i = 0; i < 3; i++) {
      const lightMaterial = i === 0 ? signalMaterials[axis].red : i === 2 ? signalMaterials[axis].green : materials.blackMetal;
      instance(sphereGeometry, lightMaterial,
        [headX + (horizontal ? direction * .21 : 0), 6.48 - i * .49, headZ + (horizontal ? 0 : direction * .21)],
        [.18, .18, .07], [0, rotation, 0], false);
      box(materials.dark, headX + (horizontal ? direction * .34 : 0), 6.68 - i * .49,
        headZ + (horizontal ? 0 : direction * .34), .47, .06, .36, rotation, false);
    }
    if (pole) box(materials.dark, x, 2.0, z, 0.33, 0.43, 0.28);
  }
  for (const z of intersections) {
    for (const roadX of [0, 80]) {
      trafficLight(roadX - 12.2, z - 11.8, 1, 1);
      trafficLight(roadX + 12.2, z + 11.8, -1, -1);
      // Crossing heads share each corner mast and face the opposing traffic.
      trafficLight(roadX - 12.2, z - 11.8, 1, 1, 'x', false);
      trafficLight(roadX + 12.2, z + 11.8, -1, -1, 'x', false);
    }
    sign(z === 0 ? 'OCEAN DRIVE' : z < 0 ? 'PALM AVENUE' : 'MARINA WAY', -12.08, 5.8, z - 11.3, 3.0, 0.55, 0, { background: '#356e65', border: false, fontSize: 59 });
  }

  function bench(x, z, rotation = 0) {
    // Use a local transform for slatted benches aligned with either sidewalk.
    const local = (dx, dy, dz, w, h, d, material) => {
      box(material, x + dx * Math.cos(rotation) + dz * Math.sin(rotation), dy, z - dx * Math.sin(rotation) + dz * Math.cos(rotation), w, h, d, rotation);
    };
    for (let i = 0; i < 4; i++) local(0, 0.68, -0.27 + i * 0.18, 2.0, 0.09, 0.13, materials.trunkLight);
    for (let i = 0; i < 3; i++) local(0, 0.97 + i * 0.18, 0.33, 2, 0.12, 0.07, materials.trunkLight);
    for (const dx of [-0.75, 0.75]) {
      local(dx, 0.43, 0, 0.1, 0.55, 0.6, materials.blackMetal);
      local(dx, 0.94, 0.36, 0.08, 1.0, 0.08, materials.blackMetal);
    }
  }
  for (let z = -197; z < 185; z += 44) if (!nearCross(z, 18)) {
    bench(-15.7, z, Math.PI / 2);
    bench(15.7, z + 4, -Math.PI / 2);
    cylinder(materials.dark, -15.1, 0.75, z + 2.1, 0.35, 1.05);
    cylinder(materials.metal, -15.1, 1.29, z + 2.1, 0.38, 0.07);
    cylinder(materials.red, 11.8, 0.68, z + 8, 0.14, 0.8);
    instance(sphereGeometry, materials.red, [11.8, 1.08, z + 8], [0.17, 0.13, 0.17]);
    box(materials.red, 11.8, 0.8, z + 8, 0.55, 0.15, 0.15);
    for (const side of [-1, 1]) {
      const px = side * 15.7;
      if(side===1&&z===23)continue; // The news kiosk occupies this planter bay.
      box(materials.concrete, px, 0.54, z - 8, 1.1, 0.7, 2.7);
      box(materials.soil, px, 0.91, z - 8, 0.9, 0.06, 2.5, 0, false);
      for (let i = 0; i < 3; i++) shrub(px, 1.31 + i % 2 * .07, z - 8.8 + i * .8, 1.15, .94, 1.2);
    }
  }
  const cityProps = createCityProps(root);
  colliders.push(...cityProps.colliders);
  const ready = Promise.all([materialReady, cityProps.ready]);

  // Billboard is part of the city, with a real support structure and floodlights.
  const billboardTexture = canvasTexture(1024, 512, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, '#22494a'); gradient.addColorStop(1, '#152f36');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e9b176'; ctx.beginPath(); ctx.arc(820, 215, 128, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d76f53'; ctx.fillRect(670, 240, 300, 18); ctx.fillRect(670, 272, 300, 12); ctx.fillRect(670, 299, 300, 8);
    ctx.fillStyle = '#f0e9d8'; ctx.font = 'bold 92px Arial'; ctx.fillText('THIS CITY', 60, 160); ctx.fillText('IS YOURS.', 60, 265);
    ctx.fillStyle = '#b8cec4'; ctx.font = '26px Arial'; ctx.fillText('MAKE A LITTLE TROUBLE.  FIND YOUR PARADISE.', 62, 405);
    ctx.fillStyle = '#e8b981'; ctx.font = 'bold 21px Arial'; ctx.fillText('PACIFIC COAST  /  EST. 1986', 62, 456);
  });
  const billboardMaterial = new THREE.MeshStandardMaterial({ map: billboardTexture, roughness: 0.65 });
  const billboard = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), billboardMaterial);
  billboard.position.set(32, 34, -18.3); root.add(billboard);
  box(materials.dark, 32, 34, -18.6, 18.5, 9.5, 0.35);
  for (const x of [25, 39]) box(materials.metal, x, 29, -19, 0.3, 12, 0.3);
  for (const x of [26, 32, 38]) {
    line(materials.metal, [x, 29.3, -18.4], [x, 29.3, -16.7], 0.05);
    box(materials.lamp, x, 29.5, -16.7, 0.4, 0.13, 0.3, 0, false);
  }

  // Beach, boardwalk, lifeguard stations and breakwaters.
  box(materials.pale, -109, 0.1, -20, 13, 0.2, 465, 0, false);
  for (let z = -245; z < 213; z += 2.8) box(materials.concrete, -109, 0.21, z, 12.7, 0.012, 0.025, 0, false);
  box(materials.sand, -135, -0.08, -20, 40, 0.16, 465, 0, false);
  for (let z = -205; z < 200; z += 25) {
    bench(-109, z, Math.PI / 2);
    cylinder(materials.white, -115, 0.7, z, 0.09, 1.2);
    if (z < 174) line(materials.metal, [-115, 1.15, z], [-115, 1.15, z + 25], 0.025, cylinderGeometry, false);
  }
  for (const z of [-144, 45, 160]) {
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) cylinder(materials.white, -134 + dx * 1.4, 1.2, z + dz * 1.1, 0.08, 2.5);
    box(materials.teal, -134, 2.5, z, 3.7, 2.2, 3.3);
    box(materials.white, -134, 3.7, z, 4.5, 0.2, 4.0);
    box(materials.glassLight, -134, 2.8, z + 1.68, 2.7, 0.9, 0.07, 0, false);
    sign('LIFEGUARD', -134, 2.07, z + 1.72, 2.8, 0.5, 0, { background: '#578e88', border: false, fontSize: 65 });
    for (let i = 0; i < 6; i++) box(materials.white, -134, 0.3 + i * 0.22, z + 2.6 - i * 0.23, 1.1, 0.12, 0.4);
  }
  for (let i = 0; i < 22; i++) {
    const x = range(-144, -123), z = range(-210, 190);
    box(i % 2 ? materials.teal : materials.blush, x, 0.08, z, 1.2, 0.035, 2.5, range(-0.3, 0.3), false);
    if (i % 3 === 0) {
      cylinder(materials.white, x + 1.1, 1.2, z, 0.025, 2.5);
      instance(coneGeometry, i % 2 ? materials.white : materials.blush, [x + 1.1, 2.4, z], [1.5, 0.6, 1.5]);
    }
  }
  const ocean = createOcean();
  root.add(ocean.mesh);

  // Distant metropolitan silhouettes wrap the drivable district without walls.
  // Conventional repeated interior atlas here gives each long strip a bank of
  // windows while retaining the real sky's reflections on the glazing.
  const skylineGlass = materials.glass.clone();
  skylineGlass.map = materials.glass.map.clone();
  skylineGlass.map.wrapS = THREE.RepeatWrapping;
  skylineGlass.map.repeat.set(2, 1);
  skylineGlass.map.needsUpdate = true;
  skylineGlass.color.set('#b0bfbd');
  for (let i = 0; i < 46; i++) {
    const x = i < 22 ? range(-80, 190) : range(155, 290);
    const z = i < 22 ? range(-390, -268) : range(-235, 210);
    const w = range(15, 31), d = range(16, 35), h = i % 7 === 0 ? range(105, 145) : range(28, 85);
    const facade = i % 3 === 0 ? materials.blue : i % 3 === 1 ? materials.pale : materials.sage;
    box(facade, x, h / 2, z, w, h, d);
    box(materials.trim, x, h + 0.3, z, w + 0.4, 0.4, d + 0.4);
    if (i % 3 === 0) {
      box(facade, x - w * .08, h + 5, z, w * .72, 10, d * .68);
      box(materials.metal, x - w * .08, h + 10.2, z, w * .75, .4, d * .71);
    }
    if (i % 7 === 0) {
      box(facade, x, h + 14, z, w * .48, 12, d * .45);
      box(materials.glassDark, x, h + 21, z, w * .28, 3, d * .28);
      cylinder(materials.metal, x, h + 27, z, .09, 12);
    }
    for (let yy = 5; yy < h - 1; yy += 3.2) {
      for (const side of [-1, 1]) {
        panel(skylineGlass, x, yy, z + side * (d / 2 + 0.02), w - 1.6, 1.7, side < 0 ? Math.PI : 0);
        panel(skylineGlass, x + side * (w / 2 + 0.02), yy, z, d - 1.6, 1.7, side * Math.PI / 2);
      }
    }
  }
  // A recognizable tapered downtown crown terminates the boulevard's sightline.
  const towerX = -3, towerZ = -310;
  for (const [y, height, radius] of [[42, 84, 15], [94, 20, 12.5], [111, 14, 9.5], [122, 8, 6.5]]) {
    instance(bayGeometry, materials.blue, [towerX, y, towerZ], [radius, height, radius]);
    instance(bayGeometry, materials.trim, [towerX, y + height / 2, towerZ], [radius + .2, .6, radius + .2]);
    for (let yy = y - height / 2 + 2; yy < y + height / 2 - 1; yy += 3.3) {
      for (let k = 0; k < 16; k++) {
        const angle = k * Math.PI / 8;
        panel(skylineGlass, towerX + Math.cos(angle) * (radius + .04), yy, towerZ + Math.sin(angle) * (radius + .04), radius * .35, 2.0, Math.PI / 2 - angle);
      }
    }
  }

  // Per-instance visibility now culls individual facades and props. Opaque
  // material batches can span the district without submitting off-screen
  // geometry; preserve the existing transparent batches for depth sorting.
  const sharedGroups = new Map();
  for (const batch of batches.values()) {
    const key = `${batch.geometry.uuid}:${batch.material.uuid}:${batch.shadow}`;
    if (!sharedGroups.has(key)) sharedGroups.set(key, []);
    sharedGroups.get(key).push(batch);
  }
  const renderBatches = [];
  for (const group of sharedGroups.values()) {
    const count = group.reduce((sum, batch) => sum + batch.matrices.length, 0);
    if (count > 500 && group[0].material.transparent) renderBatches.push(...group);
    else renderBatches.push({ ...group[0], matrices: group.flatMap(batch => batch.matrices), colors: group.flatMap(batch => batch.colors) });
  }
  for (const batch of renderBatches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
    for (let i = 0; i < batch.matrices.length; i++) {
      mesh.setMatrixAt(i, batch.matrices[i]);
      if (batch.colors[i]) mesh.setColorAt(i, new THREE.Color(batch.colors[i]));
    }
    mesh.castShadow = batch.shadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    root.add(mesh);
    instanceVisibility.add(mesh, { padding: batch.material === materials.leaves ? .16 : 0 });
  }
  const buildingOcclusion = createBuildingOcclusion(solidBuildingBounds);
  const occlusionWorldIdentity = new THREE.Matrix4();
  return {
    root, colliders, roads, ready, lampPositions,
    updateInstanceVisibility(camera, options) {
      root.updateWorldMatrix(true, false);
      // Registered boxes are in the original district world frame. A moved or
      // scaled district keeps frustum culling but skips these static occluders.
      buildingOcclusion.update(camera, { enabled: root.matrixWorld.equals(occlusionWorldIdentity) });
      instanceVisibility.update(camera, { ...options, occlusion: buildingOcclusion });
    },
    restoreInstances: instanceVisibility.restore,
    getInstanceVisibility: () => ({ ...instanceVisibility.getStats(), occluders: buildingOcclusion.getStats() }),
    updateWires: streetDetails.updateWires,
    getWireStats: streetDetails.getWireStats,
    setSky: data => ocean.setSky(data),
    landmarks: district.landmarks,
    zones: district.zones,
    locationAt(x, z) {
      return district.zones.find(zone => x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ)?.name
        || (x < -100 ? 'Pacific Oceanfront' : z < -95 ? 'Palm Avenue' : z > 95 ? 'Marina Way' : 'Ocean Drive');
    },
    setNight(value) {
      ocean.setNight(value);
      materials.lamp.emissiveIntensity=value?4.5:1.3;
      materials.glassWarm.emissiveMap=value?materials.glassWarm.map:null;
      materials.glassWarm.emissiveIntensity=value?.8:.035;
      materials.glassWarm.needsUpdate=true;
      illuminatedSigns.forEach(({material,intensity})=>material.emissiveIntensity=intensity*(value?3:1));
    },
    bounds: { minX: -148, maxX: 143, minZ: -238, maxZ: 194 },
    update(dt, time) { ocean.update(time); breeze.value = time; updateTrafficSignals(time); },
  };
}
