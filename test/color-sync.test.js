import test from 'node:test';
import assert from 'node:assert/strict';
import {RigService} from '../lib/rig-service.mjs';
import {TEST_CONFIG} from '../test-support/rig-config.mjs';
import {IDENTITY,correctLinear,defaultAdjustments} from '../public/js/color-calibration.js';
import {referenceSettings} from '../public/js/color-profiles.js';

const snapshot = {
  awbMode:'OFF', awbLock:false, colorCorrectionMode:'TRANSFORM_MATRIX', whiteBalanceGains:[1.76,1,1,1.44],
  colorCorrectionTransform:[1.2,-0.1,-0.1,0,1,0,0,-0.2,1.2], tonemapMode:'FAST',
  tonemapCurveRed:[0,0,1,1], tonemapCurveGreen:[0,0,1,1], tonemapCurveBlue:[0,0,1,1],
  tonemapGamma:1, tonemapPreset:'SRGB', noiseReductionMode:'FAST', edgeMode:'OFF', hotPixelMode:'OFF', shadingMode:'OFF'
};
const phones = [...TEST_CONFIG.phones, {id:'cam-3', ip:'192.168.50.103', name:'Side'}];
const [leader, follower, side] = phones;
function rig() {
  const states = new Map(phones.map(p => [p.ip,{iso:200, isCapturing:false, selectedCameraId:'0',
    isH264Recording:false, colorProcessing:{awbMode:'AUTO'}}]));
  const commands = [], faults = {};
  const service = new RigService({
    configStore:{read:async()=>({...TEST_CONFIG,phones})}, gateway:{state:async()=>({running:false})},
    command:async(ip,body,options) => {
      commands.push({ip,body,options});
      const state = states.get(ip);
      if (ip === faults.offline) throw new Error('Timed out');
      if (body.cmd === 'autoColorSnapshot') {
        if (faults.convergence) throw new Error('AWB did not converge');
        state.colorProcessing = structuredClone(snapshot);
        if (faults.leaderMismatch) state.colorProcessing.awbMode = 'AUTO';
        return {ok:true, snapshot:faults.incomplete ? {awbMode:'OFF'} : snapshot};
      }
      if (body.cmd === 'setColorProcessing') {
        state.colorProcessing = structuredClone(body.value);
        if (faults.round) state.colorProcessing.colorCorrectionTransform=state.colorProcessing.colorCorrectionTransform.map(n=>Math.round(n*1000)/1000);
        if (ip === faults.mismatch) state.colorProcessing.tonemapMode = 'HIGH_QUALITY';
        if (ip === faults.lostAck) throw new Error('Lost acknowledgement');
      }
      return {ok:true,state:structuredClone(state)};
    },
  });
  const sync = (ids, retryId) => service.operate('color-sync',ids,{leaderId:leader.id,retryId});
  return {commands, faults, states, service, sync, writes:()=>commands.filter(c=>c.body.cmd!=='getState')};
}

test('concurrent Prepare rig and Calibration refreshes both receive the same phone status',async()=>{
  const f=rig();
  const [prepare,calibration]=await Promise.all([f.service.refresh(true),f.service.refresh()]);
  assert.ok(prepare.connected);
  assert.deepEqual(calibration,prepare);
  assert.equal(f.commands.length,phones.length);
});

function chartFrame(f) {
  const state=f.states.get(leader.ip);
  state.colorProcessing=structuredClone(snapshot);
  return {ip:leader.ip,route:'cam-1',reference:structuredClone(referenceSettings(state)),fit:{matrix:IDENTITY,after:2},adjustments:{...defaultAdjustments(),saturation:40}};
}
const adjust=(f,correction,ids=[leader.id,follower.id])=>f.service.operate('color-sync',ids,{leaderId:leader.id,source:'adjust',correction});

test('Apply writes the fitted correction and sliders to the leader, then copies its rounded readback only to selected followers',async()=>{
  const f=rig(),frame=chartFrame(f);
  frame.fit.matrix=[[1,.06,0],[0,.95,.02],[-.02,0,1.03]];
  frame.adjustments={amount:72,exposure:.3,warmth:12,tint:-9,saturation:65};
  f.faults.lostAck=leader.ip;f.faults.round=true;
  const result=await adjust(f,frame);
  assert.equal(result.ok,true);
  const writes=f.writes();
  assert.deepEqual(writes.map(c=>[c.ip,c.body.cmd]),[[leader.ip,'setColorProcessing'],[follower.ip,'setColorProcessing']]);
  const matrix=writes[0].body.value.colorCorrectionTransform,base=snapshot.colorCorrectionTransform;
  const multiply=(m,v)=>[0,1,2].map(row=>v.reduce((sum,n,col)=>sum+n*m[row*3+col],0));
  const input=[.19,.37,.54];
  const expected=correctLinear(multiply(base,input),frame.fit.matrix,frame.adjustments);
  multiply(matrix,input).forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-9));
  const verified=f.states.get(leader.ip).colorProcessing;
  assert.deepEqual(writes[1].body.value,verified);
  assert.deepEqual(f.states.get(follower.ip).colorProcessing,verified);
  assert.deepEqual(verified.whiteBalanceGains,snapshot.whiteBalanceGains);
  assert.equal(f.states.get(side.ip).colorProcessing.awbMode,'AUTO');
  await adjust(f,frame);
  assert.equal(f.writes().length,2);
  // A second slider position and a reset start from the original reference.
  const reset={...frame,fit:{matrix:IDENTITY,after:2},previousTransform:verified.colorCorrectionTransform,adjustments:defaultAdjustments()};
  assert.equal((await adjust(f,reset)).ok,true);
  assert.deepEqual(f.states.get(follower.ip).colorProcessing,snapshot);
});

test('unusable or stale chart frames cannot write phones, and a leader mismatch prevents follower writes',async()=>{
  const f=rig(),frame=chartFrame(f);
  for(const wrong of [{route:'cam-9'},{ip:side.ip},{fit:{matrix:IDENTITY,after:16}},{adjustments:{...frame.adjustments,saturation:300}},{fit:{...frame.fit,offset:[.1,0,0]}}]){
    await assert.rejects(adjust(f,{...frame,...wrong}));
  }
  f.states.get(leader.ip).iso=300;
  await assert.rejects(adjust(f,frame),{code:'COLOR_REFERENCE_CHANGED'});
  f.states.get(leader.ip).iso=200;
  f.states.get(leader.ip).colorProcessing.colorCorrectionTransform=Array(9).fill(0);
  await assert.rejects(adjust(f,frame),{code:'COLOR_REFERENCE_CHANGED'});
  assert.equal(f.writes().length,0);
  f.states.get(leader.ip).colorProcessing=structuredClone(snapshot);f.faults.mismatch=leader.ip;
  await assert.rejects(adjust(f,frame),{code:'COLOR_LEADER_FAILED'});
  assert.deepEqual(f.writes().map(w=>w.ip),[leader.ip]);
});

test('partial adjustment can retry an offline follower without rewriting the leader',async()=>{
  const f=rig(),frame=chartFrame(f);
  f.faults.offline=follower.ip;
  const first=await adjust(f,frame);
  assert.deepEqual(first.results.map(r=>r.ok),[true,false]);
  delete f.faults.offline;
  assert.equal((await f.sync([leader.id,follower.id],first.status.colorSync.id)).ok,true);
  assert.deepEqual(f.writes().map(w=>w.ip),[leader.ip,follower.ip]);
});

test('one measured hardware snapshot reaches only selected phones, including a follower without a preview', async()=>{
  const f = rig();
  f.faults.lostAck = follower.ip;
  const {ok,results,status} = await f.sync([leader.id,follower.id]);
  assert.ok(ok);
  assert.equal(results.length,2);
  assert.deepEqual(f.writes().map(c=>[c.ip,c.body]),[
    [leader.ip,{cmd:'autoColorSnapshot',timeoutMs:8000}],
    [follower.ip,{cmd:'setColorProcessing',value:snapshot}]
  ]);
  assert.ok(f.writes()[0].options.timeoutMs > 8000);
  assert.deepEqual(status.colorSync.snapshot,snapshot);
  assert.equal(status.phones[1].previewReady,false);
  assert.equal(f.states.get(side.ip).colorProcessing.awbMode,'AUTO');
  assert.equal(f.states.get(follower.ip).iso,200);
});

test('copy uses the existing manual leader configuration without remeasuring and skips matching followers', async()=>{
  const f=rig();
  const current={...snapshot,whiteBalanceGains:[2.1,1,1,1.3]};
  f.states.get(leader.ip).colorProcessing={...current,ignoredField:'device-specific'};
  f.states.get(side.ip).colorProcessing=current;
  f.faults.lostAck=follower.ip;
  await f.service.refresh(true);
  for(const p of phones)f.service.settings.set(p.id,{ip:p.ip});
  const result=await f.service.operate('color-sync',phones.map(p=>p.id),{leaderId:leader.id,source:'current'});
  assert.ok(result.ok);
  assert.equal(result.status.colorSync.source,'current');
  assert.deepEqual(result.status.colorSync.snapshot,current);
  assert.deepEqual(f.writes().map(c=>[c.ip,c.body]),[[follower.ip,{cmd:'setColorProcessing',value:current}]]);
  assert.equal(f.states.get(leader.ip).colorProcessing.ignoredField,'device-specific');
  assert.deepEqual(result.status.phones.map(p=>Boolean(p.settings)),[true,false,true]);
});

test('copy rejects auto, incomplete and single-phone setups before writing settings',async()=>{
  const f=rig(), apply=ids=>f.service.operate('color-sync',ids,{source:'current',leaderId:leader.id});
  await assert.rejects(apply([leader.id]),{code:'COLOR_NO_FOLLOWERS'});
  for (const value of [{awbMode:'AUTO'},{...snapshot,whiteBalanceGains:null}]) {
    f.states.get(leader.ip).colorProcessing=value;
    await assert.rejects(apply([leader.id,follower.id]),{code:'COLOR_MANUAL_REQUIRED'});
  }
  assert.deepEqual(f.writes(),[]);
});

test('offline and mismatching followers are reported individually; retry copies the same snapshot',async()=>{
  const f = rig(), ids = phones.map(p=>p.id);
  f.faults.offline = side.ip;
  f.faults.mismatch = follower.ip;
  const first = await f.sync(ids);
  assert.equal(first.ok,false);
  assert.deepEqual(first.results.map(r=>r.ok),[true,false,false]);
  assert.match(first.results[1].error.message,/tonemapMode/);
  assert.equal(first.results[2].error.code,'PHONE_OFFLINE');
  assert.equal(first.status.events.filter(e=>e.code==='COLOR-SYNC'&&e.level==='error').length,2);
  delete f.faults.mismatch;
  delete f.faults.offline;
  const retry = await f.sync(ids,first.status.colorSync.id);
  assert.ok(retry.ok);
  assert.equal(retry.status.colorSync.id,first.status.colorSync.id);
  assert.equal(f.writes().filter(c=>c.body.cmd==='autoColorSnapshot').length,1);
  await f.sync(ids,retry.status.colorSync.id);
  assert.equal(f.writes().length,4); // all three phones already match
  f.states.get(leader.ip).selectedCameraId = 'other lens';
  await assert.rejects(f.sync(ids,retry.status.colorSync.id),{code:'COLOR_SNAPSHOT_CHANGED'});
  assert.equal(f.writes().length,4);
});

test('missing snapshot, failed AWB, and wrong leader readback never send follower settings',async()=>{
  for (const fault of ['convergence','incomplete','leaderMismatch']) {
    const f = rig();
    f.faults[fault] = true;
    await assert.rejects(f.sync([leader.id,follower.id]),{code:'COLOR_LEADER_FAILED'});
    assert.equal(f.writes().length,1);
    assert.equal(f.service.status().colorSync,null);
  }
});

test('recording, unselected and offline leaders are rejected before any phone writes',async()=>{
  const f=rig();
  await assert.rejects(f.sync([follower.id]),{code:'COLOR_LEADER'});
  f.states.get(follower.ip).isH264Recording=true;
  await assert.rejects(f.sync([leader.id,follower.id]),{code:'PHONE_RECORDING'});
  f.faults.offline=leader.ip;
  await assert.rejects(f.sync([leader.id]),{code:'COLOR_LEADER_OFFLINE'});
  assert.equal(f.writes().length,0);
});

test('the calibration button addresses the displayed selection even if another tab changes it',async t=>{
  const {selectedColorPhones,syncPhoneColor} = await import('../public/js/phone-color-sync.js');
  const status={phones, colorSync:{id:'previous-snapshot'}};
  const key='rig-selection-v1';
  const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
  let saved=null;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>k===key?saved:null}});
  t.after(()=>{
    if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);
    else delete globalThis.localStorage;
  });
  assert.deepEqual(selectedColorPhones(status),phones);
  saved=JSON.stringify({[side.id]:false});
  const displayed=selectedColorPhones(status).map(p=>p.id);
  saved=JSON.stringify({[side.id]:true});
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push([url,options.headers['X-Rig-Request'],JSON.parse(options.body)]);
    return {ok:true,json:async()=>({status})};
  });
  assert.equal(await syncPhoneColor(status,displayed,leader.id,true),status);
  await syncPhoneColor(status,displayed,leader.id,false,'current');
  const correction={adjustments:{...defaultAdjustments(),saturation:75}};
  await syncPhoneColor(status,displayed,leader.id,false,'adjust',correction);
  assert.deepEqual(calls,[['/api/rig/color-sync','1',{ids:[leader.id,follower.id],leaderId:leader.id,retryId:'previous-snapshot'}],
    ['/api/rig/color-copy','1',{ids:[leader.id,follower.id],leaderId:leader.id}],
    ['/api/rig/color-adjust','1',{ids:[leader.id,follower.id],leaderId:leader.id,correction}]]);
});
