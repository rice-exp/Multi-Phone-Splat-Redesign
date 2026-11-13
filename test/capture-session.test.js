import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, writeFile, readdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {CaptureSession} from '../lib/capture-session.mjs';
import {CaptureUpload} from '../lib/capture-upload.mjs';
import {FrameReview} from '../lib/frame-review.mjs';
import {TEST_CONFIG} from '../test-support/rig-config.mjs';

const jpeg = Buffer.from([255,216,255,224,0,2,255,217]);
const remote = '/storage/emulated/0/Android/data/com.explab.camera/files/CameraScope/transfer/';
async function rigFixture(t, {drop=false, failSync=false, missingCli=false}={}) {
  const dir = await mkdtemp(path.join(os.tmpdir(),'capture-job-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const config = {...TEST_CONFIG,outputRoot:dir};
  const phones = config.phones;
  const settings = new Map(phones.map((p,i)=>[p.ip,{isCapturing:i===0,streamEnabled:i===0,isH264Recording:false}]));
  const configStore = {read:async()=>config};
  const calls = [], transfers = [];
  const review = new FrameReview({configStore,env:{}});
  const rig = {configStore, sync:new Map(), inventory:()=>phones, readPhone:async phone=>({...phone,responding:true,state:{...settings.get(phone.ip)}}),
    command:async(ip,request)=>Object.assign(settings.get(ip),{isCapturing:request.capture,streamEnabled:request.streamEnabled}),
    run:async (_,args)=>{
      calls.push(args);
      const [,action,...rest] = args;
      const results = phones.map(p=>({host:p.ip,ok:true}));
      if (rest.includes('--help')) return {stdout:'usage'};
      if (action==='--host') {
        const current = settings.get(rest[0]);
        if (rest.includes('stop')) current.isCapturing = false;
        if (rest.includes('set')) Object.assign(current,{isCapturing:rest.includes('--capture'),streamEnabled:rest.includes('--stream')});
        return {stdout:'ok'};
      }
      if (action==='sync-many') return {stdout:JSON.stringify({results:failSync?[]:results})};
      if (action==='phase-align') return {stdout:JSON.stringify({targetLeaderTimestampNs:123456789,results})};
      assert.equal(action,'capture-sequence');
      assert.equal(rest[rest.indexOf('--target-leader-ns')+1],'123456789');
      for (const row of results) row.frames = [1,0].map(i=>({sequenceIndex:i,
        event:drop && row===results[1] && i===1?'sequenceFrameDropped':'sequenceFrameSaved',
        file:remote + row.host + '-' + i + '.jpg',actualLeaderNs:123456789+i*33333333}));
      return {stdout:JSON.stringify({frameCount:2, intervalNs:33333333, intervalSource:'sensor',results})};
    }};
  let failTransfer = drop;
  const receiver = ()=>({start:async()=>{},close:async()=>{},transfer:async(ip,file,destination)=>{
    transfers.push(file);
    if (failTransfer && ip===phones[1].ip) { failTransfer=false; throw Error('Wi-Fi disconnected'); }
    await writeFile(destination,jpeg);
  }});
  const service = new CaptureSession({rig,review,findCli:async()=>missingCli?null:'cli',receiver});
  const phases = new Set();
  service.onChange = ()=>phases.add(service.participant().phase);
  return {service,review,settings,calls,transfers,phases,
    start:()=>service.start({ids:phones.map(p=>p.id),name:'Walking take',frameCount:2})};
}
test('Capture records the selected sequence, restores previews and feeds saved photos to Frame review',async t=>{
  const {service,review,settings,calls,phases,start} = await rigFixture(t);
  assert.equal(service.participant().phase,'idle');
  const job = await start();
  await assert.rejects(start(),{code:'RIG_BUSY'});
  await service.finished;
  assert.equal(job.phase,'saved',job.message);
  assert.deepEqual([...phases],['preparing','capturing','saving','done']);
  assert.equal(job.transferred,4);
  assert.equal(calls.filter(args=>args[1]==='capture-sequence' && !args.includes('--help')).length,1);
  assert.deepEqual([...settings.values()].map(s=>[s.streamEnabled,s.isCapturing]),[[true,true],[false,false]]);
  const saved = await review.session(job.session);
  assert.deepEqual(saved.frames.map(frame=>frame.index),[0,1]);
  assert.equal(saved.totals.recordedTransfers,4);
  const image = await review.image(job.session,1,'cam-2');
  assert.deepEqual(await image.handle.readFile(),jpeg); await image.handle.close();
});
test('transfer retry saves only missing phone images and preserves a real capture drop',async t=>{
  const {service,review,calls,transfers,start} = await rigFixture(t,{drop:true});
  const job = await start(); await service.finished;
  assert.equal(job.phase,'partial'); assert.equal(job.savedOnPhone,3); assert.equal(job.transferred,2);
  assert.equal((await review.session(job.session)).totals.transferFailed,1);
  const initialCommands = calls.length, initialTransfers = transfers.length;
  assert.throws(()=>service.retry('another-session'),{code:'CAPTURE_RETRY'});
  service.retry(job.session); await service.finished;
  assert.equal(calls.length,initialCommands); assert.equal(transfers.length,initialTransfers+1);
  assert.deepEqual((await review.session(job.session)).totals,{recordedTransfers:3,captureDropped:1,transferFailed:0,unknown:0});
  assert.equal(job.retryable,false);
});
test('missing CLI prevents device commands and failed synchronization restores camera states',async t=>{
  const missing = await rigFixture(t,{missingCli:true});
  await assert.rejects(missing.start(),{code:'CLI_MISSING'}); assert.equal(missing.calls.length,0);
  const {service,calls,settings,start} = await rigFixture(t,{failSync:true});
  const job = await start(); await service.finished;
  assert.equal(job.phase,'failed'); assert.match(job.message,/synchronization/);
  assert.equal(calls.some(args=>args.includes('--frame-count')),false);
  assert.deepEqual([...settings.values()].map(s=>[s.streamEnabled,s.isCapturing]),[[true,true],[false,false]]);
  assert.equal(service.rig.busy,null);
});
test('Wi-Fi receiver verifies whole and chunked phone uploads and discards mismatched files',async t=>{
  const directory = await mkdtemp(path.join(os.tmpdir(),'frame-upload-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  let chunked = false, wrongSize = false;
  const receiver = new CaptureUpload('127.0.0.1',0,async(ip,req)=>{
    assert.equal(req.cmd,'uploadFile');
    const unauthorized = await fetch(req.uploadUrl,{method:'POST',body:'rejected'});
    assert.equal(unauthorized.status,403);
    const parts = chunked ? [jpeg.subarray(0,4),jpeg.subarray(4)] : [jpeg];
    for (const [i,body] of parts.entries()) {
      const headers = {Authorization:'Bearer '+req.uploadToken,'X-CameraScope-Filename':'example.jpg'};
      if (chunked) Object.assign(headers,{'X-CameraScope-Upload-Id':'test','X-CameraScope-Chunk-Offset':String(i*4),
        'X-CameraScope-Total-Bytes':String(jpeg.length),'X-CameraScope-Total-Chunks':'2','X-CameraScope-Chunk-Index':String(i)});
      const result = await fetch(req.uploadUrl,{method:'POST',headers,body});
      assert.equal(result.status,i===parts.length-1?200:202);
    }
    return {ok:true,file:req.file,sizeBytes:jpeg.length+Number(wrongSize)};
  },2500);
  await receiver.start(); t.after(()=>receiver.close());
  for (const name of ['whole','chunked']) {
    chunked = name==='chunked';
    const dest = path.join(directory,name+'.jpg');
    await receiver.transfer('127.0.0.1',remote+'example.jpg',dest);
    assert.deepEqual(await readFile(dest),jpeg);
  }
  wrongSize = true;
  await assert.rejects(receiver.transfer('127.0.0.1',remote+'example.jpg',path.join(directory,'bad.jpg')),/differs/);
  assert.deepEqual((await readdir(directory)).sort(),['chunked.jpg','whole.jpg']);
});
