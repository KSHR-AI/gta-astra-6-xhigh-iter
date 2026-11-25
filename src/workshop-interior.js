import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl } from './asset-url.js';

// Worktops, air receiver and tire storage are confined to these wall strips.
// Vehicle and pedestrian collision is registered even before the art streams.
const furnishings = [
  [32.9, -109.58, 24.6, 1.07, 1.01],
  [46.55, -126.15, 1.08, 8.2, 1.03],
  [29.0, -142.35, 8.3, .98, 2.0],
  [42.45, -141.95, 2.75, 1.32, 1.38],
];
const teal = '#346662', blue = '#456d72', red = '#963f36', iron = '#273433';
const steel = '#a4afa5', brass = '#be9655', cream = '#e3dcc1', rubber = '#303137';
const amber = '#c98b4b';
const halfPi = Math.PI / 2;

function buildShop(root, canv) {
  const groups = [[], []], panels = [], graphic = new THREE.Group();
  const basis = new THREE.Object3D();
  const boxShape = new THREE.BoxGeometry(), cylinderShape = new THREE.CylinderGeometry(1, 1, 1, 12);
  const pipeBend = new THREE.TorusGeometry(1, .10, 5, 16);
  const tireShape = new THREE.TorusGeometry(.335, .107, 8, 24);
  function part(shape, color, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0, lit = 0) {
    basis.position.set(x,y,z); basis.rotation.set(rx,ry,rz); basis.scale.set(w,h,d); basis.updateMatrix();
    const g = shape.clone().applyMatrix4(basis.matrix);
    const tone = new THREE.Color(color), rgb = new Float32Array(g.attributes.position.count * 3);
    for (let i=0; i<rgb.length; i+=3) tone.toArray(rgb,i);
    g.setAttribute('color',new THREE.BufferAttribute(rgb,3));
    groups[lit].push(g);
  }
  const box = (...args) => part(boxShape,...args);
  const roll = (...args) => part(cylinderShape,...args);
  const emissive = (color,x,y,z,w,h,d) => box(color,x,y,z,w,h,d,0,0,0,1);
  const eye = (x,y,z,r) => part(pipeBend,steel,x,y,z,r,r,r);
  const insert = (row,x,y,z,w,h,angle=0) => {
    const g=new THREE.PlaneGeometry(w,h);
    const uv=g.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setY(i,(2-row+uv.getY(i))/3);
    g.rotateY(angle).translate(x,y,z);
    panels.push(g);
  };
  // A long red-enamel service bench faces the delivery bay. Open leg bays
  // separate the rolling tool chests and leave room for a mechanic's knees.
  box(iron,32.9,1,-109.58,24.6,.09,1.07);
  box('#b59871',32.9,1.075,-109.58,24.6,.09,1.08);
  box(steel,32.9,1.016,-110.13,24.6,.075,.032);
  box(teal,32.9,.49,-109.03,24.7,.89,.08);
  for(const x of [21.35,25.5,29.75,34,38.4,42.85]) {
    box(red,x+.43,.49,-109.64,1.60,.83,.77);
    for(const side of [-.62,.62]) box(rubber,x+.43+side,.103,-109.68,.14,.13,.55);
    for(let i=0;i<4;i++) {
      box('#ad5143',x+.43,.275+i*.166,-110.037,1.49,.137,.04);
      box(steel,x+.43,.313+i*.166,-110.069,1.24,.023,.037);
    }
    for(const dz of [-.43,.40]) box(teal,Math.min(x+2.56,45.12),.5,-109.58+dz,.085,1,.085);
  }
  // Cream enamel upper cabinets and the lit perforated tool panels sit at
  // arm height. Each wrench and socket rail projects in front of its outline.
  const zBoard=-109.045;
  for(const x of [23.65,32.9,42.15]){
    box(iron,x,1.99,zBoard,6.02,1.60,.11);
    insert(0,x,1.99,zBoard-.058,5.90,1.48,Math.PI);
    for(let n=0;n<7;n++){
      const xx=x-2.30+n*.38, length=.42+n*.043;
      box(steel,xx,2.19-length*.5,-109.14,.052,length,.04);
      eye(xx,2.20,-109.14,.077);
      box(steel,xx-.043,2.16-length,-109.14,.037,.092,.041,0,0,-.28);
      box(steel,xx+.043,2.16-length,-109.14,.037,.092,.041,0,0,.28);
    }
    box(steel,x+1.55,1.72,-109.14,1.72,.064,.085);
    for(let n=0;n<6;n++)roll('#bdc2b4',x+.89+n*.25,1.84,-109.16,.058+n*.004,.17,.058+n*.004);
    box(teal,x,2.88,-109.28,6.12,.19,.62);
    emissive('#fff3cc',x,2.773,-109.47,5.82,.036,.096);
  }
  for(const x of [27.93,37.66]){
    box(cream,x,2.06,-109.24,1.64,1.44,.48);
    for(const side of [-1,1]) {
      box('#c7c9b9',x+side*.404,2.06,-109.50,.775,1.34,.036);
      box(iron,x+side*.108,1.93,-109.54,.036,.25,.053);
    }
  }
  // Cast-iron bench vise, grinder, bottles and a tray of sockets.
  for(const x of [24.0,39.8]) {
    box(teal,x,1.18,-109.79,.54,.13,.42);
    box(blue,x,1.40,-109.82,.38,.35,.28);
    for(const side of [-1,1])box(steel,x+side*.17,1.59,-109.82,.115,.10,.30);
    roll(steel,x+.38,1.34,-109.82,.034,.41,.034,0,0,halfPi);
    box(iron,x+.58,1.34,-109.82,.033,.29,.033);
  }
  roll(blue,32.6,1.37,-109.70,.185,.47,.185,0,0,halfPi);
  for(const side of [-1,1]) roll('#847d68',32.6+side*.30,1.37,-109.70,.215,.08,.215,0,0,halfPi);
  for(const [j,x] of [21.4,21.70,29.3,34.7,35.03,42.3,42.6].entries()){
    const h=.25+(j%3)*.09;
    roll([amber,cream,blue][j%3],x,1.12+h/2,-109.53,.095,h,.095);
    roll(iron,x,1.14+h,-109.53,.062,.035,.062);
  }

  // The hand-painted enamel sign is the side-on handoff focal point.
  box(iron,33.0,4.55,-109.04,10.90,3.48,.135);
  box(brass,33.0,4.55,-109.12,10.78,3.37,.046);
  const signMaterial=new THREE.MeshStandardMaterial({
    color:'#f2ebd4',roughness:.69,metalness:.15,emissive:'#fff2ca',emissiveIntensity:.31,
  });
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(10.64,3.25),signMaterial);
  sign.position.set(33.0,4.55,-109.149);sign.rotation.y=Math.PI;
  sign.visible=false;graphic.add(sign);
  new THREE.TextureLoader().load(assetUrl('art/world/astra-workshop.webp'),texture=>{
    texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
    signMaterial.map=texture;signMaterial.emissiveMap=texture;signMaterial.needsUpdate=true;sign.visible=true;
  },undefined,()=>{sign.visible=false;});
  for(const x of [26.95,39.05]) {
    box(teal,x,4.52,-109.15,.12,3.28,.31);
    box(amber,x,4.52,-109.32,.045,2.74,.035);
  }

  // The driver approaches the east wall before turning to Mara. A second
  // bench and an illuminated alignment board fill the gap between the old lifts.
  const ex=46.55,ez=-126.15;
  box(teal,ex,.52,ez,1.04,.95,8.2);
  box(steel,ex,1.04,ez,1.11,.08,8.22);
  for(let i=0;i<6;i++){
    const zz=ez-3.42+i*1.37;
    box(i%3===1?blue:teal,ex-.54,.54,zz,.04,.78,1.26);
    box(steel,ex-.57,.77,zz,.032,.035,.97);
  }
  box(iron,47.99,2.28,ez,.13,1.91,7.64);
  insert(1,47.913,2.28,ez,7.49,1.77,-halfPi);
  box(teal,47.80,3.34,ez,.49,.16,7.81);
  emissive('#ffe7ae',47.63,3.247,ez,.11,.031,7.42);
  for(const z of [-130.8,-121.45]){
    box(blue,47.81,2.36,z,.42,2.38,.54);
    for(let i=0;i<3;i++)box(steel,47.59,3.19-i*.11,z,.027,.038,.32);
  }

  // Equip the two existing lift benches rather than adding islands to the
  // turning floor. The wall displays are above those benches, behind the posts.
  for (const [bay,z] of [-136,-116].entries()) {
    if (!bay) {
      insert(2,47.92,2.66,z,7.93,1.95,-halfPi);
      for (const dz of [-2.6,2.6]) {
        part(tireShape,rubber,47.69,2.60,z+dz,1.14,1.14,1.14,0,halfPi,0);
        roll(steel,47.69,2.60,z+dz,.268,.23,.268,0,0,halfPi);
        roll(iron,47.56,2.60,z+dz,.076,.03,.076,0,0,halfPi);
      }
      // Two lead-acid batteries and the upright battery tester.
      for (const dz of [-1.52,-.57]) {
        box(iron,44.55,1.52,z+dz,.53,.50,.71);
        box('#c2b397',44.55,1.79,z+dz,.57,.06,.75);
        for(const off of [-.22,.22])roll(off<0?red:steel,44.55,1.84,z+dz+off,.045,.057,.045);
      }
      box(blue,44.66,1.66,z+1.58,.54,.79,.64);
      box(cream,44.37,1.81,z+1.58,.044,.29,.49);
    } else {
      for(const dz of [-3.45,0,3.45])box(teal,47.68,2.64,z+dz,.49,1.77,.067);
      for(const y of [1.93,2.60,3.27]) {
        box(steel,47.68,y,z,.60,.060,7.02);
        for(let n=0;n<7;n++){
          const zz=z-2.89+n*.96;
          if(y===3.27 && n%2)continue;
          box([red,'#ad8151',teal,cream][n%4],47.66,y+.198,zz,.43,.31,.57);
          box(cream,47.425,y+.225,zz,.023,.09,.23);
        }
      }
      for(let n=0;n<5;n++){
        const zz=z-1.01+n*.44;
        roll(n%2?cream:red,44.67,1.50,zz,.16,.48,.16);
        roll(steel,44.67,1.75,zz,.16,.04,.16);
      }
    }
    // Lift screw chains, hydraulic reservoir, height control and arm pads.
    for (const [index,x] of [27,36.5].entries()) {
      const dir=index?-1:1;
      box(iron,x,.98,z-.333,.13,1.79,.026);
      box(steel,x,2.84,z-.337,.036,.93,.030);
      box(blue,x+.22*dir,1.32,z,.30,.63,.36);
      box(amber,x+.22*dir,1.49,z-.191,.22,.19,.027);
      roll(iron,x+.22*dir,1.20,z-.208,.056,.035,.056,halfPi);
      roll(iron,x+dir*1.31,.327,z,.185,.085,.185);
      for(const d of [-1,1])box('#b99758',x+d*.50,.045,z,.066,.012,1.10);
    }
  }
  // The opposite wall stores mounted wheels on two levels. A freestanding
  // compressor and coiled air hose remain outside both nine-metre lift bays.
  for(const x of [25.1,29.0,32.9])for(const dz of [-.42,.42])
    box(teal,x,1.11,-142.35+dz,.072,2.1,.072);
  for(const h of [.29,1.38])for(const dz of [-.32,.32])
    box(steel,29,h,-142.35+dz,8.02,.063,.065);
  for(let i=0;i<12;i++){
    const xx=25.58+(i%6)*1.24,h=i<6?.70:1.79;
    part(tireShape,rubber,xx,h,-142.35,1,1,1,0,halfPi,0);
    if(i%3!==1) roll(steel,xx,h,-142.35,.234,.12,.234,0,0,halfPi);
  }
  for(const x of [41.66,43.24]) box(iron,x,.15,-141.95,.27,.24,.77);
  roll('#b26446',42.45,.56,-141.95,.42,2.31,.42,0,0,halfPi);
  for(const x of [41.27,43.63])roll('#934b36',x,.56,-141.95,.405,.075,.405,0,0,halfPi);
  box(iron,42.45,1.04,-141.95,1.33,.13,.48);
  roll(blue,42.3,1.26,-141.97,.185,.67,.185,0,0,halfPi);
  for(let i=0;i<5;i++)box(steel,42.85,1.22+i*.045,-141.96,.41,.023,.34);
  for(const x of [22.75,43.2]){
    roll('#9d5038',x,2.42,-109.28,.38,.34,.38,halfPi);
    for(let j=0;j<3;j++)part(pipeBend,iron,x+.46,1.72,-109.26-j*.026,.28,.48,.28);
  }
  // Two inspection gantries add a foreground ceiling silhouette. No lights
  // are added to the scene's dynamic light list.
  for(const z of [-132.4,-119.5]){
    for(const x of [24,36.4]){
      for(const dx of [-1.6,1.6])box(iron,x+dx,5.98,z,.029,.58,.029);
      box(teal,x,5.67,z,3.66,.14,.42);
      for(const dz of [-.10,.10])emissive('#fff0cc',x,5.585,z+dz,3.47,.032,.043);
    }
  }
  const atlas=canv(768,576,(c,w)=>{
    for(let row=0;row<3;row++){
      const y=row*192;
      const gradient=c.createLinearGradient(0,y,0,y+192);
      gradient.addColorStop(0,row===1?'#84928a':'#8c8e76');
      gradient.addColorStop(.5,row===1?'#456059':'#5d6f61');
      gradient.addColorStop(1,'#364e46');c.fillStyle=gradient;c.fillRect(0,y,w,192);
      if(!row){
        c.fillStyle='#30413b';
        for(let x=6;x<w;x+=13)for(let yy=y+6;yy<y+192;yy+=13)c.fillRect(x,yy,2,2);
      }else if(row===2){
        c.fillStyle='#2b4e49';c.fillRect(0,y,w,192);
        c.strokeStyle='#d6b776';c.lineWidth=4;c.strokeRect(10,y+10,w-20,172);
        c.fillStyle='#efdbb0';c.textAlign='center';c.font='bold 45px Arial';c.fillText('BRAKE SERVICE',384,y+93,390);
        c.font='19px Arial';c.fillText('DRUMS    /    DISCS    /    HYDRAULICS',384,y+132,378);
      }else if(row===1){
        c.fillStyle='#f0dfab';c.textAlign='left';c.font='bold 41px Arial';
        c.fillText('ALIGNMENT',22,y+63);c.font='18px Arial';c.fillText('SUSPENSION   /   STEERING',24,y+101);
        c.strokeStyle='#c4d3bb';c.lineWidth=3;
        c.strokeRect(350,y+64,360,69);c.beginPath();c.moveTo(527,y+35);c.lineTo(527,y+158);c.stroke();
        for(const x of [383,671])for(const yy of [y+52,y+126]){c.fillStyle='#b6c3ac';c.fillRect(x,yy,16,31);}
      }
    }
  });
  const boardMaterial=new THREE.MeshStandardMaterial({map:atlas,roughness:.86,emissive:0xffffff,emissiveMap:atlas,emissiveIntensity:.24});
  const batches=groups.map((items,i)=>new THREE.Mesh(mergeGeometries(items),i?
    new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false}):
    new THREE.MeshStandardMaterial({vertexColors:true,roughness:.70,metalness:.17})));
  batches[0].castShadow=batches[0].receiveShadow=true;
  const board=new THREE.Mesh(mergeGeometries(panels),boardMaterial);
  graphic.add(...batches,board);graphic.name='Auto Works service interior';root.add(graphic);
  return graphic;
}

export function createWorkshopInterior(root,canvasTexture,colliders,lampPositions) {
  // Existing nearest-fixture lighting illuminates people and sheet metal at
  // night without adding another dynamic light or compiling another variant.
  for(const x of [24,36.4])for(const z of [-132.4,-119.5])lampPositions.push(new THREE.Vector3(x,5.50,z));
  for (const [x,z,w,d,h] of furnishings)colliders.push({
    minX:x-w/2,maxX:x+w/2,minZ:z-d/2,maxZ:z+d/2,minY:.0345,maxY:h,
  });
  let shop;
  return camera=>{
    const p=camera.position, near=Math.abs(p.x-33)<63 && Math.abs(p.z+126)<59;
    if(near && !shop)shop=buildShop(root,canvasTexture);
    if(shop)shop.visible=near;
  };
}
