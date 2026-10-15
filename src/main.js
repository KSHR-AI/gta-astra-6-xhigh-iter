import * as THREE from 'three';
import { createWorld } from './world.js';
import { createCar, loadVehicleAssets } from './vehicles.js';
import { loadCharacterAssets, createCharacter } from './characters.js';
import { createUI } from './ui.js';
import { createAudio } from './audio.js';
import { createAtmosphere } from './atmosphere.js';
import { createRendering } from './rendering.js';
import './style.css';

const canvas = document.querySelector('#game');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xcac9c7, 0.0025);
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, powerPreference:'high-performance'});
const gl=renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');
const softwareRenderer=debugInfo&&/swiftshader|llvmpipe|software/i.test(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
renderer.setPixelRatio(softwareRenderer?.8:Math.min(devicePixelRatio,1.75));
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
camera.lookAt(cameraLook);
const hemisphere=new THREE.HemisphereLight(0xb8d7ff,0x797164,.85);
scene.add(hemisphere);
const sun=new THREE.DirectionalLight(0xffe1bc,3.8);
sun.position.set(-70,58,-80); sun.castShadow=true;
sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-75,right:75,top:75,bottom:-75,near:1,far:250});
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
const sound=createAudio();
const keys=new Set();
const state={ready:false,started:false,paused:false,mapOpen:false,health:100,stamina:100,money:1250,wanted:0,ammo:12,reserve:96,inCar:false,speed:0,location:'VESPUCCI BOULEVARD',time:'18:42',objectiveTitle:'A fresh start',objective:'Find a ride. Make the city yours.',objectiveDistance:0,weapon:'UNARMED',nearCar:false,fps:60};
let ui,player,currentCar=null,mission=0,night=false,weapon=false,aiming=false,reloading=false;
let vehicleDayEnvironment=null,vehicleNightEnvironment=null;
let yaw=0,pitch=0.2,jumpVelocity=0,lastShot=-100,lastCrime=-100,wantedSince=-100,elapsed=0,lookTimer=0,doorTimer=0,respawnTimer=0,reloadRemaining=0;
let lastFrame=performance.now(),frameCount=0,fpsTimer=0,uiTimer=0,miniTimer=0,mouseDown=false;
const aimRay=new THREE.Raycaster();
const vehicles=[],pedestrians=[],effects=[];
const contactCanvas=document.createElement('canvas');contactCanvas.width=contactCanvas.height=64;
const contactContext=contactCanvas.getContext('2d');const contactGradient=contactContext.createRadialGradient(32,32,2,32,32,32);
contactGradient.addColorStop(0,'rgba(0,0,0,.28)');contactGradient.addColorStop(.55,'rgba(0,0,0,.12)');contactGradient.addColorStop(1,'rgba(0,0,0,0)');contactContext.fillStyle=contactGradient;contactContext.fillRect(0,0,64,64);
const contactTexture=new THREE.CanvasTexture(contactCanvas);
const shadowAnchor=new THREE.Vector3(0,0,20);
function addContactShadow(group,w,h){group.traverse(o=>{if(o.isMesh){o.castShadow=!softwareRenderer&&!o.material?.transparent;o.receiveShadow=true;}});const shadow=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:contactTexture,transparent:true,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.07;group.add(shadow);}
const goal=new THREE.Vector3(4,0,-125);
const playerVelocity=new THREE.Vector3();
const tmp=new THREE.Vector3();
const mapCanvas=()=>document.querySelector('#minimap');
const clamp=THREE.MathUtils.clamp;
const damp=(a,b,k,dt)=>THREE.MathUtils.lerp(a,b,1-Math.exp(-k*dt));
const angleDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));

ui=createUI({
 onStart:startGame,onPause:()=>pause(true),onResume:()=>pause(false),onRestart:restart,
 onSound:enabled=>{sound.setEnabled(enabled);sound.start();},
 onQuality:q=>{renderer.setPixelRatio(q==='high'?(softwareRenderer?.8:Math.min(devicePixelRatio,1.75)):.6);renderer.shadowMap.enabled=q==='high';renderer.shadowMap.needsUpdate=true;rendering.setQuality(q);},
 onTime:value=>setTime(value==='night'),onMap:open=>setMap(open),
 onMobile:(code,down)=>{if(down){if(!keys.has(code)) action(code);keys.add(code);}else keys.delete(code);},
});
ui.setReady(false);

function setTime(dark){
 night=dark; atmosphere.setNight(night); rendering.setNight(night);world.setNight(night);streetLights.forEach(light=>light.visible=night);headlights.forEach(light=>light.visible=night); state.time=night?'22:16':'18:42';
 sun.color.set(night?0x96baff:0xffe1bc); sun.intensity=night?0.8:3.8;
 hemisphere.intensity=night?.8:.85; hemisphere.color.set(night?0x6c86b4:0xb8d7ff);
 scene.fog.color.set(night?0x101b2a:0xcac9c7);renderer.toneMappingExposure=night?1:1.0;
 vehicles.forEach(c=>{
  c.model.setLights(night);
  c.model.mesh.traverse(o=>{const materials=Array.isArray(o.material)?o.material:[o.material];for(const m of materials)if(m?.isMeshStandardMaterial&&m.userData.dayEnvIntensity!==undefined){
    m.envMap=night?vehicleNightEnvironment:vehicleDayEnvironment;
    m.envMapRotation.copy(night?atmosphere.rotation:new THREE.Euler());
    m.envMapIntensity=m.userData.dayEnvIntensity*(night?.55:1);
   }});
 });renderer.shadowMap.needsUpdate=true;
}
function startGame(){if(!state.ready)return;state.started=true;state.paused=false;ui.setPaused(false);sound.start();ui.toast('WELCOME TO VESPUCCI','Your story starts here. Find a ride with E.');}
function pause(value){state.paused=value;keys.clear();mouseDown=false;aiming=false;ui.setPaused(value);if(value&&document.pointerLockElement)document.exitPointerLock();}
function setMap(value){state.mapOpen=Boolean(value&&state.started);keys.clear();mouseDown=false;aiming=false;ui.showMap(state.mapOpen);if(state.mapOpen){if(document.pointerLockElement)document.exitPointerLock();drawMap(document.querySelector('#city-map'),true);}}
function restart(){
 if(!state.ready||!player)return;
 currentCar=null;state.started=true;
 state.health=100;state.stamina=100;state.wanted=0;state.ammo=12;state.reserve=96;state.inCar=false;state.money=1250;state.speed=0;state.nearCar=false;
 mission=0;weapon=false;aiming=false;mouseDown=false;reloading=false;reloadRemaining=0;respawnTimer=0;doorTimer=0;lastShot=-100;lastCrime=-100;wantedSince=-100;lookTimer=elapsed;
 state.weapon='UNARMED';state.objectiveTitle='A fresh start';state.objective='Find a ride. Make the city yours.';
 player.mesh.position.set(1.4,0,23);player.mesh.rotation.set(0,Math.PI,0);player.setVisible(true);player.setWeapon(false);playerVelocity.set(0,0,0);yaw=0;pitch=.2;jumpVelocity=0;
 for(const c of vehicles){c.model.mesh.position.copy(c.home);c.heading=c.homeHeading;c.model.mesh.rotation.set(0,c.heading,0);c.speed=0;c.steer=0;c.health=100;c.occupied=false;c.stolen=false;c.traffic=c.homeTraffic;c.routeIndex=c.homeRouteIndex;c.closeDoorAt=0;c.model.setDoor(false);c.model.update(1,0,0);}
 for(const p of pedestrians){p.actor.mesh.position.copy(p.home);p.direction=p.homeDirection;p.down=false;p.recoverAt=0;p.fleeUntil=0;p.actor.mesh.rotation.set(0,p.direction<0?Math.PI:0,0);p.actor.update(1,{speed:0,dead:false});}
 for(const e of effects){scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();}effects.length=0;
 marker.visible=false;cameraLook.copy(player.mesh.position).add(new THREE.Vector3(0,1.2,-3));camera.position.copy(player.mesh.position).add(new THREE.Vector3(0,3.6,5.8));sound.start();
 pause(false);setMap(false);ui.toast('A FRESH START','The boulevard is yours again.');
}

function addCar(x,z,heading,color,type='sport',traffic=false,police=false){
 const model=createCar({color,type,police});addContactShadow(model.mesh,3.4,5.6);model.mesh.position.set(x,0,z);model.mesh.rotation.y=heading;scene.add(model.mesh);
 const car={model,heading,speed:0,steer:0,traffic,police,occupied:false,health:100,home:new THREE.Vector3(x,0,z),homeHeading:heading,homeTraffic:traffic,homeRouteIndex:0,routeIndex:0,stolen:false,closeDoorAt:0};vehicles.push(car);return car;
}
await loadVehicleAssets();
addCar(4.8,18,Math.PI,0x315c61);
addCar(-8,-26,0,0xa9b5a9,'sedan');
addCar(8,-56,Math.PI,0x983b2f,'sport');
addCar(-8,61,0,0xd6d5c9,'sedan');
addCar(75,-43,0,0x466c72,'sport');
addCar(84,36,Math.PI,0x344050,'sedan');
const trafficRoute=[new THREE.Vector3(-4,0,82),new THREE.Vector3(-4,0,-85),new THREE.Vector3(76,0,-85),new THREE.Vector3(76,0,82)];
const t1=addCar(-4,-45,0,0x566c61,'sedan',true);t1.routeIndex=0;
const t2=addCar(76,20,0,0xe2d7bd,'sedan',true);t2.routeIndex=3;t2.homeRouteIndex=3;
const police=addCar(83,-150,Math.PI,0x14202b,'sedan',false,true);

const marker=new THREE.Group();
const markerMat=new THREE.MeshBasicMaterial({color:0xffc56d,transparent:true,opacity:.75,depthWrite:false});
const markerRing=new THREE.Mesh(new THREE.TorusGeometry(2.3,.055,8,64),markerMat);markerRing.rotation.x=Math.PI/2;markerRing.position.y=.08;marker.add(markerRing);
const markerBeam=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,5,8),new THREE.MeshBasicMaterial({color:0xffcb75,transparent:true,opacity:.28,depthWrite:false}));markerBeam.position.y=2.5;marker.add(markerBeam);
const markerDiamond=new THREE.Mesh(new THREE.OctahedronGeometry(.45),markerMat);markerDiamond.position.y=4.8;marker.add(markerDiamond);
marker.position.copy(goal);scene.add(marker);

function crime(level){if(state.wanted===0&&level>0)wantedSince=elapsed;state.wanted=clamp(Math.max(state.wanted,level),0,5);lastCrime=elapsed;}
function toastCrime(){ui.toast('VEHICLE ACQUIRED','Lose the heat. Head to the coast.');}
function nearestCar(){let nearest=null,dist=4.4;for(const c of vehicles){if(c.occupied)continue;let d=c.model.mesh.position.distanceTo(player.mesh.position);if(d<dist){dist=d;nearest=c;}}return nearest;}
function enterExit(){
 if(doorTimer>0)return;
 if(currentCar){
  const c=currentCar; if(Math.abs(c.speed)>10){ui.toast('SLOW DOWN','Brake before leaving your vehicle.');return;}
  const side=new THREE.Vector3(Math.cos(c.heading)*1.9,0,-Math.sin(c.heading)*1.9);
  const exit=c.model.mesh.position.clone().add(side);if(collides(exit.x,exit.z,.4))exit.sub(side.multiplyScalar(2));
  player.mesh.position.copy(exit);player.mesh.position.y=0;player.setVisible(true);player.mesh.rotation.y=c.heading;currentCar=null;c.occupied=false;c.speed=0;c.model.setDoor(true);doorTimer=.65;
  c.closeDoorAt=elapsed+.65;state.inCar=false;playerVelocity.set(0,0,0);mouseDown=false;ui.toast('ON FOOT','Explore the city. Your ride will be waiting.');return;
 }
 const c=nearestCar();if(!c){ui.toast('FIND A RIDE','Get closer to a vehicle and press E.');return;}
 currentCar=c;c.occupied=true;c.traffic=false;c.model.setDoor(true);doorTimer=.65;c.speed=0;player.setVisible(false);state.inCar=true;weapon=false;aiming=false;mouseDown=false;reloading=false;reloadRemaining=0;player.setWeapon(false);state.weapon='UNARMED';
 c.closeDoorAt=elapsed+.65;
 if(!c.stolen){c.stolen=true;crime(1);toastCrime();}
 if(mission===0){mission=1;state.objectiveTitle='The coastal run';state.objective='Take your new ride to the golden waypoint.';}
 yaw=c.heading+Math.PI;lookTimer=0;
}
function action(code){
 if(code==='Escape'){if(state.mapOpen)setMap(false);else pause(!state.paused);return;}
 if(!state.started||state.paused)return;
 if(code==='KeyM'){setMap(!state.mapOpen);return;}
 if(state.mapOpen)return;
 if(code==='KeyE'||code==='KeyF')enterExit();
 if(code==='Digit1'&&!currentCar){weapon=!weapon;player.setWeapon(weapon);state.weapon=weapon?'9MM PISTOL':'UNARMED';ui.toast(weapon?'9MM PISTOL EQUIPPED':'WEAPON HOLSTERED',weapon?'Right mouse to aim · Click to fire · R to reload':'Keep a low profile.');}
 if(code==='KeyR')reload();
 if(code==='KeyH'&&currentCar)sound.horn();
 if(code==='Space'&&!currentCar&&player.mesh.position.y<.01)jumpVelocity=5;
 if((code==='Shoot'||code==='Mouse0')&&!currentCar){if(!weapon){weapon=true;player.setWeapon(true);state.weapon='9MM PISTOL';}shoot();}
}
function reload(){
 if(!weapon||reloading||state.ammo===12||state.reserve===0)return;reloading=true;reloadRemaining=1.05;ui.toast('RELOADING','Fresh magazine.');sound.reload();
}
function spawnEffect(position,color=0xffca76,count=8){
 for(let i=0;i<count;i++){const mesh=new THREE.Mesh(new THREE.SphereGeometry(.025+Math.random()*.035,4,4),new THREE.MeshBasicMaterial({color,transparent:true}));mesh.position.copy(position);scene.add(mesh);effects.push({mesh,vel:new THREE.Vector3((Math.random()-.5)*6,Math.random()*4,(Math.random()-.5)*6),life:.5,max:.5});}
}
function shoot(){
 if(!state.started||state.paused||state.mapOpen||!weapon||currentCar||reloading||elapsed-lastShot<.2)return;
 if(state.ammo<=0){reload();return;}
 state.ammo--;lastShot=elapsed;sound.shoot();crime(Math.min(5,Math.max(2,state.wanted+(state.ammo%4===0?1:0))));
 aimRay.setFromCamera(new THREE.Vector2(0,aiming?0:.04),camera);
 player.mesh.rotation.y=yaw+Math.PI;player.mesh.updateMatrixWorld(true);
 const origin=player.getMuzzlePosition(new THREE.Vector3());
 const direction=aimRay.ray.direction.clone();
 const far=aimRay.ray.origin.clone().addScaledVector(direction,85);
 let hitDistance=85,hitObject=null,hitBuilding=false;
 for(const box of buildingBoxes){const hit=aimRay.ray.intersectBox(box,new THREE.Vector3());if(hit&&hit.distanceTo(camera.position)<hitDistance){hitDistance=hit.distanceTo(camera.position);far.copy(hit);hitBuilding=true;}}
 for(const c of vehicles){const sphere=new THREE.Sphere(c.model.mesh.position.clone().add(new THREE.Vector3(0,.8,0)),1.5);const hit=aimRay.ray.intersectSphere(sphere,new THREE.Vector3());if(hit&&hit.distanceTo(camera.position)<hitDistance){hitDistance=hit.distanceTo(camera.position);far.copy(hit);hitObject=c;hitBuilding=false;}}
 for(const p of pedestrians){if(p.down)continue;const sphere=new THREE.Sphere(p.actor.mesh.position.clone().add(new THREE.Vector3(0,1,0)),.8);const hit=aimRay.ray.intersectSphere(sphere,new THREE.Vector3());if(hit&&hit.distanceTo(camera.position)<hitDistance){hitDistance=hit.distanceTo(camera.position);far.copy(hit);hitObject=p;hitBuilding=false;}}
 // A camera can see around a corner while the handgun is still behind cover.
 const muzzleRay=new THREE.Ray(origin,far.clone().sub(origin).normalize());
 let muzzleDistance=origin.distanceTo(far);
 for(const box of buildingBoxes){const hit=muzzleRay.intersectBox(box,new THREE.Vector3());if(hit&&hit.distanceTo(origin)<muzzleDistance-.01){muzzleDistance=hit.distanceTo(origin);far.copy(hit);hitObject=null;hitBuilding=true;}}
 const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin,far]),new THREE.LineBasicMaterial({color:0xffe3a2,transparent:true,opacity:.9}));scene.add(line);effects.push({mesh:line,life:.075,max:.075});spawnEffect(origin,0xffce61,3);
 if(hitObject){spawnEffect(far,0xecc698,9);if(hitObject.actor){hitObject.down=true;hitObject.recoverAt=elapsed+12;crime(3);}else{hitObject.health-=24;if(hitObject.health<=0){hitObject.speed=0;hitObject.traffic=false;spawnEffect(far,0x555555,12);ui.toast('VEHICLE DISABLED','Find another ride.');}}}
 else if(hitBuilding)spawnEffect(far,0xd7c9b6,5);
 for(const p of pedestrians)p.fleeUntil=elapsed+7;
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
function updatePlayer(dt){
 if(currentCar){updateDriving(dt);player.mesh.position.copy(currentCar.model.mesh.position);player.update(dt,{speed:0});return;}
 let moveX=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
 let moveZ=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
 const sprint=(keys.has('ShiftLeft')||keys.has('ShiftRight'))&&state.stamina>2&&moveZ!==0;
 const speed=aiming?2:sprint?7:3.4;
 if(sprint)state.stamina=Math.max(0,state.stamina-dt*12);else state.stamina=Math.min(100,state.stamina+dt*8);
 const move=new THREE.Vector3(moveX,0,-moveZ).normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP,yaw);
 playerVelocity.lerp(move.multiplyScalar(speed),1-Math.exp(-12*dt));
 moveBody(player.mesh.position,playerVelocity.x*dt,playerVelocity.z*dt,.42);
 if(playerVelocity.length()>.15||weapon){const target=weapon?yaw+Math.PI:Math.atan2(playerVelocity.x,playerVelocity.z);player.mesh.rotation.y+=angleDiff(player.mesh.rotation.y,target)*Math.min(1,dt*13);}
 jumpVelocity-=14*dt;player.mesh.position.y=Math.max(0,player.mesh.position.y+jumpVelocity*dt);if(player.mesh.position.y===0)jumpVelocity=0;
 player.update(dt,{speed:playerVelocity.length(),aiming:weapon,shooting:elapsed-lastShot<.13});
 state.nearCar=!!nearestCar();state.speed=0;
}
function updateDriving(dt){
 const c=currentCar;
 const throttle=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
 const steering=(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0);
 const handbrake=keys.has('Space');
 if(c.health>0){if(throttle!==0)c.speed+=throttle*(throttle*c.speed<0?23:12)*dt;else c.speed*=Math.exp(-.45*dt);}else c.speed*=Math.exp(-3*dt);
 if(handbrake)c.speed*=Math.exp(-3*dt);
 c.speed=clamp(c.speed,-10,42);c.steer=damp(c.steer,steering*.5,8,dt);
 c.heading+=c.steer*c.speed*.19*dt/(1+Math.abs(c.speed)*.025);
 const prev=c.model.mesh.position.clone();
 const hit=moveBody(c.model.mesh.position,Math.sin(c.heading)*c.speed*dt,Math.cos(c.heading)*c.speed*dt,1.05);
 if(hit&&Math.abs(c.speed)>3){state.health=Math.max(0,state.health-Math.abs(c.speed)*.22);sound.crash();spawnEffect(c.model.mesh.position.clone().add(new THREE.Vector3(0,.4,0)));c.speed*=-.18;}
 for(const other of vehicles){if(other===c)continue;const distance=c.model.mesh.position.distanceTo(other.model.mesh.position);if(carsOverlap(c.model.mesh.position,c.heading,other.model.mesh.position,other.heading)){c.model.mesh.position.copy(prev);if(Math.abs(c.speed)>4){sound.crash();spawnEffect(c.model.mesh.position.clone().add(new THREE.Vector3(0,.6,0)));other.speed=c.speed*.3;crime(1);}c.speed*=-.25;}}
 c.model.mesh.rotation.y=c.heading;
 c.model.mesh.rotation.z=damp(c.model.mesh.rotation.z,-c.steer*c.speed*.003,7,dt);
 state.speed=Math.round(c.speed*3.6);state.nearCar=false;
 player.setVisible(false);
}
function updateTraffic(dt){
 for(const c of vehicles){
  if(c.closeDoorAt&&elapsed>=c.closeDoorAt){c.model.setDoor(false);c.closeDoorAt=0;}
  if(c===currentCar){c.model.update(dt,c.speed,c.steer);continue;}
  if(c.traffic&&c.health>0){
   const target=trafficRoute[c.routeIndex];tmp.copy(target).sub(c.model.mesh.position);if(tmp.length()<7)c.routeIndex=(c.routeIndex+1)%trafficRoute.length;
   const desired=Math.atan2(tmp.x,tmp.z);c.heading+=clamp(angleDiff(c.heading,desired),-dt*1.8,dt*1.8);
   const nearPlayer=c.model.mesh.position.distanceTo(player.mesh.position)<5;
   c.speed=damp(c.speed,nearPlayer?0:7.5,2,dt);
   moveBody(c.model.mesh.position,Math.sin(c.heading)*c.speed*dt,Math.cos(c.heading)*c.speed*dt,1);
   c.model.mesh.rotation.y=c.heading;
  }
  if(c.police&&c.health>0&&state.wanted>0&&elapsed-wantedSince>5&&c!==currentCar){
   const chaseTarget=player.mesh.position.clone();const policePos=c.model.mesh.position;const dist=policePos.distanceTo(chaseTarget);
   const policeRoad=policePos.x>40?80:0,targetRoad=chaseTarget.x>40?80:0;
   if(policeRoad!==targetRoad){
    const cross=[-90,0,90].sort((a,b)=>(Math.abs(policePos.z-a)+Math.abs(chaseTarget.z-a))-(Math.abs(policePos.z-b)+Math.abs(chaseTarget.z-b)))[0];
    if(Math.abs(policePos.z-cross)>7)chaseTarget.set(policeRoad,0,cross);else chaseTarget.set(targetRoad,0,cross);
   }else if(Math.abs(policePos.z-chaseTarget.z)>20)chaseTarget.x=policeRoad;
   tmp.copy(chaseTarget).sub(policePos);
   c.heading+=clamp(angleDiff(c.heading,Math.atan2(tmp.x,tmp.z)),-dt*2,dt*2);
   c.speed=damp(c.speed,dist>7?12+state.wanted*2:0,1.5,dt);
   const previous=policePos.clone();
   const hit=moveBody(c.model.mesh.position,Math.sin(c.heading)*c.speed*dt,Math.cos(c.heading)*c.speed*dt,1);
   if(vehicles.some(other=>other!==c&&carsOverlap(policePos,c.heading,other.model.mesh.position,other.heading))){policePos.copy(previous);c.speed=0;}
   if(hit)c.heading+=dt*2;c.model.mesh.rotation.y=c.heading;
   if(dist<11&&elapsed-wantedSince>10){state.health=Math.max(0,state.health-dt*(2+state.wanted));if(Math.floor(elapsed*2)!==Math.floor((elapsed-dt)*2))spawnEffect(player.mesh.position.clone().add(new THREE.Vector3(0,1,0)),0xffb55b,2);}
  }else if(c.police)c.speed=0;
  c.model.update(dt,c.speed,c.steer);
 }
}
function updatePedestrians(dt){
 for(const p of pedestrians){
  p.actor.mesh.visible=p.actor.mesh.position.distanceTo(camera.position)<85;
  if(!p.actor.mesh.visible)continue;
  if(p.down){p.actor.update(dt,{speed:0,dead:true});if(elapsed>p.recoverAt)p.down=false;continue;}
  const flee=p.fleeUntil>elapsed;let direction=p.direction;
  if(flee){direction=p.actor.mesh.position.z<player.mesh.position.z?-1:1;}
  p.actor.mesh.position.z+=direction*(flee?5.5:1.15)*dt;
  if(p.actor.mesh.position.z<-180)p.direction=1;if(p.actor.mesh.position.z>140)p.direction=-1;
  p.actor.mesh.rotation.y=damp(p.actor.mesh.rotation.y,direction<0?Math.PI:0,8,dt);
  p.actor.update(dt,{speed:flee?5.5:1.15});
 }
}
function clipCameraBoom(head,target){
 const offset=target.clone().sub(head),steps=Math.max(1,Math.ceil(offset.length()/.25));
 for(let i=1;i<=steps;i++){const point=head.clone().addScaledVector(offset,i/steps);if(collides(point.x,point.z,.2))return head.clone().addScaledVector(offset,Math.max(0,i-1)/steps);}
 return target;
}
function updateCamera(dt){
 if(!state.started){
  camera.position.set(9.8+Math.sin(elapsed*.045)*.32,2.15,28.7+Math.cos(elapsed*.045)*.2);camera.fov=52;camera.updateProjectionMatrix();camera.lookAt(-3.2,2.8,-12);return;
 }
 const base=player.mesh.position;
 if(currentCar&&elapsed-lookTimer>2.5)yaw+=angleDiff(yaw,currentCar.heading+Math.PI)*Math.min(1,dt*2.8);
 const dist=currentCar?7.6:aiming?2.7:4.5;
 const height=currentCar?2.3:aiming?1.65:2.05;
 const offset=new THREE.Vector3(Math.sin(yaw)*dist,height+pitch*3,Math.cos(yaw)*dist);
 if(!currentCar&&!aiming)offset.add(new THREE.Vector3(Math.cos(yaw)*.55,0,-Math.sin(yaw)*.55));
 if(aiming)offset.add(new THREE.Vector3(Math.cos(yaw)*.65,0,-Math.sin(yaw)*.65));
 const head=base.clone().add(new THREE.Vector3(0,1.2,0));
 const desired=clipCameraBoom(head,base.clone().add(offset));
 camera.position.lerp(desired,1-Math.exp(-6*dt));
 // Clamp the smoothed position too, so orbiting a corner cannot interpolate through it.
 camera.position.copy(clipCameraBoom(head,camera.position));
 const look=base.clone().add(new THREE.Vector3(-Math.sin(yaw)*3,aiming?1.5:1.2,-Math.cos(yaw)*3));
 cameraLook.lerp(look,1-Math.exp(-10*dt));camera.lookAt(cameraLook);
 camera.fov=damp(camera.fov,currentCar?58+Math.min(10,Math.abs(currentCar.speed)*.2):aiming?43:55,4,dt);camera.updateProjectionMatrix();
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
 const simDt=state.paused||state.mapOpen?0:dt;
 elapsed+=simDt;doorTimer=Math.max(0,doorTimer-simDt);
 world.update?.(simDt,elapsed);
 markerDiamond.rotation.y+=simDt*.6;markerDiamond.position.y=4.8+Math.sin(elapsed*2)*.2;
 marker.visible=mission===1;
 if(state.started&&!state.paused&&!state.mapOpen){
  if(reloading){reloadRemaining=Math.max(0,reloadRemaining-dt);if(reloadRemaining===0){const count=Math.min(12-state.ammo,state.reserve);state.ammo+=count;state.reserve-=count;reloading=false;}}
  updatePlayer(dt);updateTraffic(dt);updatePedestrians(dt);
  if((mouseDown||keys.has('Mouse0')||keys.has('Shoot'))&&weapon)shoot();
  if(state.wanted>0&&elapsed-lastCrime>24&&police.model.mesh.position.distanceTo(player.mesh.position)>24){state.wanted--;lastCrime=elapsed-12;if(state.wanted===0){ui.toast('HEAT LOST','Back under the radar.');state.money+=150;}}
  if(mission===1&&currentCar&&player.mesh.position.distanceTo(goal)<9){mission=2;state.money+=750;state.objectiveTitle='The city is yours';state.objective='Cruise the coast. Explore. Stay out of trouble.';ui.toast('COASTAL RUN COMPLETE','+$750 · Welcome to Grand Theft Astra.');sound.notify();}
  if(state.health<=0&&respawnTimer===0){respawnTimer=3;ui.toast('BUSTED','Catching your breath…');}
  if(respawnTimer>0){respawnTimer-=dt;if(respawnTimer<=0){respawnTimer=0;restart();ui.toast('BACK ON YOUR FEET','A new day. A new opportunity.');}}
  if(state.health<100&&state.wanted===0)state.health=Math.min(100,state.health+dt*.6);
 }else if(!state.started){vehicles.forEach(c=>c.model.update(simDt,0,0));pedestrians.forEach(p=>{p.actor.mesh.visible=p.actor.mesh.position.distanceTo(camera.position)<85;p.actor.update(simDt,{speed:0});});player?.update(simDt,{speed:0});}
 for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=simDt;if(e.life<=0){scene.remove(e.mesh);e.mesh.geometry.dispose();e.mesh.material.dispose();effects.splice(i,1);}else{if(e.vel){e.vel.y-=9*simDt;e.mesh.position.addScaledVector(e.vel,simDt);}e.mesh.material.opacity=e.life/e.max;}}
 updateCamera(simDt);updateNightLights();
 if(player){const pos=player.mesh.position;if(pos.distanceTo(shadowAnchor)>28){shadowAnchor.copy(pos);sun.target.position.set(pos.x,0,pos.z);sun.position.copy(pos).add(sunOffset);renderer.shadowMap.needsUpdate=true;}state.location=pos.x>45?'DOWNTOWN · PALM AVENUE':pos.x<-25?'VESPUCCI BEACH':pos.z<-80?'NORTH COAST · OCEAN DRIVE':'VESPUCCI BOULEVARD';state.objectiveDistance=mission===2?0:Math.round(pos.distanceTo(mission===0?vehicles[0].model.mesh.position:goal));}
 const active=state.started&&!state.paused&&!state.mapOpen;
 sound.update({speed:state.speed/3.6,inCar:active&&state.inCar,wanted:active?state.wanted:0});
 uiTimer+=dt;miniTimer+=dt;
 if(uiTimer>.1){ui.update({...state,aiming:weapon&&!currentCar,reloading});uiTimer=0;}
 if(miniTimer>.08){drawMap(mapCanvas());miniTimer=0;}
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
 if(mission===1){ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(px(player.mesh.position.x),py(player.mesh.position.z));ctx.lineTo(px(0),py(player.mesh.position.z));ctx.lineTo(px(0),py(goal.z));ctx.lineTo(px(goal.x),py(goal.z));ctx.stroke();ctx.setLineDash([]);}
 for(const c of vehicles){const p=c.model.mesh.position;ctx.fillStyle=c.police?'#7caae3':c===currentCar?'#f4bc77':'#b6c0bb';ctx.save();ctx.translate(px(p.x),py(p.z));ctx.rotate(-c.heading);ctx.fillRect(-2,-3,4,6);ctx.restore();}
 if(mission===1){ctx.fillStyle='#f6bd78';ctx.beginPath();ctx.arc(px(goal.x),py(goal.z),full?7:5,0,Math.PI*2);ctx.fill();}
 const pos=player.mesh.position;ctx.save();ctx.translate(px(pos.x),py(pos.z));ctx.rotate(-(currentCar?currentCar.heading:player.mesh.rotation.y));ctx.fillStyle='#fff5e2';ctx.shadowColor='#000';ctx.shadowBlur=5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(-5,-5);ctx.lineTo(0,-2);ctx.lineTo(5,-5);ctx.closePath();ctx.fill();ctx.restore();
 if(full){ctx.font='600 13px sans-serif';ctx.fillStyle='#c7cfca';ctx.fillText('VESPUCCI',px(-63),py(-25));ctx.fillText('DOWNTOWN',px(52),py(-150));ctx.save();ctx.translate(px(-109),h*.65);ctx.rotate(-Math.PI/2);ctx.fillStyle='#78959d';ctx.fillText('PACIFIC OCEAN',0,0);ctx.restore();}
}

window.addEventListener('keydown',e=>{
 if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code))e.preventDefault();
 if(!keys.has(e.code))action(e.code);keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();mouseDown=false;aiming=false;if(state.started)pause(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.started)pause(true);});
canvas.addEventListener('contextmenu',e=>e.preventDefault());
canvas.addEventListener('pointerdown',e=>{
 if(!state.started||state.paused||state.mapOpen)return;
 if(e.button===2){aiming=weapon;canvas.setPointerCapture(e.pointerId);}
 if(e.button===0){mouseDown=true;if(weapon)shoot();else canvas.setPointerCapture(e.pointerId);}
});
window.addEventListener('pointerup',e=>{if(e.button===0)mouseDown=false;if(e.button===2)aiming=false;});
window.addEventListener('pointermove',e=>{
 if(!state.started||state.paused||state.mapOpen)return;
 if(e.buttons||document.pointerLockElement===canvas){yaw-=e.movementX*.004;pitch=clamp(pitch+e.movementY*.003,-.28,1);lookTimer=elapsed;}
});
canvas.addEventListener('dblclick',()=>{if(state.started&&!state.paused)canvas.requestPointerLock?.();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);rendering.resize();});

// A read-only diagnostic view keeps real browser verification reproducible.
Object.defineProperty(window,'__GRAND_THEFT_ASTRA__',{value:{getState:()=>({...state,position:player?.mesh.position.toArray(),carPosition:currentCar?.model.mesh.position.toArray(),mission,reloading,reloadRemaining,elapsed,policePosition:police.model.mesh.position.toArray(),characterLoaded:!!player,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,vehicles:vehicles.length,pedestrians:pedestrians.length,softwareRenderer:!!softwareRenderer,pixelRatio:renderer.getPixelRatio(),cameraPosition:camera.position.toArray()})}});

async function boot(){
 try{
  const [skyData]=await Promise.all([atmosphere.ready,world.ready,loadCharacterAssets()]);
  if(skyData?.texture){
   const pmrem=new THREE.PMREMGenerator(renderer);
   const dayEnvironment=pmrem.fromEquirectangular(skyData.texture).texture;
   const nightEnvironment=skyData.nightTexture?pmrem.fromEquirectangular(skyData.nightTexture).texture:dayEnvironment;
   vehicleNightEnvironment=nightEnvironment;
   atmosphere.setEnvironment(dayEnvironment,nightEnvironment);
   scene.environmentRotation.copy(skyData.rotation);
   sunOffset.copy(skyData.sunDirection).multiplyScalar(140);
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
  reflectionCamera.update(renderer,scene);
  vehicles.forEach(car=>car.model.mesh.visible=true);
  const carPMREM=new THREE.PMREMGenerator(renderer);
  const vehicleEnvironment=carPMREM.fromCubemap(reflectionTarget.texture).texture;
  vehicleDayEnvironment=vehicleEnvironment;
  vehicles.forEach(car=>car.model.mesh.traverse(object=>{
   const materials=Array.isArray(object.material)?object.material:[object.material];
   for(const material of materials)if(material?.isMeshStandardMaterial){material.envMap=vehicleEnvironment;material.userData.dayEnvIntensity=material.envMapIntensity;material.needsUpdate=true;}
  }));
  carPMREM.dispose();reflectionTarget.dispose();setTime(requestedNight);renderer.shadowMap.needsUpdate=true;
  player=createCharacter();player.mesh.position.set(1.4,0,23);player.mesh.rotation.y=Math.PI;player.setWeapon(false);addContactShadow(player.mesh,1.4,1.4);scene.add(player.mesh);
  const npcSpawns=[[-13,8],[-13,-30],[13,-38],[13,45],[-13,-75],[13,-128],[67,-54],[93,10]];
  npcSpawns.forEach(([x,z],i)=>{const actor=createCharacter({npc:true,color:[0x657d78,0x8d6e62,0xb5a68a,0x697a90][i%4]});const direction=i%2?1:-1;addContactShadow(actor.mesh,1.2,1.2);actor.mesh.position.set(x,0,z);actor.mesh.rotation.y=direction<0?Math.PI:0;scene.add(actor.mesh);pedestrians.push({actor,direction,homeDirection:direction,home:new THREE.Vector3(x,0,z),down:false,recoverAt:0,fleeUntil:0});});
  state.ready=true;ui.setReady(true);
 }catch(error){console.error('Unable to initialize city',error);ui.toast('COULD NOT LOAD THE CITY','Please refresh to try again.');}
 lastFrame=performance.now();requestAnimationFrame(frame);
}
function frame(now){
 const wallDt=Math.max(0,(now-lastFrame)/1000),dt=Math.min(wallDt,.15);lastFrame=now;frameCount++;fpsTimer+=wallDt;
 if(fpsTimer>1){state.fps=Math.round(frameCount/fpsTimer);frameCount=0;fpsTimer=0;}
 const steps=Math.max(1,Math.ceil(dt/.033));for(let i=0;i<steps;i++)updateGame(dt/steps);rendering.render();requestAnimationFrame(frame);
}
boot();
