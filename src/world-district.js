import * as THREE from 'three';

// These blocks are authored around usable rooms and courtyards. Ground-level
// collision follows individual walls, never the bounding box of an open room.
export function addAuthoredDistrict(api) {
  const { box, panel, cylinder, line, instance, materials: m, canvasTexture,
    colliders, panelGeometry, sign, palm, shrub, range } = api;
  const round = new THREE.CylinderGeometry(1, 1, 1, 16);
  const tyre = new THREE.TorusGeometry(.39, .125, 6, 12);
  const matte = (color, roughness = .88, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  const wood = matte('#635143');
  const velvet = matte('#465956');
  const burgundy = matte('#713e35');
  const cream = matte('#d4c9a8');
  const glass = matte('#adc6bd', .13, { metalness: .12, transparent: true, opacity: .25, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4 });
  const tileMap = canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = '#b2a48c'; c.fillRect(0, 0, w, h);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      c.fillStyle = (x + y) % 2 ? '#c0b49a' : '#777e71'; c.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
      c.fillStyle = 'rgba(47,45,35,.08)'; c.fillRect(x * 64 + 2, y * 64 + 59, 60, 3);
    }
  });
  tileMap.wrapS = tileMap.wrapT = THREE.RepeatWrapping; tileMap.repeat.set(3, 2);
  const tiles = matte('#e1dbc5', .74, { map: tileMap });
  // The street's older buildings share the same quiet palette, but their
  // construction differs: fabric shop canopies, glazed tile and breeze blocks.
  const fabricMap = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#d4c5a3'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 128) {
      c.fillStyle = '#4b665b'; c.fillRect(x, 0, 60, h);
      c.fillStyle = '#ac9c7c'; c.fillRect(x + 61, 0, 3, h);
    }
    for (let y = 0; y < h; y += 3) {
      c.fillStyle = 'rgba(28,36,29,.045)'; c.fillRect(0, y, w, 1);
    }
  });
  const fabric = matte('#fff8e3', .96, { map: fabricMap, side: THREE.DoubleSide });
  const mosaicMap = canvasTexture(512, 256, (c, w, h) => {
    c.fillStyle = '#887d67'; c.fillRect(0, 0, w, h);
    const colors = ['#557368', '#718e7c', '#ccbd97', '#bd825b', '#d5c7a6'];
    for (let row = 0; row < 8; row++) for (let col = 0; col < 16; col++) {
      c.fillStyle = colors[(row * 7 + col * 3 + (row % 3)) % colors.length];
      c.fillRect(col * 32 + 1, row * 32 + 1, 29.5, 29.5);
      c.fillStyle = 'rgba(255,246,207,.12)'; c.fillRect(col * 32 + 2, row * 32 + 2, 28, 1);
    }
  });
  mosaicMap.wrapS = mosaicMap.wrapT = THREE.RepeatWrapping;
  const mosaic = matte('#e3dac1', .48, { map: mosaicMap, metalness: .04 });
  // A shaped fabric canopy has a sloped roof, separate valance and closed
  // returns. One shared geometry/material is instanced across all storefronts.
  const canopy = new THREE.BufferGeometry();
  const canopyPositions = [], canopyUVs = [], canopyIndices = [];
  const section = [[0, 0], [-.07, .42], [-.23, .96], [-.43, 1.48], [-.49, 1.68], [-.72, 1.68]];
  for (let i = 0; i < section.length; i++) {
    const [y, z] = section[i];
    canopyPositions.push(-.5, y, z, .5, y, z);
    canopyUVs.push(0, 1 - i / (section.length - 1), 1, 1 - i / (section.length - 1));
    if (i) canopyIndices.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  }
  for (const side of [-1, 1]) {
    const start = canopyPositions.length / 3;
    canopyPositions.push(side * .5, 0, 0, side * .5, -.49, 1.68, side * .5, -.72, 1.68, side * .5, -.72, 0);
    canopyUVs.push(.25, 1, .25, .3, .3, 0, .3, 1);
    canopyIndices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  canopy.setAttribute('position', new THREE.Float32BufferAttribute(canopyPositions, 3));
  canopy.setAttribute('uv', new THREE.Float32BufferAttribute(canopyUVs, 2));
  canopy.setIndex(canopyIndices); canopy.computeVertexNormals();
  const awning = (x, y, z, width, yaw) => instance(canopy, fabric, [x, y, z], [width, 1, 1], [0, yaw, 0]);
  const solid = (x, z, w, d, h = 4) => colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h });
  const wall = (material, x, z, w, d, h, y = h / 2) => { box(material, x, y, z, w, h, d); solid(x, z, w, d, y + h / 2); };
  const floor = (material, x, z, w, d) => (api.walkableBox ?? box)(material, x, .022, z, w, .025, d, 0, false, 'district-floor');
  const flat = (material, x, z, w, d, angle = 0, y = .055) => instance(panelGeometry, material, [x, y, z], [w, d, 1], [-Math.PI / 2, 0, angle], false);
  const planter = (x, z, w = 1.2, d = 1.2, h = .65) => {
    wall(m.terracotta, x, z, w, d, h);
    box(m.soil, x, h + .02, z, w - .14, .06, d - .14, 0, false);
    const count = Math.max(1, Math.ceil(d / 1.2));
    for (let i = 0; i < count; i++) shrub(x, h + .44 + range(-.05, .08), z + (i - (count - 1) / 2) * d / count, w * 1.13, .95, d / count * 1.22);
  };
  const lamp = (x, y, z, face = 1) => {
    box(m.dark, x, y, z, .16, .36, .22);
    box(m.lamp, x + face * .09, y, z, .025, .26, .15, 0, false);
    box(m.dark, x + face * .12, y + .2, z, .35, .06, .29);
  };
  const chair = (x, z, angle = 0, material = velvet) => {
    const part = (dx, y, dz, w, h, d, mat) => box(mat, x + dx * Math.cos(angle) + dz * Math.sin(angle), y, z - dx * Math.sin(angle) + dz * Math.cos(angle), w, h, d, angle);
    part(0, .48, 0, .65, .13, .66, material); part(0, .88, .3, .65, .72, .1, material);
    for (const dx of [-.25, .25]) for (const dz of [-.25, .25]) part(dx, .24, dz, .045, .48, .045, m.metal);
  };
  const table = (x, z, width = 1.4, depth = 1.1) => {
    box(wood, x, .79, z, width, .1, depth);
    for (const dx of [-width * .4, width * .4]) for (const dz of [-depth * .38, depth * .38]) box(m.blackMetal, x + dx, .4, z + dz, .055, .78, .055);
    cylinder(cream, x + .13, .91, z, .055, .14);
    box(m.paint, x - .25, .85, z + .15, .24, .01, .32, .12, false);
  };
  const parapet = (x, z, w, d, y, material = m.white) => {
    box(m.concrete, x, y, z, w + .4, .25, d + .4);
    for (const side of [-1, 1]) {
      box(material, x + side * (w / 2 - .15), y + .4, z, .3, .75, d);
      box(material, x, y + .4, z + side * (d / 2 - .15), w, .75, .3);
      box(m.trim, x + side * (w / 2 - .15), y + .8, z, .42, .08, d + .1, 0, false);
      box(m.trim, x, y + .8, z + side * (d / 2 - .15), w + .1, .08, .42, 0, false);
    }
  };
  const ac = (x, y, z, scale = 1) => {
    box(m.metal, x, y + .55 * scale, z, 2.2 * scale, 1.1 * scale, 1.6 * scale);
    box(m.dark, x, y + 1.12 * scale, z, 1.9 * scale, .04, 1.34 * scale);
    for (let i = -3; i <= 3; i++) box(m.pale, x + i * .26 * scale, y + 1.16 * scale, z, .06, .04, 1.26 * scale, 0, false);
    cylinder(m.metal, x + 1.7 * scale, y + .6, z, .18, 1.2);
  };
  const window = (x, y, z, w, h, rotation, material = m.glass) => {
    const dx = Math.sin(rotation), dz = Math.cos(rotation);
    panel(m.dark, x, y, z, w + .18, h + .18, rotation);
    panel(material, x + dx * .025, y, z + dz * .025, w, h, rotation);
    box(m.trim, x + dx * .15, y - h / 2 - .09, z + dz * .15, w + .3, .12, .35, rotation, false);
    panel(m.metal, x + dx * .05, y, z + dz * .05, .045, h, rotation);
  };

  // PALOMA MOTOR LODGE: a low U-shaped property with a street-open courtyard.
  // Its north office has a genuinely open doorway, with all furniture modeled.
  floor(m.concrete, -34.5, 45, 35, 61);
  wall(m.peach, -46.4, 44.5, 10.8, 58, 6.5);
  wall(m.peach, -32.4, 69.1, 28.2, 10.8, 3.65);
  parapet(-46.4, 44.5, 10.8, 58, 6.5, m.peach);
  parapet(-32.4, 69.1, 28.2, 10.8, 3.65, m.peach);
  // Recessed guest room doors, individual sconces and air-conditioning units.
  for (let z = 29; z <= 62; z += 6.6) {
    panel(m.dark, -40.97, 1.32, z, 1.14, 2.6, Math.PI / 2);
    panel(m.teal, -40.94, 1.3, z, .98, 2.45, Math.PI / 2);
    box(m.metal, -40.87, 1.25, z - .34, .05, .045, .17);
    window(-40.9, 1.8, z + 2.65, 2.6, 1.55, Math.PI / 2, m.glassLight);
    lamp(-40.85, 2.7, z - .95);
    box(m.pale, -40.65, .62, z + 2.65, .5, .52, 1.15);
    for (let n = -3; n <= 3; n++) box(m.dark, -40.39, .62 + n * .048, z + 2.65, .015, .022, 1.02, 0, false);
    window(-40.9, 4.9, z + .8, 3.5, 1.7, Math.PI / 2);
  }
  box(m.trim, -39.9, 3.25, 45, 2.7, .18, 39);
  for (const z of [27, 39.5, 52, 63]) cylinder(m.teal, -38.7, 1.6, z, .075, 3.2);
  for (const x of [-35.5, -28.8, -22.1]) {
    panel(m.teal, x, 1.35, 63.68, 1.05, 2.5, Math.PI);
    window(x - 2.2, 1.8, 63.65, 2.6, 1.65, Math.PI, m.glassLight);
  }
  // Motel office: side walls and two separate street-facing pieces leave a 3m door.
  floor(tiles, -29.5, 20.2, 21.8, 10.4);
  wall(m.peach, -40.2, 20.2, .35, 10.6, 3.6);
  wall(m.peach, -29.5, 15, 21.8, .35, 3.6);
  wall(m.peach, -29.5, 25.3, 21.8, .35, 3.6);
  wall(m.peach, -18.7, 16.65, .35, 3.25, 3.6);
  wall(m.peach, -18.7, 23.35, .35, 3.65, 3.6);
  box(m.peach, -18.7, 3.24, 20, .35, .75, 3.5);
  box(m.teal, -18.7, 2.83, 20, .42, .1, 3.45);
  for (const z of [18.35, 21.65]) box(m.teal, -18.7, 1.4, z, .43, 2.8, .1);
  parapet(-29.5, 20.2, 21.8, 10.7, 3.7, m.peach);
  box(m.trim, -18.2, 3.48, 20.1, 3.4, .18, 10.8);
  sign('OFFICE  /  VACANCY', -17.92, 3.27, 20.1, 7.8, .42, Math.PI / 2, { background: '#355d54', color: '#e8ddbd', fontSize: 61 });
  wall(wood, -29.2, 21.5, 1.25, 5, 1.02);
  box(cream, -29.2, 1.08, 21.5, 1.45, .12, 5.2);
  box(m.dark, -29, 1.31, 20.4, .33, .32, .6);
  box(m.glassDark, -28.82, 1.45, 20.4, .025, .25, .43, 0, false);
  box(wood, -39.96, 1.9, 20, .08, 1.4, 3.1);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 8; col++) {
    cylinder(m.metal, -39.83, 1.45 + row * .4, 18.7 + col * .36, .025, .09, false);
    panel(m.paint, -39.8, 1.37 + row * .4, 18.7 + col * .36, .11, .18, Math.PI / 2);
  }
  for (const z of [17.2, 18.3]) chair(-23.6, z, Math.PI / 2);
  table(-24, 23.5, 1.1, .8);
  planter(-20.6, 23.8, .8, .8, .6);
  sign('PALOMA LODGE', -39.95, 2.9, 20.3, 6.1, .65, Math.PI / 2, { background: '#d3c8ab', color: '#39544c', border: false });
  box(m.lamp, -25, 3.52, 20.2, 2.3, .035, .3, 0, false);
  // Mid-century breeze-block screens and an open timber pergola make the
  // motel courtyard a recognisable place without closing its arrival route.
  for (const z of [16.1, 24.05]) {
    panel(mosaic, -18.495, 1.55, z, 1.55, 2.7, Math.PI / 2);
    box(m.trim, -18.38, .16, z, .28, .28, 1.7);
  }
  for (const z of [31.6, 32.5, 33.4, 34.3, 35.2]) {
    for (const y of [.55, 1.18, 1.81]) {
      // Four sides leave a real aperture in every concrete block.
      box(m.pale, -18.4, y - .26, z, .25, .1, .8);
      box(m.pale, -18.4, y + .26, z, .25, .1, .8);
      for (const dz of [-.35, .35]) box(m.pale, -18.4, y, z + dz, .25, .46, .1);
      box(m.pale, -18.4, y, z, .25, .08, .49, Math.PI / 4, false);
    }
  }
  solid(-18.4, 33.4, .35, 4.6, 2.15);
  for (const z of [39, 53]) {
    wall(wood, -19.2, z, .14, .14, 3.15);
    wall(wood, -24.1, z, .14, .14, 3.15);
  }
  for (const x of [-19.2, -24.1]) box(wood, x, 3.14, 46, .18, .22, 14.5);
  for (let z = 39; z <= 53; z += .78) box(wood, -21.65, 3.3, z, 5.5, .16, .11);
  for (const z of [39, 46, 53]) box(m.lamp, -21.6, 3.08, z, .3, .06, .3, 0, false);
  sign('POOL  /  GUESTS ONLY', -28.9, .8, 38.4, 2.2, .42, Math.PI / 2, { background: '#d5c5a2', color: '#49645a', fontSize: 46 });
  // A pool is visibly bounded; paths around it remain flush with the street.
  floor(m.pale, -32.5, 47, 12.5, 20.5);
  floor(m.pool, -33.2, 46.5, 7.4, 14.2);
  solid(-33.2, 46.5, 7.8, 14.6, .32);
  for (const x of [-37.1, -29.3]) box(m.trim, x, .16, 46.5, .38, .3, 14.8);
  for (const z of [39.2, 53.8]) box(m.trim, -33.2, .16, z, 8.2, .3, .38);
  for (const z of [41.2, 46.2, 51.2]) {
    box(cream, -25.6, .36, z, 1.1, .12, 2.5);
    box(velvet, -25.6, .45, z, .97, .08, 2.3);
    box(cream, -25.6, .67, z + .9, 1.1, .55, .1);
    for (const side of [-1, 1]) box(m.metal, -25.6 + side * .42, .19, z, .05, .35, 2.1);
  }
  planter(-19.1, 35.3, 1.3, 3.2); planter(-19.1, 58.8, 1.3, 3.1);
  palm(-23.4, 57.5, 6.8, .68);
  palm(-35.7, 30.4, 7.5, .67);
  // Roadside pylon and broad projecting eaves give the low motel its own silhouette.
  for (const z of [55.5, 57.2]) cylinder(m.teal, -18.35, 5.05, z, .095, 10.1);
  box(m.teal, -18.35, 8.3, 56.4, .45, 4.1, 4.1);
  sign('PALOMA', -18.08, 9.25, 56.4, 3.8, 1.05, Math.PI / 2, { background: '#3c6258', color: '#ffe3a7', glow: .22 });
  sign('MOTOR LODGE', -18.08, 8.05, 56.4, 3.8, .6, Math.PI / 2, { background: '#3c6258', color: '#dfc7a5', fontSize: 56 });
  sign('VACANCY', -18.08, 6.9, 56.4, 3.5, .7, Math.PI / 2, { background: '#412b27', color: '#f7a071', glow: .35 });
  ac(-46, 6.9, 24); ac(-46, 6.9, 57); ac(-31, 4.1, 69);

  // NORTH CORNER: a contact office below older, imperfect apartment floors.
  // The counter is reached through an open, 3.6m-wide east-facing doorway.
  floor(tiles, -33.4, -32, 32.1, 26);
  wall(m.brick, -49.4, -32, .4, 26, 4.1);
  wall(m.brick, -33.4, -44.9, 32.4, .4, 4.1);
  wall(m.brick, -33.4, -19.1, 32.4, .4, 4.1);
  for (const [z, depth] of [[-36.4, 17], [-21.2, 4.2]]) {
    wall(m.teal, -17.35, z, .36, depth, .65);
    box(m.teal, -17.35, 3.75, z, .36, .7, depth);
    panel(glass, -17.34, 2.0, z, depth - .18, 2.7, Math.PI / 2);
    solid(-17.35, z, .36, depth, 4.1);
    for (let zz = z - depth / 2 + .2; zz <= z + depth / 2; zz += 3.2) box(m.teal, -17.3, 2, zz, .32, 3.5, .09);
  }
  box(m.teal, -17.35, 3.75, -25.2, .36, .7, 3.6);
  for (const z of [-27.05, -23.35]) box(m.teal, -17.32, 1.65, z, .39, 3.3, .1);
  box(m.peach, -33.4, 8.2, -32, 32.4, 8.2, 26);
  box(m.trim, -33.4, 4.2, -32, 33.1, .3, 26.7);
  parapet(-33.4, -32, 32.4, 26, 12.3, m.peach);
  // Windows are arranged in paired bays, with a partial return terrace above.
  for (const y of [6.1, 9.5]) {
    for (let z = -41.8; z < -20; z += 4.5) {
      window(-17.14, y, z, 2.5, 2.0, Math.PI / 2, z % 2 ? m.glassWarm : m.glass);
      // Deep plaster returns, divided upper lights and a projecting hood make
      // the glazing sit inside the facade instead of reading as blue stickers.
      for (const dz of [-1.4, 1.4]) box(m.pale, -16.96, y, z + dz, .46, 2.4, .22);
      box(m.pale, -16.9, y + 1.18, z, .58, .22, 3.0);
      box(m.teal, -16.99, y + .57, z, .07, .055, 2.5, 0, false);
      for (const dz of [-.42, .42]) box(m.teal, -16.99, y, z + dz, .07, 2.0, .045, 0, false);
      box(m.pale, -16.87, y - 1.15, z, .65, .16, 3.06);
    }
    for (let x = -46; x < -18; x += 4.5) {
      window(x, y, -18.98, 2.3, 2.05, 0, m.glass);
      for (const dx of [-1.28, 1.28]) box(m.pale, x + dx, y, -18.78, .18, 2.4, .44);
      box(m.pale, x, y + 1.18, -18.7, 2.82, .2, .59);
      box(m.teal, x, y + .56, -18.88, 2.3, .05, .08, 0, false);
    }
  }
  for (const z of [-44.3, -39.55, -35.05, -30.55, -26.05, -20.0]) box(m.pale, -17.04, 8.2, z, .37, 7.5, .3);
  for (const y of [7.72, 11.1]) {
    box(m.trim, -16.97, y, -32, .56, .14, 26.2);
    box(m.trim, -33.4, y, -18.79, 32.5, .14, .48);
  }
  for (const z of [-41.8, -37.3, -32.8, -28.3, -23.8]) awning(-17.05, 3.5, z, 4.22, Math.PI / 2);
  for (const x of [-43.4, -37.3, -31.2, -25.1]) {
    window(x, 1.93, -18.86, 4.68, 2.58, 0, m.glassDark);
    awning(x, 3.5, -18.83, 5.48, 0);
    box(m.teal, x, .42, -18.82, 5.45, .67, .18);
    panel(mosaic, x, .44, -18.71, 4.95, .42, 0);
  }
  sign('ORBIT  •  TRAVEL & EXCHANGE', -17.0, 3.88, -32, 20.9, .48, Math.PI / 2, { background: '#30544e', color: '#e5d6b3', fontSize: 62 });
  sign('ORBIT', -24, 3.75, -18.78, 10.7, .76, 0, { background: '#30544e', color: '#e5d6b3', fontSize: 72 });
  sign('OPEN  /  COME INSIDE', -17.06, 2.7, -22, 2.0, .31, Math.PI / 2, { background: '#d2c099', color: '#354b45', fontSize: 48 });
  wall(wood, -27.4, -25.3, 1.1, 6, 1.03);
  box(cream, -27.4, 1.11, -25.3, 1.4, .14, 6.2);
  box(m.dark, -27.1, 1.47, -26.3, .12, .57, .82);
  panel(m.glassDark, -27.02, 1.5, -26.3, .7, .4, Math.PI / 2);
  box(m.blackMetal, -26.95, 1.22, -26.3, .32, .035, .58);
  cylinder(cream, -27.1, 1.32, -23.1, .075, .23);
  // Partition and actual bookcases make depth visible through the shop windows.
  wall(m.pale, -31.8, -30.7, .22, 15.5, 3.8);
  box(wood, -31.49, 1.25, -25.6, .4, 2.4, 7.3);
  for (const y of [.33, 1, 1.65, 2.32]) {
    box(cream, -31.25, y, -25.6, .7, .065, 7.5);
    for (let i = 0; i < 12; i++) box(i % 3 ? m.teal : burgundy, -31.23, y + .24, -28.9 + i * .57, .43, .4, .33 + (i % 2) * .1, 0, false);
  }
  chair(-21.2, -29.7, Math.PI); chair(-23, -29.7, Math.PI);
  table(-22.1, -33, 1.4, 1); chair(-22.1, -34.2, Math.PI);
  planter(-19.6, -20.6, 1, 1, .7);
  planter(-19.5, -41.7, 1.2, 1.2, .75);
  sign('THE WORLD IS STILL OUT THERE', -31.5, 2.97, -25.2, 7.0, .5, Math.PI / 2, { background: '#b9ae92', color: '#39584e', border: false, fontSize: 43 });
  for (const z of [-24, -34, -41]) box(m.lamp, -23, 3.89, z, 2, .04, .32, 0, false);
  // The corner carries a weathered vertical blade instead of another identical roof.
  box(burgundy, -17.8, 8.3, -18.4, 1.45, 6.1, .35);
  sign('O', -17.8, 10.2, -18.2, 1.1, 1.05, 0, { background: '#713e35', color: '#f0d9ae', border: false, glow: .2 });
  sign('R', -17.8, 8.8, -18.2, 1.1, 1.05, 0, { background: '#713e35', color: '#f0d9ae', border: false, glow: .2 });
  sign('B', -17.8, 7.4, -18.2, 1.1, 1.05, 0, { background: '#713e35', color: '#f0d9ae', border: false, glow: .2 });
  sign('I T', -17.8, 6.05, -18.2, 1.1, .8, 0, { background: '#713e35', color: '#f0d9ae', border: false, glow: .2 });
  ac(-39, 12.8, -37); ac(-26, 12.8, -37);
  box(m.white, -40, 14, -28, 9, 2.6, 9);
  parapet(-40, -28, 9, 9, 15.3, m.white);

  // ASTRA AUTO: the nine-metre bay is physically open from road to work floor.
  floor(m.concrete, 31.5, -126, 31, 36);
  floor(m.patch, 15.2, -126, 9.2, 12.4);
  wall(m.pale, 48.4, -126, .5, 35.2, 6.4);
  wall(m.brick, 33.2, -143.3, 30.8, .5, 6.4);
  wall(m.brick, 33.2, -108.7, 30.8, .5, 6.4);
  wall(m.brick, 18, -137.05, .5, 12.5, 6.4);
  wall(m.brick, 18, -114.95, .5, 12.5, 6.4);
  // Header has no ground collider: cars and pedestrians pass below it.
  box(m.teal, 18, 5.65, -126, .65, 1.5, 9.6);
  for (const z of [-130.8, -121.2]) box(m.teal, 17.75, 2.4, z, .4, 4.8, .22);
  box(m.dark, 18.3, 5, -126, .5, .35, 9.2);
  for (let y = 5.1; y < 6.3; y += .15) box(m.metal, 17.63, y, -126, .06, .1, 9.1, 0, false);
  parapet(33.2, -126, 31, 35, 6.45, m.pale);
  // Three roof clerestories and vents break the long industrial silhouette.
  for (const z of [-137, -126, -115]) {
    box(m.dark, 35, 6.65, z, 12, .2, 4.4);
    box(m.glassLight, 35, 7.1, z, 11.4, .65, 3.8);
    box(m.trim, 35, 7.48, z, 12.1, .1, 4.5);
    for (const x of [30, 33, 36, 39]) box(m.metal, x, 7.12, z - 1.93, .09, .7, .12);
  }
  sign('ASTRA  AUTO  WORKS', 17.59, 5.82, -126, 21, 1.0, -Math.PI / 2, { background: '#344e48', color: '#e4c99e', fontSize: 75 });
  sign('TUNE  /  REPAIR  /  REPAINT', 17.68, 3.45, -137.1, 10.2, .6, -Math.PI / 2, { background: '#918b73', color: '#ede1c2', fontSize: 53 });
  for (const z of [-131.7, -120.3]) {
    cylinder(m.yellow, 17.2, .65, z, .13, 1.3);
    cylinder(m.dark, 17.2, .82, z, .136, .2, false);
    solid(17.2, z, .3, .3, 1.3);
  }
  // Storage and hydraulic lift posts leave the centre of the destination clear.
  for (const z of [-136, -116]) {
    wall(burgundy, 44.6, z, 1.5, 6.8, 1.15);
    box(m.metal, 44.6, 1.2, z, 1.7, .11, 7.1);
    for (let n = 0; n < 5; n++) box(m.metal, 43.83, .38 + n * .16, z, .02, .04, 5.9, 0, false);
    box(m.dark, 48.1, 2.6, z, .08, 2.15, 8.2);
    for (let i = 0; i < 11; i++) box(m.metal, 47.99, 2.2 + (i % 3) * .32, z - 3.4 + i * .65, .045, .55, .035, 0, false);
    for (const x of [27, 36.5]) {
      wall(m.blue, x, z, .45, .65, 3.4);
      box(m.dark, x, .13, z, 1.1, .23, 1.1);
      box(m.metal, x + (x < 30 ? .65 : -.65), .27, z, 1.5, .16, .28);
    }
    flat(m.stain, 32, z, 5.5, 6.2);
  }
  for (const z of [-137.8, -134.8, -112]) for (let i = 0; i < 3; i++) instance(tyre, m.iron, [40.8, .24 + i * .27, z], [1, 1, 1], [Math.PI / 2, 0, 0]);
  for (const z of [-132, -120]) for (const x of [25, 36]) box(m.lamp, x, 6.25, z, 3.4, .04, .22, 0, false);
  sign('WORK BAY 01', 47.99, 3.8, -126, 7.5, .7, -Math.PI / 2, { background: '#b3b19b', color: '#3b5048', border: false });
  // Rear service court: dumpster, parts pallets and a shaded loading canopy.
  floor(m.patch, 33, -154, 31, 17);
  wall(m.concrete, 48.4, -154, .4, 17, 2.0);
  for (const z of [-147.5, -159.5]) wall(m.concrete, 33.3, z, 30.5, .35, 1.85);
  wall(m.teal, 43.8, -154, 2.4, 4.5, 1.75);
  box(m.dark, 43.8, 1.8, -154, 2.5, .14, 4.6);
  for (const x of [26, 30, 34]) {
    for (const z of [-151, -156]) {
      box(wood, x, .11, z, 2, .2, 1.7);
      box(m.pale, x, .75, z, 1.7, 1.1, 1.4);
      for (const xx of [-.5, .5]) box(m.dark, x + xx, .76, z, .04, 1.15, 1.43, 0, false);
    }
  }

  // SUNLINE DINER: low polished storefront and a covered corner dining terrace.
  floor(tiles, 32.2, 29, 29.5, 27);
  // Join the existing sidewalks to the facade; the old half-metre setback
  // exposed the lower base paving directly outside the windows. Meet the
  // perpendicular pavement at z=15.75 without overlapping its top surface.
  const dinerPaving = api.walkableBox ?? box;
  dinerPaving(m.sidewalk, 17.2, .10, 29.125, .5, .24, 26.75, 0, false, 'sidewalk-apron');
  // A stone entrance tread and contrasting rubber nosing mark the single
  // 18.55 cm step down into the original tiled room. Adjacent pieces share an
  // edge, never a coplanar overlay; neither adds a collision wall to the door.
  dinerPaving(cream, 17.62, .12725, 30.5, .34, .1855, 4.5, 0, false, 'doorway-threshold');
  dinerPaving(m.dark, 17.82, .12725, 30.5, .06, .1855, 4.5, 0, false, 'doorway-threshold');
  wall(m.brick, 46.8, 29, .4, 27, 4.1);
  wall(m.brick, 32.2, 42.3, 29.5, .4, 4.1);
  wall(m.brick, 32.2, 15.7, 29.5, .4, 4.1);
  for (const [z, depth] of [[22, 12.5], [37.5, 9.5]]) {
    wall(m.teal, 17.6, z, .35, depth, .7);
    box(m.teal, 17.6, 3.85, z, .35, .5, depth);
    panel(glass, 17.57, 2.15, z, depth, 2.85, -Math.PI / 2);
    solid(17.6, z, .35, depth, 4.1);
    panel(mosaic, 17.405, .39, z, depth - .12, .51, -Math.PI / 2);
    box(m.metal, 17.37, .72, z, .17, .075, depth);
    for (let zz = z - depth / 2; zz < z + depth / 2; zz += 3.4) {
      box(m.metal, 17.48, 2.15, zz, .24, 3.3, .075);
      box(m.trim, 17.47, 2.87, zz + 1.65, .13, .05, 3.22, 0, false);
    }
  }
  box(m.teal, 17.6, 3.83, 30.5, .35, .55, 4.5);
  parapet(32.2, 29, 29.7, 27, 4.15, m.white);
  // Streamline Moderne rolled fascia, with actual curved cross-section and
  // stainless ribs, distinguishes this diner from the fabric-covered shops.
  const visorSection = new THREE.Shape();
  visorSection.moveTo(0, .1); visorSection.lineTo(-1.67, .1);
  visorSection.quadraticCurveTo(-2.12, .1, -2.12, -.15);
  visorSection.quadraticCurveTo(-2.12, -.43, -1.67, -.43);
  visorSection.lineTo(0, -.43); visorSection.closePath();
  const visorGeometry = new THREE.ExtrudeGeometry(visorSection, { depth: 1, bevelEnabled: false, curveSegments: 5 });
  instance(visorGeometry, m.teal, [17.7, 3.53, 15.12], [1, 1, 27.76]);
  for (const y of [3.23, 3.5]) box(m.metal, 15.57, y, 29, .055, .035, 27.5, 0, false);
  box(m.teal, 32.2, 3.4, 15, 30.2, .18, 2.2);
  sign('COFFEE  /  KITCHEN  /  OPEN LATE', 15.555, 3.36, 29, 19.5, .18, -Math.PI / 2, { background: '#3e6259', color: '#eed9ac', fontSize: 55 });
  sign('SUNLINE', 31, 4.85, 15.375, 13.6, 1.0, Math.PI, { background: '#dfc8a4', color: '#7d4a37', fontSize: 78 });
  box(m.white, 31, 4.85, 15.55, 14.1, 1.35, .32);
  for (const z of [20.8, 29.1]) box(m.metal, 17.9, 4.65, z, .12, 2.1, .12);
  box(cream, 17.45, 5.25, 25, .38, 1.43, 10.8);
  sign('SUNLINE', 17.24, 5.25, 25, 10.3, 1.1, -Math.PI / 2, { background: '#d7c6a1', color: '#7d4a37', fontSize: 78 });
  for (const y of [4.48, 6.02]) box(m.metal, 17.44, y, 25, .42, .045, 10.9);
  // Side windows are enclosed, whereas the central four-metre entrance stays
  // fully open. Framed menu boards and low uplights sit against existing walls.
  for (const x of [23, 29, 35, 41]) {
    window(x, 1.94, 15.465, 4.65, 2.48, Math.PI, m.glassDark);
    box(m.metal, x, .67, 15.42, 5.05, .08, .19);
    panel(mosaic, x, .39, 15.41, 4.85, .43, Math.PI);
  }
  for (const z of [28.1, 32.9]) {
    box(m.metal, 17.36, 1.7, z, .12, 3.35, .1);
    box(cream, 17.31, 1.7, z + (z < 30 ? -.7 : .7), .13, 1.05, .84);
  }
  sign('BREAKFAST / ALL DAY', 17.235, 1.7, 27.4, .73, .93, -Math.PI / 2, { background: '#e0cda8', color: '#5b6958', fontSize: 40 });
  sign('FRESH / LOCAL / COFFEE', 17.235, 1.7, 33.6, .73, .93, -Math.PI / 2, { background: '#e0cda8', color: '#5b6958', fontSize: 40 });
  // Tables, booths, service counter and a real route through the open door.
  for (const z of [20, 25, 36.5]) {
    for (const x of [22, 29]) {
      table(x, z, 1.7, 1.15); chair(x, z - 1.05, Math.PI, burgundy); chair(x, z + 1.05, 0, burgundy);
    }
  }
  wall(wood, 38.9, 28.5, 1.2, 21, 1.0);
  box(cream, 38.9, 1.07, 28.5, 1.5, .13, 21.2);
  for (let z = 19.8; z < 39; z += 2.6) {
    cylinder(m.metal, 36.8, .38, z, .045, .76);
    cylinder(burgundy, 36.8, .8, z, .32, .13);
    cylinder(m.metal, 36.8, .25, z, .26, .04);
  }
  for (const z of [21, 26, 33, 38]) {
    cylinder(m.blackMetal, 29.2, 3.3, z, .018, 1.4);
    instance(round, m.teal, [29.2, 2.65, z], [.35, .2, .35]);
    cylinder(m.lamp, 29.2, 2.53, z, .29, .02, false);
  }
  for (const z of [21, 29, 37]) sign(z === 29 ? 'ALL DAY / EVERY DAY' : 'COFFEE  •  PIE  •  GOOD COMPANY', 46.55, 2.8, z, 6.3, .75, -Math.PI / 2, { background: '#334d45', color: '#d5c4a2', fontSize: 42 });
  ac(36, 4.8, 33); ac(42, 4.8, 23);
  planter(19.2, 40.8, 1, 1.2); planter(19.2, 17.5, 1, 1.2);

  // Setback apartments occupy the adjacent lot, separated by a genuine alley.
  wall(m.limestone, 37, 62, 35, 25, 4.1);
  box(m.white, 39, 10.55, 63.2, 31, 12.9, 22.6);
  box(m.sage, 43, 19.7, 64.5, 23, 5.4, 20);
  parapet(43, 64.5, 23, 20, 22.4, m.sage);
  parapet(39, 63.2, 31, 22.6, 17, m.white);
  box(m.trim, 37, 4.2, 62, 35.7, .24, 25.7);
  for (let y = 6; y < 17; y += 3.4) {
    for (const z of [54.3, 59.4, 64.5, 69.6]) {
      window(23.43, y, z, 3.6, 2.3, -Math.PI / 2, m.glassLight);
      box(m.trim, 22.7, y - 1.3, z, 1.8, .15, 4.3);
      box(m.metal, 21.85, y - .5, z, .05, .05, 4.15, 0, false);
      panel(glass, 21.88, y - .85, z, 4.1, .72, -Math.PI / 2);
      for (const dz of [-1.95, 1.95]) box(m.metal, 21.85, y - .85, z + dz, .045, .75, .045, 0, false);
    }
    for (const x of [28, 33, 38, 43, 48, 52]) window(x, y, 51.85, 3.2, 2.2, Math.PI, m.glass);
  }
  for (const y of [18.6, 21.2]) for (const z of [57.5, 63.5, 69.5]) window(31.43, y, z, 3.9, 1.9, -Math.PI / 2);
  for (const z of [53, 58.5, 64, 69.5]) {
    window(19.43, 2.1, z, 3.9, 2.7, -Math.PI / 2, m.glassDark);
    box(m.terracotta, 18.9, 3.3, z, 1.8, .2, 4.2);
  }
  sign('MARLOWE  APARTMENTS', 18.75, 4.64, 62, 19, .62, -Math.PI / 2, { background: '#c5b79b', color: '#4e6054', border: false, fontSize: 59 });
  ac(45, 23, 65);
  for (const z of [53, 73]) planter(20.2, z, 1.2, 2.3);
  floor(m.patch, 37, 46, 36, 6.4);
  for (const z of [44.7, 47.5]) box(m.concrete, 50.5, .15, z, 2.2, .3, .35);
  wall(m.teal, 51.1, 46.2, 2.0, 1.5, 1.6);
  box(m.dark, 51.1, 1.63, 46.2, 2.1, .12, 1.6);
  flat(m.stain, 48, 46, 4, 3.5);

  return {
    landmarks: { contact: { x: -22, z: -25 }, garage: { x: 28, z: -126 }, safehouse: { x: -27, z: 28 } },
    zones: [
      { name: 'Orbit Exchange', minX: -50, maxX: -16, minZ: -45, maxZ: -19 },
      { name: 'Paloma Motor Lodge', minX: -52, maxX: -17, minZ: 15, maxZ: 76 },
      { name: 'Astra Auto Works', minX: 16, maxX: 50, minZ: -163, maxZ: -108 },
      { name: 'Sunline Diner', minX: 17, maxX: 48, minZ: 15, maxZ: 43 },
      { name: 'Marlowe Apartments', minX: 18, maxX: 56, minZ: 49, maxZ: 76 },
    ],
  };
}
