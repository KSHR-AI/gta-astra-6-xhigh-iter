import test from 'node:test';
import assert from 'node:assert/strict';
import { actor } from './helpers/character-animation-fixture.js';
import * as THREE from 'three';
const rigs=[{model:'CivilianMaleNatural.glb',motion:'civilian-male-motion.json',height:1.82},{model:'CivilianFemaleNatural.glb',motion:'pedestrian-motion.json',height:1.76}];
function hull(p){p.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const cross=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);const a=[],b=[];for(const q of p){while(a.length>1&&cross(a.at(-2),a.at(-1),q)<=0)a.pop();a.push(q)}for(const q of p.toReversed()){while(b.length>1&&cross(b.at(-2),b.at(-1),q)<=0)b.pop();b.push(q)}return a.slice(0,-1).concat(b.slice(0,-1));}
function gap(a,b){let best=-Infinity;for(const polygon of[a,b])for(let i=0;i<polygon.length;i++){const p=polygon[i],q=polygon[(i+1)%polygon.length],len=Math.hypot(q[0]-p[0],q[1]-p[1]);const x=(q[1]-p[1])/len,z=(p[0]-q[0])/len,aa=a.map(p=>p[0]*x+p[1]*z),bb=b.map(p=>p[0]*x+p[1]*z);best=Math.max(best,Math.min(...aa)-Math.max(...bb),Math.min(...bb)-Math.max(...aa))}return best;}
for(const rig of rigs)for(const hz of[60,5])test(`${rig.model}: ${hz}Hz stationary pivots lift each shoe while preserving support and footwear clearance`,async()=>{
 for(const rate of[-180,-90,90,180]){
  const a=await actor(rig);a.frame({},120);const dt=1/60,batches=60/hz,duration=180/Math.abs(rate),v=new THREE.Vector3(),maximumLift={Left:0,Right:0};let maximumExtension=0,minGap=Infinity,minSole=Infinity;
  for(let frame=0;frame<Math.ceil((duration+1.2)*hz);frame++){
   for(let sub=0;sub<batches;sub++){const t=(frame*batches+sub+1)*dt;a.mesh.rotation.y=Math.min(t,duration)*rate*Math.PI/180;a.animation.advance(dt,{})}
   const feet=a.sampleFeet(),points={Left:[],Right:[]};for(const probe of a.soleProbes){probe.object.getVertexPosition(probe.index,v);probe.object.localToWorld(v);points[probe.side].push([v.x,v.z])}
   minGap=Math.min(minGap,gap(hull(points.Left),hull(points.Right)));
   for(const side of['Left','Right']){maximumLift[side]=Math.max(maximumLift[side],feet.feet[side].sole);maximumExtension=Math.max(maximumExtension,feet.feet[side].extension);minSole=Math.min(minSole,feet.feet[side].sole)}
  }
  assert.ok(minGap>0,`${rate}°/s: shoe footprints must not overlap (${minGap})`);
  assert.ok(minSole>-.002,`${rate}°/s: actual rendered soles stay within2mm of floor (${minSole})`);
  assert.ok(maximumExtension<.995,`${rate}°/s: supporting knees do not lock (${maximumExtension})`);
  for(const side of['Left','Right'])assert.ok(maximumLift[side]>.03,`${rate}°/s: ${side} has a displayed swing, not a slide (${maximumLift[side]})`);
 }
});
