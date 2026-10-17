import common from '../../scene.json';
import { summarize } from './stats.js';
const params=new URLSearchParams(location.search);
const engineId=['three','babylon','playcanvas','godot'].includes(params.get('engine'))?params.get('engine'):'three';
const config={...common,shadows:params.get('shadows')==='1'};
const $=id=>document.getElementById(id);
$('engine').value=engineId;$('shadows').value=config.shadows?'1':'0';
let instance, godot, raf, running=false, last=null, started=0, measured=false, measuredStarted=0, frameMs=[], pause=false;
let environment={}, loadMs=0, wasHidden=false;
document.addEventListener('visibilitychange',()=>{if(running&&document.hidden)wasHidden=true;});
let history=[];
try { history=JSON.parse(localStorage.getItem('astra:engine-bench:v1')??'[]');if(!Array.isArray(history))history=[]; }catch{}
const state=window.__ENGINE_BENCH__={ready:false,status:'loading',result:null,error:null,info:null,run:begin,pause:()=>{pause=true;},resume:()=>{pause=false;}};
const label={three:'Three.js',babylon:'Babylon.js',playcanvas:'PlayCanvas',godot:'Godot'};
function status(value){state.status=value;$('status').textContent=value;}
function table(){
  $('results').replaceChildren(...history.slice(-30).map(r=>{
    const tr=document.createElement('tr');
    for(const text of [label[r.engine]??r.engine,r.shadows?'On':'Off',r.fps.toFixed(1),r.medianFrameMs.toFixed(1)+' ms',r.p95FrameMs.toFixed(1)+' ms',(r.loadMs/1000).toFixed(2)+' s',r.frames]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
    return tr;
  }));
}
function fail(e){running=false;state.error=String(e.stack??e);status('Error: '+e.message);$('info').textContent=state.error;$('run').disabled=true;console.error(e);}
function finish(intervals, extra={}) {
  running=false;pause=true;
  const result={engine:engineId,shadows:config.shadows,timestamp:new Date().toISOString(),...summarize(intervals),loadMs,frameMs:intervals,info:instance?.info??extra.info??state.info,environment,width:config.width,height:config.height,warmupMs:config.warmupMs,durationMs:config.durationMs,hidden:wasHidden||document.hidden};
  if(result.hidden) return fail(new Error('Tab became hidden; discard this sample'));
  state.result=result;history.push(result);history=history.slice(-30);
  try{localStorage.setItem('astra:engine-bench:v1',JSON.stringify(history));}catch{}
  $('fps').textContent=result.fps.toFixed(1)+' fps';
  $('timing').textContent=`Median ${result.medianFrameMs.toFixed(1)} ms · 95th percentile ${result.p95FrameMs.toFixed(1)} ms · ${result.frames} frames`;
  $('info').textContent=JSON.stringify({loadMs,environment,...result.info},null,2);
  $('run').disabled=false;status('Complete');table();
  performance.mark('astra-benchmark-complete');
}
function tick(now) {
  raf=requestAnimationFrame(tick);
  if(pause) return;
  instance.render((now-started)/1000);
  if(!running) return;
  if(document.hidden) return fail(new Error('Tab became hidden; discard this sample'));
  const elapsed=now-started;
  if(elapsed<config.warmupMs){last=null;return;}
  if(!measured){measured=true;measuredStarted=now;status('Measuring…');performance.mark('astra-benchmark-measure');}
  if(last!==null)frameMs.push(now-last);
  last=now;
  if(now-measuredStarted>=config.durationMs&&frameMs.length)finish(frameMs);
}
async function begin() {
  if(!state.ready||running) return;
  state.result=null;wasHidden=document.hidden;frameMs=[];last=null;measured=false;running=true;pause=false;started=performance.now();
  $('run').disabled=true;status('Warming up…');performance.mark('astra-benchmark-start');
  if(godot){try{const result=await godot.begin({warmupMs:config.warmupMs,durationMs:config.durationMs});finish(result.frameMs,result);}catch(e){fail(e);}}
}
function gpuInfo(canvas){
  const gl=canvas.getContext('webgl2');
  const debug=gl?.getExtension('WEBGL_debug_renderer_info');
  return {userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,devicePixelRatio:devicePixelRatio,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'unavailable',vendor:debug?gl.getParameter(debug.UNMASKED_VENDOR_WEBGL):'unavailable',drawingBuffer:gl?[gl.drawingBufferWidth,gl.drawingBufferHeight]:null};
}
$('load').onclick=()=>{location.search=new URLSearchParams({engine:$('engine').value,shadows:$('shadows').value});};
$('run').onclick=begin;
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({scene:common,runs:history},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='astra-engine-benchmarks.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
window.addEventListener('pagehide',()=>{cancelAnimationFrame(raf);instance?.dispose();});
table();
try {
  if(engineId==='godot'){
    const iframe=document.createElement('iframe');iframe.title='Godot benchmark scene';
    const ready=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Godot did not initialize within 90 seconds')),90000);
      const listener=e=>{if(e.origin!==location.origin||e.source!==iframe.contentWindow)return;if(e.data?.type==='astra-godot-error'){clearTimeout(timeout);window.removeEventListener('message',listener);reject(new Error(e.data.error));}else if(e.data?.type==='astra-godot-ready'){clearTimeout(timeout);window.removeEventListener('message',listener);resolve(e.data);}};
      window.addEventListener('message',listener);
    });
    iframe.src='/godot/index.html'+(config.shadows?'?variant=shadows':'');$('viewport').replaceChildren(iframe);
    const message=await ready;godot=iframe.contentWindow.__ENGINE_BENCH__;state.info=message.info??godot.info;
    environment=gpuInfo(iframe.contentDocument.querySelector('canvas'));
  } else {
    const module=await ({three:()=>import('./three.js'),babylon:()=>import('./babylon.js'),playcanvas:()=>import('./playcanvas.js')})[engineId]();
    instance=await module.createScene($('scene'),config);instance.render(0);state.info=instance.info;environment=gpuInfo($('scene'));
  }
  loadMs=performance.now();state.loadMs=loadMs;state.environment=environment;state.ready=true;status('Ready');$('run').disabled=false;
  $('info').textContent=JSON.stringify({loadMs,environment,...state.info},null,2);
  if(instance){started=performance.now();raf=requestAnimationFrame(tick);}
  if(params.get('auto')==='1')begin();
}catch(e){fail(e);}
