import test from 'node:test';
import assert from 'node:assert/strict';
import {RigService} from '../lib/rig-service.mjs';
import {TEST_CONFIG} from '../test-support/rig-config.mjs';

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
        if (ip === faults.mismatch) state.colorProcessing.tonemapMode = 'HIGH_QUALITY';
        if (ip === faults.lostAck) throw new Error('Lost acknowledgement');
      }
      return {ok:true,state:structuredClone(state)};
    },
  });
  const sync = (ids, retryId) => service.operate('color-sync',ids,{leaderId:leader.id,retryId});
  return {commands, faults, states, service, sync, writes:()=>commands.filter(c=>c.body.cmd!=='getState')};
}

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
  assert.deepEqual(calls,[['/api/rig/color-sync','1',{ids:[leader.id,follower.id],leaderId:leader.id,retryId:'previous-snapshot'}]]);
});
