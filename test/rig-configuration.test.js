import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RigConfigStore,DEFAULT_CONFIG} from '../lib/rig-config.mjs';
import {RigService} from '../lib/rig-service.mjs';
import {routesFor} from '../lib/gateway.mjs';

async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'splat-local-service-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new RigConfigStore({file:path.join(directory,'rig.json'),env:{}});
  await store.write({...DEFAULT_CONFIG,phones:DEFAULT_CONFIG.phones.slice(0,2)});
  let starts=0,stops=0,recording=false;const commands=[];
  const gateway={child:{},state:async config=>({running:!!gateway.child,routes:routesFor(config)}),stop:async()=>{stops++;gateway.child=null;},start:async()=>{starts++;gateway.child={};}};
  const service=new RigService({configStore:store,gateway,command:async(ip,payload)=>{commands.push({ip,payload});return {ok:true,state:{isCapturing:true,isH264Recording:recording}};}});
  return {service,store,commands,counts:()=>({starts,stops}),record:()=>recording=true};
}
test('inventory edits restart the owned gateway, persist and never command phone changes',async t=>{
  const f=await fixture(t),before=await f.store.read();
  const phones=[...before.phones].reverse();const result=await f.service.configure({phones});
  assert.equal(result.ok,true);assert.deepEqual(f.counts(),{starts:1,stops:1});
  assert.equal((await f.store.read()).phones[0].id,'cam-2');assert.equal(result.status.phones[0].ip,phones[0].ip);
  assert.ok(f.commands.every(c=>c.payload.cmd==='getState'));assert.equal(f.service.busy,null);
});
test('recording and invalid configuration reject saves without changing disk or gateway',async t=>{
  const f=await fixture(t),before=await readFile(f.store.file,'utf8');
  await assert.rejects(()=>f.service.configure({pythonExecutable:'unsafe.exe'}),{code:'CONFIG_INVALID'});
  f.record();await assert.rejects(()=>f.service.configure({pcIp:'10.0.0.20'}),{code:'WORKFLOW_BUSY'});
  assert.equal(await readFile(f.store.file,'utf8'),before);assert.deepEqual(f.counts(),{starts:0,stops:0});assert.equal(f.service.busy,null);
});
