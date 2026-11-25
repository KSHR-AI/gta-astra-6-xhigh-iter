import * as THREE from 'three';
import { assetUrl } from './asset-url.js';

// Both display cases face the boulevard. Each print occupies half the atlas.
export function addDestinationPrints({ box, instance, panelGeometry, materials: m }) {
  const paper = new THREE.MeshStandardMaterial({ color: '#bdad8c', roughness: .84 });
  function install(x, y, z, direction, height, half) {
    const width = height * .75;
    const faceX = x + direction * .13;
    const rotation = direction * Math.PI / 2;
    box(m.teal, x, y, z, .24, height + .17, width + .17);
    for (const side of [-1, 1]) {
      box(m.metal, faceX, y, z + side * (width / 2 + .027), .11, height + .09, .054);
      box(m.metal, faceX, y + side * (height / 2 + .027), z, .11, .054, width);
    }
    // A shallow hood and warm strip cast a real profile above the paper.
    box(m.teal, faceX + direction * .085, y + height / 2 + .11, z, .31, .075, width + .18);
    box(m.lamp, faceX + direction * .17, y + height / 2 + .065, z, .05, .018, width * .83, 0, false);
    const print = panelGeometry.clone();
    const uv = print.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) + half) * .5);
    instance(print, paper, [faceX, y, z], [width, height, 1], [0, rotation, 0], false);
  }
  // Solid side return of Calypso, underneath its existing fabric awning.
  install(16.68, 1.55, -35.63, -1, 2.10, 0);
  // Both uprights of the hotel's original roadside pylon pass behind the case.
  install(-18.13, 3.81, 56.4, 1, 4.08, 1);
  return new THREE.TextureLoader().loadAsync(assetUrl('art/world/pacific-destination-prints.webp')).then(map => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    paper.color.set(0xffffff);
    paper.map = paper.emissiveMap = map;
    paper.emissive.set('#ffeed4');
    paper.emissiveIntensity = .40;
    paper.needsUpdate = true;
  }).catch(error => console.warn('Destination prints unavailable.', error));
}
