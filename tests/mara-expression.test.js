import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {actor} from './helpers/character-animation-fixture.js';
import {createMaraExpression,expressionField} from '../src/mara-expression.js';

test('the calibrated brow and corner fields leave eyeballs, nose tip, neck and scalp fixed',()=>{
  const sample=(x,y,z,skin=1,hair=0,eye=0)=>{const w=[0,0,0,0];expressionField(x,y,z,skin,hair,eye,w);return w};
  assert.ok(sample(.03,1.483,.099)[0]>.97);
  assert.ok(sample(-.03,1.483,.099,0,1)[1]>.97);
  assert.ok(sample(.019,1.405,.101)[2]>.97);
  assert.deepEqual(sample(.019,1.4051,.101),sample(.019,1.4052,.102),'adjacent lip edges move together');
  for(const w of [sample(.02,1.469,.09,0,0,1),sample(0,1.437,.123),sample(0,1.33,.081),sample(.03,1.54,.091,0,1)])assert.deepEqual(w,[0,0,0,0]);
});

test('Mara accents the first phrase, looks toward the car, rests between thoughts and eases away on interruption',async()=>{
  const a=await actor({model:'CivilianFemaleNatural.glb',motion:'pedestrian-motion.json',height:1.72});
  const expression=createMaraExpression(a.visual);
  const opts={lookTarget:new THREE.Vector3(0,1.6,3),dialogueFocus:new THREE.Vector3(20,0,0)};
  const at=(t,text,stop=false)=>{for(let i=0;i<Math.round(60*t);i++)expression.advance(1/60,text,stop);expression.present(true);return expression.info().weights};
  assert.equal(expression.info().supported,true);
  assert.deepEqual(at(.4,''),[0,0,0,0]);
  expression.cue('briefing');
  const peak=at(.55,'The buyer is waiting.');
  assert.ok(peak[0]>.86&&peak[1]<.35&&peak[2]<0);
  const gaze=expression.direct(opts,a.mesh);assert.ok(gaze.lookTarget.x>0&&gaze.eyeLookTarget.x>gaze.lookTarget.x*.7);
  const release=at(1/60,'',true);assert.ok(release[0]<peak[0]&&release[0]>.7*peak[0]);
  assert.deepEqual(at(1,'',true),[0,0,0,0]);
  expression.cue('handoff');assert.ok(at(.6,'Clean delivery.')[2]>.8);
  expression.present(false);assert.deepEqual(expression.info().weights,[0,0,0,0]);
  expression.present(true);assert.ok(expression.info().weights[2]>.8);
  const pause=at(1.05,'Clean delivery.');assert.ok(pause.every(v=>Math.abs(v)<.01));
  expression.cue('handoff',false);const damaged=at(.6,'I can see the scrape.');
  assert.ok(damaged[0]<0&&damaged[1]<0&&damaged[2]<0);
  expression.reset();assert.deepEqual(expression.info().weights,[0,0,0,0]);
});
