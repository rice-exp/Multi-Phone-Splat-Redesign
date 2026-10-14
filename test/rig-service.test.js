import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import {once} from 'node:events';
import {RigService,sendCommand,validateBackend,validateSettings,parseCliJson,settingsMatch} from '../lib/rig-service.mjs';
import {observedPhones,selectionFor,colorStatus,configurationStatus} from '../public/js/rig-model.js';

const settings={iso:200,exposureMs:8,frameRate:30,awbMode:'DAYLIGHT'};
const summary={count:30,selectedOffsetNs:10000,selectedErrorBoundNs:20000};
function fixture(overrides={}) {
  let clock=100000, fail=false, running=false, configFail=false, syncReport, commands=[], executions=[];
  const states=new Map(['192.168.50.101','192.168.50.102'].map(ip=>[ip,{iso:100,exposureMs:8,frameDurationMs:1000/30,autoExposureEnabled:false,isCapturing:true,colorProcessing:{awbMode:'OFF',awbLock:false}}]));
  const config={phones:[{id:'cam-1',name:'Front',ip:'192.168.50.101'},{id:'cam-2',name:'Rear',ip:'192.168.50.102'}], pcIp:'192.168.50.10', cameraScopeRoot:'/lab/CameraScope', pythonExecutable:'python',iso:100,exposureMs:8,frameRate:30,colorProcessing:{awbMode:'OFF',awbLock:false}};
  const service=new RigService({now:()=>clock,request:async url=>{
    if(configFail)throw Error('connection refused');
    const data=url.endsWith('/config')?config:url.endsWith('/job')?{state:running?'running':'idle'}:{running:true,routes:config.phones.map((phone,i)=>({name:`cam-${i+1}`,ip:phone.ip,videoPort:5004+i*2,metadataPort:6004+i*2,ready:i===0}))};
    return {ok:true,json:async()=>data};
  },command:async(ip,payload)=>{commands.push({ip,payload});if(fail&&ip.endsWith('102'))throw Object.assign(Error('Timed out'),{code:'PHONE_TIMEOUT'});if(payload.cmd==='set'){const {cmd,capture,...patch}=payload;Object.assign(states.get(ip),patch);if(typeof capture==='boolean')states.get(ip).isCapturing=capture;}return {ok:true,state:{...states.get(ip)}};},run:async(exe,args)=>{executions.push({exe,args});return {stdout:JSON.stringify(args.includes('sync-many')?(syncReport||{results:[{host:'192.168.50.101',ok:true,summary},{host:'192.168.50.102',ok:true,summary}]}):{ok:true})};},...overrides});
  return {service,config,states,commands,executions,advance:n=>clock+=n,offline:()=>fail=true,backendOffline:()=>configFail=true,running:()=>running=true,report:value=>syncReport=value};
}

test('wireless preview start uses only selected routes and preserves camera settings',async()=>{
  const f=fixture();f.states.get('192.168.50.102').isCapturing=false;
  const result=await f.service.operate('preview-start',['cam-2']);
  assert.equal(result.ok,true);assert.equal(f.executions.length,0);
  assert.deepEqual(f.commands.filter(c=>c.payload.cmd==='set'),[{ip:'192.168.50.102',payload:{cmd:'set',udpHost:'192.168.50.10',udpVideoPort:5006,udpMetadataPort:6006,streamEnabled:true,capture:true}}]);
  assert.equal(f.states.get('192.168.50.102').iso,100);
  assert.equal(f.states.get('192.168.50.101').streamEnabled,undefined);
  assert.equal(f.config.iso,100);
});

test('an active preview pipeline is not explicitly reopened; stop never stops capture',async()=>{
  const f=fixture();await f.service.operate('preview-start',['cam-1']);
  assert.equal(f.commands.find(c=>c.payload.cmd==='set').payload.capture,undefined);
  await f.service.operate('preview-stop',['cam-1']);
  assert.deepEqual(f.commands.filter(c=>c.payload.cmd==='set').at(-1).payload,{cmd:'set',streamEnabled:false});
  assert.equal(f.states.get('192.168.50.101').isCapturing,true);
});

test('stream acknowledgements without matching destination readback fail per phone',async()=>{
  const f=fixture({command:async()=>({ok:true,state:{isCapturing:true,streamEnabled:true,udpHost:'192.168.1.1'}})});
  const result=await f.service.operate('preview-start',['cam-1']);
  assert.equal(result.ok,false);assert.equal(result.results[0].error.code,'PREVIEW_NOT_CONFIRMED');
  const g=fixture();g.offline();const partial=await g.service.operate('preview-start',['cam-1','cam-2']);
  assert.equal(partial.results[0].ok,true);assert.equal(partial.results[1].error.code,'PHONE_OFFLINE');
});

test('preview mutations reject workflow, recording, destination and missing gateway routes',async()=>{
  const f=fixture();f.running();await assert.rejects(()=>f.service.operate('preview-start',['cam-1']),{code:'WORKFLOW_BUSY'});
  const g=fixture();g.states.get('192.168.50.101').isH264Recording=true;
  await assert.rejects(()=>g.service.operate('preview-stop',['cam-1']),{code:'PHONE_RECORDING'});
  const h=fixture();h.config.pcIp='127.0.0.1';await assert.rejects(()=>h.service.operate('preview-start',['cam-1']),{code:'DESTINATION_INVALID'});
  const missing=fixture({request:async url=>({ok:true,json:async()=>url.endsWith('/config')?f.config:url.endsWith('/job')?{state:'idle'}:{running:true,routes:[]}})});
  await assert.rejects(()=>missing.service.operate('preview-start',['cam-1']),{code:'PREVIEW_ROUTE_MISSING'});
  for(const current of [f,g,h,missing])assert.equal(current.commands.filter(c=>c.payload.cmd==='set').length,0);
});

test('preview changes clear clock results and work without Python',async()=>{
  const f=fixture();await f.service.operate('sync',['cam-1']);assert.ok(f.service.status().phones[0].sync);
  f.config.pythonExecutable=null;await f.service.operate('preview-start',['cam-1']);
  assert.equal(f.service.status().phones[0].sync,null);
});
test('real inventory and response/gateway status replace demo devices',async()=>{
  const f=fixture();f.offline();const status=await f.service.refresh();
  assert.equal(status.phones.length,2);assert.equal(status.phones[0].responding,true);assert.equal(status.phones[0].previewReady,true);
  assert.equal(status.phones[1].responding,false);assert.equal(status.phones[1].state,null);assert.equal(status.phones[1].sync,null);
  assert.equal(status.phones[0].battery,undefined);assert.equal(status.phones[0].settings,null);
  assert.equal(f.executions.length,0);assert.ok(f.commands.every(command=>command.payload.cmd==='getState'));
});
test('stale and disconnected backends cannot retain green device state',async()=>{
  const f=fixture();await f.service.refresh();f.advance(21000);
  assert.equal(f.service.status().connected,false);assert.equal(f.service.status().phones[0].responding,false);
  f.backendOffline();const status=await f.service.refresh(true);
  assert.equal(status.phones.length,2);assert.equal(status.phones[0].previewReady,false);assert.equal(status.phones[0].state,null);
  assert.equal(status.error.code,'BACKEND_UNAVAILABLE');
});
test('settings execute only selected phones and require color readback',async()=>{
  const f=fixture();const result=await f.service.operate('settings',['cam-2'],settings);
  assert.equal(result.ok,true);assert.equal(f.executions.length,0);
  const writes=f.commands.filter(c=>c.payload.cmd==='set');
  assert.deepEqual(writes.map(c=>c.ip),['192.168.50.102']);
  assert.equal(writes[0].payload.autoExposureEnabled,false);assert.equal(writes[0].payload.capture,undefined);
  assert.equal(result.results[0].requestedStateConfirmed,true);assert.equal(f.config.iso,100);
});
test('partial settings failures are returned per phone',async()=>{
  const f=fixture();f.offline();const result=await f.service.operate('settings',['cam-1','cam-2'],settings);
  assert.equal(result.ok,false);assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false);assert.equal(f.commands.filter(c=>c.payload.cmd==='set').length,1);
});
test('successful command with missing readback is not reported as confirmed',async()=>{
  const f=fixture({command:async()=>({ok:true,state:{}})});const result=await f.service.operate('settings',['cam-1'],settings);
  assert.equal(result.ok,false);assert.equal(result.results[0].error.code,'SETTINGS_NOT_CONFIRMED');
});
test('sync report must cover each selected host exactly once; results expire',async()=>{
  const f=fixture();f.report({results:[{host:'192.168.50.101',ok:true,summary}]});
  const result=await f.service.operate('sync',['cam-1','cam-2']);
  assert.equal(result.ok,false);assert.equal(result.results[1].error.code,'SYNC_FAILED');
  assert.ok(f.service.status().phones[0].sync);f.advance(61000);assert.equal(f.service.status().phones[0].sync,null);
});
test('empty or duplicate sync reports cannot silently pass',async()=>{
  for(const results of [[],[{host:'192.168.50.101',ok:true}],[{host:'192.168.50.101',ok:true,summary},{host:'192.168.50.101',ok:true,summary}]]){
    const f=fixture();f.report({results});assert.equal((await f.service.operate('sync',['cam-1'])).ok,false);
  }
});
test('CameraScope requested settings must match all values and manual exposure',()=>{
  const state={iso:200,exposureMs:8,frameDurationMs:33.333332,autoExposureEnabled:false,colorProcessing:{awbMode:'DAYLIGHT',awbLock:false}};
  assert.equal(settingsMatch(state,settings),true);
  assert.equal(configurationStatus({responding:true,state},settings).tone,'success');
  for(const patch of [{iso:100},{exposureMs:9},{frameDurationMs:40},{autoExposureEnabled:true},{colorProcessing:{awbMode:'DAYLIGHT',awbLock:true}},{colorProcessing:{awbMode:'OFF',awbLock:false}}]) {
    assert.equal(settingsMatch({...state,...patch},settings),false);
    assert.equal(configurationStatus({responding:true,state:{...state,...patch}},settings).tone,'warning');
  }
  assert.equal(settingsMatch({},settings),false);
  assert.equal(configurationStatus({responding:false,state},settings).tone,'warning');
});
test('running original workflows, concurrent operations and invalid selections are blocked',async()=>{
  const f=fixture();f.running();await assert.rejects(()=>f.service.operate('sync',['cam-1']),/workflow/i);assert.equal(f.executions.length,0);
  const g=fixture();g.service.busy='sync';await assert.rejects(()=>g.service.operate('settings',['cam-1'],settings),/already running/);
  g.service.busy=null;await assert.rejects(()=>g.service.operate('sync',['unknown']),/configured phones/);assert.equal(g.executions.length,0);
});
test('invalid inventory, settings and public backend addresses fail closed',async()=>{
  const f=fixture();f.config.phones[1].ip=f.config.phones[0].ip;assert.equal((await f.service.refresh()).error.code,'CONFIG_INVALID');
  assert.throws(()=>validateBackend('https://example.org'));assert.throws(()=>validateBackend('http://8.8.8.8'));assert.throws(()=>validateBackend('http://user:pass@127.0.0.1'));
  assert.throws(()=>validateSettings({...settings,exposureMs:100}));assert.throws(()=>validateSettings({...settings,iso:'200'}));assert.throws(()=>validateSettings({...settings,command:'capture'}));
});
test('CLI log prefixes are accepted, malformed output is rejected',()=>{
  assert.deepEqual(parseCliJson('Connecting…\n{"ok":true}'),{ok:true});assert.throws(()=>parseCliJson('completed'));
});
test('UI expires observed status and preserves selections without fabricated state',()=>{
  assert.deepEqual(selectionFor([{id:'a'},{id:'b'}],{a:false}),{a:false,b:true});
  const status={connected:true,checkedAt:100,phones:[{responding:true,previewReady:true,sync:{checkedAt:100},state:{colorProcessing:{awbMode:'OFF',awbLock:false}}}]};
  assert.equal(observedPhones(status,21001)[0].responding,false);assert.equal(observedPhones(status,61001)[0].sync,null);
  assert.equal(colorStatus(status.phones[0],'AUTO').tone,'warning');assert.equal(colorStatus({responding:false},'AUTO').label,'White balance unknown');
});
test('UDP transport handles valid response, malformed response, rejection and timeout',async t=>{
  const socket=dgram.createSocket('udp4');socket.bind(0,'127.0.0.1');await once(socket,'listening');t.after(()=>socket.close());
  const port=socket.address().port;
  socket.on('message',(bytes,peer)=>{const command=JSON.parse(bytes);if(command.cmd==='timeout')return;socket.send(command.cmd==='bad'?'not JSON':JSON.stringify(command.cmd==='reject'?{ok:false,error:'Unsupported mode'}:{ok:true,state:{}}),peer.port,peer.address);});
  assert.deepEqual(await sendCommand('127.0.0.1',{cmd:'getState'},{port}),{ok:true,state:{}});
  await assert.rejects(()=>sendCommand('127.0.0.1',{cmd:'bad'},{port}),{code:'PHONE_RESPONSE'});
  await assert.rejects(()=>sendCommand('127.0.0.1',{cmd:'reject'},{port}),/Unsupported mode/);
  await assert.rejects(()=>sendCommand('127.0.0.1',{cmd:'timeout'},{port,timeoutMs:25}),{code:'PHONE_TIMEOUT'});
});
