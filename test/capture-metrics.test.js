import test from 'node:test';
import assert from 'node:assert/strict';
import {analyseCaptureReport,observedIntervalNs} from '../public/js/capture-metrics.js';
const saved=(sequenceIndex,actualLeaderNs)=>({event:'sequenceFrameSaved',sequenceIndex,actualLeaderNs});
test('missing frames do not double the measured camera interval',()=>{
  assert.equal(observedIntervalNs([saved(0,1000),saved(2,1200),saved(3,1300)]),100);
});
test('cross-camera timing uses matching sequence indices and actual timestamps',()=>{
  const result=analyseCaptureReport({frameCount:3,phaseStaggerMs:2,results:[
    {host:'a',ok:true,frames:[saved(0,1000),{event:'sequenceFrameDropped',sequenceIndex:1},saved(2,3000)]},
    {host:'b',ok:true,frames:[saved(0,1020),saved(1,2040),saved(2,3050)]}
  ]});
  assert.equal(result.savedFrames,5);assert.equal(result.droppedFrames,1);
  assert.deepEqual(result.crossPhoneSpan,{groups:2,medianNs:35,p95Ns:50,maxNs:50});
  assert.equal(result.phaseStaggerMs,2);
});
test('a single timestamp cannot imply a measured cross-camera span',()=>{
  const result=analyseCaptureReport({frameCount:1,results:[{host:'a',frames:[saved(0,1000)]}]});
  assert.equal(result.crossPhoneSpan.medianNs,null);
});
