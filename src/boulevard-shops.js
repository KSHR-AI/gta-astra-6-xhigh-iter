import * as THREE from 'three';

// Four enamel faces share one print sheet. Geometry and ink are reused on
// both sides of each projecting sign so its lettering reads down either lane.
export function createBoulevardShops({ canvasTexture, box, instance, line, materials, illuminatedSigns }) {
  const atlas = canvasTexture(1024, 512, ctx => {
    const rect = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    function title(text, x, y, font, color, width) {
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.fillStyle = color;
      ctx.fillText(text, x, y, width);
    }
    rect('#154d58', 0, 0, 512, 384);
    ctx.strokeStyle = '#9de4ca'; ctx.lineWidth = 5;
    ctx.strokeRect(12, 12, 488, 360);
    title('M O T E L', 256, 84, 'bold 55px sans-serif', '#fff0bc', 400);
    title('Azul', 249, 253, 'italic bold 196px Georgia', '#ffb49c', 425);
    rect('#efb69a', 90, 270, 332, 5);
    title('VACANCY', 256, 336, 'bold 42px monospace', '#a2f0d7', 340);
    rect('#f3d8a9', 512, 0, 512, 384);
    rect('#a94632', 524, 12, 488, 360);
    for (let i = 0; i < 3; i++) {
      rect('#f7dcab', 550 + i * 12, 66 + i * 12, 132 - i * 12, 6);
      rect('#f7dcab', 854, 66 + i * 12, 132 - i * 12, 6);
    }
    title('VM', 768, 111, 'italic bold 73px Georgia', '#ffe7b8', 150);
    title('VELOCE', 768, 232, 'italic bold 109px sans-serif', '#ffe7b8', 460);
    title('MOTOR  SERVICE', 768, 311, 'bold 44px monospace', '#ffe7b8', 440);
    rect('#184c54', 0, 384, 512, 128);
    title('AZUL  •  MOTOR LODGE', 256, 466, 'bold 47px Georgia', '#ffe5bf', 469);
    rect('#e2d6b9', 512, 384, 512, 128);
    rect('#a94c37', 512, 391, 512, 6);
    rect('#a94c37', 512, 499, 512, 6);
    title('SERVICE  &  ALIGNMENT', 768, 465, 'bold 40px sans-serif', '#813f32', 474);
  });
  const ink = new THREE.MeshStandardMaterial({ map: atlas, roughness: .65,
    emissive: '#ccb092', emissiveMap: atlas, emissiveIntensity: .25 });
  illuminatedSigns.push({ material: ink, intensity: .25 });
  function crop(x, y, w, h) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(i, (x + 1 + uv.getX(i) * (w - 2)) / 1024, 1 - (y + 1 + (1 - uv.getY(i)) * (h - 2)) / 512);
    }
    return geometry;
  }
  const faces = [crop(0,0,512,384), crop(512,0,512,384), crop(0,384,512,128), crop(512,384,512,128)];
  const tire = new THREE.TorusGeometry(.47, .145, 8, 24);
  const m = materials;
  return function boulevardShop(index, faceX, z, front, depth) {
    const garage = index === 14;
    const px = offset => faceX + front * offset;
    const part = (material, along, y, out, span, height, thickness, shadow = true) =>
      box(material, px(out), y, z + along, thickness, height, span, 0, shadow);
    function plate(face, x, y, zz, width, height, angle) {
      instance(faces[face], ink, [x,y,zz], [width,height,1], [0,angle,0], false);
    }
    const fascia = garage ? m.terracotta : m.teal;
    const end = depth * .33;
    const blade = garage ? 1 : 0;
    const bladeWidth = garage ? 2.4 : 2.8;
    const bladeHeight = garage ? 1.68 : 2.28;
    const bladeY = garage ? 5.1 : 5.9;
    const bladeOut = bladeWidth / 2 + .55;
    for (const dy of [-.5,.5]) part(m.blackMetal, end, bladeY + dy, .46, .13,.12,.9);
    part(fascia, end, bladeY, bladeOut, .24,bladeHeight+.1,bladeWidth+.1);
    for (const side of [-1,1]) plate(blade,px(bladeOut),bladeY,z+end+side*.125,bladeWidth,bladeHeight,side < 0 ? Math.PI : 0);
    part(fascia,0,3.44,.26,depth-.48,.91,.42);
    plate(blade+2,px(.476),3.45,z,garage ? 7.2 : 6.3,.82,front*Math.PI/2);
    if (garage) {
      // Raised shutter guides, steel sill, folded laths and safety stripes.
      for (const center of [-6, 0]) {
        part(m.blackMetal,center,1.62,.13,5.67,2.94,.22);
        part(m.concrete,center,1.6,.265,5.26,2.68,.12);
        for (let i=0;i<13;i++) part(m.metal,center,.42+i*.198,.336,5.24,.032,.045,false);
        for (const jamb of [-2.72,2.72]) {
          part(m.dark,center+jamb,1.63,.31,.14,2.96,.27);
          for (let i=0;i<3;i++) part(m.yellow,center+jamb,.52+i*.23,.454,.14,.11,.025,false);
        }
        for (const offset of [-1.65,-.55,.55,1.65]) part(m.glassDark,center+offset,2.24,.35,.82,.29,.045,false);
      }
      part(m.glassDark,7.55,1.69,.14,6,2.75,.16);
      for (const offset of [4.55,6.5,9.05,10.55]) part(m.trim,offset,1.7,.28,.12,2.84,.17);
      for (const y of [.5,1.72]) part(m.terracotta,8.1,y,.59,3.65,.1,.77);
      for (const offset of [6.38,9.82]) part(m.metal,offset,1.23,.9,.08,1.55,.08);
      for (const offset of [6.93,8.12,9.29]) {
        instance(tire,m.dark,[px(.57),1.06,z+offset],[.92,.92,1],[0,front*Math.PI/2,0]);
      }
    } else {
      // Alternating breeze-block openings make a permeable lobby screen.
      part(m.glassDark,0,1.58,.1,depth-.55,2.69,.14);
      for (const side of [-1,1]) {
        const middle = side*depth*.325;
        const span = depth*.28;
        for (let i=0;i<5;i++) part(m.limestone,middle,.54+.49*i,.32,span,.1,.26);
        for (let row=0;row<4;row++) {
          const pitch = span/7;
          for (let cell=0;cell<7;cell++) {
            const along = middle-span/2+(cell+(row%2 ? .73 : .27))*pitch;
            part(m.limestone,along,.785+.49*row,.32,.13,.4,.26,false);
          }
        }
      }
      part(m.trim,0,2.88,.96,6.8,.21,1.84);
      part(m.teal,0,2.74,1.82,6.85,.19,.18);
      for (const along of [-2.9,-1.1,0,1.1,2.9]) part(m.trunkLight,along,1.53,.23,.095,2.58,.16);
      part(m.trunkLight,0,2.49,.23,5.85,.095,.16);
      for (const along of [-.18,.18]) part(m.metal,along,1.32,.34,.035,.43,.085);
      for (const side of [-1,1]) {
        const along = side*2.9;
        line(m.metal,[px(.18),3.45,z+along],[px(1.75),2.99,z+along],.027);
      }
    }
  };
}
