#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const exec=promisify(execFile);
const origin=process.env.BENCH_URL||'http://localhost:3100';
const orders=[['three','babylon','playcanvas','godot'],['godot','playcanvas','babylon','three'],['playcanvas','three','godot','babylon']];
const godotOnly=process.argv.includes('--godot-only');
const previous=godotOnly?JSON.parse(readFileSync(new URL('./results/results.json',import.meta.url),'utf8')):null;
const runs=previous?previous.runs.filter(run=>run.engine!=='godot'):[];
const sources=['scene.json','engines/src/main.js','engines/src/stats.js','engines/src/three.js','engines/src/babylon.js','engines/src/playcanvas.js','engines/package-lock.json','godot/main.gd','godot/project.godot','godot/shell.html','godot/build.py','godot/import-settings.json'];
const sourceSha256=Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex')]));
const report={capturedAt:new Date().toISOString(),method:'Production bundles; same Chrome tab; repeated local loads; 4s warmup +12s sampling per run; 3 rotated-order trials per profile; no simultaneous builds or other benchmark pages; idle Blender desktop and supervised services left running.',sourceSha256,sceneSha256:createHash('sha256').update(readFileSync(new URL('./scene.json',import.meta.url))).digest('hex'),runs};
if(godotOnly){
 report.originalCapturedAt=previous.capturedAt;
 report.originalSourceSha256=previous.sourceSha256;
 report.method='18 JavaScript samples retained from the original three rotated-order trials. Six Godot samples recollected after pinning texture imports; Godot-only profiles off/on, on/off, off/on. Same Chrome tab, 960x540 WebGL2, 4s warmup and 12s sampling; repeated local loads; idle Blender desktop and supervised servers. No simultaneous builds or other benchmark pages.';
}
async function browser(...args){const {stdout}=await exec('agent-browser',['--webgpu','--json',...args],{timeout:120000,maxBuffer:4*1024*1024});const response=JSON.parse(stdout);if(!response.success)throw new Error(JSON.stringify(response));return response.data;}
for(let trial=0;trial<3;trial++)for(const shadows of (trial%2?[1,0]:[0,1]))for(const engine of orders[trial].filter(engine=>!godotOnly||engine==='godot')){
  const url=`${origin}/?engine=${engine}&shadows=${shadows}&auto=1`;
  await browser('open',url);
  await browser('wait','--fn','window.__ENGINE_BENCH__?.result || window.__ENGINE_BENCH__?.error');
  const {result:state}=await browser('eval','({result:window.__ENGINE_BENCH__.result,error:window.__ENGINE_BENCH__.error})');
  if(state.error||!state.result)throw new Error(`${engine}: ${state.error||'No result'}`);
  const result={trial:trial+1,...state.result};
  if(result.environment?.drawingBuffer?.join('x')!=='960x540')throw new Error('Unexpected drawing buffer');
  if(result.hidden)throw new Error('Hidden tab invalidates measurement');
  runs.push(result);
  await writeFile(new URL('./results/results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({trial:trial+1,engine,shadows,fps:+result.fps.toFixed(2),p95:+result.p95FrameMs.toFixed(2),loadMs:+result.loadMs.toFixed(1),frames:result.frames}));
}
await browser('open','about:blank');
console.log('Recorded '+runs.length+' valid runs in benchmarks/results/results.json');
