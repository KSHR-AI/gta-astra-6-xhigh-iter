// An enamel office blade hangs across the north end of the canopy.
// The mounting rods and relieved reverse face are visible from the sidewalk.
import * as THREE from 'three';

export function addPalomaArrival({box, cylinder, instance, materials: m, canvasTexture}) {
  const x = -16.44, z = 15.98, y = 2.89;
  const cabinet = new THREE.Shape();
  cabinet.moveTo(-1.33, -.16);
  cabinet.quadraticCurveTo(-1.48, .01, -1.32, .23);
  cabinet.quadraticCurveTo(-1.17, .47, -.89, .45);
  cabinet.lineTo(1.28, .29);
  cabinet.quadraticCurveTo(1.44, .28, 1.37, .13);
  cabinet.lineTo(1.14, -.22);
  cabinet.quadraticCurveTo(1.10, -.30, .93, -.30);
  cabinet.lineTo(-.77, -.35);
  cabinet.quadraticCurveTo(-1.12, -.48, -1.33, -.16);
  const shell = new THREE.ExtrudeGeometry(cabinet, {depth:.15, bevelEnabled:true, bevelThickness:.035, bevelSize:.035, bevelSegments:2, curveSegments:12});
  instance(shell,m.metal,[x,y,z-.075],[1,1,1]);

  const artwork = canvasTexture(1024,320,c => {
    c.fillStyle='#194b4b'; c.fillRect(0,0,1024,320);
    // Screen-printed sun and white dove on the rounded heel.
    c.fillStyle='#dc7654'; c.beginPath(); c.arc(173,159,115,0,Math.PI*2); c.fill();
    c.fillStyle='#fff2cb';
    c.beginPath(); c.moveTo(70,173); c.bezierCurveTo(106,165,128,169,149,177);
    c.bezierCurveTo(133,138,113,110,107,78); c.bezierCurveTo(148,103,182,128,201,153);
    c.bezierCurveTo(207,138,219,132,231,137); c.lineTo(248,141); c.lineTo(229,148);
    c.bezierCurveTo(206,186,177,215,140,200); c.lineTo(81,218); c.lineTo(103,192); c.closePath(); c.fill();
    c.fillStyle='#faebc7'; c.font='italic bold 104px Georgia,serif'; c.fillText('Paloma',307,158);
    c.font='bold 46px sans-serif'; c.fillText('O F F I C E',324,223);
    c.lineWidth=9; c.strokeStyle='#edaf71'; c.beginPath(); c.moveTo(767,182); c.lineTo(678,182); c.lineTo(704,160); c.moveTo(678,182); c.lineTo(704,204); c.stroke();
  });
  const enamel = new THREE.MeshStandardMaterial({map:artwork, emissiveMap:artwork, emissive:'#fff0da', emissiveIntensity:.32, roughness:.39});
  const face = new THREE.ShapeGeometry(cabinet,18);
  const positions = face.attributes.position, uv = face.attributes.uv;
  for (let i=0;i<uv.count;i++) uv.setXY(i,(positions.getX(i)+1.42)/2.82,(positions.getY(i)+.43)/.90);
  instance(face,enamel,[x,y,z+.112],[1,1,1],[0,0,0],false);
  for (const height of [-.13,.11]) box(m.teal,x,y+height,z-.12,2.28,.04,.04);
  for(const [offset,top] of [[-.83,3.34],[.89,3.21]]) {
    cylinder(m.blackMetal,x+offset,(3.61+top)/2,z,.028,3.61-top);
    cylinder(m.metal,x+offset,top,z,.066,.08);
    box(m.metal,x+offset,3.57,z,.19,.065,.20);
  }
}
