import { addCalypsoFacade } from './calypso-facade.js';
import * as THREE from 'three';

// The Paloma, Calypso and the lane mouths use the district's existing instanced
// material batches. The lamps use baked emissive faces without extra lights.
export function addLastLightFrontage(api) {
  addCalypsoFacade(api);
  const {box,walkableBox,cylinder,line,panel,materials:m,sign}=api;
  const floor=walkableBox ?? box;
  // Palm-green porte-cochère: layer the stepped roof, ribbed cream soffit,
  // pendants and fascia above the original front office and clear doorway.
  box(m.teal,-16.68,3.89,20.1,4.05,.25,9.0);
  box(m.trim,-16.68,3.68,20.1,3.97,.17,8.93);
  for (const z of [15.85,24.35]) {
    cylinder(m.teal,-14.86,1.93,z,.09,3.45);
    cylinder(m.terracotta,-14.86,.45,z,.2,.52);
  }
  for(let z=16.25;z<24.4;z+=.65) box(m.terracotta,-16.62,3.571,z,3.78,.045,.11);
  for(const z of [17.25,22.85]) {
    cylinder(m.blackMetal,-16.3,3.39,z,.036,.37);
    cylinder(m.teal,-16.3,3.18,z,.27,.14);
    cylinder(m.lamp,-16.3,3.096,z,.215,.035,false);
  }
  sign('P A L O M A',-14.65,3.89,20.1,6.52,.39,Math.PI/2,{background:'#225651',color:'#ffe6a8',fontSize:103,border:false,glow:.25});

  // The Calypso display doorway opens onto a continuous concrete floor. Warm
  // backlit surf wax shelves and a worn work counter give the bay depth.
  floor(m.concrete,32,.087,-21.8,6.9,.125,5.55,0,false,'shop-floor');
  box(m.teal,32,1.9,-23.94,6.9,3.76,.13);
  const backlight = api.canvasTexture(512,256,c=>{
    c.fillStyle='#33524f';c.fillRect(0,0,512,256);
    for(const x of [84,255,431]) {
      const glow=c.createRadialGradient(x,33,3,x,88,95);
      glow.addColorStop(0,'rgba(255,211,137,.88)');
      glow.addColorStop(.4,'rgba(247,185,111,.39)');
      glow.addColorStop(1,'rgba(247,185,111,0)');
      c.fillStyle=glow;c.fillRect(0,0,512,256);
    }
    for(let y=6;y<256;y+=16){c.fillStyle='rgba(32,45,38,.25)';c.fillRect(0,y,512,2);}
  });
  const litWall = new THREE.MeshStandardMaterial({map:backlight,emissiveMap:backlight,emissive:'#ffdfb6',emissiveIntensity:.52,roughness:.88});
  panel(litWall,32,1.94,-23.858,6.86,3.68,0);
  for(const x of [28.86,35.14]) box(m.trim,x,1.94,-21.52,.16,3.72,4.9);
  for(const x of [29.4,34.56]) {
    box(m.dark,x,2.01,-23.76,1.07,2.36,.16);
    for(let row=0;row<3;row++) {
      const y=1.15+row*.58;
      box(m.trunkLight,x,y,-23.55,1.08,.065,.43);
      for(let i=0;i<3;i++) box([m.red,m.sage,m.yellow][(row+i)%3],x-.32+i*.31,y+.16,-23.49,.22,.23,.21);
    }
  }
  box(m.trunkLight,32,1.02,-23.05,3.6,.94,.75);
  box(m.trim,32,1.54,-23.05,3.76,.11,.82);
  box(m.blackMetal,32.9,1.72,-23.02,.51,.26,.28);
  sign('BOARD  REPAIR',32,2.7,-23.82,3.42,.59,0,{background:'#bd6850',color:'#fff0cd',fontSize:89,glow:.3});
  for(const x of [29.8,32,34.2]) {
    box(m.metal,x,3.61,-21.56,.18,.18,2.5);
    box(m.lamp,x,3.49,-21.56,.115,.06,2.44,0,false);
  }
  for(const x of [28.62,35.38]) box(m.yellow,x,1.77,-18.94,.09,3.38,.14);
  // Wayfinding stays close to the decision and recovery points.
  for(const [x,z,yaw,label] of [

    [60.65,-17,-Math.PI/2,'SUNLINE     /     SERVICE ENTRY'],
    [59.65,-77,.06,'←     AUTO WORKS'],
  ]) {
    cylinder(m.metal,x,1.95,z,.077,3.54);
    box(m.teal,x,3.43,z,4.9,.88,.15,yaw);
    sign(label,x+Math.sin(yaw)*.094,3.43,z+Math.cos(yaw)*.094,4.72,.72,yaw,{background:'#235b55',color:'#fff2c4',fontSize:76});
  }
  const directionFace=api.canvasTexture(768,256,c=>{
    c.fillStyle='#24524d';c.fillRect(0,0,768,256);
    c.strokeStyle='#f0dfa9';c.lineWidth=5;c.strokeRect(8,8,752,240);
    c.fillStyle='#f4e2b6';c.fillRect(28,126,712,3);
    c.font='bold 75px sans-serif';c.textBaseline='middle';
    c.fillText('AUTO WORKS',40,70);c.fillText('SUNLINE LANE',40,188);
    c.font='bold 94px sans-serif';c.textAlign='center';c.fillText('↑',683,68);c.fillText('→',683,182);
  });
  const directionPaint=new THREE.MeshStandardMaterial({map:directionFace,emissiveMap:directionFace,emissive:'#f6e2ab',emissiveIntensity:.22,roughness:.58});
  cylinder(m.metal,13.35,2.68,12.45,.09,4.95);
  box(m.teal,13.35,4.26,12.45,5.95,1.97,.16,.14);
  panel(directionPaint,13.365,4.26,12.545,5.8,1.88,.14);
  // Raised bevels finish the cut curb ends. Keep the open driving surface
  // clear between them; the shop's corner and the two alley throats stay flush.
  for(const z of [-12.8,-77.2]) for(const x of [49.15,60.85]) {
    box(m.concrete,x,.097,z,.32,.132,4.89);
    line(m.curb,[x,.18,z-2.43],[x,.18,z+2.43],.16);
  }
}
