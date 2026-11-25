import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

export async function createScene(canvas, config) {
  const context = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!context) throw new Error('WebGL 2 is unavailable');
  const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(config.width, config.height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = config.shadows;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.background);
  const camera = new THREE.PerspectiveCamera(config.camera.fovDegrees, config.width/config.height, config.camera.near, config.camera.far);
  scene.add(new THREE.AmbientLight(config.ambient.color, config.ambient.intensity));
  const sun = new THREE.DirectionalLight(config.sun.color, config.sun.intensity);
  sun.position.set(...config.sun.position);
  sun.castShadow = config.shadows;
  sun.shadow.mapSize.setScalar(config.shadowMapSize);
  Object.assign(sun.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:.1,far:160});
  sun.shadow.bias = -.0005;
  scene.add(sun);
  const box = new THREE.BoxGeometry(1,1,1);
  const material = color => new THREE.MeshStandardMaterial({ color, roughness:.85, metalness:0 });
  const ground = new THREE.Mesh(box,material(config.ground.color));
  ground.scale.set(config.ground.size,.2,config.ground.size);
  ground.position.y=-.1; ground.castShadow=true; ground.receiveShadow=true; scene.add(ground);
  const mats=config.buildings.colors.map(material);
  for(let row=0;row<8;row++) for(let col=0;col<8;col++) {
    const h=4+((row*13+col*7)%14);
    const mesh=new THREE.Mesh(box,mats[(row+col)%4]);
    const x=(col-3.5)*10,z=(row-3.5)*10;
    mesh.position.set(x+Math.sign(x)*config.buildings.roadOffset,h/2,z+Math.sign(z)*config.buildings.roadOffset);
    mesh.scale.set(6,h,6); mesh.castShadow=true;mesh.receiveShadow=true;scene.add(mesh);
  }
  const loader=new GLTFLoader();
  const [car, character] = await Promise.all([loader.loadAsync(config.assets.car.url),loader.loadAsync(config.assets.character.url)]);
  const prepare = root => root.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  for(const pos of config.assets.car.positions) {
    const root=car.scene.clone(true);root.position.set(...pos);root.rotation.y=config.assets.car.yaw;prepare(root);scene.add(root);
  }
  const mixers=[];
  const clip=THREE.AnimationClip.findByName(character.animations, config.assets.character.clip);
  if(!clip) throw new Error('Required Walk animation missing');
  for(const pos of config.assets.character.positions) {
    const root=clone(character.scene);root.position.set(...pos);prepare(root);scene.add(root);
    const mixer=new THREE.AnimationMixer(root);mixer.clipAction(clip).play();mixers.push(mixer);
  }
  const info={engine:'Three.js',version:THREE.REVISION,backend:'WebGL2',buildings:64,cars:2,characters:4,animatedCharacters:4,notes:['AmbientLight is an approximation of the other engines’ ambient models.','Hard directional shadows; shared box geometry, no instancing.']};
  return {
    info,
    render(t){
      for(const mixer of mixers) mixer.setTime(t);
      camera.position.set(Math.sin(t*.08)*65,32,Math.cos(t*.08)*65);camera.lookAt(0,4,0);
      renderer.render(scene,camera);
      info.drawCalls=renderer.info.render.calls;info.triangles=renderer.info.render.triangles;
    },
    dispose(){renderer.dispose();scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of [o.material].flat())m.dispose();});},
  };
}
