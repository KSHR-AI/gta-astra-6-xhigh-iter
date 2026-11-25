import * as THREE from 'three';

const width = 9.1, height = 4.83, slatCount = 29, pitch = height / slatCount;
const drumRadius = .46;

// The continuous curtain follows its guides onto the drum inside the header.
// Thirty stamped slats, including the yellow bottom rail, share a single draw.
export function createWorkshopShutter(parent) {
  const profile = new THREE.Shape();
  profile.moveTo(-.033, -pitch / 2); profile.lineTo(.035, -pitch / 2);
  profile.lineTo(.035, pitch / 2); profile.lineTo(-.033, pitch / 2);
  profile.lineTo(-.06, pitch * .32); profile.lineTo(-.06, -pitch * .32);
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile,{depth:width,bevelEnabled:false});
  geometry.translate(0,0,-width/2);
  const slats = new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:'#ffffff',metalness:.28,roughness:.52}),slatCount);
  slats.name='Astra Auto Works · rolling shutter';
  slats.position.set(17.95,.035,-126);
  slats.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const object = new THREE.Object3D();
  for(let i=0;i<slatCount;i++) {
    slats.setColorAt(i,new THREE.Color(i===0?'#dfa74e':i%5===1?'#748982':'#81978f'));
  }
  function pose(open) {
    for(let i=0;i<slatCount;i++) {
      const y = (i+.5)*pitch + open*height;
      if(y<=height) {
        object.position.set(0,y,0);
        object.rotation.z=0;
      } else {
        const angle=(y-height)/drumRadius;
        object.position.set(drumRadius*(1-Math.cos(angle)),height+drumRadius*Math.sin(angle),0);
        object.rotation.z=-angle;
      }
      object.updateMatrix();slats.setMatrixAt(i,object.matrix);
    }
    slats.instanceMatrix.needsUpdate=true;
  }
  let open=0,hold=0;
  pose(open);
  slats.boundingSphere = new THREE.Sphere(new THREE.Vector3(.4,2.6,0),5.55);
  parent.add(slats);
  return {
    get open(){return open;},
    update(dt,car,person) {
      if(!(dt>0))return open;
      // Start early enough for a fast arrival and keep the guides clear for
      // a pedestrian or a driver reversing out of the bay.
      const inRange=(p,range)=>p && Math.abs(p.x-18)<range && Math.abs(p.z+126)<range;
      if(inRange(car,33)||inRange(person,12))hold=3;
      else hold=Math.max(0,hold-dt);
      const next=THREE.MathUtils.clamp(open+(hold>0?dt*.67:-dt*.32),0,1);
      if(next!==open){open=next;pose(open);}
      return open;
    },
  };
}
