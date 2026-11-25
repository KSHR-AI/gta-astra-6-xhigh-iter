import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// The wheel stands offshore at the end of Ocean Drive. Each assembly shares
// vertex-colored geometry so the rim, spokes and pier each move as one object.
export function createPacificWheel() {
  const root = new THREE.Group();
  root.name = 'Pacific Wheel';
  root.position.set(-193, 0, 0);
  root.rotation.y = Math.PI / 2;
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .72 });
  const light = new THREE.MeshBasicMaterial({ color: '#ffd18b' });
  const cuboid = new THREE.BoxGeometry();
  const tube = new THREE.CylinderGeometry(1, 1, 1, 8);
  const axis = new THREE.Vector3(0, 1, 0);
  const transform = new THREE.Object3D();
  function piece(parts, geometry, color) {
    transform.updateMatrix();
    const copy = geometry.clone().applyMatrix4(transform.matrix);
    const rgb = new THREE.Color(color);
    const colors = new Float32Array(copy.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) rgb.toArray(colors, i);
    copy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(copy);
  }
  function box(parts, x, y, z, w, h, d, color) {
    transform.position.set(x, y, z);
    transform.quaternion.identity();
    transform.scale.set(w, h, d);
    piece(parts, cuboid, color);
  }
  function beam(parts, a, b, radius, color) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    transform.position.copy(start).lerp(end, .5);
    transform.scale.set(radius, delta.length(), radius);
    transform.quaternion.setFromUnitVectors(axis, delta.normalize());
    piece(parts, tube, color);
  }
  function geometry(parts) {
    const merged = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    return merged;
  }
  const frame = [], rim = [], bulbs = [], cabin = [];
  const ivory = '#f2e0bd', teal = '#347a79', vermilion = '#d35a43', timber = '#805b44';
  box(frame, 0, 2, 0, 43, 1, 15, timber);
  box(frame, 0, 1.96, 26, 7, .86, 38, timber);
  for (const x of [-19, -9, 0, 9, 19]) for (const z of [-6, 6])
    beam(frame, [x, -4, z], [x, 1.6, z], .46, timber);
  for (const x of [-3.2, 3.2]) {
    for (let z = 8; z <= 45; z += 6) beam(frame, [x,-3,z], [x,3.5,z], .16, timber);
    beam(frame,[x,3.45,7],[x,3.45,45],.09,ivory);
  }
  // Slatted entry gate closes the seaward end of the playable beach.
  for (let x = -3; x <= 3; x += .4)
    box(frame, x, 3.09, 44.9, .12, 1.42, .14, ivory);
  for (const y of [2.7, 3.68]) box(frame, 0, y, 44.9, 6.5, .12, .18, teal);
  const height = 24, radius = 18.4, seats = 16, tau = 2 * Math.PI;
  for (const side of [-1, 1]) for (const foot of [-9, 9])
    beam(frame, [foot, 2.4, side * 5.6], [0, height, side * 2.5], .58, teal);
  beam(frame, [0,height,-3.3], [0,height,3.3], 1.1, vermilion);
  const point = (angle, r, z) => [Math.cos(angle) * r, Math.sin(angle) * r, z];
  for (let i = 0; i < seats; i++) {
    const a = tau * i / seats, b = tau * (i + 1) / seats;
    for (const z of [-1.3, 1.3]) {
      beam(rim, point(a,radius,z), point(b,radius,z), .28, vermilion);
      beam(rim, point(a,radius-1.25,z), point(b,radius-1.25,z), .17, ivory);
      beam(rim, point(a,1,z), point(a,radius,z), .14, ivory);
      beam(rim, point(a,radius-1.25,z), point(b,radius,z), .11, teal);
      beam(bulbs, point(a,radius,z*1.22), point((a+b)/2,radius*Math.cos((b-a)/2),z*1.22), .095, ivory);
    }
    beam(rim, point(a,radius,-1.65), point(a,radius,1.65), .16, teal);
  }
  root.add(new THREE.Mesh(geometry(frame), steel));
  const rotating = new THREE.Mesh(geometry(rim), steel);
  rotating.position.y = height;
  rotating.add(new THREE.Mesh(geometry(bulbs), light));
  root.add(rotating);
  box(cabin, 0,-2,0, 2.05,1.12,2.7, '#ffffff');
  box(cabin, 0,-.57,0, 2.2,.23,2.9, ivory);
  for (const x of [-.88,.88]) for (const z of [-1.24,1.24])
    beam(cabin,[x,-1.6,z],[x,-.55,z],.067,ivory);
  for (const z of [-1.24,1.24]) beam(cabin,[0,0,z],[0,-.55,z],.085,teal);
  const cars = new THREE.InstancedMesh(geometry(cabin), steel, seats);
  cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  cars.boundingSphere = new THREE.Sphere(new THREE.Vector3(0,height,0),radius+3.4);
  const palette = ['#e78560','#73b9ae','#eac477','#82adc1'];
  for (let i=0; i<seats; i++) cars.setColorAt(i,new THREE.Color(palette[i%palette.length]));
  root.add(cars);
  cuboid.dispose();
  tube.dispose();
  const matrix = new THREE.Matrix4();
  function update(time) {
    const angle = time * .045;
    rotating.rotation.z = angle;
    for (let i=0; i<seats; i++) {
      const a = angle + tau*i/seats;
      matrix.makeTranslation(radius*Math.cos(a), height+radius*Math.sin(a),0);
      cars.setMatrixAt(i,matrix);
    }
    cars.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { root, update };
}
