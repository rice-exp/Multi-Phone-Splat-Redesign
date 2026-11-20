import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {workspaceRoute} from '../public/js/workflow.js';
import {participantView} from '../public/js/participant-state.js';
import {RigConfigStore,DEFAULT_CONFIG} from '../lib/rig-config.mjs';
import {RigService} from '../lib/rig-service.mjs';

test('old preview bookmarks resolve to real pages with no demo module',()=>{
  for(const [hash,page,module] of [['#prepare','/','rig-app'],['#calibration','/calibration','calibration-app'],['#frames','/frames','frame-review'],['#capture','/capture','capture-app'],['#results','/splats','pending-workflow']]){
    const route=workspaceRoute('/',hash);assert.equal(route.path,page);assert.equal(route.module,module);
  }
  assert.equal(workspaceRoute('/frames').module,'frame-review');
});
test('fresh installations contain no invented inventory, destination, phone commands or errors',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'empty-rig-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new RigConfigStore({file:path.join(directory,'rig.json'),env:{}}),config=await store.initialize();
  assert.deepEqual(config.phones,[]);assert.equal(config.pcIp,'');assert.deepEqual(DEFAULT_CONFIG.phones,[]);
  const service=new RigService({configStore:store,gateway:{state:async()=>({running:false,routes:[]})},command:()=>{throw Error('No phone should be queried');}});
  const state=await service.refresh();assert.equal(state.connected,true);assert.deepEqual(state.phones,[]);assert.deepEqual(state.events,[]);
  await assert.rejects(store.update({phones:[{id:'left',name:'Left',ip:'10.0.0.101'}]}),{code:'CONFIG_INVALID'});
});
test('existing saved inventories and installation paths are preserved on startup',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'saved-rig-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const store=new RigConfigStore({file:path.join(directory,'rig.json'),env:{}});
  const config={...DEFAULT_CONFIG,pcIp:'10.0.0.10',phones:[{id:'actual-phone',name:'Lab front',ip:'10.0.0.101',serial:'lab-serial'}],cameraScopeRoot:'/lab/CameraScope'};
  await store.write(config);const before=await readFile(store.file,'utf8');
  assert.deepEqual(await store.initialize(),config);assert.equal(await readFile(store.file,'utf8'),before);
});
test('participant stages stay dark for missing, stale, future and simulated states',()=>{
  const now=100000,current={available:true,phase:'capturing',remaining:3,sessionName:'Actual take',updatedAt:now};
  for(const state of [null,{}, {...current,available:false},{...current,simulation:true},{...current,updatedAt:now-6000},{...current,updatedAt:now+5000},{...current,phase:'fake'}]){
    const view=participantView(state,now);assert.equal(view.phase,null);assert.equal(view.timer,'—');assert.equal(view.session,'No active capture status');
  }
  assert.equal(participantView(current,now).timer,'00:03');
  assert.equal(participantView({...current,remaining:null},now).timer,'—');
});
