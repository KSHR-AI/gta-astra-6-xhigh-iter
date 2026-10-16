import * as THREE from 'three';
import { createWorld } from './world.js';
import { createCar, loadVehicleAssets } from './vehicles.js';
import { loadCharacterAssets, createCharacter } from './characters.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createAtmosphere } from './atmosphere.js';
import { createRendering } from './rendering.js';
import { createPhotoMode } from './photo-mode.js';
import { createCitySimulation } from './simulation.js';
import { createMission } from './missions.js';
import { updateVehiclePhysics } from './driving.js';
import { createVehicleApproach } from './vehicle-approach.js';
import { clipCameraSegment, getCameraSweep } from './camera-collision.js';
import { createPosedActorCollider, getAimPoint, traceShot } from './combat.js';
import { createWeaponHandling, PISTOL } from './weapon-handling.js';
import { advanceGroundedPosition } from './character-grounding.js';
import './style.css';

const canvas = document.querySelector('#game');
canvas.style.touchAction='none';canvas.tabIndex=0;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xcdb6a7, 0.0021);
// Scene MSAA and the final FXAA pass already handle edges; the full-screen
// output triangle does not need a second multisampled canvas.
const renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:'high-performance'});
const gl=renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');
const softwareRenderer=debugInfo&&/swiftshader|llvmpipe|software/i.test(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
renderer.setPixelRatio(softwareRenderer?.65:Math.min(devicePixelRatio,1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=!softwareRenderer;
renderer.shadowMap.needsUpdate=true;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.0;
renderer.info.autoReset=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.1,1400);
camera.position.set(8,5.2,36);
const cameraLook=new THREE.Vector3(0,2,-35);
const drawingSize=new THREE.Vector2();
camera.lookAt(cameraLook);
const hemisphere=new THREE.HemisphereLight(0xb9d3ee,0x75624f,.75);
scene.add(hemisphere);
const sun=new THREE.DirectionalLight(0xffc48b,3.1);
sun.position.set(-70,58,-80); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:700});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias=0.025; sun.shadow.bias=-0.00015;
scene.add(sun,sun.target);
const atmosphere=createAtmosphere(scene);
const sunOffset=new THREE.Vector3(-70,58,-80);

const world=createWorld(scene);
const rendering=createRendering(renderer,scene,camera,softwareRenderer);
// Only the nearest four real lamp fixtures illuminate the street. Reuse these
// lights as the camera travels instead of evaluating dozens of lights per pixel.
const streetLights=Array.from({length:4},()=>{const light=new THREE.PointLight(0xffc886,380,38,2);light.visible=false;scene.add(light);return light;});
const headlights=Array.from({length:2},()=>{const light=new THREE.SpotLight(0xe0edff,170,65,.37,.55,1.4);light.visible=false;scene.add(light,light.target);return light;});

const buildingBoxes=world.colliders.map(b=>new THREE.Box3(new THREE.Vector3(b.minX,b.minY??0,b.minZ),new THREE.Vector3(b.maxX,b.maxY??70,b.maxZ)));
const cameraBoxes=buildingBoxes.map(box=>box.clone().expandByScalar(.2));
const sound=createAudio();
const keys=new Set();
const state={ready:false,started:false,paused:false,mapOpen:false,health:100,stamina:100,money:1250,wanted:0,ammo:12,reserve:96,inCar:false,speed:0,location:'VESPUCCI BOULEVARD',time:'18:42',objectiveTitle:'A favor for Mara',objective:'Meet Mara in the corner office.',objectiveDistance:0,weapon:'UNARMED',nearCar:false,fps:60,policeState:'clear',searchProgress:0,gear:'N',rpm:850,vehicleHealth:100,subtitle:'',subtitleSpeaker:''};
let photo,photoWasPaused=false,photoShadowState=[];
let ui,player,currentCar=null,mission=0,night=false,weapon=false,aiming=false,reloading=false,simulation,job,interaction=null,contactActor;
let dialogueQueue=[],dialogueUntil=0,damageFlash=0;
let vehicleDayEnvironment=null,vehicleNightEnvironment=null;
let cameraRoll=0;
let yaw=0,pitch=0.07,jumpVelocity=0,lastShot=-100,lastCrime=-100,wantedSince=-100,elapsed=0,lookTimer=0,doorTimer=0,respawnTimer=0,reloadRemaining=0;
let lastFrame=performance.now(),frameCount=0,fpsTimer=0,uiTimer=0,miniTimer=0,mouseDown=false;
const aimRay=new THREE.Raycaster();
const handling=createWeaponHandling();
let aimSolution=null,lastImpact=null,lastDryFire=-100,renderFrame=0;
let playerMoveSpeed=0;
const policeShotHistory=[];
const vehicles=[],pedestrians=[],effects=[],officers=[];
const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=64;
const contactContext=contactCanvas.getContext('2d');const contactGradient=contactContext.createRadialGradient(32,32,2,32,32,32);
contactGradient.addColorStop(0,'rgba(0,0,0,.28)');contactGradient.addColorStop(.55,'rgba(0,0,0,.12)');contactGradient.addColorStop(1,'rgba(0,0,0,0)');contactContext.fillStyle=contactGradient;contactContext.fillRect(0,0,64,64);
const contactTexture=new THREE.CanvasTexture(contactCanvas);
const footCanvas=document.createElement('canvas');footCanvas.width=footCanvas.height=64;
const footContext=footCanvas.getContext('2d');
for(const x of [23,41]){const g=footContext.createRadialGradient(x,32,1,x,32,18);g.addColorStop(0,'rgba(0,0,0,.56)');g.addColorStop(.35,'rgba(0,0,0,.30)');g.addColorStop(1,'rgba(0,0,0,0)');footContext.fillStyle=g;footContext.fillRect(0,0,64,64);}
const footTexture=new THREE.CanvasTexture(footCanvas);
const shadowAnchor=new THREE.Vector3(0,0,20);
function addContactShadow(group,w,h){group.traverse(o=>{if(o.isMesh){o.castShadow=!softwareRenderer&&!o.material?.transparent;o.receiveShadow=true;}});const actor=w<2;const shadow=new THREE.Mesh(new THREE.PlaneGeometry(actor?.9:w,actor?.9:h),new THREE.MeshBasicMaterial({map:actor?footTexture:contactTexture,transparent:true,depthWrite:false}));shadow.name='contact-shadow';shadow.rotation.x=-Math.PI/2;shadow.position.y=.055;group.add(shadow);return shadow;}
const goal=new THREE.Vector3(4,0,-125);
const playerVelocity=new THREE.Vector3();
const tmp=new THREE.Vector3();
const mapCanvas=()=>document.querySelector('#minimap');
const clamp=THREE.MathUtils.clamp;
const damp=(a,b,k,dt)=>THREE.MathUtils.lerp(a,b,1-Math.exp(-k*dt));
const angleDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

ui=createUI({
 onStart:startGame,onPause:()=>pause(true),onResume:()=>pause(false),onRestart:()=>restart(true),
 onSound:enabled=>{sound.setEnabled(enabled);sound.start();},
 onQuality:q=>{renderer.setPixelRatio(q==='high'?(softwareRenderer?.65:Math.min(devicePixelRatio,1.5)):.5);renderer.shadowMap.enabled=q==='high';renderer.shadowMap.needsUpdate=true;rendering.setQuality(q);},
 onTime:value=>setTime(value==='night'),onMap:open=>setMap(open),
 onPhotoMode:enterPhoto,onPhotoExit:exitPhoto,onPhotoChange:patch=>photo.change(patch),
 onPhotoCapture:()=>photo.capture(),onPhotoReset:()=>photo.reset(),
 onAim:down=>{if(!state.started||state.paused||state.mapOpen||photo.active||currentCar||interaction)return;aiming=Boolean(down&&weapon);},
 onMobile:(code,down)=>{if(down){if(!keys.has(code)) action(code);keys.add(code);}else keys.delete(code);},
});
ui.setReady(false);
photo=createPhotoMode({camera,renderer,rendering,canvas,bounds:world.bounds,ui});

function enterPhoto(){
 if(!state.ready||!state.started||interaction)return;
 photoWasPaused=state.paused;keys.clear();mouseDown=false;aiming=false;handling.cancel();
 state.paused=true;setMap(false);if(document.pointerLockElement)document.exitPointerLock();
 photoShadowState=[];
 for(const group of [...vehicles.map(c=>c.model.mesh),player.mesh,...pedestrians.map(p=>p.actor.mesh),...officers.map(a=>a.mesh),contactActor.mesh])group.traverse(o=>{if(o.isMesh&&!o.material?.transparent&&o.name!=='contact-shadow'){photoShadowState.push([o,o.castShadow]);o.castShadow=true;}});
 renderer.shadowMap.needsUpdate=true;
 photo.enter();state.photoMode=true;
}
function exitPhoto(){
 if(!photo.active)return;
 photo.exit();for(const [object,shadow] of photoShadowState)object.castShadow=shadow;photoShadowState=[];renderer.shadowMap.needsUpdate=true;state.photoMode=false;keys.clear();state.paused=photoWasPaused;ui.setPaused(state.paused);
}

function setTime(dark){
 night=dark; atmosphere.setNight(night); rendering.setNight(night);world.setNight(night);streetLights.forEach(light=>light.visible=night);headlights.forEach(light=>light.visible=night); state.time=night?'22:16':'18:42';
 sun.color.set(night?0x96baff:0xffc48b); sun.intensity=night?0.8:3.1;
 hemisphere.intensity=night?.8:.75; hemisphere.color.set(night?0x6c86b4:0xb9d3ee);
 scene.fog.color.set(night?0x101b2a:0xcdb6a7);renderer.toneMappingExposure=night?1:1.0;
 vehicles.forEach(c=>{
  c.model.setLights(night);
  c.model.mesh.traverse(o=>{const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)if(m?.isMeshStandardMaterial&&m.userData.dayEnvIntensity!==undefined){
    m.envMap=night?vehicleNightEnvironment:vehicleDayEnvironment;
    m.envMapRotation.copy(night?atmosphere.rotation:new THREE.Euler());
    m.envMapIntensity=m.userData.dayEnvIntensity*(night?.55:1);
   }});
 });renderer.shadowMap.needsUpdate=true;
}
function startGame(){if(!state.ready)return;state.started=true;state.paused=false;ui.setPaused(false);sound.start();ui.toast('LOS PACIFICOS',job.getState().savedAt?'Your story continues.':'Mara has a job for you. Follow the gold marker.');}
function pause(value){state.paused=value;keys.clear();mouseDown=false;aiming=false;handling.cancel();ui.setPaused(value);if(value&&document.pointerLockElement)document.exitPointerLock();}
function setMap(value){state.mapOpen=Boolean(value&&state.started);keys.clear();mouseDown=false;aiming=false;handling.cancel();ui.showMap(state.mapOpen);if(state.mapOpen){if(document.pointerLockElement)document.exitPointerLock();drawMap(document.querySelector('#city-map'),true);}}
function restart(fresh=false){
 if(!state.ready||!player)return;
 if(fresh)job.fresh();else job.retry();
 simulation?.reset();interaction=null;currentCar=null;state.started=true;
 Object.assign(state,{health:100,stamina:100,wanted:0,ammo:12,reserve:96,inCar:false,speed:0,nearCar:false,policeState:'clear',searchProgress:0,subtitle:'',subtitleSpeaker:''});
 weapon=false;aiming=false;mouseDown=false;reloading=false;reloadRemaining=0;respawnTimer=0;doorTimer=0;lastShot=-100;lastCrime=-100;wantedSince=-100;lookTimer=elapsed;dialogueQueue=[];dialogueUntil=0;
 state.weapon='UNARMED';playerMoveSpeed=0;handling.reset();sound.cancelReload?.();lastImpact=null;aimSolution=null;policeShotHistory.length=0;
 const home=job.getState().mission>=4?world.landmarks?.safehouse:null;
 player.mesh.position.set(home?.x??1.4,0,home?.z??23);groundActor(player);player.resetGrounding?.();setActorShadow(player,true);player.mesh.rotation.set(0,Math.PI,0);player.setVisible(true);player.setWeapon(false);playerVelocity.set(0,0,0);yaw=home?-Math.PI/2:0;pitch=.07;jumpVelocity=0;
 for(let i=pedestrians.length-1;i>=0;i--)if(pedestrians[i].isDriver)pedestrians.splice(i,1);
 for(const c of vehicles){c.model.mesh.position.copy(c.home);c.heading=c.homeHeading;c.model.mesh.rotation.set(0,c.heading,0);c.speed=0;c.steer=0;c.health=100;c.occupied=false;c.stolen=false;c.traffic=c.homeTraffic;c.routeIndex=c.homeRouteIndex;c.closeDoorAt=0;c.physics=null;c.model.setDoor(false);c.model.setDamage?.(100);c.model.update(1,0,0);c.driverActive=!!c.driver;c.driverDownUntil=0;c.driverTrafficBeforeHit=false;}
 for(const p of pedestrians){p.actor.mesh.position.copy(p.home);groundActor(p.actor);p.actor.resetGrounding?.();setActorShadow(p.actor,true);p.direction=p.homeDirection;p.down=false;p.recoverAt=0;p.fleeUntil=0;p.actor.mesh.rotation.set(0,p.direction<0?Math.PI:0,0);p.actor.update(1,{speed:0,dead:false});}
 for(const e of effects){scene.remove(e.mesh);if(!e.mesh.isSprite)e.mesh.geometry?.dispose();e.mesh.material.dispose();}effects.length=0;
 heroCar.isJobCar=job.getState().mission<4;
 marker.visible=false;cameraLook.copy(player.mesh.position).add(new THREE.Vector3(0,1.2,-3));camera.position.copy(player.mesh.position).add(new THREE.Vector3(0,3.6,5.8));sound.start();
 pause(false);setMap(false);ui.toast(fresh?'A FRESH START':'BACK ON YOUR FEET',fresh?'Mara has a job waiting for you.':'Your mission checkpoint is ready.');
}

function addCar(x,z,heading,color,type='sport',traffic=false,police=false){
 const model=createCar({color,type,police});addContactShadow(model.mesh,3.4,5.6);model.mesh.position.set(x,0,z);model.mesh.rotation.y=heading;scene.add(model.mesh);
 const car={model,heading,speed:0,steer:0,traffic,police,occupied:false,health:100,home:new THREE.Vector3(x,0,z),homeHeading:heading,homeTraffic:traffic,homeRouteIndex:0,routeIndex:0,stolen:false,closeDoorAt:0,driverDownUntil:0,driverTrafficBeforeHit:false};vehicles.push(car);return car;
}
await loadVehicleAssets();
const heroCar=addCar(4.8,18,Math.PI,0x315c61);heroCar.isJobCar=true;
addCar(-8,-26,0,0xa9b5a9,'sedan');
addCar(8,-56,Math.PI,0x983b2f,'sport');
addCar(-8,61,0,0xd6d5c9,'sedan');
addCar(75,-43,0,0x466c72,'sport');
addCar(84,36,Math.PI,0x344050,'sedan');
const trafficRoute=[new THREE.Vector3(-4,0,82),new THREE.Vector3(-4,0,-85),new THREE.Vector3(76,0,-85),new THREE.Vector3(76,0,82)];
const t1=addCar(-4,-45,0,0x566c61,'sedan',true);t1.routeIndex=0;
const t2=addCar(76,20,0,0xe2d7bd,'sedan',true);t2.routeIndex=3;t2.homeRouteIndex=3;
const police=addCar(-4,-76,0,0x14202b,'sedan',false,true);
addCar(-8,-147,0,0x5a5c58,'sedan');
addCar(88,117,Math.PI,0xaaa08b,'sedan');

const marker=new THREE.Group();
const markerMat=new THREE.MeshBasicMaterial({color:0xffc56d,transparent:true,opacity:.75,depthWrite:false});
const markerRing=new THREE.Mesh(new THREE.TorusGeometry(2.3,.055,8,64),markerMat);markerRing.rotation.x=Math.PI/2;markerRing.position.y=.08;marker.add(markerRing);
const markerBeam=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,2.6,8),new THREE.MeshBasicMaterial({color:0xffcb75,transparent:true,opacity:.28,depthWrite:false}));markerBeam.position.y=1.3;marker.add(markerBeam);
const markerDiamond=new THREE.Mesh(new THREE.OctahedronGeometry(.45),markerMat);markerDiamond.position.y=2.7;marker.add(markerDiamond);
marker.position.copy(goal);scene.add(marker);

function dialogue(speaker,lines){dialogueQueue.push(...lines.map(text=>({speaker,text})));}
function crime(level,kind='gunshot',force=false){
 lastCrime=elapsed;
 if(simulation)Object.assign(state,simulation.reportCrime({position:player.mesh.position.clone(),level,kind,now:elapsed,force}));
}
function nearestCar(){let nearest=null,dist=3.8;for(const c of vehicles){if(c.occupied)continue;const d=c.model.mesh.position.distanceTo(player.mesh.position);if(d<dist){dist=d;nearest=c;}}return nearest;}
function anchor(c,seat=true){
 const p=new THREE.Vector3();
 if(seat)c.model.getDriverSeat?.(p);else c.model.getDoorPosition?.(p);
 if(!c.model.getDriverSeat)p.set(seat?-.35:-1.6,seat?.5:0,0);
 c.model.mesh.updateWorldMatrix(true,false);return c.model.mesh.localToWorld(p);
}
function orientDriver(actor,c,weight=1,uprightHeading=c.heading){
 const upright=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),uprightHeading);
 const seated=c.model.getDriverOrientation?.(new THREE.Quaternion())||upright;
 actor.mesh.quaternion.copy(upright).slerp(seated,weight);
}
function groundActor(actor){const p=actor.mesh.position;p.y=world.heightAt(p.x,p.z);}
function setActorShadow(actor,visible){const shadow=actor.mesh.getObjectByName('contact-shadow');if(shadow){shadow.visible=visible;if(visible){const p=actor.mesh.position;shadow.position.y=world.heightAt(p.x,p.z)-p.y+.003;}}}
function contextAction(){
 if(interaction)return;
 const p=player.mesh.position,land=world.landmarks||{};
 const near=(point,r=3.3)=>point&&Math.hypot(p.x-point.x,p.z-point.z)<r;
 const ms=job.getState();
 if(!currentCar&&near(land.contact))return{kind:'contact',title:ms.mission===0?'MEET YOUR CONTACT':'MARA · SUPPLIES',name:ms.mission===0?'Talk to Mara':state.reserve<192?'Pistol ammunition · $150':'Talk to Mara'};
 if(!currentCar&&near(land.safehouse,4)&&ms.mission>=4)return{kind:'safehouse',title:'THE PALOMA',name:'Rest & save your progress'};
 if(currentCar&&near(land.garage,6)&&Math.abs(currentCar.speed)<1.5){
  if(ms.mission===3&&currentCar.isJobCar&&state.wanted===0&&state.policeState==='clear')return{kind:'garage',title:'MARA’S WORKSHOP',name:'Deliver the convertible · +$1,500'};
  if(ms.mission>=4&&currentCar.health<100)return{kind:'garage',title:'MARA’S WORKSHOP',name:'Repair vehicle · $100'};
 }
 if(currentCar)return{kind:'vehicle',title:currentCar.model.type==='sport'?'ASTRA AURORA':'CITY SEDAN',name:Math.abs(currentCar.speed)<3?'Exit vehicle':'Slow down to exit'};
 const car=nearestCar();if(car)return{kind:'vehicle',title:car.isJobCar?'THE COASTAL JOB':'VEHICLE',name:car.driverActive?'Take occupied vehicle':'Enter vehicle'};
 return null;
}
function interact(){
 const action=contextAction();if(!action)return;
 if(action.kind==='vehicle'){enterExit();return;}
 const result=job.interact(action.kind,{vehicle:currentCar,time:elapsed,reserve:state.reserve});
 if(result.ammo)state.reserve=Math.min(192,state.reserve+result.ammo);
 if(result.repair){currentCar.health=100;currentCar.model.setDamage?.(100);}
 if(result.rest){state.health=100;state.stamina=100;state.reserve=Math.max(96,state.reserve);sound.notify();}
 if(result.delivered){currentCar.isJobCar=false;state.health=Math.max(75,state.health);sound.mission?.();}
 sound.interact?.();
}
function enterExit(){
 if(interaction||doorTimer>0)return;
 const c=currentCar||nearestCar();if(!c)return;
 if(currentCar&&Math.abs(c.speed)>3){ui.toast('SLOW DOWN','Stop before leaving your vehicle.');return;}
 const door=anchor(c,false);door.y=world.heightAt(door.x,door.z);
 if(collides(door.x,door.z,.4)||hitsVehicle(door.x,door.z,.35,c)){ui.toast('DOOR BLOCKED','Move the vehicle away from the wall.');return;}
 const phase=currentCar?'exit':'enter';
 const route=[player.mesh.position.clone()];
 if(phase==='enter'){
  const local=c.model.mesh.worldToLocal(player.mesh.position.clone());
  if(local.x>-.9){const end=local.z>=0?3.2:-3.2;route.push(c.model.mesh.localToWorld(new THREE.Vector3(local.x,0,end)),c.model.mesh.localToWorld(new THREE.Vector3(-1.65,0,end)));}
  route.push(door.clone());
  for(const point of route)point.y=world.heightAt(point.x,point.z);
 }
 const clearApproach=path=>{const samples=Math.max(1,Math.ceil(path.duration*30));for(let i=0;i<=samples;i++){const p=path.sample(path.duration*i/samples).position;if(collides(p.x,p.z,.34)||hitsVehicle(p.x,p.z,.34))return false;}return true;};
 let approach=createVehicleApproach(route);
 if(phase==='enter'&&!clearApproach(approach)){approach=createVehicleApproach(route,{rounding:0});if(!clearApproach(approach)){ui.toast('NO CLEAR APPROACH','Walk around to the driver’s door.');return;}}
 const approachDuration=approach.duration;
 interaction={phase,car:c,elapsed:0,duration:phase==='enter'?approachDuration+1.7:1.4,approachDuration,approach,from:player.mesh.position.clone(),door,seat:anchor(c,true),opened:phase==='exit'};
 c.speed=0;c.traffic=false;c.occupied=true;c.model.setDoor(phase==='exit');c.closeDoorAt=0;
 weapon=false;aiming=false;mouseDown=false;reloading=false;reloadRemaining=0;handling.cancel();sound.cancelReload?.();player.setWeapon(false);state.weapon='UNARMED';playerVelocity.set(0,0,0);jumpVelocity=0;if(phase==='exit')sound.door?.(true);
}
function updateInteraction(dt){
 const it=interaction,c=it.car;it.elapsed+=dt;const t=clamp(it.elapsed/it.duration,0,1);
 const smooth=x=>x*x*(3-2*x);
 if(it.phase==='enter'){
  if(it.elapsed<it.approachDuration){
   const sample=it.approach.sample(it.elapsed);player.mesh.position.copy(sample.position);groundActor(player);
   if(sample.direction.lengthSq()>.001){const heading=Math.atan2(sample.direction.x,sample.direction.z);player.mesh.rotation.y+=angleDiff(player.mesh.rotation.y,heading)*(1-Math.exp(-10*dt));}
   player.update(dt,{speed:sample.speed});setActorShadow(player,true);return;
  }
  if(!it.opened){it.opened=true;c.model.setDoor(true);sound.door?.(true);
   if(c.isJobCar&&job.getState().mission===1){c.stolen=true;crime(2,'theft',true);job.onVehicleTaken(c);}
   else if(!c.stolen){c.stolen=true;crime(1,'theft');}
  }
  const progress=clamp((it.elapsed-it.approachDuration)/1.7,0,1);
  player.mesh.position.lerpVectors(it.door,it.seat,smooth(clamp((progress-.15)/.75,0,1)));
  const forward=new THREE.Vector3(0,0,1).applyQuaternion(player.mesh.quaternion),heading=Math.atan2(forward.x,forward.z);
  orientDriver(player,c,THREE.MathUtils.smoothstep(progress,.22,1),heading+angleDiff(heading,c.heading)*(1-Math.exp(-10*dt)));
  player.update(dt,{speed:0,interactionPhase:'enter',interactionProgress:progress});
  if(c.driverActive&&c.driver){
   const eviction=clamp(progress/.45,0,1),exitPoint=it.door.clone().add(new THREE.Vector3(Math.cos(c.heading)*-.65,0,-Math.sin(c.heading)*-.65));exitPoint.y=world.heightAt(exitPoint.x,exitPoint.z);c.driver.mesh.position.lerpVectors(it.seat,exitPoint,eviction);orientDriver(c.driver,c,1-THREE.MathUtils.smoothstep(eviction,0,.78));
   c.driver.update(dt,{speed:0,interactionPhase:'exit',interactionProgress:eviction,dead:c.driverDownUntil>elapsed});
   if(eviction===1){c.driverActive=false;const victim={actor:c.driver,home:c.driver.mesh.position.clone(),direction:1,homeDirection:1,down:c.driverDownUntil>elapsed,recoverAt:c.driverDownUntil||0,fleeUntil:elapsed+9,fleeFrom:c.model.mesh.position.clone(),isDriver:true};pedestrians.push(victim);c.driverDownUntil=0;c.driverTrafficBeforeHit=false;setActorShadow(c.driver,true);}
  }
 }else{
  player.mesh.position.lerpVectors(it.seat,it.door,smooth(clamp(t/.8,0,1)));orientDriver(player,c,1-THREE.MathUtils.smoothstep(clamp(t/.8,0,1),0,.78));
  player.update(dt,{speed:0,interactionPhase:'exit',interactionProgress:clamp(t/.8,0,1)});
 }
 setActorShadow(player,false);c.model.update(dt,0,0);
 if(t>=1){
  if(it.phase==='enter'){currentCar=c;state.inCar=true;player.mesh.position.copy(anchor(c));yaw=c.heading+Math.PI;lookTimer=0;}
  else{currentCar=null;state.inCar=false;c.occupied=false;player.mesh.position.copy(it.door);groundActor(player);player.mesh.rotation.set(0,c.heading,0);setActorShadow(player,true);}
  c.model.setDoor(false);sound.door?.();interaction=null;doorTimer=.2;
 }
}
function action(code){
 if(photo?.active){if(code==='Escape'||code==='KeyP')exitPhoto();else if(code==='KeyH')photo.change({hideUI:!photo.settings.hideUI});return;}
 if(code==='KeyP'&&state.started){enterPhoto();return;}
 if(code==='Escape'){if(state.mapOpen)setMap(false);else pause(!state.paused);return;}
 if(!state.started||state.paused)return;
 if(code==='KeyM'){setMap(!state.mapOpen);return;}
 if(state.mapOpen)return;
 if(code==='KeyE'||code==='KeyF')interact();
 if(interaction)return;
 if(code==='Digit1'&&!currentCar){weapon=!weapon;player.setWeapon(weapon);state.weapon=weapon?'9MM PISTOL':'UNARMED';if(!weapon){aiming=false;handling.cancel();reloading=false;reloadRemaining=0;sound.cancelReload?.();}}
 if(code==='KeyR')reload();
 if(code==='KeyH'&&currentCar)sound.horn();
 if(code==='Space'&&!currentCar&&player.mesh.position.y-world.heightAt(player.mesh.position.x,player.mesh.position.z)<.01)jumpVelocity=5;
 if((code==='Shoot'||code==='Mouse0')&&!currentCar){if(!weapon){weapon=true;player.setWeapon(true);state.weapon='9MM PISTOL';}shoot();}
}
function reload(){
 if(!weapon||currentCar||reloading||interaction||state.ammo===PISTOL.capacity||state.reserve===0)return;handling.cancel();reloading=true;reloadRemaining=PISTOL.reloadTime;sound.reload({duration:PISTOL.reloadTime});
}
function spawnEffect(position,color=0xffca76,count=8){
 for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.035,4,4),new THREE.MeshBasicMaterial({color,transparent:true}));mesh.position.copy(position);scene.add(mesh);effects.push({mesh,vel:new THREE.Vector3((Math.random()-.5)*6,Math.random()*4,(Math.random()-.5)*6),life:.5,max:.5});}
}
// Camera convergence chooses the reticle target; the physical shot starts at
// the hand, so a shoulder camera cannot shoot through nearby cover or a car.
function vehicleBounds(c,padding=0){
 const p=c.model.mesh.position,x=Math.abs(Math.cos(c.heading))*1.02+Math.abs(Math.sin(c.heading))*2.24,z=Math.abs(Math.sin(c.heading))*1.02+Math.abs(Math.cos(c.heading))*2.24;
 return new THREE.Box3(new THREE.Vector3(p.x-x,p.y+.15,p.z-z),new THREE.Vector3(p.x+x,p.y+1.42,p.z+z)).expandByScalar(padding);
}
function shotGeometry(){
 return {
  buildings:buildingBoxes,groundY:.04,
  vehicles:vehicles.map(c=>({object:c,box:vehicleBounds(c),raycast:c.model.raycastSurface})),
  actors:[
   ...[...pedestrians,...officers.map(actor=>({actor,officer:true}))].filter(p=>!p.down&&p.actor.mesh.visible&&(p.actor.mesh.userData.downUntil||0)<=elapsed).map(p=>({object:p,position:p.actor.mesh.position})),
   ...vehicles.filter(c=>c.driverActive&&c.driver?.mesh.visible&&!(c.driverDownUntil>elapsed)).map(c=>createPosedActorCollider(c.driver,{actor:c.driver,car:c})),
  ],
 };
}
function updateAimSolution(){
 if(!weapon||currentCar||interaction){aimSolution=null;return;}
 aimRay.setFromCamera(new THREE.Vector2(),camera);
 aimSolution=traceShot({cameraRay:aimRay.ray,muzzle:player.getMuzzlePosition(new THREE.Vector3()),...shotGeometry()});
}
function shoot(){
 if(!state.started||state.paused||state.mapOpen||!weapon||currentCar||interaction||reloading||state.health<=0)return;
 if(state.ammo<=0){if(state.reserve>0)reload();else if(elapsed-lastDryFire>.35){sound.dryFire?.();lastDryFire=elapsed;ui.toast('OUT OF AMMUNITION','Visit Mara at Orbit Exchange for supplies.');}return;}
 handling.request(elapsed,Boolean(player.getAimState?.().ready));
}
function incapacitateActor(target){
 target.actor.reactToHit?.();
 if(target.car){target.car.driverDownUntil=elapsed+24;target.car.driverTrafficBeforeHit ||= target.car.traffic;target.car.traffic=false;}
 else{target.down=true;target.recoverAt=elapsed+24;if(target.officer)target.actor.mesh.userData.downUntil=elapsed+24;}
}
function fireShot(spread,geometry){
 state.ammo--;lastShot=elapsed;sound.shoot();crime(Math.min(5,Math.max(2,state.wanted+(state.ammo%4===0?1:0))));
 aimRay.setFromCamera(new THREE.Vector2(),camera);
 const angle=Math.random()*Math.PI*2,radius=Math.sqrt(Math.random())*spread;
 const right=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0),up=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1);
 aimRay.ray.direction.addScaledVector(right,Math.cos(angle)*radius).addScaledVector(up,Math.sin(angle)*radius).normalize();
 const origin=player.getMuzzlePosition(new THREE.Vector3());
 const barrel=player.getMuzzleDirection(new THREE.Vector3());
 const firingPose={...player.getAimState()};
 const hit=traceShot({cameraRay:aimRay.ray,muzzle:origin,...geometry});
 const direction=hit.point.clone().sub(origin);
 if(direction.lengthSq()<1e-12)direction.copy(barrel);else direction.normalize();
 lastImpact={kind:hit.kind,point:hit.point.toArray(),blocked:hit.blocked,distance:hit.distance,surfaceName:hit.surfaceName,occupant:hit.kind==='actor'&&!!hit.object.car,origin:origin.toArray(),direction:direction.toArray(),barrel:barrel.toArray(),barrelError:barrel.angleTo(direction),firingPose,shotId:handling.shots,time:elapsed,renderFrame};
 muzzleEffect(origin,direction);
 if(hit.distance>2){
  const start=origin.clone().addScaledVector(direction,.5),end=origin.clone().addScaledVector(direction,Math.min(hit.distance,6));
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),new THREE.LineBasicMaterial({color:0xffe5b5,transparent:true,opacity:.36,depthWrite:false}));scene.add(line);effects.push({mesh:line,life:.045,max:.045,opacity:.36,born:renderFrame});
 }
 if(hit.kind==='actor'){
  handling.confirmHit();incapacitateActor(hit.object);
  crime(3);
 }else if(hit.kind==='vehicle'){
  const c=hit.object;handling.confirmHit();c.health=Math.max(0,c.health-24);c.model.setDamage?.(c.health);spawnEffect(hit.point,0xddc49c,3);sound.impact?.({position:hit.point,material:'metal'});
  if(c.health<=0){c.speed=0;c.traffic=false;ui.toast('VEHICLE DISABLED','Find another ride.');}
 }else if(hit.kind==='building'||hit.kind==='ground'){spawnEffect(hit.point,0xb3a89a,3);sound.impact?.({position:hit.point,material:'stone'});}
}
const flashCanvas=document.createElement('canvas');flashCanvas.width=flashCanvas.height=64;
const flashContext=flashCanvas.getContext('2d'),flashGradient=flashContext.createRadialGradient(32,32,1,32,32,31);
flashGradient.addColorStop(0,'rgba(255,255,245,1)');flashGradient.addColorStop(.18,'rgba(255,228,155,.95)');flashGradient.addColorStop(.5,'rgba(255,156,48,.32)');flashGradient.addColorStop(1,'rgba(255,125,30,0)');flashContext.fillStyle=flashGradient;flashContext.fillRect(0,0,64,64);
const flashTexture=new THREE.CanvasTexture(flashCanvas);
function muzzleEffect(origin,direction){
 const flash=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTexture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));flash.position.copy(origin).addScaledVector(direction,.035);flash.scale.set(.14,.10,1);scene.add(flash);effects.push({mesh:flash,life:.04,max:.04,born:renderFrame});
 const shell=new THREE.Mesh(new THREE.CylinderGeometry(.007,.007,.024,6),new THREE.MeshStandardMaterial({color:0xc29c54,metalness:.75,roughness:.38}));shell.position.copy(origin).addScaledVector(direction,-.10);shell.rotation.z=Math.PI/2;scene.add(shell);
 const right=new THREE.Vector3(-Math.cos(player.mesh.rotation.y),0,Math.sin(player.mesh.rotation.y));
 effects.push({mesh:shell,vel:right.multiplyScalar(1.5).add(new THREE.Vector3(0,1.1,0)),spin:new THREE.Vector3(8,12,5),life:.65,max:.65,born:renderFrame});
}
function collides(x,z,radius=.4){
 const b=world.bounds; if(x<b.minX||x>b.maxX||z<b.minZ||z>b.maxZ)return true;
 return world.colliders.some(b=>x>b.minX-radius&&x<b.maxX+radius&&z>b.minZ-radius&&z<b.maxZ+radius);
}
function carsOverlap(a,ah,b,bh){
 const delta=new THREE.Vector2(b.x-a.x,b.z-a.z);
 const af=new THREE.Vector2(Math.sin(ah),Math.cos(ah)),ar=new THREE.Vector2(Math.cos(ah),-Math.sin(ah));
 const bf=new THREE.Vector2(Math.sin(bh),Math.cos(bh)),br=new THREE.Vector2(Math.cos(bh),-Math.sin(bh));
 return [af,ar,bf,br].every(axis=>Math.abs(delta.dot(axis))<2.25*(Math.abs(af.dot(axis))+Math.abs(bf.dot(axis)))+1.02*(Math.abs(ar.dot(axis))+Math.abs(br.dot(axis))));
}
function moveBody(pos,dx,dz,r){let hit=false;if(!collides(pos.x+dx,pos.z,r))pos.x+=dx;else hit=true;if(!collides(pos.x,pos.z+dz,r))pos.z+=dz;else hit=true;return hit;}
function hitsVehicle(x,z,r=.35,ignore=null){
 return vehicles.some(c=>{if(c===ignore)return false;const dx=x-c.model.mesh.position.x,dz=z-c.model.mesh.position.z;const side=dx*Math.cos(c.heading)-dz*Math.sin(c.heading),front=dx*Math.sin(c.heading)+dz*Math.cos(c.heading);return Math.abs(side)<1.08+r&&Math.abs(front)<2.2+r;});
}
function updatePlayer(dt){
 if(interaction){playerMoveSpeed=0;updateInteraction(dt);return null;}
 if(currentCar){playerMoveSpeed=0;updateDriving(dt);return null;}
 const moveX=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
 const moveZ=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
 const raised=weapon&&(aiming||handling.queued||elapsed-lastShot<.35);
 const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&state.stamina>2&&(moveZ!==0||moveX!==0)&&!raised&&!reloading;
 const speed=aiming?1.5:sprint?5.8:2.35;
 if(sprint)state.stamina=Math.max(0,state.stamina-dt*10);else state.stamina=Math.min(100,state.stamina+dt*9);
 const move=new THREE.Vector3(moveX,0,-moveZ).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw);
 playerVelocity.lerp(move.multiplyScalar(speed),1-Math.exp(-12*dt));
 const pos=player.mesh.position,previous=pos.clone();
 moveBody(pos,playerVelocity.x*dt,0,.35);if(hitsVehicle(pos.x,pos.z))pos.x=previous.x;
 moveBody(pos,0,playerVelocity.z*dt,.35);if(hitsVehicle(pos.x,pos.z))pos.z=previous.z;
 if(playerVelocity.length()>.15||raised){const target=raised?yaw+Math.PI:Math.atan2(playerVelocity.x,playerVelocity.z);player.mesh.rotation.y+=angleDiff(player.mesh.rotation.y,target)*Math.min(1,dt*11);}
 const support=advanceGroundedPosition(pos,previous,jumpVelocity,dt,world.heightAt);jumpVelocity=support.verticalVelocity;
 playerMoveSpeed=Math.hypot(pos.x-previous.x,pos.z-previous.z)/Math.max(dt,.001);
 setActorShadow(player,support.height<.3);state.nearCar=!!nearestCar();state.speed=0;state.gear='N';state.rpm=0;
 // Resolve the camera after movement, then give the pose that same view.
 // Advancing the old pose here made rapid aim and each recoil event one step late.
 return {speed:playerMoveSpeed,armed:weapon,aiming,shooting:handling.queued||elapsed-lastShot<.32,shotId:handling.shots,jumping:support.height>.01,verticalVelocity:jumpVelocity,reloading,reloadProgress:1-reloadRemaining/PISTOL.reloadTime};
}
function updateDriving(dt){
 const c=currentCar;
 const telemetry=updateVehiclePhysics(c,dt,{
  throttle:(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),
  steering:(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0),
  handbrake:keys.has('Space'),moveBody,vehicles,carsOverlap,
  onImpact:({speed,other,position})=>{
   c.health=Math.max(0,c.health-speed*1.4);state.health=Math.max(0,state.health-Math.max(0,speed-8)*.3);
   if(other){other.health=Math.max(0,other.health-speed);crime(1,'collision');}
   sound.crash();spawnEffect(position.clone().add(new THREE.Vector3(0,.5,0)),0xc1b5a0,6);damageFlash=.12;
  }
 });
 c.model.update(dt,c.speed,c.steer);c.model.setDamage?.(c.health);
 player.setVisible(true);player.mesh.position.copy(anchor(c));orientDriver(player,c);setActorShadow(player,false);
 player.update(dt,{speed:0,seated:true,steering:c.steer});
 state.speed=Math.round(Math.abs(c.speed)*3.6);state.gear=telemetry.gear;state.rpm=telemetry.rpm;state.slip=telemetry.slip;state.vehicleHealth=c.health;state.nearCar=false;
}
function advanceDriver(c,dt){
 c.driver.mesh.position.copy(anchor(c));orientDriver(c.driver,c);setActorShadow(c.driver,false);
 c.driver.advance(dt,{speed:0,seated:true,steering:c.steer,dead:c.driverDownUntil>elapsed});
}
function updateDrivers(dt){
 for(const c of vehicles){
  if(!c.driver||!c.driverActive||(interaction?.car===c&&interaction.phase==='enter'&&interaction.opened))continue;
  if(c.driverDownUntil&&c.driverDownUntil<=elapsed){c.driverDownUntil=0;if(c.driverTrafficBeforeHit&&!c.stolen&&!c.occupied&&c.health>0)c.traffic=true;c.driverTrafficBeforeHit=false;}
  c.driver.mesh.visible=c.model.mesh.position.distanceTo(camera.position)<65;
  advanceDriver(c,dt);
 }
}
function getPoliceShotGeometry({shooter}){
 const drivers=vehicles.filter(c=>c.driverActive&&c.driver?.mesh.visible&&!(c.driverDownUntil>elapsed));
 // Traffic has moved this substep. Snapshot occupants at their current seats
 // before the later driver update, without advancing their animation clocks.
 for(const c of drivers)if(!(interaction?.car===c&&interaction.phase==='enter'&&interaction.opened))advanceDriver(c,0);
 const actors=[
  ...[...pedestrians,...officers.map(actor=>({actor,officer:true}))].filter(p=>!p.down&&p.actor!==shooter&&p.actor.mesh.visible&&(p.actor.mesh.userData.downUntil||0)<=elapsed),
  ...drivers.map(car=>({actor:car.driver,car})),
 ];
 return {
  buildings:buildingBoxes,groundY:.04,
  vehicles:vehicles.map(c=>({object:c,box:vehicleBounds(c),raycast:c.model.raycastSurface})),
  actors:actors.map(target=>({object:target,position:target.actor.mesh.position,volumes:target.actor.getHitVolumes()})),
  player:{object:player,position:player.mesh.position,volumes:player.getHitVolumes()},
 };
}
function policeShot({origin,target,hit,damage,impact,warning,shotId}){
 const direction=target.clone().sub(origin).normalize(),distance=origin.distanceTo(target);
 if(distance>.05){
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(direction,Math.min(.5,distance*.25)),origin.clone().addScaledVector(direction,Math.min(distance,6))]),new THREE.LineBasicMaterial({color:0xffe5b5,transparent:true,opacity:.3,depthWrite:false}));scene.add(line);effects.push({mesh:line,life:.045,max:.045,opacity:.3,born:renderFrame});
 }
 const flash=new THREE.Sprite(new THREE.SpriteMaterial({map:flashTexture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));flash.position.copy(origin);flash.scale.set(.12,.09,1);scene.add(flash);effects.push({mesh:flash,life:.04,max:.04,born:renderFrame});
 sound.shoot?.({position:origin});
 const healthBefore=state.health,vehicle=impact.kind==='vehicle'?impact.object:null,vehicleHealthBefore=vehicle?.health;
 if(hit){state.health=Math.max(0,state.health-damage);player.reactToHit?.(.65);damageFlash=.3;}
 else if(impact.kind==='actor')incapacitateActor(impact.object);
 else if(vehicle){
  vehicle.health=Math.max(0,vehicle.health-damage);vehicle.model.setDamage?.(vehicle.health);
  spawnEffect(impact.point,0xddc49c,3);sound.impact?.({position:impact.point,material:'metal'});
  if(vehicle.health<=0){vehicle.speed=0;vehicle.traffic=false;}
 }else if(impact.kind==='building'||impact.kind==='ground'){
  spawnEffect(impact.point,0xb3a89a,3);sound.impact?.({position:impact.point,material:'stone'});
 }
 policeShotHistory.push({id:shotId,time:elapsed,origin:origin.toArray(),point:target.toArray(),kind:impact.kind,surface:impact.surfaceName,warning,playerHit:hit,actor:impact.kind==='actor'?(hit?'player':impact.object.car?'driver':impact.object.officer?'officer':'pedestrian'):null,actorDown:impact.kind==='actor'&&!hit?Boolean(impact.object.down||impact.object.car?.driverDownUntil>elapsed):false,healthBefore,healthAfter:state.health,vehicle:vehicle?vehicles.indexOf(vehicle):null,vehicleHealthBefore,vehicleHealthAfter:vehicle?.health});
 if(policeShotHistory.length>24)policeShotHistory.shift();
}
function clipCameraBoom(head,target){
 const cars=vehicles.filter(c=>c!==currentCar&&c!==interaction?.car);
 return clipCameraSegment(head,target,{...getCameraSweep(camera),boxes:[...cameraBoxes,...cars.filter(c=>!c.model.raycastSurface).map(c=>vehicleBounds(c,.12))],surfaces:cars.filter(c=>c.model.raycastSurface).map(c=>c.model.raycastSurface)});
}
function updateCamera(dt){
 if(photo?.active)return;
 if(!state.started){
  camera.position.set(9.8+Math.sin(elapsed*.045)*.32,2.15,28.7+Math.cos(elapsed*.045)*.2);camera.fov=52;camera.updateProjectionMatrix();camera.lookAt(-3.2,2.8,-12);return;
 }
 const base=player.mesh.position;
 if(currentCar&&elapsed-lookTimer>2.5)yaw+=angleDiff(yaw,currentCar.heading+Math.PI)*Math.min(1,dt*2.8);
 const ads=Boolean(aiming&&weapon&&!currentCar);
 const dist=currentCar?7.6:ads?2.4:4.2;
 const shoulder=currentCar?0:ads?.55:.45;
 const pivot=base.clone().add(new THREE.Vector3(0,currentCar?1.2:1.48,0));
 const vertical=clamp(pitch-handling.recoilPitch,-1.05,1.1),horizontal=yaw+handling.recoilYaw;
 const forward=new THREE.Vector3(-Math.sin(horizontal)*Math.cos(vertical),-Math.sin(vertical),-Math.cos(horizontal)*Math.cos(vertical));
 const right=new THREE.Vector3(Math.cos(horizontal),0,-Math.sin(horizontal));
 const desired=pivot.clone().addScaledVector(forward,-dist).addScaledVector(right,shoulder);
 if(currentCar)desired.y+=1.0;desired.y=Math.max(.35,desired.y);
 camera.position.lerp(clipCameraBoom(pivot,desired),1-Math.exp(-(ads?16:9)*dt));
 camera.position.copy(clipCameraBoom(pivot,camera.position));camera.position.y=Math.max(.35,camera.position.y);
 // Use one forward direction for view, reticle and shot convergence. Orbit
 // pitch is an actual angle, rather than moving a camera that looks at a fixed Y.
 cameraLook.copy(camera.position).addScaledVector(forward,30);camera.lookAt(cameraLook);
 const lean=currentCar?clamp(-currentCar.steer*Math.abs(currentCar.speed)*.004,-.035,.035):0;
 cameraRoll=damp(cameraRoll,lean,4,dt);camera.rotateZ(cameraRoll);
 camera.fov=damp(camera.fov,currentCar?58+Math.min(10,Math.abs(currentCar.speed)*.2):ads?46:55,10,dt);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}
function updateNightLights(){
 if(!night)return;
 const lamps=[...world.lampPositions].sort((a,b)=>a.distanceToSquared(camera.position)-b.distanceToSquared(camera.position));
 streetLights.forEach((light,i)=>light.position.copy(lamps[i]));
 const car=currentCar||vehicles.reduce((nearest,c)=>c.model.mesh.position.distanceToSquared(camera.position)<nearest.model.mesh.position.distanceToSquared(camera.position)?c:nearest,vehicles[0]);
 headlights.forEach((light,i)=>{
  light.visible=car.model.mesh.position.distanceTo(camera.position)<45;
  const forward=new THREE.Vector3(Math.sin(car.heading),0,Math.cos(car.heading));
  const right=new THREE.Vector3(Math.cos(car.heading),0,-Math.sin(car.heading));
  light.position.copy(car.model.mesh.position).addScaledVector(forward,1.95).addScaledVector(right,i===0?-.66:.66);light.position.y=.68;
  light.target.position.copy(light.position).addScaledVector(forward,25);light.target.position.y=.05;
 });
}
function updateGame(dt){
 const active=state.started&&!state.paused&&!state.mapOpen;
 const simDt=state.paused||state.mapOpen?0:dt;
 handling.update(simDt);elapsed+=simDt;doorTimer=Math.max(0,doorTimer-simDt);damageFlash=Math.max(0,damageFlash-simDt);
 markerDiamond.rotation.y+=simDt*.6;markerDiamond.position.y=2.7+Math.sin(elapsed*2)*.15;
 if(active){
  if(reloading){reloadRemaining=Math.max(0,reloadRemaining-dt);if(reloadRemaining===0){const count=Math.min(PISTOL.capacity-state.ammo,state.reserve);state.ammo+=count;state.reserve-=count;reloading=false;}}
  const playerPose=updatePlayer(dt);updateCamera(dt);
  if(playerPose){
   const aimDirection=camera.getWorldDirection(new THREE.Vector3());
   const aimYaw=angleDiff(player.mesh.rotation.y,Math.atan2(aimDirection.x,aimDirection.z));
   let aimTarget=null,geometry=null;
   if(weapon&&(aiming||handling.queued||elapsed-lastShot<.35)){
    aimRay.setFromCamera(new THREE.Vector2(),camera);geometry=shotGeometry();
    aimTarget=getAimPoint({cameraRay:aimRay.ray,...geometry});
    const muzzle=player.getMuzzlePosition(new THREE.Vector3());
    if(aimTarget.clone().sub(muzzle).dot(aimRay.ray.direction)<=0)aimRay.ray.at(aimRay.ray.origin.distanceTo(muzzle)+90,aimTarget);
   }
   player.update(dt,{...playerPose,aimYaw,aimPitch:Math.asin(clamp(aimDirection.y,-1,1)),aimTarget});
   const shotSpread=handling.spread(aiming,playerMoveSpeed);
   if(!reloading&&weapon&&state.health>0&&handling.consume(elapsed,player.getAimState().ready)){
    // Trace the solved pre-recoil barrel, then apply this discrete shot to the
    // visible hands and pistol without advancing gait/contact clocks again.
    fireShot(shotSpread,geometry||shotGeometry());player.applyShot(handling.shots);
   }
  }
  Object.assign(state,simulation.update(dt,{playerPosition:player.mesh.position,currentCar:interaction?.car||currentCar,time:elapsed}));
  const progress=job.update({wanted:state.wanted,policeState:state.policeState,vehicle:currentCar});
  if(progress.replaceJobCar){
   currentCar=null;interaction=null;state.inCar=false;player.mesh.position.set(1.4,0,23);groundActor(player);player.resetGrounding?.();setActorShadow(player,true);
   heroCar.model.mesh.position.copy(heroCar.home);heroCar.heading=heroCar.homeHeading;heroCar.health=100;heroCar.speed=0;heroCar.occupied=false;heroCar.stolen=false;heroCar.model.setDamage?.(100);simulation.reset();
  }
  if(state.health<=0&&respawnTimer===0){respawnTimer=3;ui.toast('BUSTED','Returning to your mission checkpoint…');}
  if(respawnTimer>0){respawnTimer-=dt;if(respawnTimer<=0){respawnTimer=0;restart(false);}}
  if(state.health<100&&state.wanted===0)state.health=Math.min(100,state.health+dt*.5);
  if(dialogueQueue.length&&elapsed>=dialogueUntil){const next=dialogueQueue.shift();state.subtitle=next.text;state.subtitleSpeaker=next.speaker;dialogueUntil=elapsed+Math.max(4.5,next.text.length*.055);}
  else if(elapsed>=dialogueUntil){state.subtitle='';state.subtitleSpeaker='';}
 }else if(!state.started){vehicles.forEach(c=>c.model.update(simDt,0,0));pedestrians.forEach(p=>{p.actor.mesh.visible=p.actor.mesh.position.distanceTo(camera.position)<70;p.actor.advance(simDt,{speed:0});});player?.update(simDt,{speed:0});}
 for(const c of vehicles)if(c!==currentCar&&!c.traffic&&!c.police&&!c.occupied&&Math.abs(c.speed)>.05){updateVehiclePhysics(c,simDt,{throttle:0,steering:0,moveBody,vehicles,carsOverlap});c.model.update(simDt,c.speed,c.steer);}
 updateDrivers(simDt);contactActor?.advance(simDt,{speed:0});
 if(job){const progress=job.getState();Object.assign(state,progress);mission=progress.mission;if(progress.target){goal.set(progress.target.x,0,progress.target.z);marker.position.copy(goal);}marker.visible=!!progress.target&&state.started;const close=progress.target&&player.mesh.position.distanceTo(goal)<4;markerBeam.visible=!close;markerDiamond.visible=!close;markerRing.scale.setScalar(close?.5:1);}
 const context=player&&job?contextAction():null;
 Object.assign(state,{interactionVisible:!!context&&!interaction,interactionTitle:context?.title||'',interactionName:context?.name||'',interactionKey:'E'});
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];if(e.born!==renderFrame)e.life-=simDt;if(e.life<=0){scene.remove(e.mesh);if(!e.mesh.isSprite)e.mesh.geometry?.dispose();e.mesh.material.dispose();effects.splice(i,1);}else{if(e.vel){e.vel.y-=9*simDt;e.mesh.position.addScaledVector(e.vel,simDt);}if(e.spin){e.mesh.rotation.x+=e.spin.x*simDt;e.mesh.rotation.y+=e.spin.y*simDt;e.mesh.rotation.z+=e.spin.z*simDt;}e.mesh.material.opacity=(e.opacity??1)*e.life/e.max;}}
 if(!active)updateCamera(simDt);
}

// Presentation follows the final physics state once per rendered frame. Slow
// frames still substep collisions, but no longer redraw the map, move lights or
// submit audio/HUD updates up to eight times before anything can be displayed.
function updatePresentation(dt){
 const active=state.started&&!state.paused&&!state.mapOpen;
 world.update?.(state.paused||state.mapOpen?0:dt,elapsed);updateNightLights();
 // NPC time advances with physics; finish its procedural pose once for this
 // displayed frame. Geometry readers also flush before an actual shot.
 player?.updateLOD?.(camera);contactActor?.updateLOD?.(camera);
 for(const p of pedestrians){setActorShadow(p.actor,true);p.actor.updateLOD?.(camera);}
 for(const officer of officers){setActorShadow(officer,true);officer.updateLOD?.(camera);}
 for(const car of vehicles)car.driver?.updateLOD?.(camera);
 updateAimSolution();
 if(player){const pos=player.mesh.position;const shadowFocus=photo.active?camera.position:pos;if(Math.hypot(shadowFocus.x-shadowAnchor.x,shadowFocus.z-shadowAnchor.z)>28){shadowAnchor.copy(shadowFocus);shadowAnchor.y=0;sun.target.position.copy(shadowAnchor);sun.position.copy(shadowAnchor).add(sunOffset);renderer.shadowMap.needsUpdate=true;}state.location=world.locationAt?.(pos.x,pos.z)||'VESPUCCI BOULEVARD';state.objectiveDistance=state.target?Math.round(pos.distanceTo(goal)):0;}
 sound.update({speed:Math.abs(currentCar?.speed||0),inCar:active&&state.inCar,wanted:active?state.wanted:0,playerPosition:player?.mesh.position,policePosition:police.model.mesh.position,velocity:playerVelocity,footSpeed:active&&!currentCar&&!interaction?playerMoveSpeed:0,sprinting:keys.has('ShiftLeft'),rpm:state.rpm,gear:state.gear,slip:state.slip||0,policeState:state.policeState,night,active,cameraForward:camera.getWorldDirection(new THREE.Vector3())});
 uiTimer+=dt;miniTimer+=dt;
 const hitMarker=handling.presentHitMarker(dt,{visible:active&&weapon&&!currentCar&&!interaction,paused:!active});
 const combat={armed:weapon&&!currentCar,aiming:aiming&&weapon&&!currentCar,reloading,reloadProgress:reloading?1-reloadRemaining/PISTOL.reloadTime:0,crosshairSpread:3+handling.spread(aiming,playerMoveSpeed)*innerHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)),hitMarker,shotBlocked:Boolean(aimSolution?.blocked)};
 Object.assign(state,combat);ui.updateCombat?.({...combat,ammo:state.ammo,reserve:state.reserve,weapon:state.weapon,inCar:state.inCar});
 if(uiTimer>.1){ui.update(state);uiTimer=0;}
 if(miniTimer>.1){drawMap(mapCanvas());miniTimer=0;}
}

function drawMap(target,full=false){
 if(!target||!player)return;const ctx=target.getContext('2d');const w=target.width,h=target.height;
 ctx.fillStyle='#1b292d';ctx.fillRect(0,0,w,h);
 const scale=full?Math.min(w/260,h/400):1.65;
 const center=full?{x:10,z:-20}:player.mesh.position;
 const px=x=>w/2+(x-center.x)*scale,py=z=>h/2+(z-center.z)*scale;
 ctx.fillStyle='#283f47';ctx.fillRect(0,0,px(-100),h);
 ctx.fillStyle='#65604f';ctx.fillRect(px(-100),0,19*scale,h);
 ctx.fillStyle='#344145';
 world.colliders.forEach(b=>ctx.fillRect(px(b.minX),py(b.minZ),(b.maxX-b.minX)*scale,(b.maxZ-b.minZ)*scale));
 ctx.strokeStyle='#667276';ctx.lineWidth=full?13*scale:15;ctx.lineCap='butt';
 [0,80].forEach(x=>{ctx.beginPath();ctx.moveTo(px(x),py(-220));ctx.lineTo(px(x),py(180));ctx.stroke();});
 [-90,0,90].forEach(z=>{ctx.beginPath();ctx.moveTo(px(-92),py(z));ctx.lineTo(px(136),py(z));ctx.stroke();});
 ctx.strokeStyle='#e5ab64';ctx.lineWidth=2;
 if(state.target){ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(px(player.mesh.position.x),py(player.mesh.position.z));ctx.lineTo(px(0),py(player.mesh.position.z));ctx.lineTo(px(0),py(goal.z));ctx.lineTo(px(goal.x),py(goal.z));ctx.stroke();ctx.setLineDash([]);}
 for(const c of vehicles){const p=c.model.mesh.position;ctx.fillStyle=c.police?'#7caae3':c===currentCar?'#f4bc77':'#b6c0bb';ctx.save();ctx.translate(px(p.x),py(p.z));ctx.rotate(-c.heading);ctx.fillRect(-2,-3,4,6);ctx.restore();}
 if(state.target){ctx.fillStyle='#f6bd78';ctx.beginPath();ctx.arc(px(goal.x),py(goal.z),full?7:5,0,Math.PI*2);ctx.fill();}
 const pos=player.mesh.position;ctx.save();ctx.translate(px(pos.x),py(pos.z));ctx.rotate(-(currentCar?currentCar.heading:player.mesh.rotation.y));ctx.fillStyle='#fff5e2';ctx.shadowColor='#000';ctx.shadowBlur=5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(-5,-5);ctx.lineTo(0,-2);ctx.lineTo(5,-5);ctx.closePath();ctx.fill();ctx.restore();
 if(full){ctx.font='600 13px sans-serif';ctx.fillStyle='#c7cfca';ctx.fillText('VESPUCCI',px(-63),py(-25));ctx.fillText('DOWNTOWN',px(52),py(-150));ctx.save();ctx.translate(px(-109),h*.65);ctx.rotate(-Math.PI/2);ctx.fillStyle='#78959d';ctx.fillText('PACIFIC OCEAN',0,0);ctx.restore();}
}

window.addEventListener('keydown',e=>{
 const control=e.target.closest?.('button,input,select,textarea,[contenteditable]');
 if(control&&['Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(e.code))return;
 if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
 const photoMovement=photo.active&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(e.code);
 if((e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)&&!photoMovement&&!['Escape','KeyP','KeyH'].includes(e.code))return;
 if(!keys.has(e.code))action(e.code);keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();mouseDown=false;aiming=false;if(state.started&&!photo.active)pause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.started&&!photo.active)pause(true);});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
 if(photo.active){canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);return;}
 if(!state.started||state.paused||state.mapOpen||interaction)return;
 canvas.focus({preventScroll:true});canvas.setPointerCapture(e.pointerId);
});
// Mouse Events report every button edge. Pointer Events only report the first
// mouse button down / last button up, losing LMB clicks while RMB stays held.
canvas.addEventListener('mousedown',e=>{
 if(e.sourceCapabilities?.firesTouchEvents||photo.active||!state.started||state.paused||state.mapOpen||interaction)return;
 if(e.button===2)aiming=weapon;
 if(e.button===0){mouseDown=true;if(weapon)shoot();}
});
window.addEventListener('mouseup',e=>{if(e.button===0)mouseDown=false;if(e.button===2)aiming=false;});
window.addEventListener('pointercancel',()=>{mouseDown=false;aiming=false;handling.cancel();});
window.addEventListener('pointermove',e=>{
 if(photo.active){if(e.buttons&&e.target===canvas)photo.look(e.movementX,e.movementY);return;}
 if(!state.started||state.paused||state.mapOpen||interaction)return;
 if(e.buttons||document.pointerLockElement===canvas){yaw-=e.movementX*(aiming?.0022:.0035);pitch=clamp(pitch+e.movementY*(aiming?.0022:.003),-1.05,1.1);lookTimer=elapsed;}
});
canvas.addEventListener('dblclick',()=>{if(state.started&&!state.paused&&!photo.active)canvas.requestPointerLock?.();});
canvas.addEventListener('wheel',e=>{if(photo.active){e.preventDefault();photo.change({fov:photo.settings.fov+e.deltaY*.025});}},{passive:false});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);rendering.resize();});

// A read-only diagnostic view keeps real browser verification reproducible.
Object.defineProperty(window,'__GRAND_THEFT_ASTRA__',{value:{getState:()=>({...state,renderFrame,playerMoveSpeed,playerHeading:player?.mesh.rotation.y,aimState:player?.getAimState?.(),muzzlePosition:player?.getMuzzlePosition?.().toArray(),muzzleDirection:player?.getMuzzleDirection?.().toArray(),shotsFired:handling.shots,shotQueued:handling.queued,lastImpact,policeShots:policeShotHistory.map(shot=>({...shot,origin:[...shot.origin],point:[...shot.point]})),recoilPitch:handling.recoilPitch,aimPoint:aimSolution?.point.toArray(),position:player?.mesh.position.toArray(),groundHeight:player?world.heightAt(player.mesh.position.x,player.mesh.position.z):null,carPosition:currentCar?.model.mesh.position.toArray(),carHeading:currentCar?.heading,carSpeed:currentCar?.speed,mission,interaction:interaction?{phase:interaction.phase,progress:interaction.elapsed/interaction.duration}:null,animation:player?.mesh.userData.animationState,pose:player?.getPoseInfo?.(),face:player?.getFaceInfo?.(),landmarks:world.landmarks,reloading,reloadRemaining,elapsed,policePosition:police.model.mesh.position.toArray(),characterLoaded:!!player,driverVisible:!!currentCar&&player?.mesh.visible,driverPosition:currentCar?player.mesh.position.toArray():null,city:simulation?.getDiagnostics?.(),driverAlignment:currentCar?{driver:player.mesh.quaternion.toArray(),cockpit:currentCar.model.getDriverOrientation?.(new THREE.Quaternion()).toArray()}:null,instanceVisibility:world.getInstanceVisibility(),wires:world.getWireStats(),heroVehicle:{driverActive:heroCar.driverActive,driverDownUntil:heroCar.driverDownUntil,driverAnimation:heroCar.driver?.mesh.userData.animationState,driverHead:heroCar.driver?.getHitVolumes?.().spheres[0]?.center.toArray(),evictedDriver:pedestrians.some(p=>p.isDriver&&p.actor===heroCar.driver)?{down:pedestrians.find(p=>p.actor===heroCar.driver).down,animation:heroCar.driver?.mesh.userData.animationState}:null,detail:heroCar.model.getDetailInfo?.(),model:heroCar.model.mesh.userData.model,detailLevels:heroCar.model.mesh.userData.detailLevels,driverSeat:heroCar.model.getDriverSeat?.().toArray(),doorEntry:heroCar.model.getDoorPosition?.().toArray(),doorAngle:heroCar.model.mesh.getObjectByName('driver_door')?.rotation.y},jobCarHealth:heroCar.health,jobCarPosition:heroCar.model.mesh.position.toArray(),characterLODs:[player,contactActor,...pedestrians.map(p=>p.actor),...officers,...vehicles.map(c=>c.driver)].filter(Boolean).map(actor=>({...actor.getLODInfo?.(),evaluation:actor.getEvaluationStats?.(),face:actor.getFaceInfo?.(),position:actor.mesh.position.toArray(),groundHeight:world.heightAt(actor.mesh.position.x,actor.mesh.position.z),visible:actor.mesh.visible})),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,vehicles:vehicles.length,vehicleDetails:vehicles.map(c=>({model:c.model.mesh.userData.model,position:c.model.mesh.position.toArray(),speed:c.speed,...c.model.getDetailInfo?.()})),pedestrians:pedestrians.length,softwareRenderer:!!softwareRenderer,pixelRatio:renderer.getPixelRatio(),cameraPosition:camera.position.toArray(),cameraDirection:camera.getWorldDirection(new THREE.Vector3()).toArray(),photo:photo.active?photo.settings:null,renderSize:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()})}});

async function boot(){
 try{
  const [skyData]=await Promise.all([atmosphere.ready,world.ready,loadCharacterAssets()]);
  if(skyData?.texture){
   world.setSky(skyData);
   const pmrem=new THREE.PMREMGenerator(renderer);
   const dayEnvironment=pmrem.fromEquirectangular(skyData.texture).texture;
   const nightEnvironment=skyData.nightTexture?pmrem.fromEquirectangular(skyData.nightTexture).texture:dayEnvironment;
   vehicleNightEnvironment=nightEnvironment;
   atmosphere.setEnvironment(dayEnvironment,nightEnvironment);
   scene.environmentRotation.copy(skyData.rotation);
   sunOffset.copy(skyData.sunDirection).multiplyScalar(350);
   sun.target.position.copy(shadowAnchor);sun.position.copy(shadowAnchor).add(sunOffset);
   pmrem.dispose();
  }
  // Capture the surrounding architecture once for local car-paint and glass
  // reflections. Reuse it across vehicles; no recurring cubemap render cost.
  const requestedNight=night;setTime(false);
  const reflectionTarget=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType});
  const reflectionCamera=new THREE.CubeCamera(.2,350,reflectionTarget);
  reflectionCamera.position.set(4.8,1.2,18);
  vehicles.forEach(car=>car.model.mesh.visible=false);
  world.restoreInstances();reflectionCamera.update(renderer,scene);
  vehicles.forEach(car=>car.model.mesh.visible=true);
  const carPMREM=new THREE.PMREMGenerator(renderer);
  const vehicleEnvironment=carPMREM.fromCubemap(reflectionTarget.texture).texture;
  vehicleDayEnvironment=vehicleEnvironment;
  vehicles.forEach(car=>car.model.mesh.traverse(object=>{
   const materials=Array.isArray(object.material)?object.material:[object.material];
   for(const material of materials)if(material?.isMeshStandardMaterial){material.envMap=vehicleEnvironment;material.userData.dayEnvIntensity=material.envMapIntensity;material.needsUpdate=true;}
  }));
  carPMREM.dispose();reflectionTarget.dispose();setTime(requestedNight);renderer.shadowMap.needsUpdate=true;
  player=createCharacter({groundHeightAt:world.heightAt});player.mesh.position.set(1.4,0,23);groundActor(player);player.mesh.rotation.y=Math.PI;player.setWeapon(false);addContactShadow(player.mesh,1.4,1.4);setActorShadow(player,true);scene.add(player.mesh);
  const npcSpawns=[[-14,8],[-14,-30],[14,-38],[14,45],[-14,-75],[14,-128],[66,-54],[94,10],[-14,67],[14,-160],[66,47],[94,-120]];
  npcSpawns.forEach(([x,z],i)=>{const actor=createCharacter({groundHeightAt:world.heightAt,npc:true,color:[0x657d78,0x8d6e62,0xb5a68a,0x697a90,0x8b5365,0xd0c7b5][i%6]});const direction=i%2?1:-1;addContactShadow(actor.mesh,1.2,1.2);actor.mesh.position.set(x,world.heightAt(x,z),z);setActorShadow(actor,true);actor.mesh.rotation.y=direction<0?Math.PI:0;scene.add(actor.mesh);pedestrians.push({actor,direction,homeDirection:direction,home:actor.mesh.position.clone(),down:false,recoverAt:0,fleeUntil:0});});
  for(let i=0;i<2;i++){const actor=createCharacter({groundHeightAt:world.heightAt,npc:true,police:true,color:0x23374d});actor.setWeapon(true);addContactShadow(actor.mesh,1.2,1.2);actor.mesh.visible=false;scene.add(actor.mesh);officers.push(actor);}
  for(const c of [heroCar,t1,t2]){c.driver=createCharacter({groundHeightAt:world.heightAt,npc:true,color:c===heroCar?0xa78c6a:0x526b7a});c.driverActive=true;addContactShadow(c.driver.mesh,1.2,1.2);scene.add(c.driver.mesh);}
  contactActor=createCharacter({groundHeightAt:world.heightAt,npc:true,color:0x272c3d});contactActor.mesh.position.set(world.landmarks.contact.x-1,0,world.landmarks.contact.z);groundActor(contactActor);contactActor.mesh.rotation.y=Math.PI/2;addContactShadow(contactActor.mesh,1.2,1.2);setActorShadow(contactActor,true);scene.add(contactActor.mesh);
  simulation=createCitySimulation({vehicles,pedestrians,police,officers,world,moveBody,carsOverlap,getPoliceShotGeometry,onPoliceShot:policeShot,onToast:(a,b)=>ui.toast(a,b)});
  job=createMission({landmarks:world.landmarks,getHeroPosition:()=>heroCar.model.mesh.position,onDialogue:dialogue,onToast:(a,b)=>ui.toast(a,b),onComplete:info=>{ui.missionComplete?.(info);sound.notify();}});
  const saved=job.getState();Object.assign(state,saved);mission=saved.mission;
  if(mission>=4){player.mesh.position.set(world.landmarks.safehouse.x,0,world.landmarks.safehouse.z);groundActor(player);setActorShadow(player,true);player.mesh.rotation.y=Math.PI/2;yaw=-Math.PI/2;heroCar.isJobCar=false;}
  updateDrivers(0);ui.update(state);
  state.ready=true;ui.setReady(true);
 }catch(error){console.error('Unable to initialize city',error);ui.toast('COULD NOT LOAD THE CITY','Please refresh to try again.');}
 lastFrame=performance.now();requestAnimationFrame(frame);
}
function frame(now){
 renderFrame++;
 const wallDt=Math.max(0,(now-lastFrame)/1000),dt=Math.min(wallDt,.25);lastFrame=now;frameCount++;fpsTimer+=wallDt;
 if(fpsTimer>1){state.fps=Math.round(frameCount/fpsTimer);frameCount=0;fpsTimer=0;}
 // A paused simulation has no elapsed time to subdivide. Refresh the frozen
 // pose once while the photo camera and presentation keep their frame cadence.
 const steps=state.paused||state.mapOpen?1:Math.max(1,Math.ceil(dt/.033));for(let i=0;i<steps;i++)updateGame(dt/steps);photo.update(dt,keys);updatePresentation(dt);world.updateWires(camera,renderer.getDrawingBufferSize(drawingSize));const refreshShadows=renderer.shadowMap.enabled&&(renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate);
 if(refreshShadows){sun.updateWorldMatrix(true,false);sun.target.updateWorldMatrix(true,false);sun.shadow.updateMatrices(sun);}
 world.updateInstanceVisibility(camera,{preserveShadows:refreshShadows,shadowFrusta:refreshShadows?[sun.shadow.getFrustum()]:undefined});rendering.render();photo.afterRender();requestAnimationFrame(frame);
}
boot();
