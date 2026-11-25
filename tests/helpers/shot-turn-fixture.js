import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { createWeaponHandling, PISTOL } from '../../src/weapon-handling.js';
import { advanceGroundedPosition } from '../../src/character-grounding.js';
import { createVehicleApproach } from '../../src/vehicle-approach.js';
import { actor } from './character-animation-fixture.js';
import { createShotFrameScheduler } from '../../src/shot-frame-scheduler.js';
export const RIGS=[{model:'CivilianMaleNatural.glb',motion:'civilian-male-motion.json',height:1.82},{model:'CivilianFemaleNatural.glb',motion:'pedestrian-motion.json',height:1.76}];
const source=await readFile(new URL('../../src/main.js',import.meta.url),'utf8');
export const MAIN_SOURCE_SHA256=createHash('sha256').update(source).digest('hex');
const clamp=THREE.MathUtils.clamp;
const angleDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
function functionSource(name) {
 const start=source.indexOf(`function ${name}(`);
 if(start<0)throw new Error(`Missing actual main function ${name}`);
 const end=source.indexOf('\nfunction ',start+10);
 if(end<0)throw new Error(`Cannot delimit actual main function ${name}`);
 return source.slice(start,end);
}
const playerSource=functionSource('updatePlayer');
export async function combatHarness(rig=RIGS[0],{raised=true,distance=90,targetHeight=1.4,shoulderOffset=0,schedule='deadline'}={}) {
 const a=await actor(rig);a.frame({},120);a.animation.setWeapon(true);a.frame({armed:true,aiming:raised},90);
 const metrics={advanceCalls:0,frames:[],totalDt:0,initialPoses:a.animation.getPoseInfo().evaluations.poses};
 const handling=createWeaponHandling(),shotEvents=[],poseHistory=[],listeners={canvas:{},window:{}};
 const player={mesh:a.mesh,setWeapon:visible=>a.animation.setWeapon(visible),getAimState:()=>a.animation.getAimState(),update:(dt,options)=>a.animation.update(dt,options)};
 const canvas={addEventListener:(name,callback)=>listeners.canvas[name]=callback,focus(){},setPointerCapture(){}};
 const window={addEventListener:(name,callback)=>listeners.window[name]=callback};
 const carMesh=new THREE.Group();carMesh.position.set(-1.6,0,0);
 const car={model:{mesh:carMesh,setDoor(){},getDriverSeat:p=>p.set(0,.5,0),getDoorPosition:p=>p.set(-1,0,0)},speed:0,heading:0,occupied:false};
 const world={heightAt:()=>0};
 const ctx={THREE,clamp,angleDiff,PISTOL,advanceGroundedPosition,createVehicleApproach,
  handling,player,playerVelocity:new THREE.Vector3(),state:{ready:true,started:true,paused:false,mapOpen:false,health:100,ammo:12,reserve:96,stamina:100},
  weapon:true,aiming:raised,mouseDown:false,currentCar:null,interaction:null,reloading:false,reloadRemaining:0,elapsed:0,lastShot:-100,lastDryFire:-100,
  jumpVelocity:0,playerMoveSpeed:0,yaw:-Math.PI,pitch:0,doorTimer:0,keys:new Set(),world,
  nearestCar:()=>car,collides:()=>false,hitsVehicle:()=>false,moveBody:(p,x,z)=>{p.x+=x;p.z+=z},setActorShadow(){},updateDriving(){},updateInteraction(){},interact(){},
  sound:{cancelReload(){},reload(){},dryFire(){},door(){}},ui:{toast(){},setPaused(){},showMap(){}},drawMap(){},
  document:{pointerLockElement:null,exitPointerLock(){},querySelector(){return null}},canvas,window,
  photo:{active:false,enter(){this.active=true},exit(){this.active=false},change(){}},photoWasPaused:false,photoShadowState:[],photoActorVisibility:{enter(){},exit(){}},localSelfShadow:{release(){}},
  renderer:{shadowMap:{}},vehicles:[car],pedestrians:[],officers:[],contactActor:{mesh:new THREE.Group()}};
 vm.createContext(ctx);
 const names=['pause','setMap','enterPhoto','exitPhoto','action','reload','shoot','enterExit','anchor'];
 vm.runInContext(names.map(functionSource).join('\n')+'\n'+playerSource,ctx);
 const mouseStart=source.indexOf("canvas.addEventListener('mousedown',");
 const pointerEnd=source.indexOf("window.addEventListener('pointermove',",mouseStart);
 if(mouseStart<0||pointerEnd<0)throw new Error('Actual mouse binding range moved');
 vm.runInContext(source.slice(mouseStart,pointerEnd),ctx);
 function press({button=0,touch=false}={}) {listeners.canvas.mousedown({button,sourceCapabilities:touch?{firesTouchEvents:true}:undefined});}
 function release(button=0) {listeners.window.mouseup({button});}
 function poseTarget() {
  const wanted=ctx.yaw+Math.PI;
  let point=new THREE.Vector3(Math.sin(wanted)*distance-Math.cos(wanted)*shoulderOffset,targetHeight,Math.cos(wanted)*distance+Math.sin(wanted)*shoulderOffset).add(a.mesh.position);
  // Mirror main's explicit behind-muzzle forward fallback; do not ask the arm
  // to aim backward at cover between its muzzle and shoulder-camera origin.
  const direction=new THREE.Vector3(Math.sin(wanted),0,Math.cos(wanted));
  const muzzle=a.weapon.localToWorld(new THREE.Vector3(0,.024,.202));
  if(point.clone().sub(muzzle).dot(direction)<=0)point=direction.clone().multiplyScalar(90).add(new THREE.Vector3(a.mesh.position.x,targetHeight,a.mesh.position.z));
  return {wanted,point};
 }
 function step(dt) {
  if(ctx.state.paused||ctx.state.mapOpen||ctx.photo.active)return;
  metrics.advanceCalls++;metrics.totalDt+=dt;handling.update(dt);ctx.elapsed+=dt;
  if(ctx.reloading){ctx.reloadRemaining=Math.max(0,ctx.reloadRemaining-dt);if(ctx.reloadRemaining===0){const count=Math.min(PISTOL.capacity-ctx.state.ammo,ctx.state.reserve);ctx.state.ammo+=count;ctx.state.reserve-=count;ctx.reloading=false;}}
  const options=ctx.updatePlayer(dt);if(!options)return;
  const {wanted,point}=poseTarget();
  const aimYaw=angleDiff(a.mesh.rotation.y,wanted);
  a.animation.update(dt,{...options,aimYaw,aimPitch:0,aimTarget:ctx.weapon&&(ctx.aiming||handling.queued||ctx.elapsed-ctx.lastShot<.35)?point:null});
  const aim=a.animation.getAimState();
  poseHistory.push({dt,time:ctx.elapsed,deadline:handling.pendingDeadline,heading:a.mesh.rotation.y,queued:handling.queued,...aim});
  ctx.observePose?.({a,dt,time:ctx.elapsed,aim});
  if(!ctx.reloading&&ctx.weapon&&ctx.state.health>0&&handling.consume(ctx.elapsed,aim.ready)){
   const muzzle=a.weapon.localToWorld(new THREE.Vector3(0,.024,.202));
   const barrel=new THREE.Vector3(0,0,1).applyQuaternion(a.weapon.getWorldQuaternion(new THREE.Quaternion()));
   shotEvents.push({time:ctx.elapsed,error:barrel.angleTo(point.clone().sub(muzzle).normalize()),aim:{...aim},id:handling.shots});
   ctx.state.ammo--;ctx.lastShot=ctx.elapsed;a.animation.applyShot(handling.shots);
  }
 }
 const scheduled=createShotFrameScheduler({getTime:()=>ctx.elapsed,advance:step,handling});
 function frameDt(dt){
  dt=Math.min(dt,.25);const before=metrics.advanceCalls,elapsedBefore=ctx.elapsed,queued=handling.queued,paused=ctx.state.paused||ctx.state.mapOpen||ctx.photo.active;
  const nominal=paused?1:Math.max(1,Math.ceil(dt/.033));
  if(schedule==='baseline'){for(let i=0;i<nominal;i++)step(dt/nominal);}
  else scheduled(dt,paused);
  const record={dt,queued,paused,nominal,calls:metrics.advanceCalls-before,elapsedBefore,elapsedAfter:ctx.elapsed};metrics.frames.push(record);return record;
 }
 function frame(hz=60){return frameDt(1/hz);}
 function run(seconds,hz=60){for(let i=0;i<Math.ceil(seconds*hz-1e-10);i++)frame(hz);}
 return {a,ctx,handling,shotEvents,poseHistory,press,release,frame,frameDt,run,step,listeners,car,metrics,setHeading:heading=>ctx.yaw=heading-Math.PI,
  setTarget:(range,height=targetHeight)=>{distance=range;targetHeight=height},poseTarget};
}
