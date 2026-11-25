import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceGroundedPosition } from '../src/character-grounding.js';
const floorAt = (x) => x < 0 ? .0345 : x < .25 ? .34 : .22;
test('walking follows road, curb and sidewalk without starting a jump', () => {
 let position={x:-1,y:.0345,z:0};
 for(const x of [-.1,.1,.4,.1,-.1]) {
  const previous={...position};position.x=x;
  const result=advanceGroundedPosition(position,previous,0,1/30,floorAt);
  assert.equal(position.y,floorAt(x));assert.equal(result.height,0);assert.equal(result.verticalVelocity,0);
 }
});
test('a jump starts and lands relative to raised sidewalks', () => {
 for(const x of [-1,.1,1]) {
  const position={x,y:floorAt(x),z:0}; let velocity=5, peak=position.y, airborne=0;
  for(let i=0;i<90;i++) {
   const result=advanceGroundedPosition(position,{...position},velocity,1/60,floorAt);
   velocity=result.verticalVelocity;peak=Math.max(peak,position.y);airborne+=result.height>.01;
  }
  assert.ok(peak-floorAt(x)>.8);assert.ok(airborne>30);assert.equal(position.y,floorAt(x));assert.equal(velocity,0);
 }
});
test('a jumping actor retains its world height across a step and lands on its destination', () => {
 const position={x:-1,y:.7,z:0}, previous={...position};position.x=1;
 const falling=advanceGroundedPosition(position,previous,-1,.1,floorAt);
 assert.ok(Math.abs(position.y-.46)<1e-12);assert.ok(Math.abs(falling.verticalVelocity+2.4)<1e-12);
 const landed=advanceGroundedPosition(position,{...position},falling.verticalVelocity,.1,floorAt);
 assert.equal(position.y,.22);assert.equal(landed.verticalVelocity,0);
});
