import * as THREE from 'three';
import { assetUrl } from './asset-url.js';

// Street-facing signs, shop displays and canopies around the Ocean Drive crossing.
export function addVespucciFrontage({ box, line, cylinder, panel, instance, materials: m, canvasTexture, panelGeometry }) {
  const enamel = color => new THREE.MeshStandardMaterial({ color, roughness: .52 });
  const coral = enamel('#d65a42'), blue = enamel('#218d91'), butter = enamel('#f4c358');
  const mint = enamel('#a2cfc1');
  const signFace = (texture, glow = .16) => new THREE.MeshStandardMaterial({
    map: texture, emissiveMap: texture, emissive: '#ffe5c6', emissiveIntensity: glow,
    alphaTest: .42, side: THREE.DoubleSide, roughness: .72,
  });
  const print = (w, h, draw) => signFace(canvasTexture(w, h, draw));
  function type(c, text, x, y, size, color, family = 'sans-serif', weight = 'bold') {
    c.fillStyle = color;
    c.font = `${weight} ${size}px ${family}`;
    c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillText(text, x, y);
  }

  // The letters hang individually along a shallow catenary, with their common
  // printed face batched into one transparent-cutout plane. A second outward
  // face reads correctly to traffic arriving from the opposite direction.
  const districtLetters = canvasTexture(1536, 224, (c, w) => {
    const name = 'VESPUCCI';
    c.font = '900 147px sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    for (let i=0; i<name.length; i++) {
      const x=(i+.5)*w/name.length, y=110 + 28*(1-((x-w/2)/(w/2))**2);
      c.strokeStyle='#233e3b'; c.lineWidth=19; c.strokeText(name[i],x+2,y+4);
      c.strokeStyle='#a34a37'; c.lineWidth=9; c.strokeText(name[i],x,y);
      c.fillStyle='#ffe5a4'; c.fillText(name[i],x,y);
    }
  });
  const letters = signFace(districtLetters, .5);
  letters.side = THREE.FrontSide;
  const crossingZ = -13.8;
  panel(letters, 0, 8.7, crossingZ + .065, 14.4, 2.1, 0);
  panel(letters, 0, 8.7, crossingZ - .065, 14.4, 2.1, Math.PI);
  for (const x of [-14.5,14.5]) {
    cylinder(m.teal,x,5.55,crossingZ,.14,10.7);
    cylinder(m.blackMetal,x,.58,crossingZ,.29,.82);
    cylinder(m.trim,x,10.9,crossingZ,.21,.15);
  }
  const cable = x => 9.18 + 1.63 * (x/14.5)**2;
  for (let i=0; i<16; i++) {
    const a=-14.5+i*29/16, b=a+29/16;
    line(m.blackMetal,[a,cable(a),crossingZ],[b,cable(b),crossingZ],.041);
  }
  for (let i=0; i<8; i++) {
    const x=(i-3.5)*1.8;
    cylinder(m.blackMetal,x,cable(x)-.19,crossingZ,.023,.38,false);
  }

  // An enamel advertising panel sits on real stand-off steelwork above the
  // surf shop. Its screen-printed art and storefront share the same palette.
  const mural = new THREE.MeshStandardMaterial({ color: '#3c827c', roughness: .92 });
  const ready = new THREE.TextureLoader().loadAsync(assetUrl('art/world/calypso-surf.webp')).then(map => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    mural.color.set('#ffffff');
    mural.map = map;
    mural.needsUpdate = true;
  }).catch(error => console.warn('Calypso mural unavailable.', error));
  box(m.teal, 28, 13.23, -18.12, 10.65, 15.95, .23);
  panel(mural, 28, 13.23, -17.99, 10.42,15.7,0);
  for (const x of [23,33]) {
    box(m.blackMetal,x,13.2,-18.56,.11,15.8,.7);
    line(m.blackMetal,[x,20.9,-18.1],[x,21.65,-17.15],.05);
    box(m.trim,x,21.62,-17.13,.56,.13,.38);
  }
  const shopBand = print(1024,128,c=>{
    c.fillStyle='#1e5654';c.fillRect(0,0,1024,128);
    c.fillStyle='#f4bd76';c.fillRect(12,8,1000,3);c.fillRect(12,117,1000,3);
    type(c,'C A L Y P S O    S U R F    S U P P L Y',512,66,39,'#ffe3a3');
  });
  box(blue,32,3.7,-18.63,29.5,.72,.46);
  panel(shopBand,32,3.7,-18.38,28.9,.62,0);
  for (const x of [20.4,26.1,31.8,37.5,43.2]) {
    for (let i=0; i<8; i++) {
      const stripe = i%2 ? m.white : coral;
      const xx=x+(i-3.5)*.65;
      instance(panelGeometry,stripe,[xx,3.02,-18.22],[.655,1.53,1],[-1.23,0,0],true);
      box(stripe,xx,2.63,-17.50,.655,.29,.065);
    }
    for (const dx of [-2.45,2.45]) line(m.metal,[x+dx,2.24,-18.78],[x+dx,2.7,-17.54],.038);
  }
  const board = new THREE.LatheGeometry([[0,-1.18],[.16,-1.12],[.32,-.65],[.37,0],[.34,.52],[.23,.91],[.085,1.13],[0,1.19]].map(([x,y])=>new THREE.Vector2(x,y)),16);
  for (const [i,x] of [20,20.85,25.7,26.5,36.9,37.75,42.9].entries()) {
    const tilt=(i%3-1)*.11;
    instance(board,[mint,butter,coral][i%3],[x,1.43,-18.49],[1,.95,.33],[0,0,tilt]);
    line(m.trim,[x+.93*Math.sin(tilt),1.43-.93*Math.cos(tilt),-18.36],
      [x-.93*Math.sin(tilt),1.43+.93*Math.cos(tilt),-18.36],.017);
  }

  // The exchange dresses its display windows with framed destination prints.
  // Canvas artwork shares one atlas and keeps the illustrated paper crisp up close.
  const travelPrints = print(1024,512,(c)=>{
    for (let i=0;i<3;i++) {
      const x=i*342;
      c.save(); c.beginPath(); c.rect(x,0,342,512); c.clip(); c.translate(x,0);
      c.fillStyle=['#df985c','#ecc797','#87b7a8'][i]; c.fillRect(0,0,342,512);
      c.fillStyle='#f7d78b'; c.beginPath(); c.arc(242,132,63,0,Math.PI*2); c.fill();
      const hills=(y,amplitude,color,phase)=>{
        c.fillStyle=color; c.beginPath(); c.moveTo(-1,513);
        for(let j=0;j<=10;j++) c.lineTo(j*35,y+Math.sin(j*.7+phase)*amplitude+Math.sin(j*1.32+phase)*18);
        c.lineTo(350,513); c.closePath(); c.fill();
      };
      hills(244,48,'#6b9992',i+1); hills(318,32,'#396d6c',i+4); hills(390,20,'#204b50',i);
      type(c,['CATALINA','BAJA','BIG SUR'][i],171,52,45,'#243e3b','Georgia');
      type(c,'O R B I T   T R A V E L',171,466,17,'#f5dbb1');
      c.strokeStyle='#f2d9ad';c.lineWidth=13;c.strokeRect(5,5,332,502);c.restore();
    }
  });
  for (const x of [-42.9,-30.9]) {
    box(m.terracotta,x,1.8,-18.77,3.7,1.87,.14);
    panel(travelPrints,x,1.8,-18.68,3.61,1.8,0);
  }

  // A sculpted diner cup hangs over the corner, above a double-faced roadside
  // blade. The bowl, rim, handle and saucer read in silhouette from the street.
  const cupX=15.6, cupZ=17.35;
  cylinder(m.teal,cupX,4.2,cupZ,.15,8.15);
  box(coral,cupX,6.2,cupZ,3.45,2.35,.38);
  const dinerFace=print(640,384,c=>{
    c.fillStyle='#bb493c';c.fillRect(0,0,640,384);
    c.strokeStyle='#f4c992';c.lineWidth=8;c.strokeRect(16,16,608,352);
    type(c,'Sunline',320,147,126,'#ffefc4','Georgia','italic');
    type(c,'D  I  N  E  R',320,285,48,'#ffda84');
  });
  for(const side of [-1,1]) panel(dinerFace,cupX,6.2,cupZ+side*.202,3.28,2.19,side<0?Math.PI:0);
  const cup = new THREE.LatheGeometry([[0,0],[.52,0],[.72,.18],[.88,.61],[.97,1.06],[.91,1.09],[.82,.85],[0,.84]].map(([x,y])=>new THREE.Vector2(x,y)),32);
  instance(cup,m.white,[cupX,7.63,cupZ],[1.16,1.15,1.16]);
  cylinder(blue,cupX,7.59,cupZ,1.38,.15);
  cylinder(m.terracotta,cupX,8.64,cupZ,.94,.025,false);
  const handle = new THREE.TorusGeometry(.46,.11,8,20);
  instance(handle,m.white,[cupX+1.01,8.34,cupZ],[.94,1.0,1]);

  // The motel's projecting blade is visible along the street; the existing
  // office sign faces its guests at the door.
  const motelFace=print(384,1024,c=>{
    c.fillStyle='#27766f';c.beginPath();c.moveTo(22,24);c.lineTo(362,58);c.lineTo(362,955);c.lineTo(22,1000);c.closePath();c.fill();
    c.strokeStyle='#f2c486';c.lineWidth=9;c.stroke();
    for(const [i,letter] of Array.from('MOTEL').entries()) type(c,letter,193,141+i*174,156,'#fff0bd');
  });
  const bx=-17.15,bz=16.0;
  for (const y of [5.2,8.65]) {
    box(m.teal,bx-1.06,y,bz,2.7,.15,.15);
    line(m.metal,[bx-2.31,y-.55,bz],[bx-.78,y,bz],.044);
  }
  cylinder(m.teal,bx-2.31,6.3,bz,.11,5.6);
  for(const side of [-1,1]) panel(motelFace,bx,7,bz+side*.04,2.33,6.08,side<0?Math.PI:0);
  return ready;
}
