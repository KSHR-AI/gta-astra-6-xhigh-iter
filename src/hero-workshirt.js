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
      '#include <begin_vertex>', '#include <begin_vertex>\nvShirtBind = position;');
    shader.fragmentShader = 'uniform sampler2D garageCrest;\nvarying vec3 vShirtBind;\n' + shader.fragmentShader.replace(
      '#include <color_fragment>', `
      #include <color_fragment>
      vec2 badgeUv = vec2(.5 - vShirtBind.x / .38, (vShirtBind.y - .297) / .285);
      vec4 printInk = texture2D(garageCrest, clamp(badgeUv,0.,1.));
      float isBack = 1. - smoothstep(-.11,-.06,vShirtBind.z);
      float sleeve = abs(vShirtBind.x);
      float band = smoothstep(.226,.23,sleeve) * (1.-smoothstep(.245,.249,sleeve));
      band += smoothstep(.256,.259,sleeve) * (1.-smoothstep(.263,.266,sleeve));
      float textile = clamp(sourceLuminance * shirtDyeScale, .52, 1.22);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.71,.42,.115)*textile, band*wardrobeMask*.84);
      diffuseColor.rgb = mix(diffuseColor.rgb, printInk.rgb*textile, printInk.a*isBack*wardrobeMask*.92);
      `);
  };
  material.customProgramCacheKey = () => baseKey+'-pacific-workshirt';
}
