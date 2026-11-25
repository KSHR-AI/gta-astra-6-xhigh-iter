export function summarize(frameMs) {
  if (!frameMs.length || frameMs.some(n=>!Number.isFinite(n)||n<=0)) throw new Error('Expected positive finite frame intervals');
  const sorted=[...frameMs].sort((a,b)=>a-b);
  const quantile=p=>{const i=(sorted.length-1)*p, lo=Math.floor(i);return sorted[lo]+(sorted[Math.ceil(i)]-sorted[lo])*(i-lo);};
  const elapsedMs=frameMs.reduce((a,b)=>a+b,0);
  return {fps:frameMs.length*1000/elapsedMs,medianFrameMs:quantile(.5),p95FrameMs:quantile(.95),frames:frameMs.length,elapsedMs};
}
