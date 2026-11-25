import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../benchmarks/engines/src/stats.js';
test('benchmark FPS uses elapsed time and frame percentiles retain stalls',()=>{
  const r=summarize([10,10,10,70]);
  assert.equal(r.fps,40);assert.equal(r.medianFrameMs,10);assert.ok(Math.abs(r.p95FrameMs-61)<1e-9);assert.equal(r.elapsedMs,100);
});
test('benchmark rejects invalid or missing intervals',()=>{for(const values of [[],[0],[NaN],[-1]])assert.throws(()=>summarize(values));});
