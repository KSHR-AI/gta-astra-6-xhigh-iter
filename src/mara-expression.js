import * as THREE from 'three';

const smooth = THREE.MathUtils.smoothstep;
const fields = new WeakMap();
const neutral = new THREE.Vector4(0,0,0,0);
const halfWave = (time, a,b,c,d) => smooth(time,a,b)*(1-smooth(time,c,d));

// Landmark distances in the shipped female head's bind space (metres).
// Both lip surfaces follow one displacement through the closed seam.
// The painted brow shell receives the same field as the skin beneath it.
export function expressionField(x,y,z,skin,hair,eye,output) {
  output.fill(0);
  if (eye || z < .065 || (!skin && !hair)) return;
  const side = Math.sign(x), ax=Math.abs(x);
  const depth=smooth(z,.065,.086);
  const browArch=1.479+.0035*Math.cos((ax-.028)*72);
  const brow=depth*(1-smooth(Math.abs(y-browArch),.002,.013))*
    smooth(ax,.002,.014)*(1-smooth(ax,.039,.057));
  output[0]=side>0?brow:0;
  output[1]=side<0?brow:0;
  if (!skin) return;
  const corner=depth*(1-smooth(Math.abs(y-1.405),.004,.020))*
    smooth(ax,.002,.017)*(1-smooth(ax,.023,.042));
  output[2]=corner;
  output[3]=depth*(1-smooth(Math.abs(y-1.405),.002,.012))*(1-smooth(ax,.012,.027));
}

function attachField(geometry) {
  if (geometry.hasAttribute('maraFaceField')) return;
  const {position,_skin_mask:skin,_hair_mask:hair,_eye_side:eye}=geometry.attributes;
  if (!position||!skin||!hair||!eye) return;
  let attribute=fields.get(position);
  if (!attribute) {
    const bytes=new Uint8Array(position.count*4), weights=[0,0,0,0];
    for(let i=0;i<position.count;i++){
      expressionField(position.getX(i),position.getY(i),position.getZ(i),skin.getX(i)>.5,hair.getX(i)>.5,eye.getX(i),weights);
      for(let j=0;j<4;j++)bytes[4*i+j]=Math.round(weights[j]*255);
    }
    attribute=new THREE.Uint8BufferAttribute(bytes,4,true);
    fields.set(position,attribute);
  }
  geometry.setAttribute('maraFaceField',attribute);
}

export function createMaraExpression(model) {
  const meshes=[], amount=new THREE.Vector4(0,0,0,0);
  model.traverse(mesh=>{
    if (!mesh.isSkinnedMesh || !mesh.material?.userData.naturalHuman || !mesh.geometry.hasAttribute('_eye_side')) return;
    attachField(mesh.geometry);
    const material=mesh.material,compile=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=function(shader,renderer){
      compile.call(this,shader,renderer);
      shader.uniforms.maraExpression={value:amount};
      shader.vertexShader='attribute vec4 maraFaceField;\nuniform vec4 maraExpression;\n'+shader.vertexShader.replace(
        '#include <begin_vertex>', `#include <begin_vertex>
        float brow = dot(maraFaceField.xy,maraExpression.xy);
        float corner = maraFaceField.z*maraExpression.z;
        transformed.y += .0065*brow + .0035*corner;
        transformed.x += sign(position.x)*(.0025*corner-.0018*maraFaceField.w*maraExpression.w);
        transformed.z += .0012*brow + .002*maraFaceField.w*maraExpression.w;`);
    };
    material.customProgramCacheKey=()=>key+'-mara-expression-v1';
    meshes.push(mesh);
  });
  let cue='conversation', clean=true, lineCount=0, line='', age=0, elapsed=0, shownTime=NaN;
  const pose=new THREE.Vector4(0,0,0,0), desired=new THREE.Vector4(0,0,0,0);
  const origin=new THREE.Vector3(), focus=new THREE.Vector3(), visitor=new THREE.Vector3();
  const eyeTarget=new THREE.Vector3(), headTarget=new THREE.Vector3();
  let headTilt=0,nod=0,eyeGlance=0,headGlance=0;
  function reset() { cue='conversation';clean=true;lineCount=0;line='';age=0;headTilt=0;nod=0;eyeGlance=0;headGlance=0;pose.set(0,0,0,0);amount.set(0,0,0,0);shownTime=NaN; }
  return {
    cue(kind, cleanDelivery = true) {
      if(kind!=='handoff'&&kind!=='briefing')return;
      cue=kind;clean=cleanDelivery;lineCount=0;line='';age=0;
    },
    reset,
    advance(dt, text, interrupted) {
      if (dt<=0 || !meshes.length) return;
      const next=interrupted?'':text||'';
      if (!next&&!line&&pose.lengthSq()===0&&Math.abs(headTilt)+Math.abs(nod)+eyeGlance+headGlance===0) return;
      if(next!==line){age=0;line=next;if(next)lineCount++;}
      age+=dt;elapsed+=dt;desired.set(0,0,0,0);
      if (line) {
        // Two held thoughts separated by a rest. Timing is independent of
        // words or syllables; the radio and captions carry the dialogue.
        const opening=halfWave(age,.04,.30,.67,1.18);
        const afterthought=halfWave(age,1.79,2.09,2.38,2.9);
        if(lineCount>1||cue==='conversation')desired.set(.27*opening,.41*opening+.16*afterthought,.33*afterthought,.22*opening);
        else if(cue==='handoff'&&!clean)desired.set(-.33*opening,-.52*opening,-.53*opening,.78*opening+.21*afterthought);
        else if(cue==='handoff')desired.set(.49*opening,.68*opening,.9*opening+.36*afterthought,.18*afterthought);
        else desired.set(.96*opening+.16*afterthought,.32*opening+.43*afterthought,-.28*opening+.28*afterthought,.62*opening+.28*afterthought);
      }
      const blend=1-Math.exp(-(line?14:10)*dt);
      pose.lerp(desired,blend);
      const focusBeat = line&&lineCount===1&&cue==='briefing';
      eyeGlance=THREE.MathUtils.lerp(eyeGlance,focusBeat ? .62*halfWave(age,.25,.39,.78,1.0):0,blend);
      headGlance=THREE.MathUtils.lerp(headGlance,focusBeat ? .78*halfWave(age,.38,.63,.81,1.19):0,blend);
      headTilt=THREE.MathUtils.lerp(headTilt,.083*(desired.x-desired.y),blend);
      nod=THREE.MathUtils.lerp(nod,line?(cue==='handoff'?-.105:-.070)*halfWave(age,.22,.49,.56,.84):0,blend);
      if (!line&&Math.abs(headTilt)+Math.abs(nod)+eyeGlance+headGlance<.0002){headTilt=0;nod=0;eyeGlance=0;headGlance=0;}
      if (pose.lengthSq()<1e-6&&desired.lengthSq()===0)pose.set(0,0,0,0);
    },
    direct(options,actor) {
      if(!options || (!headTilt && !nod && !eyeGlance && !headGlance)) return options;
      const directed = {...options,dialogueTilt:headTilt,dialogueNod:nod};
      if (!options.lookTarget || !options.dialogueFocus || !eyeGlance&&!headGlance) return directed;
      actor.getWorldPosition(origin);origin.y=options.lookTarget.y;
      visitor.copy(options.lookTarget).sub(origin);
      focus.copy(options.dialogueFocus).sub(origin);
      // Give the eyes a short lead and retain a readable three-quarter face.
      // Both targets stay at eye height so a low parked car cannot bury the chin.
      focus.y=0; visitor.y=0;
      if(focus.lengthSq()<.01||visitor.lengthSq()<.01)return directed;
      const a=Math.atan2(visitor.x,visitor.z), b=Math.atan2(focus.x,focus.z);
      const arc=clampAngle(b-a);
      function mark(target,weight){
        return target.set(origin.x+Math.sin(a+arc*weight)*3,options.lookTarget.y,origin.z+Math.cos(a+arc*weight)*3);
      }
      directed.lookTarget=mark(headTarget,headGlance);
      directed.eyeLookTarget=mark(eyeTarget,eyeGlance);
      return directed;
    },
    present(visible) {
      // A reduced index LOD can predate Mara's wardrobe/face setup. Reuse
      // the bind attribute when that geometry first becomes visible.
      for(const mesh of meshes)attachField(mesh.geometry);
      if(!visible){amount.copy(neutral);shownTime=NaN;return;}
      if(shownTime!==elapsed){amount.copy(pose);shownTime=elapsed;}
    },
    info() { return {supported:meshes.length>0, cue, lineActive:Boolean(line), seconds:age, weights:amount.toArray()}; }
  };
}

function clampAngle(angle) {
  return THREE.MathUtils.clamp(Math.atan2(Math.sin(angle),Math.cos(angle)),-.50,.50);
}
