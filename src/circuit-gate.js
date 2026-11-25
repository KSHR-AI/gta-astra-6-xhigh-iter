import * as THREE from 'three';

// One double-sided batch per gate, including the painted entry arc.
export function createCircuitGate() {
  const positions = [], colors = [];
  const navy = new THREE.Color(0x112936), mint = new THREE.Color(0x40f4c3), ivory = new THREE.Color(0xfff3d0);
  function quad(a, b, c, d, color) {
    for (const vertex of [a,b,c,a,c,d]) {
      positions.push(...vertex);
      colors.push(color.r, color.g, color.b);
    }
  }
  function panel(x0, y0, x1, y1, color, z = 0) {
    quad([x0,y0,z], [x1,y0,z], [x1,y1,z], [x0,y1,z], color);
  }
  // Keep tall brightly capped pylons clear of the driver's sightline.
  for (const side of [-1, 1]) {
    const x = side * 6.5;
    panel(x-.27,.12,x+.27,5.25,navy);
    for (const face of [-.025,.025]) {
      panel(x-.13,.14,x+.13,4.3,mint,face);
      panel(x-.26,4.55,x+.26,5.16,ivory,face);
    }
    quad([x,5.25,0],[x-side*1.15,6.38,0],[x-side*1.15,6.07,0],[x,4.94,0],mint);
  }
  panel(-5.36,6.07,-1.5,6.38,mint);
  panel(1.5,6.07,5.36,6.38,mint);
  panel(-1.5,5.76,1.5,6.7,navy);
  for (const face of [-.035,.035]) {
    for (let row=0; row<2; row++) for (let col=0; col<6; col++) {
      if ((row+col)%2===0) panel(-1.2+col*.4,5.83+row*.4,-.8+col*.4,6.23+row*.4,ivory,face);
    }
  }
  // The arc marks where the 9 m radial trigger begins on approach.
  for (let i=0; i<16; i++) {
    const angle = -Math.PI*.27 + i*Math.PI*.54/16;
    const end = angle+Math.PI*.54/16*.79;
    const point = (a,r) => [Math.sin(a)*r,.12,-Math.cos(a)*r];
    quad(point(angle,8.88),point(end,8.88),point(end,8.56),point(angle,8.56),mint);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  const gate = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide,toneMapped:false}));
  gate.visible = false;
  return gate;
}
