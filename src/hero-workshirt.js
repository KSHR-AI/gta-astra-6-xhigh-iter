import * as THREE from 'three';

let crest;
function garageCrest() {
  if (crest) return crest;
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 288;
  const c = canvas.getContext('2d');
  c.fillStyle = '#e4b35f'; c.strokeStyle = '#e4b35f';
  c.lineWidth = 7;
  // A wheel with swept speed lines and a cream tread, in two screen-print inks.
  for (const side of [-1,1]) {
    c.save(); c.translate(192,93); c.scale(side,1);
    for (let i=0;i<3;i++) {
      c.beginPath(); c.moveTo(36,-21+i*15); c.lineTo(143-i*22,-38+i*15);
      c.lineTo(130-i*22,-24+i*15); c.lineTo(40,-9+i*15); c.fill();
    }
    c.restore();
  }
  c.beginPath(); c.arc(192,85,45,0,Math.PI*2); c.stroke();
  c.lineWidth=4; c.beginPath(); c.arc(192,85,31,0,Math.PI*2); c.stroke();
  for(let i=0;i<5;i++) {
    const angle=i*Math.PI*2/5;
    c.beginPath();c.moveTo(192+10*Math.cos(angle),85+10*Math.sin(angle));
    c.lineTo(192+30*Math.cos(angle+.24),85+30*Math.sin(angle+.24));c.stroke();
  }
  c.textAlign='center'; c.textBaseline='middle'; c.fillStyle='#f5deaf';
  c.font='italic 900 78px sans-serif'; c.fillText('PACIFIC',192,177,355);
  c.fillStyle='#e4b35f'; c.font='bold 30px sans-serif'; c.fillText('M O T O R   W O R K S',192,233,321);
  c.fillRect(91,262,202,4);
  crest = new THREE.CanvasTexture(canvas);
  crest.colorSpace = THREE.SRGBColorSpace;
  crest.anisotropy = 4;
  return crest;
}

export function applyHeroWorkshirt(material) {
  const compile = material.onBeforeCompile, baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader,renderer) {
    compile.call(this,shader,renderer);
    shader.uniforms.garageCrest = {value:garageCrest()};
    // Interpolate the original garment coordinates before skinning. The ink
    // follows the same triangles through aiming, seated poses and every LOD.
    shader.vertexShader = 'varying vec3 vShirtBind;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>', `#include <begin_vertex>
      vShirtBind = position;
      float shoulderTailoring = smoothstep(.12,.18,abs(position.x)) *
        (1.-smoothstep(.22,.29,abs(position.x))) *
        smoothstep(.48,.55,position.y) * (1.-smoothstep(.60,.65,position.y));
      transformed += normal * (.0045 * shoulderTailoring * clamp(clothDye,0.,1.));`);
    shader.fragmentShader = 'uniform sampler2D garageCrest;\nvarying vec3 vShirtBind;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', `
      #include <color_fragment>
      vec2 badgeUv = vec2(.5 - vShirtBind.x / .38, (vShirtBind.y - .297) / .285);
      vec4 printInk = texture2D(garageCrest, clamp(badgeUv,0.,1.));
      float isBack = 1. - smoothstep(-.11,-.06,vShirtBind.z);
      float sleeve = abs(vShirtBind.x);
      float band = smoothstep(.226,.23,sleeve) * (1.-smoothstep(.245,.249,sleeve));
      band += smoothstep(.256,.259,sleeve) * (1.-smoothstep(.263,.266,sleeve));
      // A reinforced shoulder yoke follows the slope of each shoulder.
      float shoulderSeam = .552 - .35 * abs(vShirtBind.x);
      float seamDist = vShirtBind.y - shoulderSeam;
      float yoke = smoothstep(-.004,.004,seamDist)*isBack*wardrobeMask;
      diffuseColor.rgb *= 1. - .16*yoke;
      float stitch = (1.-smoothstep(.001,.003,abs(seamDist))) * isBack * wardrobeMask;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.41,.27,.13),stitch*.68);
      float folded = exp(-abs(vShirtBind.y-.265-.09*abs(vShirtBind.x))/.007);
      diffuseColor.rgb *= 1.-.14*folded*wardrobeMask;
      float textile = clamp(sourceLuminance * shirtDyeScale, .52, 1.22);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.71,.42,.115)*textile, band*wardrobeMask*.84);
      diffuseColor.rgb = mix(diffuseColor.rgb, printInk.rgb*textile, printInk.a*isBack*wardrobeMask*.92);
      `);
  };
  material.customProgramCacheKey = () => baseKey+'-pacific-workshirt';
}

// A bias-cut band wraps the fitted hair above the ears, with two short tails
// at the nape. Build in actor space, then attach it to the changing head pose.
export function fitMaraHeadscarf(model, head) {
  const hair = new THREE.Box3();
  const point = new THREE.Vector3();
  model.traverse(part => {
    const mask = part.geometry?.getAttribute('_hair_mask');
    if (!part.isSkinnedMesh || !mask) return;
    for (let i = 0; i < mask.count; i++) {
      if (mask.getX(i) < .85) continue;
      part.getVertexPosition(i, point);
      hair.expandByPoint(part.localToWorld(point));
    }
  });
  if (hair.isEmpty()) return null;
  const center = hair.getCenter(new THREE.Vector3());
  const width = hair.max.x - hair.min.x;
  const radius = width * .505;
  const front = hair.max.z;
  const group = new THREE.Group();
  group.name = 'Mara · tied linen headscarf';
  group.position.set(center.x, hair.max.y - width * .33, front - radius);
  const linen = new THREE.MeshStandardMaterial({color:0xe2a755, roughness:.97, side:THREE.DoubleSide});
  const seam = new THREE.MeshStandardMaterial({color:0x9a4737, roughness:.91});
  const band = new THREE.Mesh(new THREE.CylinderGeometry(radius*.97,radius, .036,36,1,true),linen);
  band.scale.z=1.05;band.rotation.x=.14;group.add(band);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(radius*.993,.0025,5,40),seam);
  edge.rotation.x=Math.PI/2+.14;edge.scale.y=1.05;edge.position.y=-.011;group.add(edge);
  for(const side of [-1,1]){
    const tail=new THREE.BufferGeometry();
    tail.setAttribute('position',new THREE.Float32BufferAttribute([
      0,0,-radius, side*.021,.005,-radius, side*.033,-.053,-radius-.018,
      0,0,-radius, side*.033,-.053,-radius-.018, side*.022,-.069,-radius-.024
    ],3));
    tail.computeVertexNormals();group.add(new THREE.Mesh(tail,linen));
  }
  group.traverse(part=>{if(part.isMesh){part.castShadow=true;part.receiveShadow=true;}});
  group.updateMatrixWorld(true);head.attach(group);
  return group;
}

// A waxed-canvas waist apron spans the front half of the hips. The higher
// outer corners and split hem leave the thighs free during a step.
export function fitMaraApron(hips, height) {
  const canvas = new THREE.MeshStandardMaterial({color:0x49615c,roughness:.94,side:THREE.DoubleSide});
  const binding = new THREE.MeshStandardMaterial({color:0xb08c62,roughness:.88,side:THREE.DoubleSide});
  const pocket = new THREE.MeshStandardMaterial({color:0x364b46,roughness:.96,side:THREE.DoubleSide});
  const group = new THREE.Group();
  group.name = 'Mara · workshop waist apron';
  const hip = hips.getWorldPosition(new THREE.Vector3());
  group.position.set(hip.x,hip.y+.10,hip.z);
  group.scale.setScalar(height/1.72);
  function surface(angle, drop, offset = 0) {
    const flare = Math.sin(Math.min(1,drop/.19) * Math.PI/2);
    return new THREE.Vector3(Math.sin(angle)*(.153 + .042*flare + offset),
      -drop, Math.cos(angle)*(.116 + .05*flare + offset) + .012);
  }
  function panel(name,from,to,top,bottom,offset,material) {
    const positions=[],indices=[];
    for(let row=0;row<4;row++)for(let i=0;i<=12;i++){
      const angle=THREE.MathUtils.lerp(from,to,i/12);
      const y=THREE.MathUtils.lerp(top,typeof bottom==='function'?bottom(angle):bottom,row/3);
      const v=surface(angle,y,offset);positions.push(v.x,v.y,v.z);
      if(row&&i){const k=row*13+i;indices.push(k-14,k-13,k,k-14,k,k-1);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);
  }
  panel('Apron',-1.58,1.58,0,a=>.287-.057*Math.pow(Math.abs(a)/1.58,2)-.021*Math.exp(-Math.abs(a)/.07),0,canvas);
  panel('Waist binding',-Math.PI,Math.PI,0,.026,.003,binding);
  for(const side of [-1,1]){
    const middle=side*.52;
    panel('Tool pocket',middle-.37,middle+.37,.093,.198,.006,pocket);
    panel('Pocket welt',middle-.37,middle+.37,.091,.099,.008,binding);
  }
  group.updateMatrixWorld(true);hips.attach(group);return group;
}

// Cut the sleeve on the original skinned upper arm so the hem follows each
// elbow without a second layer intersecting the arm during the briefing.
export function applyMaraSleeves(material) {
  const compile=material.onBeforeCompile, key=material.customProgramCacheKey();
  material.onBeforeCompile=function(shader,renderer){
    compile.call(this,shader,renderer);
    shader.vertexShader='varying vec3 vSleeveBind;\n'+shader.vertexShader.replace(
      '#include <begin_vertex>', '#include <begin_vertex>\nvSleeveBind = position;');
    shader.fragmentShader='varying vec3 vSleeveBind;\n'+shader.fragmentShader.replace(
      '#include <color_fragment>', `
      #include <color_fragment>
      float armX=abs(vSleeveBind.x);
      // The original civilian arms have two long spans of triangles. Keep
      // the hands and shoulder seam; fitted sleeves supply the fabric between.
      if(armX>.112 && armX<.557 && vSleeveBind.y>1.20) discard;
      float sleeve=smoothstep(.075,.096,armX)*(1.-smoothstep(.267,.272,armX))*smoothstep(1.15,1.19,vSleeveBind.y);
      float cuff=smoothstep(.248,.251,armX);
      vec3 sleeveColor=wardrobeColor*mix(1.0,.64,cuff)*clamp(.78+sourceLuminance*.9,.78,1.12);
      diffuseColor.rgb=mix(diffuseColor.rgb,sleeveColor,sleeve);
      `);
  };
  material.customProgramCacheKey=()=>key+'-mara-sleeves';
}

// Rigid folds at the shoulder, elbow and cuff retain sleeve volume when the
// wrist twists. Each half follows the same bones as the underlying shirt.
export function fitMaraSleeve(upper, forearm, hand, height) {
  const red = new THREE.MeshStandardMaterial({color:0x943c32,roughness:.96});
  const dark = new THREE.MeshStandardMaterial({color:0x70352f,roughness:.98});
  const scale=height/1.72;
  const parts=[];
  function section(from,to,profile) {
    const start=from.getWorldPosition(new THREE.Vector3());
    const axis=to.getWorldPosition(new THREE.Vector3()).sub(start);
    const length=axis.length();
    const group=new THREE.Group();
    group.name='Mara · mechanic shirt sleeve';
    group.position.copy(start);
    group.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize());
    const contour=profile.map(([fraction,radius])=>new THREE.Vector2(radius*scale,length*fraction));
    const surface=new THREE.Mesh(new THREE.LatheGeometry(contour,24),red);
    surface.castShadow=true;surface.receiveShadow=true;group.add(surface);
    group.updateMatrixWorld(true);from.attach(group);parts.push(group);
    return group;
  }
  section(upper,forearm,[[-.13,0],[-.11,.041],[0,.066],[.22,.064],[.48,.059],
    [.68,.055],[.79,.057],[.84,.052],[.91,.052],[1,.051],[1.09,.039],[1.12,0]]);
  const lower=section(forearm,hand,[[-.12,0],[-.08,.036],[0,.050],[.16,.051],
    [.28,.047],[.38,.050],[.44,.045],[.60,.044],[.76,.040],[.86,.035],[.89,.038],[.99,.033],[1,.025]]);
  const end=hand.getWorldPosition(new THREE.Vector3());
  lower.worldToLocal(end);
  const cuff=new THREE.Mesh(new THREE.CylinderGeometry(.033*scale,.039*scale,.035*scale,24),dark);
  cuff.position.y=end.y-.017*scale;lower.add(cuff);
  return parts;
}
