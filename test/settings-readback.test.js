import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsVerification,verificationMessage} from '../public/js/settings-readback.js';
import {configurationStatus} from '../public/js/rig-model.js';
import {RigService,settingsMatch} from '../lib/rig-service.mjs';

// Observed on the deployed build: numeric settings and white balance are
// present, but getState omits autoExposureEnabled entirely.
const requested={iso:1600,exposureMs:8,frameRate:29,awbMode:'OFF'};
const legacyState={iso:1600,exposureMs:8,frameDurationMs:34.482758,colorProcessing:{awbMode:'OFF',awbLock:false},isCapturing:true};

test('missing AE reporting is partial verification rather than a fabricated mismatch or full confirmation',()=>{
  const report=settingsVerification(legacyState,requested);
  assert.equal(report.status,'partial');assert.deepEqual(report.fields.filter(f=>f.status==='unreported').map(f=>f.key),['autoExposureEnabled']);
  assert.match(verificationMessage(report),/ISO, exposure and frame interval match/);
  assert.match(verificationMessage(report),/Auto exposure/);
  assert.equal(settingsMatch(legacyState,requested),false);
  assert.deepEqual(configurationStatus({responding:true,state:legacyState},requested),{label:'Settings partly verified',tone:'warning'});
});
test('real ISO and frame-interval differences remain errors with requested/reported values',()=>{
  const report=settingsVerification(legacyState,{...requested,iso:6400,frameRate:30});
  assert.equal(report.status,'mismatch');
  assert.deepEqual(report.fields.filter(f=>f.status==='mismatch').map(f=>f.key),['iso','frameDurationMs']);
  assert.match(verificationMessage(report),/ISO: requested 6400, reported 1600/);
  assert.match(verificationMessage(report),/Frame interval \(ms\): requested 33\.333333, reported 34\.482758/);
});
test('missing core values cannot pass; reported AE-on and white balance conflicts cannot be waived',()=>{
  assert.equal(settingsVerification({...legacyState,iso:undefined},requested).status,'unavailable');
  assert.equal(settingsVerification({...legacyState,iso:'1600'},requested).status,'mismatch');
  assert.equal(settingsVerification({...legacyState,autoExposureEnabled:true},requested).status,'mismatch');
  assert.equal(settingsVerification({...legacyState,colorProcessing:{awbMode:'AUTO',awbLock:false}},requested).status,'mismatch');
  assert.equal(settingsVerification({...legacyState,autoExposureEnabled:false},requested).status,'confirmed');
});
test('the settings operation accepts legacy numeric readback with an explicit warning, never resending the write',async()=>{
  const commands=[];
  const service=new RigService({configStore:{read:async()=>({phones:[{id:'cam-1',ip:'192.168.1.101'}]})},gateway:{state:async()=>({running:false,routes:[]})},
    command:async(ip,payload)=>{commands.push(payload);return {ok:true,state:structuredClone(legacyState)};}});
  const result=await service.operate('settings',['cam-1'],requested);
  assert.equal(result.ok,true);assert.equal(result.results[0].requestedStateConfirmed,false);assert.equal(result.results[0].verification.status,'partial');
  assert.equal(commands.filter(p=>p.cmd==='set').length,1);
  assert.equal(result.status.events.findLast(e=>e.code==='SETTINGS').level,'warning');
  assert.equal(result.status.phones[0].settings.requested.iso,1600);
});
test('failed readback retains the attempted target and exposes a field-level mismatch',async()=>{
  const service=new RigService({configStore:{read:async()=>({phones:[{id:'cam-1',ip:'192.168.1.101'}]})},gateway:{state:async()=>({running:false,routes:[]})},
    command:async()=>({ok:true,state:structuredClone(legacyState)})});
  const result=await service.operate('settings',['cam-1'],{...requested,iso:6400});
  assert.equal(result.ok,false);assert.equal(result.results[0].verification.status,'mismatch');
  assert.match(result.results[0].error.message,/requested 6400, reported 1600/);
  assert.equal(result.status.phones[0].settings.requested.iso,6400);
});
