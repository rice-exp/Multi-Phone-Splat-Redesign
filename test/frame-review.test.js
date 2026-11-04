import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {FrameReview} from '../lib/frame-review.mjs';
import {recordedState,timingFor,timestampNs} from '../public/js/frame-review-model.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF7sAAAAASUVORK5CYII=','base64');
async function fixture(t) {
  const root=await mkdtemp(path.join(os.tmpdir(),'frame-review-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const session=path.join(root,'frames','take-01');
  await mkdir(path.join(session,'frame-000000'),{recursive:true});
  await mkdir(path.join(session,'frame-000002'),{recursive:true});
  await writeFile(path.join(session,'frame-000000','cam-1.png'),png);
  await writeFile(path.join(session,'frame-000002','cam-1.png'),png);
  const manifest={session:'old embedded name',intervalNs:33333333,metrics:{frameCount:3,phaseStaggerMs:0.5},frames:[
    {sequenceIndex:0,folder:'frame-000000',groupedLeaderNs:'9007199254740993',files:[
      {cameraId:'cam-1',host:'192.168.50.101',file:'cam-1.png',captureDropped:false,actualLeaderNs:'9007199254740993'},
      {cameraId:'cam-2',file:null,dropped:true,transferFailed:true,captureDropped:false,actualLeaderNs:'9007199254741993',error:'ADB timeout'}]},
    {sequenceIndex:2,folder:'frame-000002',files:[
      {cameraId:'cam-1',file:'cam-1.png',actualLeaderNs:'9007199321407659'},
      {cameraId:'cam-2',file:null,dropped:true,captureDropped:true}]}]};
  const manifestFile=path.join(session,'frame-manifest.json');
  await writeFile(manifestFile,'\uFEFF'+JSON.stringify(manifest));
  const service=new FrameReview({configStore:{read:async()=>({outputRoot:root})},env:{}});
  return {root,session,manifest,manifestFile,service};
}
test('manifest outcomes distinguish dropped capture, failed transfer and legacy unknown',()=>{
  assert.equal(recordedState({captureDropped:true}),'capture_dropped');
  assert.equal(recordedState({dropped:true,transferFailed:true,captureDropped:false}),'transfer_failed');
  assert.equal(recordedState({dropped:true}),'unavailable');
  assert.equal(recordedState(null),'unrecorded');
  assert.equal(recordedState({file:'image.jpg'}),'available');
});
test('timing preserves nanoseconds beyond Number precision and never reports a one-camera spread',()=>{
  const files=[{actualLeaderNs:'9007199254740993'},{actualLeaderNs:'9007199254741993'}];
  assert.deepEqual(timingFor(files,'9007199254740993'),{samples:2,spreadMs:0.001,offsets:[0,0.001]});
  assert.equal(timingFor(files.slice(0,1),null).spreadMs,null);
  assert.equal(timestampNs(9007199254740992),null);
  assert.equal(timestampNs(null),null);
  assert.equal(timingFor([{actualLeaderNs:null},{actualLeaderNs:''}],null).samples,0);
});
test('loads original CameraScope manifests, sparse indices and per-camera failures without live phones',async t=>{
  const {service}=await fixture(t);
  assert.equal((await service.list()).sessions[0].id,'take-01');
  const session=await service.session('take-01');
  assert.equal(session.session,'take-01');
  assert.deepEqual(session.frames.map(f=>f.index),[0,2]);
  assert.equal(session.missingSequenceCount,1);
  assert.deepEqual(session.totals,{recordedTransfers:2,captureDropped:1,transferFailed:1,unknown:0});
  const frame=await service.frame('take-01',0,session.revision);
  assert.equal(frame.spreadMs,0.001);
  assert.equal(frame.files[0].actualLeaderNs,'9007199254740993');
  assert.equal(frame.files[0].state,'available');
  assert.equal(frame.files[1].state,'transfer_failed');
  assert.equal(frame.files[1].offsetMs,0.001);
  const image=await service.image('take-01',0,'cam-1',session.revision);
  assert.equal(image.type,'image/png');assert.deepEqual(await image.handle.readFile(),png);await image.handle.close();
  await assert.rejects(service.image('take-01',0,'cam-2'),/No transferred image/);
  await assert.rejects(service.frame('take-01',1),/not in the session/);
});
test('disk checks distinguish missing, empty, unsupported and absent camera records',async t=>{
  const {service,session,manifest,manifestFile}=await fixture(t);
  await rm(path.join(session,'frame-000000','cam-1.png'));
  assert.equal((await service.frame('take-01',0)).files[0].state,'missing');
  await writeFile(path.join(session,'frame-000000','cam-1.png'),'');
  assert.equal((await service.frame('take-01',0)).files[0].state,'missing');
  manifest.frames[0].files[0].file='cam-1.dng';
  manifest.frames[0].files.push({cameraId:'cam-3',captureDropped:true});
  await writeFile(path.join(session,'frame-000000','cam-1.dng'),'raw');
  await writeFile(manifestFile,JSON.stringify(manifest));
  assert.equal((await service.frame('take-01',0)).files[0].state,'unsupported');
  const second=await service.frame('take-01',2);
  assert.equal(second.files[2].state,'unrecorded');
  assert.equal(second.spreadMs,null);
});
test('rejects traversal, unlisted images, symlink files and symlink sessions',async t=>{
  const {service,session,root,manifest,manifestFile}=await fixture(t);
  await assert.rejects(service.session('../take-01'),/valid capture session/);
  await assert.rejects(service.session('..\\take-01'),/valid capture session/);
  await writeFile(path.join(root,'private.png'),png);
  await symlink(path.join(root,'private.png'),path.join(session,'frame-000000','link.png'));
  manifest.frames[0].files[0].file='link.png';
  await writeFile(manifestFile,JSON.stringify(manifest));
  assert.equal((await service.frame('take-01',0)).files[0].state,'blocked');
  await assert.rejects(service.image('take-01',0,'cam-1'),/Invalid image path/);
  manifest.frames[0].files[0].file='../../private.png';
  await writeFile(manifestFile,JSON.stringify(manifest));
  assert.equal((await service.frame('take-01',0)).files[0].state,'blocked');
  await assert.rejects(service.image('take-01',0,'private.png'),/No transferred image/);
  await symlink(session,path.join(root,'frames','linked-session'),'dir');
  assert.equal((await service.list()).sessions.some(s=>s.id==='linked-session'),false);
  await assert.rejects(service.session('linked-session'),/Symbolic links/);
});
test('manifest updates invalidate the cached session and in-flight image revision',async t=>{
  const {service,manifest,manifestFile}=await fixture(t);
  const before=await service.session('take-01');
  manifest.frames[0].files[0].captureDropped=true;
  await writeFile(manifestFile,JSON.stringify(manifest));
  await assert.rejects(service.frame('take-01',0,before.revision),{code:'REVIEW_CHANGED'});
  await assert.rejects(service.image('take-01',0,'cam-1',before.revision),{code:'REVIEW_CHANGED'});
  assert.equal((await service.frame('take-01',0)).files[0].state,'capture_dropped');
});
test('invalid manifests fail clearly while empty roots and single-object manifests are supported',async t=>{
  const {service,root,manifest,manifestFile}=await fixture(t);
  await writeFile(manifestFile,'{"frames":');
  await assert.rejects(service.session('take-01'),{code:'REVIEW_MANIFEST'});
  assert.equal((await service.list()).sessions.length,1);
  await writeFile(manifestFile,JSON.stringify({...manifest,frames:[manifest.frames[0],manifest.frames[0]]}));
  await assert.rejects(service.session('take-01'),/unique nonnegative/);
  const single={...manifest,frames:{...manifest.frames[0],files:manifest.frames[0].files[0]}};
  await writeFile(manifestFile,JSON.stringify(single));
  assert.equal((await service.session('take-01')).cameras.length,1);
  const missing=new FrameReview({configStore:{read:async()=>({outputRoot:root})},env:{RIG_CAPTURE_ROOT:path.join(root,'absent')}});
  assert.deepEqual((await missing.list()).sessions,[]);
  assert.match((await missing.list()).captureRoot,/absent$/);
});
