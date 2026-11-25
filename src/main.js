import { streamCharacterTextures } from './character-texture-stream.js';
import * as THREE from 'three';
import { createWorld } from './world.js';
import { cityMapCenter, cityMapScale, mapClickPosition, mapRoute, nearestMapRoad, nextMapTurn } from './map-navigation.js';
import { createCar, loadVehicleAssets } from './vehicles.js';
import { loadCharacterAssets, createCharacter } from './characters.js';
import { createUI } from './ui.js';
import { keyboardCode } from './input-prompts.js';
import { createAudio } from './audio.js';
import { createAtmosphere } from './atmosphere.js';
import { createEnvironmentLighting } from './environment-lighting.js';
import { loadVehicleProbe } from './vehicle-probe.js';
import { createDistrictLighting } from './district-lighting.js';
import { createRendering } from './rendering.js';
import { createGamepadInput } from './gamepad.js';
import { createPhotoMode } from './photo-mode.js';
import { createPhotoActorVisibility } from './photo-actor-visibility.js';
import { createCitySimulation } from './simulation.js';
import { createCircuitGate } from './circuit-gate.js';
import { PIER_SCREEN_CENTER } from './pier-screening.js';
import { SCREENING_AUDIENCE, CIRCUIT_START, createMission } from './missions.js';
import { createLastLightForkCues, drawLastLightFork, showLastLightFork } from './last-light-map.js';
import { SHIFT_STOPS, SHIFT_PULL_OFF } from './night-shift.js';
import { recorderDesk } from './room-tone.js';
import { createSkidMarks } from './skid-marks.js';
import { updateVehiclePhysics } from './driving.js';
import { createVehicleApproach } from './vehicle-approach.js';
import { clipCameraSegment, getCameraSweep } from './camera-collision.js';
import { createPlayerCameraVisibility } from './player-camera-visibility.js';
import { createCharacterContactShadow } from './character-contact-shadow.js';
import { createPhotoCharacterShadow } from './photo-character-shadow.js';
import { createPosedActorCollider, getAimPoint, traceShot } from './combat.js';
import { createWeaponHandling, PISTOL } from './weapon-handling.js';
import { createShotFrameScheduler } from './shot-frame-scheduler.js';
import { createEffectMaterialPool } from './effect-material-pool.js';
import { createEffectShaderWarmup, warmKnownEffectVariants } from './effect-shader-warmup.js';
import { createLampInspection } from './lamp-inspection.js';
import { advanceFootVelocity, sprintFraming, WALK_SPEED, SPRINT_SPEED } from './foot-movement.js';
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
let graphicsQuality = softwareRenderer ? 'performance' : 'high';
const vehicleProbe = loadVehicleProbe(graphicsQuality);
let fastMotion = false, lastMotionTime = -Infinity;
function gameplayPixelRatio() {
 if (graphicsQuality === 'high') return softwareRenderer ? .65 : Math.min(devicePixelRatio, 1.5);
 // Bound shaded pixels on a software GPU while retaining fine detail in smaller windows.
 const budget = softwareRenderer ? 370000 : 950000;
 return Math.min(devicePixelRatio, softwareRenderer && fastMotion ? .5 : .8, Math.sqrt(budget / (innerWidth * innerHeight)));
}
renderer.setPixelRatio(gameplayPixelRatio());
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate=!softwareRenderer;
renderer.shadowMap.needsUpdate=true;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
// Cool coastal skylight and a muted ground bounce keep shaded plaster and faces distinct.
const daylight={sky:0xa4c9f6,ground:0x645749,fill:.62,sun:0xffc394,key:2.52,exposure:.93};
renderer.toneMappingExposure=daylight.exposure;
renderer.info.autoReset=false;
renderer.outputColorSpace=THREE.SRGBColorSpace;
const camera=new THREE.PerspectiveCamera(55,innerWidth/innerHeight,0.1,1400);
camera.position.set(8,5.2,36);
const cameraLook=new THREE.Vector3(0,2,-35);
const drawingSize=new THREE.Vector2();
camera.lookAt(cameraLook);
const hemisphere=new THREE.HemisphereLight(daylight.sky,daylight.ground,daylight.fill);
scene.add(hemisphere);
const sun=new THREE.DirectionalLight(daylight.sun,daylight.key);
sun.position.set(-70,58,-80); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:700});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias=0.025; sun.shadow.bias=-0.00015;
scene.add(sun,sun.target);
const atmosphere=createAtmosphere(scene);
const sunOffset=new THREE.Vector3(-70,58,-80);

const world=createWorld(scene);
const skidMarks=createSkidMarks(scene,world.sampleGround);
const rendering=createRendering(renderer,scene,camera,softwareRenderer);
// Only the nearest four real lamp fixtures illuminate the street. Reuse these
// lights as the camera travels instead of evaluating dozens of lights per pixel.
const districtLighting=createDistrictLighting(renderer,scene);
const streetLights=Array.from({length:4},()=>{const light=new THREE.PointLight(0xffc886,0,38,2);scene.add(light);return light;});
const headlights=Array.from({length:2},()=>{const light=new THREE.SpotLight(0xe0edff,0,65,.37,.55,1.4);scene.add(light,light.target);return light;});

const buildingBoxes=world.colliders.map(b=>new THREE.Box3(new THREE.Vector3(b.minX,b.minY??0,b.minZ),new THREE.Vector3(b.maxX,b.maxY??70,b.maxZ)));
const cameraBoxes=buildingBoxes.map(box=>box.clone().expandByScalar(.2));
const sound=createAudio();
const keys=new Set();
const state={ready:false,started:false,paused:false,mapOpen:false,health:100,stamina:100,money:1250,wanted:0,ammo:12,reserve:96,inCar:false,speed:0,location:'VESPUCCI BOULEVARD',time:'18:42',objectiveTitle:'Meet Mara at the Paloma',objective:'Talk to Mara under the Paloma awning.',objectiveDistance:0,weapon:'UNARMED',nearCar:false,fps:60,policeState:'clear',searchProgress:0,gear:'N',rpm:850,vehicleHealth:100,subtitle:'',subtitleSpeaker:''};
let photo,photoWasPaused=false,photoShadowState=[];
let ui,player,currentCar=null,mission=0,night=false,weapon=false,aiming=false,reloading=false,simulation,job,interaction=null,contactActor;
let dialogueQueue=[],dialogueUntil=0,damageFlash=0;
let workshopFraction=0, maraAtWorkshop=false, conversationUntil=0;
let cameraCue=null;
const doorHandleTarget=new THREE.Vector3();
let vehicleDayEnvironment=null,vehicleNightEnvironment=null,effectDayEnvironment=null;
let cameraRoll=0,playerCameraVisibility;
let yaw=0,pitch=0.07,jumpVelocity=0,lastShot=-100,lastCrime=-100,wantedSince=-100,elapsed=0,lookTimer=0,doorTimer=0,respawnTimer=0,reloadRemaining=0;
let lastFrame=performance.now(),frameCount=0,fpsTimer=0,uiTimer=0,miniTimer=0,mouseDown=false;
const aimRay=new THREE.Raycaster();
const handling=createWeaponHandling();
const advanceFrameSimulation=createShotFrameScheduler({getTime:()=>elapsed,advance:updateGame,handling});
let aimSolution=null,lastImpact=null,lastDryFire=-100,renderFrame=0;
let playerMoveSpeed=0;
let sprintExhausted=false;
let lampInspection=null;
const contactLookTarget=new THREE.Vector3(),playerLookTarget=new THREE.Vector3();
function nearbyFaceTarget(actor,other,target){
 if(!actor||!other||interaction||(currentCar&&actor!==contactActor))return null;
 const dx=other.mesh.position.x-actor.mesh.position.x,dz=other.mesh.position.z-actor.mesh.position.z;
 const distance=Math.hypot(dx,dz);
 const host=actor===contactActor;
 if(distance<.65||distance>(host?7:4))return null;
 if(!host&&dx*Math.sin(actor.mesh.rotation.y)+dz*Math.cos(actor.mesh.rotation.y)<distance*.3)return null;
 if(other.getLookPosition)return other.getLookPosition(target);
 target.copy(other.mesh.position);target.y+=1.6;return target;
}
const policeShotHistory=[];
const vehicles=[],pedestrians=[],effects=[],officers=[];
// Lazy factories run after asset initialization; the owner exists before any
// asynchronous load so teardown cannot leave later-created materials behind.
const effectMaterials=createEffectMaterialPool({
 flash:()=>new THREE.SpriteMaterial({map:flashTexture,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}),
 shell:()=>new THREE.MeshStandardMaterial({color:0xc29c54,metalness:.75,roughness:.38}),
 tracer:()=>new THREE.LineBasicMaterial({color:0xffe5b5,transparent:true,depthWrite:false}),
 particle:()=>new THREE.MeshBasicMaterial({transparent:true}),
});
const photoActorVisibility=createPhotoActorVisibility({pedestrians,vehicles});
// A single local depth map adds face/limb contact only in close daylight photos.
const photoShadowActors=()=>[player,contactActor,...pedestrians.map(p=>p.actor),...officers,...vehicles.map(car=>car.driver)].filter(Boolean);
const localSelfShadow=createPhotoCharacterShadow({renderer,camera,scene,sun,getActors:photoShadowActors});
const environmentLighting=createEnvironmentLighting({renderer,captureVehicleCube,createVehicleTarget:vehicleProbe.createTarget,apply:applyEnvironmentMaps});
const effectShaderWarmup=createEffectShaderWarmup({renderer,materials:effectMaterials,
 prepare:retainedMaterials=>warmKnownEffectVariants({renderer,camera,scene,retainedMaterials,
  sun,hemisphere,streetLights,headlights,dayEnvironment:effectDayEnvironment}),
 onError:error=>console.warn('Shot shader warmup failed; effects will prepare on first use.',error),
});
let lastEnvironmentBuild=0,environmentError=null;
function disposePhotoCharacterShadow(){
 localSelfShadow.dispose();photoActorVisibility.dispose();environmentLighting.dispose();effectShaderWarmup.dispose();effectMaterials.dispose();window.removeEventListener('pagehide',onPhotoPageHide);
}
function onPhotoPageHide(event){
 localSelfShadow.release('page-hidden');
 if(!event.persisted)disposePhotoCharacterShadow();
}
window.addEventListener('pagehide',onPhotoPageHide);
import.meta.hot?.dispose(disposePhotoCharacterShadow);

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
function addActorContactShadow(actor){
 // The articulated fallback has no measured outsole cache; retain its simple
 // contact instead of estimating a footprint from the ankle joint.
 if(!actor.getFootContactSurfaces?.())return addContactShadow(actor.mesh,1.2,1.2);
 actor.mesh.traverse(o=>{if(o.isMesh){o.castShadow=!softwareRenderer&&!o.material?.transparent;o.receiveShadow=true;}});
 actor.contactShadow=createCharacterContactShadow(actor,{groundHeightAt:world.heightAt});
 return actor.contactShadow.group;
}
const goal=new THREE.Vector3(4,0,-125);
const playerVelocity=new THREE.Vector3();
const tmp=new THREE.Vector3();
let waypoint=null,mapCursor=null;
const waypointColor=0xc799ff;
const mapCanvas=()=>document.querySelector('#minimap');
const clamp=THREE.MathUtils.clamp;
const damp=(a,b,k,dt)=>THREE.MathUtils.lerp(a,b,1-Math.exp(-k*dt));
const angleDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

ui=createUI({
 onStart:startGame,onPause:()=>pause(true),onResume:()=>pause(false),onRestart:fresh=>{restart(fresh);if(state.started)requestAnimationFrame(streamCharacterTextures);},
 onSound:enabled=>{sound.setEnabled(enabled);sound.start();},
 onQuality:q=>{if(q!=='high')localSelfShadow.release('shadows-disabled');graphicsQuality=q;renderer.setPixelRatio(gameplayPixelRatio());renderer.shadowMap.enabled=q==='high';renderer.shadowMap.needsUpdate=true;rendering.setQuality(q);},
 onTime:value=>setTime(value==='night'),onMap:open=>setMap(open),
 onPhotoMode:enterPhoto,onPhotoExit:exitPhoto,onPhotoChange:patch=>photo.change(patch),
 onPhotoCapture:()=>photo.capture(),onPhotoReset:()=>photo.reset(),
 onAim:down=>{if(!state.started||state.paused||state.mapOpen||photo.active||currentCar||interaction)return;aiming=Boolean(down&&weapon);},
 onMobile:(code,down,cancelled=false)=>{if(down){if(!keys.has(code)) action(code);keys.add(code);}else{keys.delete(code);if(cancelled&&code==='Mouse0')handling.cancel();}},
}, graphicsQuality);
ui.setReady(false);
photo=createPhotoMode({camera,renderer,rendering,canvas,bounds:world.bounds,ui});

function enterPhoto(){
 if(!state.ready||!state.started||interaction||photo.active)return;
 photoWasPaused=state.paused;keys.clear();mouseDown=false;aiming=false;handling.cancel();
 state.paused=true;setMap(false);if(document.pointerLockElement)document.exitPointerLock();
 photoShadowState=[];
 for(const group of [...vehicles.map(c=>c.model.mesh),player.mesh,...pedestrians.map(p=>p.actor.mesh),...officers.map(a=>a.mesh),contactActor.mesh])group.traverse(o=>{if(o.isMesh&&!o.material?.transparent&&o.name!=='contact-shadow'){photoShadowState.push([o,o.castShadow]);o.castShadow=true;}});
 renderer.shadowMap.needsUpdate=true;
 photoActorVisibility.enter();photo.enter();state.photoMode=true;
}
function exitPhoto(){
 if(!photo.active)return;
 localSelfShadow.release('photo-exit');
 photo.exit();
 // The viewport may have changed while photo mode owned the render resolution.
 if(renderer.getPixelRatio()!==gameplayPixelRatio()){renderer.setPixelRatio(gameplayPixelRatio());rendering.resize();}
 photoActorVisibility.exit();for(const [object,shadow] of photoShadowState)object.castShadow=shadow;photoShadowState=[];renderer.shadowMap.needsUpdate=true;state.photoMode=false;keys.clear();state.paused=photoWasPaused;ui.setPaused(state.paused);
}

function setTime(dark){
 night=dark;if(night)localSelfShadow.release('night'); atmosphere.setNight(night); rendering.setNight(night);world.setNight(night);streetLights.forEach(light=>light.intensity=night?380:0);headlights.forEach(light=>light.intensity=0);districtLighting.setLightCounts(night?4:0,0); state.time=night?'22:16':'18:42';
 sun.color.set(night?0x96baff:daylight.sun); sun.intensity=night?0.8:daylight.key;
 hemisphere.intensity=night?.8:daylight.fill; hemisphere.color.set(night?0x6c86b4:daylight.sky);
 hemisphere.groundColor.set(night?0x75624f:daylight.ground);
 scene.fog.color.set(night?0x101b2a:0xcdb6a7);renderer.toneMappingExposure=night?1:daylight.exposure;
 vehicles.forEach(c=>{
  c.model.setLights(night);
  c.model.mesh.traverse(o=>{const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)if(m?.isMeshStandardMaterial&&m.userData.dayEnvIntensity!==undefined){
    m.envMap=night?vehicleNightEnvironment:vehicleDayEnvironment;
    m.envMapRotation.copy(night?atmosphere.rotation:new THREE.Euler());
    m.envMapIntensity=m.userData.dayEnvIntensity*(night?.55:1);
   }});
 });renderer.shadowMap.needsUpdate=true;
}
function startGame(){if(!state.ready)return;requestAnimationFrame(streamCharacterTextures);state.started=true;state.paused=false;ui.setPaused(false);sound.start();ui.toast('LOS PACIFICOS',job.getState().savedAt?'Your story continues.':'Mara has a job for you. Follow the gold marker.');}
function pause(value){state.paused=value;keys.clear();mouseDown=false;aiming=false;handling.cancel();ui.setPaused(value);if(value&&document.pointerLockElement)document.exitPointerLock();}
function setMap(value){
 state.mapOpen=Boolean(value&&state.started);keys.clear();mouseDown=false;aiming=false;handling.cancel();
 mapCursor=null;ui.showMap(state.mapOpen);
 if(state.mapOpen){if(document.pointerLockElement)document.exitPointerLock();updateDestinations();drawMap(document.querySelector('#city-map'),true);}
}
function setWaypoint(point,message,selectionPoint=point){
 const pickup=job?.selectFreightPickup(selectionPoint);
 displayWaypoint(pickup?{x:pickup.x,z:pickup.z,freightPickup:pickup.id}:point,message);
}
function displayWaypoint(point,message){
 waypoint=point;state.waypoint=point;
 document.querySelector('#waypoint-status').textContent=message;
 document.querySelector('#clear-waypoint').disabled=!point;
 document.querySelector('#district-destinations')?.querySelector('[aria-pressed]')?.removeAttribute('aria-pressed');
 if(state.mapOpen)drawMap(document.querySelector('#city-map'),true);
}
function updateDestinations(){
 const list=document.querySelector('#district-destinations');
 if(!job)return;
 const missionState=job.getState(),choices=[];
 const add=(label,point)=>{if(point)choices.push({label,point});};
 if(missionState.nightShiftActive){
  const freight=job.getFreightManifest();
  if(freight?.recovering)add('Recover freight',missionState.target);
  else if(missionState.nightShiftPhase==='collect'){
   for(const point of SHIFT_STOPS)if(!freight?.orders.includes(point.id))add(point.label,point);
  }
  add('Auto Works dispatch',world.landmarks.garage);
  if(missionState.nightShiftCargo<95)add('Roadside straps',SHIFT_PULL_OFF);
 }else{
  if(missionState.mission<4)add('Last Light',missionState.radioActive?world.landmarks.contact:missionState.target);
  if((missionState.mission===0||missionState.mission===5)&&!missionState.radioActive&&!missionState.circuitActive){
   add('Pacific Circuit',CIRCUIT_START);
   if(missionState.radioPhase!=='finished')add('Vale FM',recorderDesk);
  }
  if(missionState.mission===5&&!missionState.circuitActive&&!missionState.radioActive){
   add('Night Shift freight',world.landmarks.garage);
   if(missionState.pierScreeningUnlocked)add('Pier drive-in',SCREENING_AUDIENCE);
   add('Replay Last Light',world.landmarks.contact);
  }
  if(missionState.radioActive)add('Recorder objective',missionState.target);
  if(missionState.lastLight?.phase==='fork')add('Sunline lane',missionState.secondaryTarget);
 }
 list.replaceChildren();
 for(const {label,point} of choices){
  const button=document.createElement('button');
  button.type='button';button.textContent=label;button.title='Mark '+label+' on your map';
  button.addEventListener('click',()=>{
   mapCursor=null;setWaypoint({x:point.x,z:point.z},'Waypoint set · '+label);
   button.setAttribute('aria-pressed','true');
  });
  if(waypoint&&waypoint.x===point.x&&waypoint.z===point.z)button.setAttribute('aria-pressed','true');
  list.append(button);
 }
 list.hidden=!list.childElementCount;
}
function pinStreet(point){
 const pickup=job?.freightPickupNear(point);
 if(pickup){
   mapCursor=null;setWaypoint(pickup,'Waypoint set · '+pickup.label);return;
 }
 const nearest=nearestMapRoad(world.roads,point);
 const {minX,maxX,minZ,maxZ}=world.bounds;
 if(nearest.distance>nearest.road.width/2+3||point.x<minX||point.x>maxX||point.z<minZ||point.z>maxZ){
   document.querySelector('#waypoint-status').textContent='Choose a street inside the district';return;
 }
 mapCursor=null;
 const pin={x:clamp(nearest.snap.x,minX,maxX),z:clamp(nearest.snap.z,minZ,maxZ)};
 setWaypoint(pin,'Waypoint set · '+world.locationAt(pin.x,pin.z),null);
}
const cityMap=document.querySelector('#city-map');
cityMap.addEventListener('click',event=>pinStreet(mapClickPosition(cityMap,event.clientX,event.clientY)));
cityMap.addEventListener('focus',()=>{if(cityMap.matches(':focus-visible')){mapCursor={...(waypoint||{x:player.mesh.position.x,z:player.mesh.position.z})};drawMap(cityMap,true);}});
cityMap.addEventListener('blur',()=>{mapCursor=null;if(state.mapOpen)drawMap(cityMap,true);});
cityMap.addEventListener('keydown',event=>{
 const offsets={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
 if(!offsets[event.key]&&event.key!=='Enter'&&event.key!==' ')return;
 event.preventDefault();event.stopPropagation();
 mapCursor??={...(waypoint||{x:player.mesh.position.x,z:player.mesh.position.z})};
 if(!offsets[event.key]){pinStreet(mapCursor);return;}
 const [dx,dz]=offsets[event.key],step=event.shiftKey?25:5;
 mapCursor.x=clamp(mapCursor.x+dx*step,world.bounds.minX,world.bounds.maxX);
 mapCursor.z=clamp(mapCursor.z+dz*step,world.bounds.minZ,world.bounds.maxZ);
 drawMap(cityMap,true);
});
document.querySelector('#clear-waypoint').addEventListener('click',()=>{setWaypoint(null,'Waypoint cleared');cityMap.focus();});
function placeAurora(checkpoint){
 const position=checkpoint||heroCar.home;
 heroCar.model.mesh.position.set(position.x,0,position.z);
 heroCar.heading=checkpoint?.heading??heroCar.homeHeading;
 heroCar.health=checkpoint?.health??100;
 heroCar.speed=0;heroCar.steer=0;heroCar.physics=null;
 heroCar.occupied=false;heroCar.stolen=false;heroCar.closeDoorAt=0;
 heroCar.model.mesh.rotation.set(0,heroCar.heading,0);
 heroCar.model.setDoor(false);heroCar.model.setDamage?.(heroCar.health);
 heroCar.model.update(0,0,0);
}
function placeMara(atWorkshop){
 maraAtWorkshop=atWorkshop;
 const point=atWorkshop?world.landmarks.garage:world.landmarks.contact;
 contactActor.mesh.position.set(point.x+(atWorkshop?3.4:0),0,point.z+(atWorkshop?3.4:0));
 groundActor(contactActor);contactActor.resetGrounding?.();
 contactActor.mesh.rotation.set(0,atWorkshop?-2.4:.38,0);
}
function placeAtCheckpoint(progress){
 const checkpoint=progress.jobCarCheckpoint;
 const home=progress.mission>=4?world.landmarks.safehouse:world.landmarks.start;
 heroCar.isJobCar=progress.mission<4;
 if(checkpoint){
  placeAurora(checkpoint);
  player.mesh.position.copy(anchor(heroCar,false));
  yaw=heroCar.heading+Math.PI;
 }else{
  player.mesh.position.set(home?.x??-16.3,0,home?.z??20.1);
  yaw=progress.mission>=4?-Math.PI/2:-.64;
 }
 groundActor(player);player.resetGrounding?.();player.mesh.rotation.set(0,yaw+Math.PI,0);
 setActorShadow(player,true);placeMara(progress.mission===3);
 pitch=.07;jumpVelocity=0;
}
function restart(fresh=false){
 lampInspection=null;
 skidMarks.clear();
 if(!state.ready||!player)return;
 // Restore photo-owned visibility before reset reclassifies drivers and corpses.
 if(photo.active)exitPhoto();
 localSelfShadow.release('restart');
 if(fresh)job.fresh();else job.retry();
 displayWaypoint(null,'Choose a street');
 simulation?.reset();interaction=null;currentCar=null;state.started=true;
 Object.assign(state,{health:100,stamina:100,wanted:0,ammo:12,reserve:96,inCar:false,speed:0,nearCar:false,policeState:'clear',searchProgress:0,subtitle:'',subtitleSpeaker:''});
 weapon=false;aiming=false;mouseDown=false;reloading=false;reloadRemaining=0;respawnTimer=0;doorTimer=0;lastShot=-100;lastCrime=-100;wantedSince=-100;lookTimer=elapsed;dialogueQueue=[];dialogueUntil=0;
 state.weapon='UNARMED';playerMoveSpeed=0;sprintExhausted=false;handling.reset();sound.cancelReload?.();lastImpact=null;aimSolution=null;policeShotHistory.length=0;
 player.setVisible(true);player.setWeapon(false);playerVelocity.set(0,0,0);
 for(let i=pedestrians.length-1;i>=0;i--)if(pedestrians[i].isDriver)pedestrians.splice(i,1);
 for(const c of vehicles){c.model.mesh.position.copy(c.home);c.heading=c.homeHeading;c.model.mesh.rotation.set(0,c.heading,0);c.speed=0;c.steer=0;c.health=100;c.occupied=false;c.stolen=false;c.traffic=c.homeTraffic;c.routeIndex=c.homeRouteIndex;c.closeDoorAt=0;c.physics=null;c.model.setDoor(false);c.model.setDamage?.(100);c.model.update(1,0,0);c.driverActive=!!c.driver;c.driverDownUntil=0;c.driverTrafficBeforeHit=false;}
 for(const p of pedestrians){p.actor.mesh.position.copy(p.home);groundActor(p.actor);p.actor.resetGrounding?.();setActorShadow(p.actor,true);p.direction=p.homeDirection;p.down=false;p.recoverAt=0;p.fleeUntil=0;p.actor.mesh.rotation.set(0,p.direction<0?Math.PI:0,0);p.actor.update(1,{speed:0,dead:false});}
 for(const e of effects){scene.remove(e.mesh);if(!e.mesh.isSprite)e.mesh.geometry?.dispose();effectMaterials.release(e.mesh.material);}effects.length=0;
 conversationUntil=0;placeAtCheckpoint(job.getState());
 marker.visible=false;cameraLook.copy(player.mesh.position).add(new THREE.Vector3(0,1.2,-3));camera.position.copy(player.mesh.position).add(new THREE.Vector3(0,3.6,5.8));sound.start();
 pause(false);setMap(false);ui.toast(fresh?'A FRESH START':'CHECKPOINT RESTORED',fresh?'Mara has a job waiting for you.':'Your mission checkpoint is ready.');
}

function addCar(x,z,heading,color,type='sport',traffic=false,police=false){
 const model=createCar({color,type,police});addContactShadow(model.mesh,3.4,5.6);model.mesh.position.set(x,0,z);model.mesh.rotation.y=heading;scene.add(model.mesh);
 const car={model,heading,speed:0,steer:0,traffic,police,occupied:false,health:100,home:new THREE.Vector3(x,0,z),homeHeading:heading,homeTraffic:traffic,homeRouteIndex:0,routeIndex:0,stolen:false,closeDoorAt:0,driverDownUntil:0,driverTrafficBeforeHit:false};vehicles.push(car);return car;
}
const charactersReady = loadCharacterAssets();
await loadVehicleAssets();
const heroCar=addCar(4.8,18,Math.PI,0x315c61);heroCar.isJobCar=true;
addCar(-8,-26,0,0xa9b5a9,'sedan');
addCar(8,-56,Math.PI,0x983b2f,'sport');
const palomaSedan=addCar(-8,CIRCUIT_START.z,0,0xd6d5c9,'sedan');
palomaSedan.circuitLoaner=true;
addCar(75,-43,0,0x466c72,'sport');
const eastAvenueTraffic = addCar(84,36,Math.PI,0x344050,'sedan',true);
eastAvenueTraffic.routeIndex=eastAvenueTraffic.homeRouteIndex=2;
const boulevardTraffic=addCar(-4,-45,0,0x566c61,'sedan',true);
const downtownTraffic=addCar(76,20,0,0xe2d7bd,'sedan',true);
downtownTraffic.innerLoop=true;
downtownTraffic.routeIndex=downtownTraffic.homeRouteIndex=2;
const police=addCar(-8.25,-76,0,0x14202b,'sedan',false,true);
addCar(-8,-147,0,0x5a5c58,'sedan');
addCar(88,117,Math.PI,0xaaa08b,'sedan');

const marker=new THREE.Group();
const markerMat=new THREE.MeshBasicMaterial({color:0xffc56d,transparent:true,opacity:.75,depthWrite:false});
const markerRing=new THREE.Mesh(new THREE.TorusGeometry(2.3,.055,8,64),markerMat);markerRing.rotation.x=Math.PI/2;markerRing.position.y=.08;marker.add(markerRing);
const markerBeam=new THREE.Mesh(new THREE.CylinderGeometry(.04,.04,2.6,8),new THREE.MeshBasicMaterial({color:0xffcb75,transparent:true,opacity:.28,depthWrite:false}));markerBeam.position.y=1.3;marker.add(markerBeam);
const markerDiamond=new THREE.Mesh(new THREE.OctahedronGeometry(.45),markerMat);markerDiamond.position.y=2.7;marker.add(markerDiamond);
marker.position.copy(goal);
const radioMarker=new THREE.Mesh(markerDiamond.geometry,new THREE.MeshBasicMaterial({color:0x84dfd1,transparent:true,opacity:.82,depthWrite:false}));
radioMarker.scale.setScalar(.7);radioMarker.visible=false;
const circuitGate=createCircuitGate();
// A single painted chevron points along the outgoing street or driveway.
const chevronShape=new THREE.Shape();
chevronShape.moveTo(-1.7,.8);chevronShape.lineTo(0,-1.3);chevronShape.lineTo(1.7,.8);
chevronShape.lineTo(1.7,1.7);chevronShape.lineTo(0,-.35);chevronShape.lineTo(-1.7,1.7);chevronShape.closePath();
const turnCue=new THREE.Mesh(new THREE.ShapeGeometry(chevronShape).rotateX(-Math.PI/2),
 new THREE.MeshBasicMaterial({color:0xffc56d,transparent:true,opacity:.88,depthWrite:false}));
turnCue.visible=false;
const waypointMarker=new THREE.Mesh(new THREE.OctahedronGeometry(.65),
 new THREE.MeshBasicMaterial({color:waypointColor,wireframe:true}));
waypointMarker.visible=false;


const navigationMarkers = new THREE.Group();
const forkCues=createLastLightForkCues(turnCue,(x,z)=>world.heightAt(x,z));
for(const cue of forkCues)cue.visible=false;
navigationMarkers.add(marker,radioMarker,circuitGate,turnCue,waypointMarker,...forkCues);
scene.add(navigationMarkers);

function dialogue(speaker,lines,{replace=false}={}){
 if(replace){dialogueQueue.length=0;dialogueUntil=elapsed;state.subtitle='';state.subtitleSpeaker='';}
 dialogueQueue.push(...lines.map(text=>({speaker,text})));
}
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
function setActorShadow(actor,visible){const shadow=actor.mesh.getObjectByName('contact-shadow');if(shadow){shadow.visible=visible;if(visible&&!actor.contactShadow){const p=actor.mesh.position;shadow.position.y=world.heightAt(p.x,p.z)-p.y+.003;}}}
function watchingFilm(){return cameraCue==='screening'&&conversationUntil>elapsed;}
function contextAction(){
 if(interaction||job?.inspectionRemaining>0)return;
 const p=player.mesh.position,land=world.landmarks||{};
 const near=(point,r=3.3)=>point&&Math.hypot(p.x-point.x,p.z-point.z)<r;
 const ms=job.getState();
 const atMara=near(contactActor.mesh.position,3.75);
 if(ms.mission===0&&!ms.radioActive&&!ms.circuitActive&&atMara&&(!currentCar||currentCar===heroCar&&Math.abs(currentCar.speed)<.7))
  return {kind:'contact',title:'LAST LIGHT AT THE PALOMA',name:'Talk to Mara'};
 if((ms.mission===2||ms.mission===3)&&!currentCar&&atMara)
  return {kind:'recover',title:'MARA · ROADSIDE ASSISTANCE',name:'Recover the Aurora to the last checkpoint'};
 const inspection=job.inspectAction?.(p,currentCar,heroCar);
 if(inspection)return inspection;
 const shiftAction=job.nightShiftAction?.(p,currentCar);
 if(shiftAction)return shiftAction;
 const screening=job.screeningAction?.(p,currentCar);
 if(screening)return watchingFilm()?null:screening;
 const radioAction=job.radioAction(p,currentCar);if(radioAction)return radioAction;
 if(ms.mission===5&&!ms.radioActive&&!ms.circuitActive&&!ms.nightShiftActive&&!currentCar&&near(land.contact,2.6))
  return {kind:'replay',title:'LAST LIGHT AT THE PALOMA',name:'Replay the delivery · practice run'};
 if(!ms.nightShiftActive&&!ms.radioActive&&currentCar&&(ms.mission===5||ms.mission===0&&currentCar.circuitLoaner)&&!ms.circuitActive&&near(CIRCUIT_START,8)&&Math.abs(currentCar.speed)<1.5&&currentCar.health>0)return{kind:'circuit',title:'PACIFIC CIRCUIT',name:ms.circuitBest?'Race again · beat your best':'Race the Pacific Circuit · up to $750'};
 if(!ms.radioActive&&!ms.circuitActive&&!ms.nightShiftActive&&!currentCar&&atMara&&ms.mission!==0){
  if(ms.mission===1&&cameraCue==='briefing'&&elapsed<conversationUntil)return null;
  if(ms.mission<4)return{kind:'contact',title:'LAST LIGHT AT THE PALOMA',name:'Ask Mara about the delivery'};
  return{kind:'contact',title:'MARA · SUPPLIES',name:state.reserve<192?'Pistol ammunition · $150':'Talk to Mara'};
 }
 if(!currentCar&&near(land.safehouse,4)&&ms.mission>=4)return{kind:'safehouse',title:'THE PALOMA',name:'Rest & save your progress'};
 if(currentCar&&near(land.garage,6)&&Math.abs(currentCar.speed)<1.5){
  if(ms.mission===3&&currentCar.isJobCar&&state.wanted===0&&state.policeState==='clear')return{kind:'garage',title:'MARA’S WORKSHOP',name:'Hand over the Aurora · $'+(ms.deliveryQuote?.total??1500).toLocaleString('en-US')};
 }
 const atLift=Math.abs(p.x-32)<4.8&&Math.min(Math.abs(p.z+116),Math.abs(p.z+136))<4.5;
 if(currentCar&&ms.mission>=4&&atLift&&Math.abs(currentCar.speed)<1.5&&currentCar.health<100)
  return{kind:'garage',title:'AUTO WORKS · SERVICE LIFT',name:ms.money>=100?'Repair vehicle · $100':'Repair costs $100'};
 if(currentCar)return{kind:'vehicle',title:currentCar.model.type==='sport'?'ASTRA AURORA':currentCar.police?'MERIDIAN PATROL':'ASTRA MERIDIAN',name:Math.abs(currentCar.speed)<3?'Exit vehicle':'Slow down to exit'};
 const car=nearestCar();if(car)return{kind:'vehicle',title:car.isJobCar?'MARA’S AURORA':'VEHICLE',name:car.circuitLoaner&&(ms.mission===0||ms.mission===5)?'Enter Pacific Circuit courtesy car':car.driverActive?'Take occupied vehicle':'Enter vehicle'};
 return null;
}
function interact(){
 const action=contextAction();if(!action)return;
 if(action.kind==='vehicle'){enterExit();return;}
 const result=job.interact(action.kind,{position:player.mesh.position,vehicle:currentCar,jobVehicle:heroCar,wanted:state.wanted,policeState:state.policeState,time:elapsed,reserve:state.reserve});
 if(result.shiftInteraction&&action.kind==='shift-start'&&waypoint)job.selectFreightPickup(waypoint);
 if(result.inspecting){
  lampInspection=createLampInspection(heroCar.model,player.mesh.position);
  playerVelocity.set(0,0,0);weapon=false;aiming=false;mouseDown=false;player.setWeapon(false);
  handling.cancel();reloading=false;reloadRemaining=0;sound.cancelReload?.();state.weapon='UNARMED';
 }
 if(result.accepted||result.replayAccepted){
  if(result.replayAccepted){placeAurora(null);placeMara(false);heroCar.isJobCar=true;}
  contactActor.performGesture?.('briefing');cameraCue='briefing';conversationUntil=elapsed+4.4;
  if(currentCar===heroCar)job.onVehicleTaken(heroCar);
 }
 if(result.replaceJobCar)placeAurora(job.getState().jobCarCheckpoint);
 if(result.ammo)state.reserve=Math.min(192,state.reserve+result.ammo);
 if(result.repair){currentCar.health=100;currentCar.model.setDamage?.(100);}
 if(result.rest){state.health=100;state.stamina=100;state.reserve=Math.max(96,state.reserve);sound.notify();}
 if(result.delivered){currentCar.isJobCar=false;state.health=Math.max(75,state.health);contactActor.performGesture?.('handoff',job.getState().lastLight?.cleanEligible);cameraCue='handoff';conversationUntil=elapsed+3.3;sound.handoff?.();}
 if(result.screeningStarted){
  world.restartPierScreening();
  if(!night)ui.selectTime('night');
  sound.startProjection(PIER_SCREEN_CENTER);
  cameraCue='screening';conversationUntil=elapsed+18;
 }
 if(!result.screeningStarted)sound.interact?.();
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
   if(c===heroCar){job.onVehicleTaken(c);}
   else if(!c.stolen && !c.circuitLoaner){c.stolen=true;crime(1,'theft');}
  }
  const progress=clamp((it.elapsed-it.approachDuration)/1.7,0,1);
  player.mesh.position.lerpVectors(it.door,it.seat,smooth(clamp((progress-.15)/.75,0,1)));
  const forward=new THREE.Vector3(0,0,1).applyQuaternion(player.mesh.quaternion),heading=Math.atan2(forward.x,forward.z);
  orientDriver(player,c,THREE.MathUtils.smoothstep(progress,.22,1),heading+angleDiff(heading,c.heading)*(1-Math.exp(-10*dt)));
  player.update(dt,{speed:0,interactionPhase:'enter',doorHandleTarget:c.model.getDoorHandleWorld?.(doorHandleTarget),interactionProgress:progress});
  if(c.driverActive&&c.driver){
   const eviction=clamp(progress/.45,0,1),exitPoint=it.door.clone().add(new THREE.Vector3(Math.cos(c.heading)*-.65,0,-Math.sin(c.heading)*-.65));exitPoint.y=world.heightAt(exitPoint.x,exitPoint.z);c.driver.mesh.position.lerpVectors(it.seat,exitPoint,eviction);orientDriver(c.driver,c,1-THREE.MathUtils.smoothstep(eviction,0,.78));
   c.driver.update(dt,{speed:0,interactionPhase:'exit',doorHandleTarget:c.model.getDoorHandleWorld?.(doorHandleTarget),interactionProgress:eviction,dead:c.driverDownUntil>elapsed});
   if(eviction===1){c.driverActive=false;const victim={actor:c.driver,home:c.driver.mesh.position.clone(),direction:1,homeDirection:1,down:c.driverDownUntil>elapsed,recoverAt:c.driverDownUntil||0,fleeUntil:elapsed+9,fleeFrom:c.model.mesh.position.clone(),isDriver:true};pedestrians.push(victim);c.driverDownUntil=0;c.driverTrafficBeforeHit=false;setActorShadow(c.driver,true);}
  }
 }else{
  player.mesh.position.lerpVectors(it.seat,it.door,smooth(clamp(t/.8,0,1)));orientDriver(player,c,1-THREE.MathUtils.smoothstep(clamp(t/.8,0,1),0,.78));
  player.update(dt,{speed:0,interactionPhase:'exit',doorHandleTarget:c.model.getDoorHandleWorld?.(doorHandleTarget),interactionProgress:clamp(t/.8,0,1)});
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
 if(code==='KeyF'&&currentCar)enterExit();
 else if(code==='KeyE'||code==='KeyF')interact();
 if(interaction)return;
 if(code==='Digit1'&&!currentCar){weapon=!weapon;player.setWeapon(weapon);state.weapon=weapon?'9MM PISTOL':'UNARMED';if(!weapon){aiming=false;handling.cancel();reloading=false;reloadRemaining=0;sound.cancelReload?.();}}
 if(code==='KeyR')reload();
 if(code==='KeyH'&&currentCar){sound.horn();simulation?.soundHorn?.(currentCar,elapsed);}
 if(code==='Space'&&!currentCar&&player.mesh.position.y-world.heightAt(player.mesh.position.x,player.mesh.position.z)<.01)jumpVelocity=5;
 if((code==='Shoot'||code==='Mouse0')&&!currentCar){if(!weapon){weapon=true;player.setWeapon(true);state.weapon='9MM PISTOL';}shoot();}
}
function reload(){
 if(!weapon||currentCar||reloading||interaction||state.ammo===PISTOL.capacity||state.reserve===0)return;handling.cancel();reloading=true;reloadRemaining=PISTOL.reloadTime;sound.reload({duration:PISTOL.reloadTime});
}
function spawnEffect(position,color=0xffca76,count=8){
 for(let i=0;i<count;i++){const material=effectMaterials.acquire('particle',{color});if(!material)return;const mesh=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.035,4,4),material);mesh.position.copy(position);scene.add(mesh);effects.push({mesh,vel:new THREE.Vector3((Math.random()-.5)*6,Math.random()*4,(Math.random()-.5)*6),life:.5,max:.5});}
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
  const material=effectMaterials.acquire('tracer',{opacity:.36});
  if(material){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([start,end]),material);scene.add(line);effects.push({mesh:line,life:.045,max:.045,opacity:.36,born:renderFrame});}
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
 const material=effectMaterials.acquire('flash');if(!material)return;
 const flash=new THREE.Sprite(material);flash.position.copy(origin).addScaledVector(direction,.035);flash.scale.set(.14,.10,1);scene.add(flash);effects.push({mesh:flash,life:.04,max:.04,born:renderFrame});
 const shell=new THREE.Mesh(new THREE.CylinderGeometry(.007,.007,.024,6),effectMaterials.acquire('shell'));shell.position.copy(origin).addScaledVector(direction,-.10);shell.rotation.z=Math.PI/2;scene.add(shell);
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
const controller = createGamepadInput();
let pad = controller.poll([]);
let controllerFocused = true;
function controllerAction(button) {
 if(ui.handleControllerMenu?.(button))return;
 if (!state.started && !state.paused && (button === 'jump' || button === 'menu')) { ui.start(); return; }
 if (button === 'menu') action('Escape');
 else if (button === 'map') action('KeyM');
 else if (button === 'context') action('KeyE');
 else if (button === 'back' && currentCar) action('KeyF');
 else if (button === 'jump' && !currentCar) action('Space');
}
function pollController(dt) {
 let devices;
 if (controllerFocused && !document.hidden) {
  try { devices = navigator.getGamepads?.(); } catch { /* Gamepad access may be disabled by the host. */ }
 }
 pad = controller.poll(devices,controllerAction,ui.setInputMode);
 if (!state.started || state.paused || state.mapOpen || interaction || photo.active) return;
 if (pad.lookX || pad.lookY) {
  conversationUntil=0;
  yaw -= pad.lookX * dt * 2.7;
  pitch = clamp(pitch + pad.lookY * dt * 1.9, -1.05, 1.1);
  lookTimer = elapsed;
 }
}
function updatePlayer(dt){
 if(interaction){skidMarks.interrupt();playerMoveSpeed=0;updateInteraction(dt);return null;}
 if(currentCar){playerMoveSpeed=0;updateDriving(dt);return null;}
 const moveX=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0) + pad.moveX;
 const moveZ=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0) - pad.moveY;
 const raised=weapon&&(aiming||handling.queued||elapsed-lastShot<.35);
 if(state.stamina<=2)sprintExhausted=true;
 else if(state.stamina>=18)sprintExhausted=false;
 const sprint=(pad.sprint||keys.has('ShiftLeft')||keys.has('ShiftRight'))&&!sprintExhausted&&(moveZ!==0||moveX!==0)&&!raised&&!reloading;
 const speed=aiming?1.5:sprint?SPRINT_SPEED:WALK_SPEED;
 if(sprint)state.stamina=Math.max(0,state.stamina-dt*10);else state.stamina=Math.min(100,state.stamina+dt*9);
 const move=new THREE.Vector3(moveX,0,-moveZ).clampLength(0,1).applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw);
 move.multiplyScalar(speed);
 if(weapon||aiming)playerVelocity.lerp(move,1-Math.exp(-12*dt));
 else advanceFootVelocity(playerVelocity,move,dt);
 const pos=player.mesh.position,previous=pos.clone();
 moveBody(pos,playerVelocity.x*dt,0,.35);if(hitsVehicle(pos.x,pos.z))pos.x=previous.x;
 moveBody(pos,0,playerVelocity.z*dt,.35);if(hitsVehicle(pos.x,pos.z))pos.z=previous.z;
 if(watchingFilm()&&!moveX&&!moveZ&&!raised){
  const facing=Math.atan2(PIER_SCREEN_CENTER.x-pos.x,PIER_SCREEN_CENTER.z-pos.z);
  player.mesh.rotation.y+=angleDiff(player.mesh.rotation.y,facing)*(1-Math.exp(-4*dt));
 }else if(playerVelocity.length()>.15||raised){
  const target=raised?yaw+Math.PI:Math.atan2(playerVelocity.x,playerVelocity.z);
  const wantedTurn=angleDiff(player.mesh.rotation.y,target)*Math.min(1,dt*11);
  // Let the feet support a raised turn while camera and reticle intent stay free.
  const turnLimit=raised?THREE.MathUtils.degToRad(360)*dt:Infinity;
  player.mesh.rotation.y+=clamp(wantedTurn,-turnLimit,turnLimit);
 }
 const support=advanceGroundedPosition(pos,previous,jumpVelocity,dt,world.heightAt);jumpVelocity=support.verticalVelocity;
 playerMoveSpeed=Math.hypot(pos.x-previous.x,pos.z-previous.z)/Math.max(dt,.001);
 setActorShadow(player,support.height<.3);state.nearCar=!!nearestCar();state.speed=0;state.gear='N';state.rpm=0;
 // Resolve the camera after movement, then give the pose that same view.
 // Advancing the old pose here made rapid aim and each recoil event one step late.
 return {speed:playerMoveSpeed,armed:weapon,aiming,shooting:handling.queued||elapsed-lastShot<.32,shotId:handling.shots,jumping:support.height>.01,verticalVelocity:jumpVelocity,reloading,reloadProgress:1-reloadRemaining/PISTOL.reloadTime};
}
const drivingGround = {};
function updateDriving(dt){
 const c=currentCar;
 const handbrake=!!state.circuitCountdown||pad.handbrake||keys.has('Space');
 const telemetry=updateVehiclePhysics(c,dt,{
  throttle:state.circuitCountdown?0:(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0)+pad.throttle,
  steering:(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-pad.moveX,
  surface:world.sampleGround(c.model.mesh.position.x,c.model.mesh.position.z,drivingGround).kind,
  handbrake,moveBody,vehicles,carsOverlap,
  onImpact:({speed,other,position})=>{
   c.health=Math.max(0,c.health-speed*1.4);state.health=Math.max(0,state.health-Math.max(0,speed-8)*.3);
   if(other){
    other.health=Math.max(0,other.health-speed);
    if(speed>=6)crime(1,'collision');
   }
   const intensity=clamp(speed/12,.2,1.5);
   sound.crash(intensity);
   spawnEffect(position.clone().add(new THREE.Vector3(0,.5,0)),0xc1b5a0,Math.ceil(5*intensity));
   damageFlash=.12*Math.min(1,intensity);
  }
 });
 skidMarks.update(c,telemetry.slip,handbrake);
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
  const material=effectMaterials.acquire('tracer',{opacity:.3});
  if(material){const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin.clone().addScaledVector(direction,Math.min(.5,distance*.25)),origin.clone().addScaledVector(direction,Math.min(distance,6))]),material);scene.add(line);effects.push({mesh:line,life:.045,max:.045,opacity:.3,born:renderFrame});}
 }
 const flashMaterial=effectMaterials.acquire('flash');
 if(flashMaterial){const flash=new THREE.Sprite(flashMaterial);flash.position.copy(origin);flash.scale.set(.12,.09,1);scene.add(flash);effects.push({mesh:flash,life:.04,max:.04,born:renderFrame});}
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
 const base=currentCar?currentCar.model.mesh.position:player.mesh.position;
 const roadPace=currentCar?clamp(Math.abs(currentCar.speed)/34,0,1):0;
 const speedBlend=roadPace*roadPace*(3-2*roadPace);
 let speakerWeight=0;
 if(conversationUntil>elapsed){
  const moving=Math.abs(currentCar?.speed||0)>1.5||pad.moveX||pad.moveY||pad.throttle||
   keys.has('KeyW')||keys.has('KeyA')||keys.has('KeyS')||keys.has('KeyD')||
   keys.has('ArrowUp')||keys.has('ArrowDown')||keys.has('ArrowLeft')||keys.has('ArrowRight');
  if(moving||aiming||interaction||state.paused||state.mapOpen)conversationUntil=0;
  else{
   // Follow Mara's gesture to the car she is describing across the street.
   const briefing=cameraCue==='briefing'&&!currentCar;
   const remaining=conversationUntil-elapsed;
   if(briefing)speakerWeight=THREE.MathUtils.smoothstep(remaining,2.75,3.15);
   const showCar=briefing&&remaining<3.05;
   const p = watchingFilm() ? PIER_SCREEN_CENTER : showCar ? heroCar.model.mesh.position : contactActor.mesh.position;
   const heading=Math.atan2(base.x-p.x,base.z-p.z);
   yaw+=angleDiff(yaw,heading)*(1-Math.exp(-3.5*dt));
   const viewPitch = watchingFilm() ? (currentCar ? -.24 : -.19) : showCar ? .055 : .045;
   pitch=damp(pitch,viewPitch,3,dt);lookTimer=elapsed;
  }
 }
 const follow=currentCar?clamp((elapsed-lookTimer-1.65)/.85,0,1):0;
 if(currentCar&&follow){
  const cornerLead=clamp(currentCar.steer*currentCar.speed*.023,-.28,.28);
  const heading=currentCar.heading+Math.PI+cornerLead;
  yaw+=angleDiff(yaw,heading)*(1-Math.exp(-(3.3+roadPace*1.4)*follow*dt));
 }
 const ads=Boolean(aiming&&weapon&&!currentCar);
 const sprintView=currentCar||weapon||aiming||interaction?0:sprintFraming(playerMoveSpeed);
 const dist=currentCar?6.8+1.6*speedBlend:ads?2.4:4.2+.45*sprintView;
 const shoulder = currentCar ? 0 : watchingFilm() ? .98 : ads ? .55 : .45;
 const pivot=base.clone().add(new THREE.Vector3(0,currentCar?1.25+.22*speedBlend:1.48,0));
 const vertical=clamp(pitch-handling.recoilPitch,-1.05,1.1),horizontal=yaw+handling.recoilYaw;
 const forward=new THREE.Vector3(-Math.sin(horizontal)*Math.cos(vertical),-Math.sin(vertical),-Math.cos(horizontal)*Math.cos(vertical));
 const right=new THREE.Vector3(Math.cos(horizontal),0,-Math.sin(horizontal));
 const desired=pivot.clone().addScaledVector(forward,-dist).addScaledVector(right,shoulder);
 let face;
 if(speakerWeight>0){
  face=contactActor.mesh.position.clone();face.y+=1.47;
  const towardPlayer=new THREE.Vector3(base.x-face.x,0,base.z-face.z);
  if(towardPlayer.lengthSq()<.001)towardPlayer.set(Math.sin(contactActor.mesh.rotation.y),0,Math.cos(contactActor.mesh.rotation.y));
  towardPlayer.normalize();
  const portrait=face.clone().addScaledVector(towardPlayer,2.4);
  portrait.x+=towardPlayer.z*.95;portrait.z-=towardPlayer.x*.95;portrait.y+=.14;
  desired.lerp(portrait,speakerWeight);
 }
 if(currentCar)desired.y+=1.0+.22*speedBlend;desired.y=Math.max(.35,desired.y);
 camera.position.lerp(clipCameraBoom(pivot,desired),1-Math.exp(-(currentCar?10+roadPace*9:ads?16:9)*dt));
 camera.position.copy(clipCameraBoom(pivot,camera.position));camera.position.y=Math.max(.35,camera.position.y);
 // Use one forward direction for view, reticle and shot convergence. Orbit
 // pitch is an actual angle, rather than moving a camera that looks at a fixed Y.
 cameraLook.copy(camera.position).addScaledVector(forward,30);
 if(face){
  const towardFace=face.sub(camera.position).normalize();
  cameraLook.lerp(towardFace.multiplyScalar(30).add(camera.position),speakerWeight);
 }
 if(currentCar)cameraLook.y-=2.8*Math.cos(vertical);
 camera.lookAt(cameraLook);
 const lean=currentCar?clamp(-currentCar.steer*Math.abs(currentCar.speed)*.004,-.035,.035):0;
 cameraRoll=damp(cameraRoll,lean,4,dt);camera.rotateZ(cameraRoll);
 camera.fov=damp(camera.fov,currentCar?55+12*speedBlend:ads?46:55+3*sprintView-12*speakerWeight,currentCar?3.5:10,dt);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
}
function updateNightLights(){
 if(!night)return;
 const lamps=[...world.lampPositions].sort((a,b)=>a.distanceToSquared(camera.position)-b.distanceToSquared(camera.position));
 streetLights.forEach((light,i)=>light.position.copy(lamps[i]));
 const car=currentCar||vehicles.reduce((nearest,c)=>c.model.mesh.position.distanceToSquared(camera.position)<nearest.model.mesh.position.distanceToSquared(camera.position)?c:nearest,vehicles[0]);
 const headlightsOn=car.model.mesh.position.distanceTo(camera.position)<45;
 districtLighting.setLightCounts(4,headlightsOn?2:0);
 headlights.forEach((light,i)=>{
  light.intensity=headlightsOn?170:0;
  const forward=new THREE.Vector3(Math.sin(car.heading),0,Math.cos(car.heading));
  const right=new THREE.Vector3(Math.cos(car.heading),0,-Math.sin(car.heading));
  light.position.copy(car.model.mesh.position).addScaledVector(forward,1.95).addScaledVector(right,i===0?-.66:.66);light.position.y=.68;
  light.target.position.copy(light.position).addScaledVector(forward,25);light.target.position.y=.05;
 });
}
function moveInspectionBody(pos,dx,dz){
 const x=pos.x,z=pos.z;
 moveBody(pos,dx,0,.35);if(hitsVehicle(pos.x,pos.z))pos.x=x;
 moveBody(pos,0,dz,.35);if(hitsVehicle(pos.x,pos.z))pos.z=z;
}
function updateGame(dt){
 const active=state.started&&!state.paused&&!state.mapOpen;
 const simDt=state.paused||state.mapOpen?0:dt;
 handling.update(simDt);elapsed+=simDt;doorTimer=Math.max(0,doorTimer-simDt);damageFlash=Math.max(0,damageFlash-simDt);
 markerDiamond.rotation.y+=simDt*.6;markerDiamond.position.y=2.7+Math.sin(elapsed*2)*.15;
 if(active){
  if(reloading){reloadRemaining=Math.max(0,reloadRemaining-dt);if(reloadRemaining===0){const count=Math.min(PISTOL.capacity-state.ammo,state.reserve);state.ammo+=count;state.reserve-=count;reloading=false;}}
  const playerPose=updatePlayer(dt);
  let inspectionReady=true,interruptInspection=false;
  if(lampInspection){
   interruptInspection=!playerPose||playerMoveSpeed>.03||playerPose.jumping||weapon||state.health<=0;
   if(!interruptInspection){
    const step=lampInspection.update(dt,player.mesh,moveInspectionBody,world.heightAt);
    inspectionReady=step.ready;interruptInspection=step.blocked;
    playerPose.speed=playerMoveSpeed=step.speed;
    if(step.ready){
     playerPose.inspectionTarget=step.target;
     playerPose.inspectionProgress=1-job.inspectionRemaining/1.4;
    }
   }
  }
  updateCamera(dt);
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
   const lookTarget=watchingFilm()?PIER_SCREEN_CENTER:state.subtitleSpeaker==='MARA'&&playerMoveSpeed<.2&&!weapon
    ?nearbyFaceTarget(player,contactActor,playerLookTarget):null;
   player.update(dt,{...playerPose,aimYaw,aimPitch:Math.asin(clamp(aimDirection.y,-1,1)),aimTarget,lookTarget});
   const shotSpread=handling.spread(aiming,playerMoveSpeed);
   if(!reloading&&weapon&&state.health>0&&handling.consume(elapsed,player.getAimState().ready)){
    // Trace the solved pre-recoil barrel, then apply this discrete shot to the
    // visible hands and pistol without advancing gait/contact clocks again.
    fireShot(shotSpread,geometry||shotGeometry());player.applyShot(handling.shots);
   }
  }
  Object.assign(state,simulation.update(dt,{playerPosition:player.mesh.position,currentCar:interaction?.car||currentCar,time:elapsed}));
  const previousShutter=workshopFraction;
  workshopFraction=world.updateWorkshop?.(dt,currentCar?.model.mesh.position,player.mesh.position)??0;
  if(previousShutter===0&&workshopFraction>0)sound.shutter?.(world.landmarks.garage);
  const progress=job.update({dt,inspectionReady,interruptInspection,position:player.mesh.position,wanted:state.wanted,policeState:state.policeState,vehicle:currentCar,jobVehicle:heroCar,slip:state.slip});
  if(lampInspection&&!job.inspectionRemaining)lampInspection=null;
  if(progress.replaceJobCar){
   if(currentCar===heroCar||interaction?.car===heroCar){
    skidMarks.interrupt();currentCar=null;interaction=null;state.inCar=false;
    player.mesh.rotation.set(0,heroCar.heading,0);player.setWeapon(false);
    player.mesh.position.copy(anchor(heroCar,false));groundActor(player);player.resetGrounding?.();setActorShadow(player,true);
   }
   placeAurora(job.getState().jobCarCheckpoint);
  }
  if(state.health<=0&&respawnTimer===0){respawnTimer=3;ui.toast('BUSTED','Returning to your mission checkpoint…');}
  if(respawnTimer>0){respawnTimer-=dt;if(respawnTimer<=0){respawnTimer=0;restart(false);}}
  if(state.health<100&&state.wanted===0)state.health=Math.min(100,state.health+dt*.5);
  if(dialogueQueue.length&&elapsed>=dialogueUntil){const next=dialogueQueue.shift();state.subtitle=next.text;state.subtitleSpeaker=next.speaker;dialogueUntil=elapsed+Math.max(4.5,next.text.length*.055);}
  else if(elapsed>=dialogueUntil){state.subtitle='';state.subtitleSpeaker='';}
 }else if(!state.started){vehicles.forEach(c=>c.model.update(simDt,0,0));pedestrians.forEach(p=>{p.actor.mesh.visible=p.actor.mesh.position.distanceTo(camera.position)<70;p.actor.advance(simDt,{speed:0});});player?.update(simDt,{speed:0});}
 for(const c of vehicles)if(c!==currentCar&&!c.traffic&&!c.police&&!c.occupied&&Math.abs(c.speed)>.05){updateVehiclePhysics(c,simDt,{throttle:0,steering:0,moveBody,vehicles,carsOverlap});c.model.update(simDt,c.speed,c.steer);}
 updateDrivers(simDt);contactActor?.advance(simDt,{speed:0,
  dialogueLine:state.subtitleSpeaker==='MARA'&&state.health>0&&player.mesh.position.distanceToSquared(contactActor.mesh.position)<49?state.subtitle:'',
  dialogueFocus:heroCar.model.mesh.position,
  lookTarget:state.started&&state.health>0?nearbyFaceTarget(contactActor,player,contactLookTarget):null});
 if(job){const progress=job.getState();Object.assign(state,progress);mission=progress.mission;
 const selectedPickup=progress.nightShiftSelectedPickup;
 if(selectedPickup&&waypoint?.freightPickup!==selectedPickup.id){
  displayWaypoint({x:selectedPickup.x,z:selectedPickup.z,freightPickup:selectedPickup.id},'Waypoint set · '+selectedPickup.label);
 }else if(waypoint?.freightPickup&&!selectedPickup){
  displayWaypoint(null,'Choose a street');
 }
 if(mission===3&&!maraAtWorkshop)placeMara(true);
 else if(maraAtWorkshop&&mission!==3&&player.mesh.position.distanceTo(contactActor.mesh.position)>48)placeMara(false);
 if(progress.target){goal.set(progress.target.x,0,progress.target.z);marker.position.copy(goal);}circuitGate.visible=(progress.mission===0||progress.mission===5)&&!progress.radioActive&&!progress.nightShiftActive&&state.started;
 radioMarker.visible=Boolean(progress.secondaryTarget&&state.started);
 if(radioMarker.visible){
  const point=progress.secondaryTarget;radioMarker.position.set(point.x,world.heightAt(point.x,point.z)+2.2,point.z);
  radioMarker.rotation.y=markerDiamond.rotation.y;
 }
 if(circuitGate.visible){const gate=progress.circuitActive?progress.target:CIRCUIT_START;circuitGate.position.set(gate.x,0,gate.z);circuitGate.rotation.y=gate.heading??0;}
 const gateIsTarget=progress.circuitActive||progress.target===CIRCUIT_START;
 marker.visible=!!progress.target&&state.started&&!(circuitGate.visible&&gateIsTarget);const close=progress.target&&player.mesh.position.distanceTo(goal)<4;markerBeam.visible=!close;markerDiamond.visible=!close;markerRing.scale.setScalar(close?.5:1);}
 const context=player&&job?contextAction():null;
 Object.assign(state,{interactionVisible:!!context&&!interaction,interactionTitle:context?.title||'',interactionName:context?.name||'',interactionKey:'E'});
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];if(e.born!==renderFrame)e.life-=simDt;if(e.life<=0){scene.remove(e.mesh);if(!e.mesh.isSprite)e.mesh.geometry?.dispose();effectMaterials.release(e.mesh.material);effects.splice(i,1);}else{if(e.vel){e.vel.y-=9*simDt;e.mesh.position.addScaledVector(e.vel,simDt);}if(e.spin){e.mesh.rotation.x+=e.spin.x*simDt;e.mesh.rotation.y+=e.spin.y*simDt;e.mesh.rotation.z+=e.spin.z*simDt;}e.mesh.material.opacity=(e.opacity??1)*e.life/e.max;}}
 if(!active)updateCamera(simDt);
}

// Presentation follows the final physics state once per rendered frame. Slow
// frames still substep collisions, but no longer redraw the map, move lights or
// submit audio/HUD updates up to eight times before anything can be displayed.
function updatePresentation(dt){
 if(softwareRenderer && graphicsQuality==='performance' && state.started && !photo.active){
  // Preserve the interactive pixel budget while travelling. Wait for a settled view
  // before restoring extra detail, so quick stops do not churn render targets.
  const now=performance.now();
  if(playerMoveSpeed>.5 || Math.abs(currentCar?.speed||0)>1)lastMotionTime=now;
  const moving=now-lastMotionTime<1500;
  if(moving!==fastMotion){
   fastMotion=moving;
   const ratio=gameplayPixelRatio();
   if(renderer.getPixelRatio()!==ratio){renderer.setPixelRatio(ratio);rendering.resize();}
  }
 }
 const active=state.started&&!state.paused&&!state.mapOpen;
 // Driver distance culling still runs while paused; free-camera visibility wins.
 photoActorVisibility.update();
 // Apply the camera mask after physics and free-camera movement. The actor's
 // pose, muzzle and shadow remain available even when its colour/depth are hidden.
 playerCameraVisibility?.update(camera,{started:state.started,photoActive:photo.active,inCar:Boolean(currentCar),interacting:Boolean(interaction),paused:state.paused||state.mapOpen});
 if(job?.getFreightManifest)world.setFreightStatus?.(job.getFreightManifest());
 world.setPierScreening?.(Boolean(state.pierScreeningUnlocked));
 world.update?.(state.paused||state.mapOpen?0:dt,elapsed);updateNightLights();
 // NPC time advances with physics; finish its procedural pose once for this
 // displayed frame. Geometry readers also flush before an actual shot.
 const presentActor=actor=>{if(!actor)return;actor.updateLOD?.(camera);if(actor.mesh.visible)actor.contactShadow?.update();};
 presentActor(player);presentActor(contactActor);
 for(const p of pedestrians){setActorShadow(p.actor,true);presentActor(p.actor);}
 for(const officer of officers){setActorShadow(officer,true);presentActor(officer);}
 for(const car of vehicles)presentActor(car.driver);
 updateAimSolution();
 if(player){const pos=player.mesh.position;const shadowFocus=photo.active?camera.position:pos;if(Math.hypot(shadowFocus.x-shadowAnchor.x,shadowFocus.z-shadowAnchor.z)>28){shadowAnchor.copy(shadowFocus);shadowAnchor.y=0;sun.target.position.copy(shadowAnchor);sun.position.copy(shadowAnchor).add(sunOffset);renderer.shadowMap.needsUpdate=true;}state.location=world.locationAt?.(pos.x,pos.z)||'VESPUCCI BOULEVARD';state.objectiveDistance=state.target?Math.round(pos.distanceTo(goal)):0;}
 let passingCar=null,passingDistance=35*35;
 if(player&&!currentCar)for(const car of vehicles){
  if(!car.traffic||Math.abs(car.speed)<1)continue;
  const distance=car.model.mesh.position.distanceToSquared(player.mesh.position);
  if(distance<passingDistance){passingCar=car;passingDistance=distance;}
 }
 sound.update({passingCar,vehicleType:currentCar?.model.type,district:state.location,landmarks:world.landmarks,dialogueActive:Boolean(state.subtitle),speed:Math.abs(currentCar?.speed||0),inCar:active&&state.inCar,wanted:active?state.wanted:0,playerPosition:player?.mesh.position,policePosition:police.model.mesh.position,velocity:playerVelocity,footSpeed:active&&!currentCar&&!interaction?playerMoveSpeed:0,sprinting:pad.sprint||keys.has('ShiftLeft'),rpm:state.rpm,gear:state.gear,slip:state.slip||0,policeState:state.policeState,night,active,cameraForward:camera.getWorldDirection(new THREE.Vector3())});
 uiTimer+=dt;miniTimer+=dt;
 const hitMarker=handling.presentHitMarker(dt,{visible:active&&weapon&&!currentCar&&!interaction,paused:!active});
 const combat={armed:weapon&&!currentCar,aiming:aiming&&weapon&&!currentCar,reloading,reloadProgress:reloading?1-reloadRemaining/PISTOL.reloadTime:0,crosshairSpread:3+handling.spread(aiming,playerMoveSpeed)*innerHeight/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)),hitMarker,shotBlocked:Boolean(aimSolution?.blocked)};
 Object.assign(state,combat);ui.updateCombat?.({...combat,ammo:state.ammo,reserve:state.reserve,weapon:state.weapon,inCar:state.inCar});
 if(uiTimer>.1){ui.update(state);uiTimer=0;}
 waypointMarker.visible=Boolean(active&&!photo.active&&waypoint&&player&&Math.hypot(player.mesh.position.x-waypoint.x,player.mesh.position.z-waypoint.z)<85);
 if(waypointMarker.visible){
   waypointMarker.position.set(waypoint.x,world.heightAt(waypoint.x,waypoint.z)+2.2,waypoint.z);
   waypointMarker.rotation.y=elapsed*.55;
 }
 const forkVisible=active&&!photo.active&&!waypoint&&showLastLightFork(state.lastLight?.phase);
 for(const cue of forkCues)cue.visible=forkVisible;
 const destination=waypoint||state.target;
 turnCue.visible=turnCue.visible&&active&&!photo.active&&!!destination;
 if(miniTimer>.1){
   if(active&&waypoint&&!waypoint.freightPickup&&player&&Math.hypot(player.mesh.position.x-waypoint.x,player.mesh.position.z-waypoint.z)<8){
     setWaypoint(null,'Waypoint reached');ui.toast('WAYPOINT REACHED',world.locationAt(player.mesh.position.x,player.mesh.position.z));
   }
   drawMap(mapCanvas());miniTimer=0;
   const turn=active&&!photo.active&&(waypoint||state.target)&&player&&nextMapTurn(mapRoute(world.roads,player.mesh.position,waypoint||goal),currentCar?48:32);
   turnCue.visible=Boolean(turn)&&(!!waypoint||state.lastLight?.phase!=='fork');
   if(turn){turnCue.material.color.setHex(waypoint?waypointColor:state.lastLight?.route==='service'?0x84dfd1:0xffc56d);turnCue.position.set(turn.x,world.heightAt(turn.x,turn.z)+.09,turn.z);turnCue.rotation.y=turn.heading;}
 }
}

function drawMap(canvas,full=false){
 if(!canvas||!player)return;const ctx=canvas.getContext('2d');const w=canvas.width,h=canvas.height;
 ctx.fillStyle='#1b292d';ctx.fillRect(0,0,w,h);
 const scale=full?cityMapScale(w,h):1.65;
 const center=full?cityMapCenter:player.mesh.position;
 const px=x=>w/2+(x-center.x)*scale,py=z=>h/2+(z-center.z)*scale;
 ctx.fillStyle='#283f47';ctx.fillRect(0,0,px(-150),h);
 ctx.fillStyle='#65604f';ctx.fillRect(px(-150),0,39*scale,h);
 ctx.fillStyle='#917a61';
 ctx.fillRect(px(-200.5),py(-21.5),15*scale,43*scale);
 ctx.fillRect(px(-186),py(-3.5),45*scale,7*scale);
 ctx.fillStyle='#344145';
 world.colliders.forEach(b=>ctx.fillRect(px(b.minX),py(b.minZ),(b.maxX-b.minX)*scale,(b.maxZ-b.minZ)*scale));
 ctx.strokeStyle='#667276';ctx.lineCap='butt';
 for(const road of world.roads){
   const dx=road.axis==='x'?road.length/2:0,dz=road.axis==='z'?road.length/2:0;
   ctx.lineWidth=road.width*scale;ctx.beginPath();
   ctx.moveTo(px(road.x-dx),py(road.z-dz));ctx.lineTo(px(road.x+dx),py(road.z+dz));ctx.stroke();
 }
 const {target,secondaryTarget}=full&&job?job.getState():state;
 ctx.strokeStyle=waypoint?'#c799ff':state.lastLight?.route==='service'?'#84dfd1':'#e5ab64';ctx.lineWidth=full?3.5:2;
 if(waypoint||target){
   const [start,...turns]=mapRoute(world.roads,player.mesh.position,waypoint||target);
   ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(px(start.x),py(start.z));
   for(const turn of turns)ctx.lineTo(px(turn.x),py(turn.z));
   ctx.stroke();ctx.setLineDash([]);
 }
 if(!waypoint&&showLastLightFork(state.lastLight?.phase))drawLastLightFork(ctx,px,py,full);
 for(const c of vehicles){const p=c.model.mesh.position;ctx.fillStyle=c.police?'#7caae3':c===currentCar?'#f4bc77':'#b6c0bb';ctx.save();ctx.translate(px(p.x),py(p.z));ctx.rotate(-c.heading);ctx.fillRect(-2,-3,4,6);ctx.restore();}
 if((state.mission===0||state.mission===5)&&!state.radioActive&&!state.nightShiftActive&&!state.circuitActive){
   const x=px(CIRCUIT_START.x),y=py(CIRCUIT_START.z),cell=full?4:2.5;
   ctx.fillStyle='#163531';ctx.fillRect(x-1,y-4*cell,4*cell+2,2*cell+2);
   ctx.fillStyle='#b1ffe5';ctx.fillRect(x-1,y-4*cell,2,4*cell);
   for(let row=0;row<2;row++)for(let col=row;col<4;col+=2)ctx.fillRect(x+col*cell,y+(row-4)*cell,cell,cell);
   if(full){ctx.font='bold 15px sans-serif';ctx.fillText('Pacific Circuit · courtesy sedan',x+5,y+18);}
 }
 if(secondaryTarget){
   const point=secondaryTarget,x=px(point.x),y=py(point.z);
   ctx.fillStyle='#84dfd1';ctx.beginPath();ctx.arc(x,y,full?7:5,0,Math.PI*2);ctx.fill();
   if(full){ctx.font='bold 16px sans-serif';ctx.fillText(point.label,x+10,y-8);}
 }
 if(target){ctx.fillStyle='#f6bd78';ctx.beginPath();ctx.arc(px(target.x),py(target.z),full?7:5,0,Math.PI*2);ctx.fill();}
 if(waypoint){ctx.save();ctx.translate(px(waypoint.x),py(waypoint.z));ctx.rotate(Math.PI/4);const size=full?8:5;ctx.fillStyle='#c799ff';ctx.fillRect(-size,-size,2*size,2*size);ctx.strokeStyle='#301f43';ctx.strokeRect(-size,-size,2*size,2*size);ctx.restore();}
 if(full&&mapCursor){const x=px(mapCursor.x),y=py(mapCursor.z);ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(x-9,y-9,18,18);}
 const pos=player.mesh.position;ctx.save();ctx.translate(px(pos.x),py(pos.z));ctx.rotate(-(currentCar?currentCar.heading:player.mesh.rotation.y));ctx.fillStyle='#fff5e2';ctx.shadowColor='#000';ctx.shadowBlur=5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(-5,-5);ctx.lineTo(0,-2);ctx.lineTo(5,-5);ctx.closePath();ctx.fill();ctx.restore();
 if(full){ctx.font='600 13px sans-serif';ctx.fillStyle='#c7cfca';ctx.fillText('VESPUCCI',px(-63),py(-25));ctx.fillText('DOWNTOWN',px(52),py(-150));ctx.save();ctx.translate(px(-170),h*.65);ctx.rotate(-Math.PI/2);ctx.fillStyle='#78959d';ctx.fillText('PACIFIC OCEAN',0,0);ctx.restore();}
}

window.addEventListener('keydown',e=>{
 const code=keyboardCode(e);
 if(!code)return;
 const control=e.target.closest?.('button,input,select,textarea,[contenteditable]');
 if(control&&['Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(code))return;
 if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(code))e.preventDefault();
 const photoMovement=photo.active&&['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','ShiftLeft','ShiftRight'].includes(code);
 if((e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)&&!photoMovement&&!['Escape','KeyP','KeyH'].includes(code))return;
 if(!keys.has(code))action(code);keys.add(code);
});
window.addEventListener('keyup',e=>keys.delete(keyboardCode(e)));
window.addEventListener('focus',()=>{controllerFocused=true;});
window.addEventListener('blur',()=>{controllerFocused=false;controller.reset();keys.clear();mouseDown=false;aiming=false;if(state.started&&!photo.active)pause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){controller.reset();if(state.started&&!photo.active)pause(true);}});
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
 if(e.buttons||document.pointerLockElement===canvas){conversationUntil=0;yaw-=e.movementX*(aiming?.0022:.0035);pitch=clamp(pitch+e.movementY*(aiming?.0022:.003),-1.05,1.1);lookTimer=elapsed;}
});
canvas.addEventListener('dblclick',()=>{if(state.started&&!state.paused&&!photo.active)canvas.requestPointerLock?.();});
canvas.addEventListener('wheel',e=>{if(photo.active){e.preventDefault();photo.change({fov:photo.settings.fov+e.deltaY*.025});}},{passive:false});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();if(!photo?.active)renderer.setPixelRatio(gameplayPixelRatio());renderer.setSize(innerWidth,innerHeight);rendering.resize();});

// A read-only diagnostic view keeps real browser verification reproducible.
Object.defineProperty(window,'__GRAND_THEFT_ASTRA__',{value:{getState:()=>({...state,renderFrame,environmentLighting:environmentLighting.getInfo(),effectShaderWarmup:effectShaderWarmup.getInfo(),localSelfShadow:localSelfShadow.getInfo(),photoActors:photoActorVisibility.getInfo(),cameraVisibility:playerCameraVisibility?.getState(),footContacts:player?.contactShadow?.getInfo(),shaderPrograms:renderer.info.programs.length,playerMoveSpeed,playerHeading:player?.mesh.rotation.y,aimState:player?.getAimState?.(),muzzlePosition:player?.getMuzzlePosition?.().toArray(),muzzleDirection:player?.getMuzzleDirection?.().toArray(),shotsFired:handling.shots,shotQueued:handling.queued,lastImpact,policeShots:policeShotHistory.map(shot=>({...shot,origin:[...shot.origin],point:[...shot.point]})),recoilPitch:handling.recoilPitch,aimPoint:aimSolution?.point.toArray(),position:player?.mesh.position.toArray(),groundHeight:player?world.heightAt(player.mesh.position.x,player.mesh.position.z):null,carPosition:currentCar?.model.mesh.position.toArray(),carHeading:currentCar?.heading,carSpeed:currentCar?.speed,mission,interaction:interaction?{phase:interaction.phase,progress:interaction.elapsed/interaction.duration}:null,animation:player?.mesh.userData.animationState,pose:player?.getPoseInfo?.(),face:player?.getFaceInfo?.(),landmarks:world.landmarks,reloading,reloadRemaining,elapsed,policePosition:police.model.mesh.position.toArray(),characterLoaded:!!player,driverVisible:!!currentCar&&player?.mesh.visible,driverPosition:currentCar?player.mesh.position.toArray():null,city:simulation?.getDiagnostics?.(),driverAlignment:currentCar?{driver:player.mesh.quaternion.toArray(),cockpit:currentCar.model.getDriverOrientation?.(new THREE.Quaternion()).toArray()}:null,instanceVisibility:world.getInstanceVisibility(),wires:world.getWireStats(),heroVehicle:{driverActive:heroCar.driverActive,driverDownUntil:heroCar.driverDownUntil,driverAnimation:heroCar.driver?.mesh.userData.animationState,driverHead:heroCar.driver?.getHitVolumes?.().spheres[0]?.center.toArray(),evictedDriver:pedestrians.some(p=>p.isDriver&&p.actor===heroCar.driver)?{down:pedestrians.find(p=>p.actor===heroCar.driver).down,animation:heroCar.driver?.mesh.userData.animationState}:null,detail:heroCar.model.getDetailInfo?.(),model:heroCar.model.mesh.userData.model,detailLevels:heroCar.model.mesh.userData.detailLevels,driverSeat:heroCar.model.getDriverSeat?.().toArray(),doorEntry:heroCar.model.getDoorPosition?.().toArray(),doorAngle:heroCar.model.mesh.getObjectByName('driver_door')?.rotation.y},jobCarHealth:heroCar.health,jobCarPosition:heroCar.model.mesh.position.toArray(),characterLODs:[player,contactActor,...pedestrians.map(p=>p.actor),...officers,...vehicles.map(c=>c.driver)].filter(Boolean).map(actor=>({...actor.getLODInfo?.(),evaluation:actor.getEvaluationStats?.(),face:actor.getFaceInfo?.(),attention:actor.getAttentionInfo?.(),position:actor.mesh.position.toArray(),groundHeight:world.heightAt(actor.mesh.position.x,actor.mesh.position.z),visible:actor.mesh.visible})),drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,vehicles:vehicles.length,vehicleDetails:vehicles.map(c=>({model:c.model.mesh.userData.model,position:c.model.mesh.position.toArray(),speed:c.speed,...c.model.getDetailInfo?.()})),pedestrians:pedestrians.length,softwareRenderer:!!softwareRenderer,pixelRatio:renderer.getPixelRatio(),cameraPosition:camera.position.toArray(),cameraDirection:camera.getWorldDirection(new THREE.Vector3()).toArray(),photo:photo.active?photo.settings:null,renderSize:renderer.getDrawingBufferSize(new THREE.Vector2()).toArray()})}});

// Publish complete replacement maps together; retain each material's authored
// intensity instead of capturing the current night multiplier on a rebuild.
function applyEnvironmentMaps({day,night:nightMap,vehicle}){
 districtLighting.setMaps({day,night:nightMap,vehicle});
 atmosphere.setEnvironment(day,nightMap);effectDayEnvironment=day;vehicleDayEnvironment=vehicle;vehicleNightEnvironment=nightMap;
 for(const car of vehicles)car.model.mesh.traverse(object=>{
  const materials=Array.isArray(object.material)?object.material:[object.material];
  for(const material of materials)if(material?.isMeshStandardMaterial){
   material.userData.dayEnvIntensity??=material.envMapIntensity;
   material.envMap=night?nightMap:vehicle;
   material.envMapRotation.copy(night?atmosphere.rotation:new THREE.Euler());
   material.envMapIntensity=material.userData.dayEnvIntensity*(night?.55:1);material.needsUpdate=true;
  }
 });
}

// Recreate the same static daylight probe used at startup. A context restore
// may happen in a distant night photo, with actors already present and hidden.
function captureVehicleCube(dayEnvironment,skyData){
 const target=new THREE.WebGLCubeRenderTarget(128,{type:THREE.HalfFloatType});
 const probe=new THREE.CubeCamera(.2,350,target);probe.position.set(4.8,1.2,18);
 const hidden=new Map([...vehicles.map(car=>car.model.mesh),...photoShadowActors().map(actor=>actor.mesh),...effects.map(effect=>effect.mesh),navigationMarkers].map(root=>[root,root.visible]));
 const saved={night,background:scene.background,environment:scene.environment,rotation:scene.environmentRotation.clone(),
  exposure:renderer.toneMappingExposure,sunPosition:sun.position.clone(),sunTarget:sun.target.position.clone(),
  target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),xr:renderer.xr.enabled};
 try{
  setTime(false);scene.background=skyData.lightingTexture||skyData.texture;scene.environment=dayEnvironment;scene.environmentRotation.copy(skyData.rotation);
  sun.target.position.set(0,0,20);sun.position.copy(sun.target.position).add(sunOffset);
  for(const root of hidden.keys())root.visible=false;
  world.restoreInstances();sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;
  probe.update(renderer,scene);
  return target;
 }catch(error){target.dispose();throw error;}
 finally{
  for(const [root,visible] of hidden)root.visible=visible;
  setTime(saved.night);scene.background=saved.background;scene.environment=saved.environment;scene.environmentRotation.copy(saved.rotation);
  renderer.toneMappingExposure=saved.exposure;sun.position.copy(saved.sunPosition);sun.target.position.copy(saved.sunTarget);
  renderer.xr.enabled=saved.xr;renderer.setRenderTarget(saved.target,saved.face,saved.mip);
  sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;
 }
}

async function boot(){
 try{
  const [skyData]=await Promise.all([atmosphere.ready,world.ready,charactersReady,vehicleProbe.ready]);
  if(skyData?.texture){
   world.setSky(skyData);
   sunOffset.copy(skyData.sunDirection).multiplyScalar(350);
   sun.target.position.copy(shadowAnchor);sun.position.copy(shadowAnchor).add(sunOffset);
   environmentLighting.setSky(skyData);environmentLighting.update();
  }
  player=createCharacter({groundHeightAt:world.heightAt});player.mesh.position.set(1.4,0,23);groundActor(player);player.mesh.rotation.y=Math.PI;player.setWeapon(false);addActorContactShadow(player);setActorShadow(player,true);scene.add(player.mesh);
  playerCameraVisibility=createPlayerCameraVisibility(player.mesh);
  const npcSpawns=[[-14,8],[-14,-30],[14,-38],[15,30],[-14,-75],[16.8,-130.25],[66,-54],[94,10],[-14,67],[34,-20.5],[66,47],[94,-120]];
  npcSpawns.forEach(([x,z],i)=>{const actor=createCharacter({groundHeightAt:world.heightAt,npc:true,color:[0x657d78,0x8d6e62,0xb5a68a,0x697a90,0x8b5365,0xd0c7b5][i%6]});const direction=i%2?1:-1;addActorContactShadow(actor);actor.mesh.position.set(x,world.heightAt(x,z),z);setActorShadow(actor,true);actor.mesh.rotation.y=direction<0?Math.PI:0;scene.add(actor.mesh);pedestrians.push({actor,ambientRole:i===3?'diner-customer':i===5?'mechanic':i===9?'calypso-shopper':null,direction,homeDirection:direction,home:actor.mesh.position.clone(),down:false,recoverAt:0,fleeUntil:0});});
  for(let i=0;i<2;i++){const actor=createCharacter({groundHeightAt:world.heightAt,npc:true,police:true,color:0x23374d});actor.setWeapon(true);addActorContactShadow(actor);actor.mesh.visible=false;scene.add(actor.mesh);officers.push(actor);}
  for(const c of [boulevardTraffic, downtownTraffic, eastAvenueTraffic]){c.driver=createCharacter({groundHeightAt:world.heightAt,npc:true,color:0x526b7a});c.driverActive=true;addActorContactShadow(c.driver);scene.add(c.driver.mesh);}
  contactActor=createCharacter({role:'mara',groundHeightAt:world.heightAt,npc:true,color:0x272c3d});addActorContactShadow(contactActor);setActorShadow(contactActor,true);scene.add(contactActor.mesh);
  simulation=createCitySimulation({vehicles,pedestrians,police,officers,world,moveBody,carsOverlap,getPoliceShotGeometry,onPoliceShot:policeShot,onToast:(a,b)=>ui.toast(a,b)});
  job=createMission({onRecordingCue:site=>sound.recordingCue(site),landmarks:world.landmarks,getHeroPosition:()=>heroCar.model.mesh.position,onDialogue:dialogue,onToast:(a,b)=>ui.toast(a,b),onComplete:info=>{ui.missionComplete?.(info);sound.notify();}});
  const saved=job.getState();Object.assign(state,saved);mission=saved.mission;
  placeAtCheckpoint(saved);
  updateDrivers(0);ui.update(state);
  // A lost context can recover on the next frame; a rebuild error needs refresh.
  const environmentFailure=environmentLighting.getInfo().error;
  if(environmentFailure)throw new Error(environmentFailure);
  // Prepare both shadow variants behind the existing loading screen.
  // A lost context retries at the recovery gate; ordinary warmup errors fall back.
  if(environmentLighting.getInfo().ready)effectShaderWarmup.update(environmentLighting.revision);
  state.ready=true;ui.setReady(true);
 }catch(error){console.error('Unable to initialize city',error);ui.toast('COULD NOT LOAD THE CITY','Please refresh to try again.');}
 lastFrame=performance.now();requestAnimationFrame(frame);
}
function frame(now){
 // Never advance the game behind a lost context or display empty GPU-only maps.
 if(!environmentLighting.update()){
  lastFrame=now;
  const failure=environmentLighting.getInfo().error;
  if(failure&&failure!==environmentError){environmentError=failure;ui.toast('GRAPHICS INTERRUPTED','Please refresh to restore the city.');}
  requestAnimationFrame(frame);return;
 }
 // Environment maps must exist before preparation. A context lost during the
 // hidden draw still holds simulation; the revision clock reset follows its cost.
 if(!effectShaderWarmup.update(environmentLighting.revision)){
  lastFrame=performance.now();requestAnimationFrame(frame);return;
 }
 if(lastEnvironmentBuild!==environmentLighting.revision){lastEnvironmentBuild=environmentLighting.revision;now=performance.now();lastFrame=now;}
 pollController(Math.min(.25,Math.max(0,(now-lastFrame)/1000)));
 // The title is opaque. Save the first scene submission for the playable camera.
 if (!state.started) {
  lastFrame = now;
  requestAnimationFrame(frame);
  return;
 }
 if(renderFrame===0)updateCamera(10);
 renderFrame++;
 const wallDt=Math.max(0,(now-lastFrame)/1000),dt=Math.min(wallDt,.25);lastFrame=now;frameCount++;fpsTimer+=wallDt;
 if(fpsTimer>1){state.fps=Math.round(frameCount/fpsTimer);frameCount=0;fpsTimer=0;}
 // A paused simulation has no elapsed time to subdivide. Refresh the frozen
 // pose once while the photo camera and presentation keep their frame cadence.
 advanceFrameSimulation(dt,state.paused||state.mapOpen);photo.update(dt,keys);updatePresentation(dt);world.updateWires(camera,renderer.getDrawingBufferSize(drawingSize));const refreshShadows=renderer.shadowMap.enabled&&(renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate);
 if(refreshShadows){sun.updateWorldMatrix(true,false);sun.target.updateWorldMatrix(true,false);sun.shadow.updateMatrices(sun);}
 world.updateInstanceVisibility(camera,{preserveShadows:refreshShadows,shadowFrusta:refreshShadows?[sun.shadow.getFrustum()]:undefined});localSelfShadow.update({photoActive:photo.active,night,started:state.started});rendering.render();if(renderFrame===1)ui.revealGame();photo.afterRender();requestAnimationFrame(frame);
}
boot();
