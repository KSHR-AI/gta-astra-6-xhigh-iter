import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The diner receives its fruit through this service lane. Everything is built
// in metres and joins the district's existing material/geometry instance batches.
export function addServiceLaneDressing(api) {
  const { box, panel, instance, materials: m, colliders, canvasTexture } = api;
  const solid = (x, z, w, d, h) => colliders.push({
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h,
  });
  // Original citrus-trade livery. The same plate identifies the trailer,
  // receiving rack, and individual slatted boxes at the diner.
  const livery = canvasTexture(768, 256, (c, w, h) => {
    c.fillStyle = '#efe0ae'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#24554e'; c.fillRect(0, 197, w, 59);
    c.fillStyle = '#ce5735'; c.fillRect(0, 189, w, 6);
    c.fillStyle = '#ec913c'; c.beginPath(); c.arc(113, 117, 70, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#cd5131'; c.beginPath(); c.arc(125, 126, 57, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#f7c46a'; c.beginPath(); c.arc(125, 126, 45, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#d97038'; c.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      c.beginPath(); c.moveTo(125 + 5 * Math.cos(a), 126 + 5 * Math.sin(a));
      c.lineTo(125 + 40 * Math.cos(a), 126 + 40 * Math.sin(a)); c.stroke();
    }
    c.fillStyle = '#286050'; c.beginPath(); c.moveTo(107, 65);
    c.quadraticCurveTo(63, 59, 51, 19); c.quadraticCurveTo(104, 14, 107, 65); c.fill();
    c.fillStyle = '#264f44'; c.textBaseline = 'middle';
    c.font = 'italic bold 116px Georgia'; c.fillText('Solana', 207, 106, 516);
    c.font = 'bold 21px Arial'; c.fillText('C O A S T A L   C I T R U S', 224, 167);
    c.fillStyle = '#f4e2ad'; c.font = 'bold 22px Arial';
    c.fillText('LOS PACIFICOS  •  GROWERS COOPERATIVE', 80, 227, 609);
    for (let y = 5; y < h; y += 16) {
      c.fillStyle = 'rgba(255,250,215,.08)'; c.fillRect(0, y, w, 1);
      c.fillStyle = 'rgba(30,50,42,.09)'; c.fillRect(0, y + 2, w, 2);
    }
  });
  const printed = new THREE.MeshStandardMaterial({ map: livery, roughness: .81, metalness: .07 });
  const wheel = new THREE.CylinderGeometry(1, 1, 1, 12);
  const flank = -Math.PI / 2;
  const x = 61.76, z = -36;
  // 2.48-m-wide refrigerated pup trailer. Its yellow landing feet keep the
  // uncoupled front level; its tandem axles carry the rear instead of four corners.
  box(m.dark, x, .84, z, 1.45, .29, 7.8);
  box(m.white, x, 2.48, z, 2.48, 2.72, 8.25);
  box(m.metal, x, 3.88, z, 2.56, .14, 8.35);
  box(m.teal, x, 1.23, z, 2.52, .25, 8.31);
  solid(x, z, 2.55, 8.35, 3.95);
  panel(printed, x - 1.245, 2.55, z, 7.72, 2.5, flank);
  for (const end of [-1, 1]) {
    box(m.metal, x - 1.26, 2.51, z + end * 4.06, .12, 2.63, .14);
    box(m.lamp, x - 1.325, 3.75, z + end * 3.85, .035, .09, .16, 0, false);
  }
  for (const side of [-1, 1]) {
    box(m.metal, x + side * .8, .62, z - 2.4, .13, 1.12, .15);
    box(m.yellow, x + side * .8, .095, z - 2.4, .4, .14, .46, 0, false);
    for (const dz of [2.15, 3.12]) {
      const wx = x + side * 1.03;
      instance(wheel, m.dark, [wx, .49, z + dz], [.46, .31, .46], [0, 0, Math.PI / 2]);
      instance(wheel, m.metal, [wx + side * .16, .49, z + dz], [.245, .05, .245], [0, 0, Math.PI / 2]);
    }
    box(m.metal, x + side * .59, 2.48, z + 4.16, .055, 2.3, .065);
    box(m.blackMetal, x + side * .47, 1.75, z + 4.2, .28, .055, .07);
    box(m.redLight, x + side * 1.02, 1.22, z + 4.19, .22, .1, .04, 0, false);
  }
  box(m.dark, x, 1.03, z + 4.21, 2.51, .18, .18);
  panel(printed, x, 3.06, z + 4.17, 1.85, .66);
  // Condenser and louver bank face the other direction of travel.
  box(m.pale, x, 2.92, z - 4.29, 1.49, 1.28, .37);
  for (let n = 0; n < 6; n++) box(m.blackMetal, x, 2.57 + n * .14, z - 4.49, 1.18, .046, .03, 0, false);

  // Build each reusable crate at its own origin. Slats and fruit appear in
  // two instanced batches even when several pallets enter the same view.
  const slats = [];
  const slat = (dx, dy, dz, w, h, d) => slats.push(new THREE.BoxGeometry(w, h, d).translate(dx, dy, dz));
  slat(0, .085, 0, .94, .12, .66);
  for (const side of [-1, 1]) {
    for (const height of [.19, .34]) {
      slat(0, height, side * .33, .99, .112, .045);
      slat(side * .475, height, 0, .055, .112, .65);
    }
    for (const end of [-1, 1]) slat(side * .43, .23, end * .29, .075, .39, .075);
  }
  const crateShell = mergeGeometries(slats);
  const oranges = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const fruit = new THREE.IcosahedronGeometry(.11, 0);
    fruit.scale(1, .96, 1).rotateY(i + j).translate((i - 1.5) * .21, .34, (j - 1) * .19);
    const tone = new THREE.Color((i + j) % 3 ? '#ed9739' : '#e0a43e');
    const color = new THREE.Float32BufferAttribute(new Float32Array(fruit.attributes.position.count * 3), 3);
    for (let v = 0; v < color.count; v++) color.setXYZ(v, tone.r, tone.g, tone.b);
    fruit.setAttribute('color', color);
    oranges.push(fruit);
  }
  const fruitTray = mergeGeometries(oranges);
  const peel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86 });
  function crate(x, y, z, filled) {
    instance(crateShell, m.trunkLight, [x, y, z], [1, 1, 1]);
    if (filled) instance(fruitTray, peel, [x, y, z], [1, 1, 1], [0, 0, 0], false);
  }
  function pallet(x, z, layers) {
    box(m.trunk, x, .12, z, 1.32, .18, 1.65);
    for (let i = 0; i < layers; i++) {
      for (const dz of [-.37, .37]) crate(x, .21 + i * .39, z + dz, i === layers - 1);
    }
    solid(x, z, 1.32, 1.65, .21 + .4 * layers);
  }
  pallet(60.54, -28.6, 3);
  pallet(62.1, -28.78, 1);
  pallet(48.3, 24, 2);

  // The same co-op supplies the juice cart just inside the diner window.
  // Its back faces the dining room; the open doorway is 2.5 m to its north.
  const cartX = 19.1, cartZ = 35.4;
  box(m.teal, cartX, .64, cartZ, .79, .94, 1.67);
  box(m.metal, cartX, 1.15, cartZ, .91, .09, 1.78);
  panel(printed, cartX - .401, .69, cartZ, 1.48, .55, flank);
  for (const dz of [-.57, .57]) {
    instance(wheel, m.dark, [cartX - .31, .18, cartZ + dz], [.15, .08, .15], [0, 0, Math.PI / 2]);
    instance(wheel, m.dark, [cartX + .31, .18, cartZ + dz], [.15, .08, .15], [0, 0, Math.PI / 2]);
  }
  const juice = new THREE.MeshStandardMaterial({ color: '#e79337', roughness: .24, metalness: .04 });
  for (const dz of [-.39, .39]) {
    box(m.pale, cartX, 1.29, cartZ + dz, .57, .21, .56);
    instance(wheel, juice, [cartX, 1.66, cartZ + dz], [.245, .53, .245]);
    instance(wheel, m.metal, [cartX, 1.96, cartZ + dz], [.263, .07, .263]);
    box(m.blackMetal, cartX + .28, 1.44, cartZ + dz, .14, .13, .09, 0, false);
  }
  solid(cartX, cartZ, .9, 1.77, 1.98);

  // Empty galvanized return cage on the opposite wall, with timber bumpers,
  // an independent pole lamp and a smaller livery plate facing the alley.
  const rackX = 48.9, rackZ = -47.2;
  box(m.dark, rackX, .14, rackZ, 1.47, .19, 2.44);
  for (const dx of [-.68, .68]) for (const dz of [-1.15, 1.15])
    box(m.metal, rackX + dx, 1.16, rackZ + dz, .066, 2, .066);
  for (const height of [.36, 1.02, 1.69]) {
    box(m.metal, rackX, height, rackZ, 1.44, .045, 2.36);
    box(m.trunkLight, rackX + .72, height + .07, rackZ, .06, .12, 2.35);
  }
  panel(printed, rackX + .74, 1.89, rackZ, 1.45, .48, Math.PI / 2);
  solid(rackX, rackZ, 1.5, 2.45, 2.17);
  const poleX = 60.15, poleZ = -42.7;
  box(m.trunk, poleX, 2.2, poleZ, .23, 4.35, .23);
  box(m.metal, poleX + .43, 4.28, poleZ, 1.01, .095, .09);
  box(m.teal, poleX + .85, 4.19, poleZ, .62, .16, .42);
  box(m.lamp, poleX + .85, 4.10, poleZ, .49, .04, .32, 0, false);
  solid(poleX, poleZ, .23, .23, 4.4);
}
