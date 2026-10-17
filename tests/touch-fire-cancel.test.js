import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createWeaponHandling } from '../src/weapon-handling.js';

// Execute the real input callback and UI event bindings, rather than reproduce
// their cancellation logic. This fixture models event routing and real handling;
// trusted browser pointer delivery is a separate runtime acceptance step.
const root=new URL('../',import.meta.url);
const [main,ui]=await Promise.all(['src/main.js','src/ui.js'].map(name=>readFile(new URL(name,root),'utf8')));
const callbackLine=main.split('\n').find(line=>line.trim().startsWith('onMobile:'));
assert.ok(callbackLine,'actual main mobile callback must exist');
const mobile=callbackLine.trim().slice('onMobile:'.length).replace(/,$/,'');
const start=ui.indexOf("  root.querySelectorAll('[data-code]').forEach((button) => {");
const end=ui.indexOf('  const aimButton =',start);
assert.ok(start>=0&&end>start,'actual UI touch event section must exist');
const bindings=ui.slice(start,end);
function fixture(){
 const handling=createWeaponHandling(),buttons=[],actions=[],keys=new Set();let now=0;
 function button(code){
  const listeners={},classes=new Set();
  const element={dataset:{code},setPointerCapture(){},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},addEventListener:(name,callback)=>listeners[name]=callback};
  const result={element,classes,emit(type){let stopped=false,prevented=false;listeners[type]({type,pointerId:1,preventDefault(){prevented=true},stopPropagation(){stopped=true}});return {stopped,prevented}}};
  buttons.push(result);return result;
 }
 const fire=button('Mouse0'),move=button('KeyW');
 const context={root:{querySelectorAll:()=>buttons.map(b=>b.element)},keys,handling,action:code=>{actions.push(code);if(code==='Mouse0')handling.request(now,false)}};
 vm.createContext(context);vm.runInContext(`const onMobile=${mobile}; const call=(name,...args)=>onMobile(...args);\n${bindings}`,context);
 return {handling,fire,move,actions,keys,setTime:value=>now=value};
}

for(const event of ['pointercancel','lostpointercapture'])test(`interrupted FIRE ${event} discards a pending raise and permits a fresh tap`,()=>{
 const f=fixture();f.fire.emit('pointerdown');assert.equal(f.handling.queued,true);
 const routing=f.fire.emit(event);if(event==='pointercancel')assert.equal(routing.stopped,true,'UI swallows cancellation, so callback must carry it');
 assert.equal(f.handling.queued,false);assert.equal(f.handling.consume(.2,true),false);
 assert.equal(f.keys.has('Mouse0'),false);assert.equal(f.fire.classes.has('is-held'),false);
 f.setTime(.3);f.fire.emit('pointerdown');f.fire.emit('pointerup');assert.equal(f.handling.consume(.5,true),true);
 assert.equal(f.handling.shots,1);
});

test('ordinary quick tap survives pointerup and the automatic loss of capture',()=>{
 const f=fixture();f.fire.emit('pointerdown');f.fire.emit('pointerup');f.fire.emit('lostpointercapture');
 assert.equal(f.handling.queued,true,'release must not discard an explicit tap waiting for the pose');
 assert.equal(f.handling.consume(.1,true),false);assert.equal(f.handling.consume(.2,true),true);
 assert.equal(f.handling.consume(.8,true),false);assert.equal(f.handling.shots,1);
});

test('a held FIRE edge remains semi-automatic and cancellation cannot undo its accepted round',()=>{
 const f=fixture();f.fire.emit('pointerdown');assert.equal(f.handling.consume(.2,true),true);
 for(const t of [.4,.6,.8])assert.equal(f.handling.consume(t,true),false);
 f.fire.emit('pointercancel');assert.equal(f.handling.shots,1);assert.equal(f.handling.queued,false);
});

test('canceling a pending cooldown follow-up cannot replay it later',()=>{
 const f=fixture();f.fire.emit('pointerdown');f.fire.emit('pointerup');f.handling.consume(.2,true);
 f.setTime(.3);f.fire.emit('pointerdown');assert.equal(f.handling.consume(.31,true),false);
 f.fire.emit('pointercancel');assert.equal(f.handling.consume(.6,true),false);assert.equal(f.handling.shots,1);
});

test('canceling a movement pointer leaves a separate deliberate FIRE tap intact',()=>{
 const f=fixture();f.fire.emit('pointerdown');f.fire.emit('pointerup');f.move.emit('pointerdown');f.move.emit('pointercancel');
 assert.equal(f.keys.has('KeyW'),false);assert.equal(f.handling.queued,true);assert.equal(f.handling.consume(.2,true),true);
});

test('redundant capture-loss events after cancellation cannot cancel a later independent request',()=>{
 const f=fixture();f.fire.emit('pointerdown');f.fire.emit('pointercancel');
 f.setTime(.3);f.handling.request(.3,false);f.fire.emit('lostpointercapture');
 assert.equal(f.handling.queued,true,'no held code means old capture completion has no new cancellation authority');
 assert.equal(f.handling.consume(.5,true),true);
});

test('ordinary duplicate down events do not create requests or extend the existing deadline',()=>{
 const f=fixture();f.fire.emit('pointerdown');f.setTime(.3);f.fire.emit('pointerdown');
 assert.deepEqual(f.actions,['Mouse0']);assert.equal(f.handling.consume(.381,true),false);
 f.fire.emit('pointerup');f.setTime(.4);f.fire.emit('pointerdown');f.fire.emit('pointerup');assert.equal(f.handling.consume(.6,true),true);
});
