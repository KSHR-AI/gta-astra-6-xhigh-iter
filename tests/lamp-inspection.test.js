import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createLampInspection} from '../src/lamp-inspection.js';

test('rear-fender approach clears the corner, follows ground and finishes facing the selected blade',()=>{
  const mesh=new THREE.Group();mesh.position.set(5,.5,-2);mesh.rotation.y=.73;
  const car={mesh,getRearLampWorld:(side,out)=>mesh.localToWorld(out.set(side*.43,.727,-2.25))};
  for(const side of [-1,1]){
    const actor=new THREE.Group();actor.rotation.y=-2;
    actor.position.copy(mesh.localToWorld(new THREE.Vector3(side*1.51,0,-1.8)));
    const ground=(x,z)=>.1*x+.02*z;
    const inspection=createLampInspection(car,actor.position);
    let frame;
    for(let i=0;i<240;i++){
      frame=inspection.update(1/60,actor,(pos,dx,dz)=>{
        const next=pos.clone();next.x+=dx;next.z+=dz;
        const local=mesh.worldToLocal(next.clone());
        assert.ok(Math.abs(local.x)>1.42||local.z< -2.55);
        pos.copy(next);
      },ground);
      if(frame.ready)break;
    }
    assert.equal(frame.ready,true);
    assert.ok(Math.abs(frame.target.distanceTo(car.getRearLampWorld(side,new THREE.Vector3())))<1e-6);
    assert.ok(Math.cos(actor.rotation.y-mesh.rotation.y)>Math.cos(.1));
    assert.equal(actor.position.y,ground(actor.position.x,actor.position.z));
  }
});
