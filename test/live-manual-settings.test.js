import test from 'node:test';
import assert from 'node:assert/strict';
import {RigService,validateSettings} from '../lib/rig-service.mjs';
import {validateConfig,DEFAULT_CONFIG} from '../lib/rig-config.mjs';
import {reportedManualSettings} from '../public/js/manual-camera-settings.js';

// Like the reported failure: 'set' updates requested state immediately,
// but this fake Camera2 session latches sensor controls only when reopened.
function rig({recording=false,clamp=false,lostStop=false}={}) {
  const phones=['a','b'].map((id,i)=>({id,name:id,ip:'192.168.1.'+(10+i)}));
  const states=phones.map((_,i)=>({iso:100+i*100,exposureMs:8+i,frameDurationMs:1000/30,
    colorProcessing:{awbMode:i?'OFF':'AUTO',awbLock:false},streamEnabled:true,isCapturing:true,isH264Recording:recording,
    udpHost:'192.168.1.2',udpVideoPort:5004+i*2,udpMetadataPort:6004+i*2,logLines:['Device override: ISO requested=2400 actual=1600']}));
  const sensors=structuredClone(states),writes=[];let stamp=0;
  const service=new RigService({configStore:{read:async()=>({...DEFAULT_CONFIG,phones,pcIp:'192.168.1.2'})},
    gateway:{state:async()=>({running:false,routes:[]})},command:async(ip,cmd)=>{
      const i=phones.findIndex(p=>p.ip===ip),s=states[i];
      if(cmd.cmd==='set'){
        writes.push({id:phones[i].id,...cmd});
        if(cmd.capture===false){if(lostStop)throw Error('Lost stop acknowledgement');s.isCapturing=false;s.streamEnabled=false;}
        if(cmd.iso!=null){Object.assign(s,{iso:cmd.iso,exposureMs:cmd.exposureMs,frameDurationMs:cmd.frameDurationMs,colorProcessing:cmd.colorProcessing});}
        if(cmd.capture===true){s.isCapturing=true;s.streamEnabled=cmd.streamEnabled??s.streamEnabled;Object.assign(sensors[i],s);
          if(clamp){sensors[i].iso=1600;s.logLines.push(`Device override: ISO requested=${cmd.iso} actual=1600`);}
        }
      }
      if(s.isCapturing)s.phase={frameTimestampNs:++stamp*1e8,lastFrameIntervalMs:sensors[i].frameDurationMs};
      return {ok:true,state:structuredClone(s)};
    }});
  return {service,states,sensors,writes};
}
test('Apply changes the running fake sensor, not just its requested state, without touching a follower or its route',async()=>{
  const f=rig(),other=structuredClone(f.sensors[1]);
  const r=await f.service.operate('settings',['a'],{iso:400,exposureMs:100},{refreshPreview:true});
  assert.equal(r.ok,true);assert.deepEqual(f.writes.map(p=>[p.id,p.capture]),[['a',false],['a',true]]);
  assert.equal(f.sensors[0].iso,400);assert.equal(f.sensors[0].exposureMs,100);
  assert.equal(f.sensors[0].frameDurationMs,100);assert.equal(f.sensors[0].udpVideoPort,5004);
  assert.equal(f.sensors[0].colorProcessing.awbMode,'AUTO');assert.equal(f.states[0].streamEnabled,true);
  assert.deepEqual(f.sensors[1],other);assert.deepEqual(r.results[0].live,{fresh:true,intervalMs:100,overrides:[]});
});
test('editing only FPS across mixed phones keeps each existing ISO, exposure and white balance',async()=>{
  const f=rig();const r=await f.service.operate('settings',['a','b'],{frameRate:24},{refreshPreview:true});
  assert.equal(r.ok,true);assert.deepEqual(f.sensors.map(s=>[s.iso,s.exposureMs,s.colorProcessing.awbMode]),[[100,8,'AUTO'],[200,9,'OFF']]);
  assert.ok(f.sensors.every(s=>Math.abs(s.frameDurationMs-1000/24)<1e-6));
});
test('flags a new sensor override even when the requested ISO was echoed; ignores historical log lines',async()=>{
  const f=rig({clamp:true}),r=await f.service.operate('settings',['a'],{iso:24000},{refreshPreview:true});
  assert.equal(r.results[0].requested.iso,24000);assert.equal(f.sensors[0].iso,1600);
  assert.deepEqual(r.results[0].live.overrides,['Device override: ISO requested=24000 actual=1600']);
  assert.equal(r.status.events.findLast(e=>e.code==='SETTINGS').level,'warning');
});
test('never wakes stopped cameras, restarts recordings, or retries an uncertain stop',async()=>{
  const idle=rig();idle.states[0].isCapturing=false;
  await idle.service.operate('settings',['a'],{iso:500},{refreshPreview:true});assert.equal(idle.writes.length,1);assert.equal(idle.writes[0].capture,undefined);
  const rec=rig({recording:true});await assert.rejects(()=>rec.service.operate('settings',['a'],{iso:500},{refreshPreview:true}),{code:'PHONE_RECORDING'});assert.equal(rec.writes.length,0);
  const unknown=rig();delete unknown.states[0].isH264Recording;
  assert.equal((await unknown.service.operate('settings',['a'],{iso:500},{refreshPreview:true})).ok,false);assert.equal(unknown.writes.length,0);
  const lost=rig({lostStop:true});const r=await lost.service.operate('settings',['a'],{iso:500},{refreshPreview:true});assert.equal(r.ok,false);
  assert.deepEqual(lost.writes.map(p=>p.capture),[false]);
});
test('live values and saved defaults support positive device inputs, fractional FPS and exposure-limited timing',()=>{
  const s={iso:25600,exposureMs:100,frameRate:30,awbMode:'AUTO'};
  assert.equal(validateSettings(s).frameRate,10);assert.equal(validateConfig({...DEFAULT_CONFIG,...s}).frameRate,10);
  assert.equal(validateSettings({...s,exposureMs:1,frameRate:239.76}).frameRate,239.76);
  assert.equal(reportedManualSettings({frameDurationMs:33.333333}).frameRate,30);
  for(const x of [{iso:-1},{iso:100.5},{exposureMs:NaN},{frameRate:0},{frameRate:Infinity}])assert.throws(()=>validateSettings({...s,...x}));
});
