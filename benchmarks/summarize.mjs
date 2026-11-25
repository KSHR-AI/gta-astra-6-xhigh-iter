import { readFile, writeFile } from 'node:fs/promises';
const root=new URL('./results/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,root),'utf8'));
const browser=await read('results.json');
const builds=await read('web-builds.json');
const godot=await read('godot-builds.json');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b);const m=(sorted.length-1)/2;return (sorted[Math.floor(m)]+sorted[Math.ceil(m)])/2;};
const engines=['three','babylon','playcanvas','godot'];
if(browser.runs.length!==24||builds.status!=='complete')throw new Error('All browser and build trials must complete first');
const rows=engines.map(engine=>{
 const profiles=[false,true].map(shadows=>{
  const runs=browser.runs.filter(r=>r.engine===engine&&r.shadows===shadows);
  if(runs.length!==3)throw new Error('Expected three valid trials per engine/profile');
  return {shadows,trials:runs.length,fps:median(runs.map(r=>r.fps)),fpsMin:Math.min(...runs.map(r=>r.fps)),fpsMax:Math.max(...runs.map(r=>r.fps)),p95FrameMs:median(runs.map(r=>r.p95FrameMs)),loadMs:median(runs.map(r=>r.loadMs))};
 });
 return {engine,profiles,...(engine==='godot'?{exportSeconds:median(godot.warmExportSeconds),coldImportSeconds:godot.coldImportSeconds,webBytes:godot.webBytes}:{buildSeconds:builds.summary[engine].wallMilliseconds.median/1000,javascriptBytes:builds.summary[engine].javascriptBytes,javascriptGzipBytes:builds.summary[engine].javascriptGzipBytes})};
});
const summary={capturedAt:browser.capturedAt,aggregation:'Median across three runs per engine/profile; FPS is frames divided by summed frame intervals. P95 is the median of per-run P95s, not a pooled percentile.',environment:browser.runs[0].environment,sceneSha256:browser.sceneSha256,rows};
await writeFile(new URL('summary.json',root),JSON.stringify(summary,null,2)+'\n');
let csv='engine,shadows,trials,median_fps,min_fps,max_fps,median_p95_frame_ms,median_local_load_ms\n';
for(const row of rows)for(const p of row.profiles)csv+=[row.engine,p.shadows,p.trials,p.fps,p.fpsMin,p.fpsMax,p.p95FrameMs,p.loadMs].join(',')+'\n';
await writeFile(new URL('summary.csv',root),csv);
console.log(JSON.stringify(summary,null,2));
