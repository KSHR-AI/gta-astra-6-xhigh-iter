import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SHIFT_STOPS } from './night-shift.js';

// One printed atlas serves all the labels. Unprinted faces sample the white margin.
function freightMaterial(canvasTexture) {
  const stock = [['PALOMA', 'MOTOR LODGE  /  LINEN', '#285952'], ['PACIFIC PIER', 'PROJECTION  /  35 MM', '#a34433'],
    ['SUNLINE', 'GLASSWARE  /  FRAGILE', '#366275']];
  const map = canvasTexture(512, 512, c => {
    c.fillStyle = '#fff'; c.fillRect(0, 0, 512, 512);
    stock.forEach(([name, caption, tint], index) => {
      const y = index * 144;
      c.fillStyle = '#eee1bd'; c.fillRect(8, y + 8, 496, 126);
      c.fillStyle = tint; c.fillRect(13, y + 13, 486, 116);
      c.fillStyle = '#fff0cc'; c.textAlign = 'center';
      c.font = 'bold 57px Georgia'; c.fillText(name, 256, y + 73, 451);
      c.font = 'bold 22px Arial'; c.fillText(caption, 256, y + 108);
    });
  });
  return new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: .73, metalness: .1 });
}

// Compact the pieces of each package and its trolley once. Each subsequent
// loading action reparents a finished mesh without allocating more geometry.
function kit(material) {
  const parts = [];
  function part(geometry, color, x, y, z, row, yaw = 0) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const tone = new THREE.Color(color);
    const uv = g.attributes.uv, colors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) {
      tone.toArray(colors, i * 3);
      if (row == null) uv.setXY(i, .5, .045);
      else uv.setXY(i, (8 + uv.getX(i) * 496) / 512, 1 - (row * 144 + 8 + (1 - uv.getY(i)) * 126) / 512);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.rotateY(yaw).translate(x, y, z);
    parts.push(g);
  }
  return {
    box: (c, x, y, z, w, h, d) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z),
    soft: (c, x, y, z, w, h, d, radius) => part(new RoundedBoxGeometry(w, h, d, 1, radius), c, x, y, z),
    drum: (c, x, y, z, top, bottom, h, n = 12) => part(new THREE.CylinderGeometry(top, bottom, h, n), c, x, y, z),
    plate: (row, x, y, z, w, h, yaw = 0) => part(new THREE.PlaneGeometry(w, h), '#ffffff', x, y, z, row, yaw),
    finish(name) {
      const mesh = new THREE.Mesh(mergeGeometries(parts), material);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    },
  };
}

const rail = '#a7aba2', iron = '#354341';
function linen(k) {
  for (let i = 0; i < 5; i++) {
    const x = i % 2 ? .013 : -.009, z = i % 2 ? .006 : -.009;
    k.soft(i % 2 ? '#e2dfc9' : '#f5ebd4', x, .058 + i * .105, z, .67, .115, .52, .044);
    k.box('#93aba2', x, .074 + i * .105, -.251 + z, .59, .013, .015);
  }
  for (const x of [-.205, .205]) {
    k.soft('#428074', x, .263, 0, .048, .533, .548, .014);
    k.box('#c2b58a', x, .478, -.28, .064, .053, .018);
  }
  k.plate(0, 0, .32, -.28, .32, .114, Math.PI);
  k.plate(0, 0, .32, .28, .32, .114);
}
function films(k) {
  k.soft('#325955', 0, .19, 0, .7, .37, .52, .036);
  for (const y of [.036, .287, .354]) k.box(rail, 0, y, 0, .708, .018, .529);
  for (const x of [-.32, .32]) for (const z of [-.242, .242]) k.box(rail, x, .19, z, .055, .35, .041);
  for (const x of [-.20, .20]) k.box('#d8c49b', x, .268, -.276, .053, .096, .024);
  k.plate(1, 0, .16, -.263, .43, .153, Math.PI);
  k.plate(1, 0, .16, .263, .43, .153);
  // The flanged reel tin and five punched lid details read from a chase camera.
  k.drum('#96a39c', 0, .406, 0, .238, .238, .09, 24);
  k.drum('#c7cec0', 0, .458, 0, .246, .246, .024, 24);
  k.drum(iron, 0, .474, 0, .034, .034, .009);
  for (let i = 0; i < 5; i++) {
    const a = i * 2 * Math.PI / 5;
    k.drum('#65716b', Math.cos(a) * .142, .473, Math.sin(a) * .142, .045, .045, .006);
  }
}
function glasses(k) {
  k.soft('#36727c', 0, .045, 0, .72, .09, .53, .018);
  for (const side of [-1, 1]) {
    for (const y of [.13, .23]) {
      k.box('#46808a', 0, y, side * .26, .73, .058, .031);
      k.box('#4d8a91', side * .35, y, 0, .03, .058, .51);
    }
    for (const end of [-1, 1]) k.box('#e8cb82', side * .332, .153, end * .244, .043, .248, .043);
  }
  for (let x = -1; x <= 1; x++) for (const z of [-.113, .113]) {
    k.drum('#90baaf', x * .215, .231, z, .076, .088, .266, 10);
    k.drum('#d8e7d7', x * .215, .368, z, .077, .077, .012, 10);
  }
  k.plate(2, 0, .156, -.278, .36, .105, Math.PI);
  k.plate(2, 0, .156, .278, .36, .105);
}

function retainingBand(k, x, height, depth) {
  const webbing = '#b47c45';
  k.box(webbing, x, height, 0, .032, .013, depth);
  for (const end of [-1, 1]) k.box(webbing, x, height / 2, end * depth / 2, .032, height, .012);
}

function dock(k, id) {
  const linenCart = id === 'paloma', glassRack = id === 'sunline';
  const h = glassRack ? .78 : linenCart ? .57 : .215;
  k.box(iron, 0, h - .04, 0, .86, .08, .67);
  for (const x of [-.35, .35]) for (const z of [-.25, .25]) {
    k.box(iron, x, h / 2, z, .039, h - .07, .039);
    k.soft('#37403c', x, .066, z, .087, .131, .127, .03);
  }
  if (glassRack) k.box(rail, 0, .3, 0, .8, .042, .63);
  // Handles stand behind each stock item and stay with the wheeled dolly.
  const handle = linenCart ? 1.36 : 1.03;
  for (const x of [-.35, .35]) k.box(rail, x, (handle + h) / 2, .31, .045, handle - h, .045);
  k.box(rail, 0, handle, .31, .74, .045, .045);
  return h;
}

function luggageRack(k) {
  for (const x of [-.7, .7]) {
    for (const z of [-.244, .244]) k.soft(iron, x, .038, z, .115, .09, .09, .018);
    k.box(rail, x, .099, 0, .045, .041, .65);
  }
  for (const z of [-.27, -.09, .09, .27]) k.box(rail, 0, .105, z, 1.47, .041, .047);
}

export function createNightShiftFreight({ root, canvasTexture, ground, colliders }) {
  const material = freightMaterial(canvasTexture), stops = new Map();
  const display = new THREE.Group();
  display.name = 'Night Shift loading stocks';
  root.add(display);
  const art = { sunline: glasses, paloma: linen, pier: films };
  const positions = { sunline: [5.38, 0, -Math.PI / 2], paloma: [-5.55, 0, Math.PI / 2], pier: [0, 7.1, Math.PI] };
  for (const { id, x, z } of SHIFT_STOPS) {
    const [dx, dz, yaw] = positions[id];
    const station = new THREE.Group();
    station.position.set(x + dx, ground.heightAt(x + dx, z + dz), z + dz);
    station.rotation.y = yaw;
    display.add(station);
    const standKit = kit(material), h = dock(standKit, id);
    const itemKit = kit(material);
    art[id](itemKit);
    if (id === 'pier') retainingBand(itemKit, .17, .48, .548);
    if (id === 'sunline') for (const offset of [-.215, .215]) retainingBand(itemKit, offset, .381, .558);
    const item = itemKit.finish('Freight · ' + id);
    const stand = standKit.finish(id + ' receiving trolley');
    station.add(stand, item);
    item.position.y = h;
    stops.set(id, { station, item, h, collider: { minX: x + dx - .43, maxX: x + dx + .43,
      minZ: z + dz - .43, maxZ: z + dz + .43, minY: station.position.y, maxY: station.position.y + 1.36 } });
  }
  const rackKit = kit(material); luggageRack(rackKit);
  const rack = rackKit.finish('Detachable freight rack');
  let active = false, previousCarrier, previousOrder = '', previousRecovery;
  display.visible = false;
  function update(manifest) {
    const enabled = Boolean(manifest), orders = manifest?.orders ?? [], carrier = manifest?.carrier ?? null;
    const orderKey = orders.join('+'), recovering = Boolean(manifest?.recovering);
    if (enabled !== active) {
      display.visible = active = enabled;
      for (const { collider } of stops.values()) {
        if (enabled) colliders.push(collider);
        else {
          const i = colliders.indexOf(collider);
          if (i >= 0) colliders.splice(i, 1);
        }
      }
    } else if (carrier === previousCarrier && orderKey === previousOrder && recovering === previousRecovery) return;
    previousCarrier = carrier; previousOrder = orderKey; previousRecovery = recovering;
    if (carrier && orders.length) {
      // This chassis child already follows suspension across every vehicle LOD.
      (carrier.getObjectByName('vehicle_damage_effects') || carrier).add(rack);
      rack.position.set(0, carrier.userData.vehicleType === 'sport' ? .91 : 1.056, -1.84);
    } else rack.removeFromParent();
    for (const [id, { station, item, h }] of stops) {
      const index = orders.indexOf(id);
      if (carrier && index >= 0) {
        rack.add(item);
        item.position.set(orders.length === 1 ? 0 : index ? .374 : -.374, .129, 0);
        item.rotation.y = 0;
        item.visible = true;
      } else {
        station.add(item);
        item.position.set(0, h, 0);
        item.rotation.y = 0;
        item.visible = index < 0 || (recovering && id === orders.at(-1));
      }
    }
  }
  return { update };
}
