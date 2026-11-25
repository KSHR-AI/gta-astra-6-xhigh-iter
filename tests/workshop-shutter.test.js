import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createWorkshopShutter } from '../src/workshop-shutter.js';

test('workshop curtain clears an arriving car, holds for pedestrians and closes after departure', () => {
  const scene = new THREE.Group(), door = createWorkshopShutter(scene);
  const slats = scene.children[0], matrix = new THREE.Matrix4();
  slats.getMatrixAt(0,matrix);
  const initialRail = matrix.elements[13];
  const approach = {x:4,z:-97}, bay = {x:25,z:-126};
  assert.equal(door.open,0);
  assert.equal(door.update(1,{x:55,z:-50}),0);
  for(let i=0;i<120;i++)door.update(1/60,approach);
  assert.equal(door.open,1);
  slats.getMatrixAt(0,matrix);
  assert.ok(matrix.elements[13] > 4.8);
  assert.equal(door.update(6,null,bay),1);
  assert.equal(door.update(1,null,null),1);
  assert.equal(door.update(0,null,null),1);
  for(let i=0;i<480;i++)door.update(1/60,null,null);
  assert.equal(door.open,0);
  slats.getMatrixAt(0,matrix);
  assert.equal(matrix.elements[13],initialRail);
});
