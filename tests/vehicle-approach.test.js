import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createVehicleApproach } from '../src/vehicle-approach.js';
const point = (x,z) => new THREE.Vector3(x,0,z);

test('door approach eases from rest and stops at the handle without overshoot', () => {
  for (const distance of [.02, .3, 3, 12]) {
    const approach = createVehicleApproach([point(0,0),point(0,distance)]);
    assert.equal(approach.sample(0).speed, 0);
    let previous = 0;
    for (let t=0;t<approach.duration;t+=.01) {
      const sample=approach.sample(t);
      assert.ok(sample.position.z >= previous && sample.position.z <= distance);
      assert.ok(sample.speed <= 2.35 + 1e-8);
      previous=sample.position.z;
    }
    assert.ok(approach.sample(approach.duration + 1).position.distanceTo(point(0,distance)) < 1e-10);
    assert.equal(approach.sample(approach.duration).speed, 0);
  }
});

test('rounded approach goes around the front of the chassis with capsule clearance', () => {
  const path=createVehicleApproach([point(1.8,0),point(1.8,3.2),point(-1.65,3.2),point(-1.65,0)]);
  let previousHeading;
  for(let t=.02;t<path.duration-.1;t+=.02){
    const {position:p,direction}=path.sample(t);
    assert.ok(Math.abs(p.x)>1.42 || Math.abs(p.z)>2.65, 'route must remain outside the expanded car hull');
    const heading=Math.atan2(direction.x,direction.z);
    if(previousHeading!==undefined){const difference=Math.atan2(Math.sin(heading-previousHeading),Math.cos(heading-previousHeading));assert.ok(Math.abs(difference)<.5,'turn should change continuously');}
    previousHeading=heading;
  }
});

test('already at the door remains finite and completes immediately', () => {
  const path=createVehicleApproach([point(-1.65,0),point(-1.65,0)]);
  const sample=path.sample(0);
  assert.equal(path.duration,0);assert.equal(sample.speed,0);assert.equal(sample.finished,true);
  assert.ok(sample.position.toArray().every(Number.isFinite));
});
