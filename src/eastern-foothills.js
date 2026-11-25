import * as THREE from 'three';

// A low inland ridge seen down the eastbound streets. The western ocean stays
// open. The terrain contours share one indexed surface and material.
export function createEasternFoothills() {
  const positions=[],colors=[],indices=[];
  const xs=[190,225,258,291,328,369,407,449,495];
  const levels=[0,.12,.38,.26,.68,.49,1,.66,0];
  const columns=97;
  const soil=new THREE.Color('#977e67'),grass=new THREE.Color('#737b61');
  const rock=new THREE.Color('#93918b'),color=new THREE.Color();
  const ridge=(z,center,span)=>Math.exp(-((z-center)**2)/(span*span));
  for(let row=0;row<xs.length;row++){
    for(let i=0;i<columns;i++){
      const z=-270+i*5.75;
      const phase=z+(row-4)*3.7;
      // Broad saddles and overlapping spurs form a long, low coastal range.
      const profile=11+32*ridge(phase,-66,67)+25*ridge(phase,56,44)+26*ridge(phase,148,57);
      const drainage=.5+.5*Math.sin(z*.071+row*.56+Math.sin(z*.027)*1.4);
      const rough=1.7*Math.sin(z*.16+row*.79)+1.1*Math.sin(z*.29-row*.51);
      const edge=Math.min(1,i/10,(columns-1-i)/10);
      const altitude=-2+edge*levels[row]*(profile+6.6*drainage+rough);
      const x=xs[row]+levels[row]*(10*Math.sin(z*.037+row*.47)+5*Math.sin(z*.11));
      positions.push(x,altitude,z);
      color.copy(soil).lerp(grass,.27+.59*drainage).lerp(rock,Math.max(0,levels[row]-.37)*.62);
      colors.push(color.r,color.g,color.b);
      if(row && i){
        const d=row*columns+i,c=d-1,b=d-columns,a=b-1;
        indices.push(a,b,c,b,d,c);
      }
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({
    vertexColors:true,roughness:1,envMapIntensity:.45,
  }));
  mesh.name='Inland foothills · east of Los Pacificos';
  return mesh;
}
