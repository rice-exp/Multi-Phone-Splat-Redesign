import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import path from 'node:path';
import {RigConfigStore,DEFAULT_CONFIG,migrateConfig,validateConfig,PROJECT_ROOT} from '../lib/rig-config.mjs';

async function storeFor(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'splat-config-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  return new RigConfigStore({file:path.join(directory,'rig.json'),env:{}});
}
test('configuration initializes once and persists edits across process instances',async t=>{
  const store=await storeFor(t);await store.initialize();
  await store.update({pcIp:'10.0.0.20',phones:[{id:'custom',name:'Side',ip:'10.0.0.101',enabled:false}]});
  const reopened=new RigConfigStore({file:store.file,env:{}});const config=await reopened.initialize();
  assert.equal(config.pcIp,'10.0.0.20');assert.deepEqual(config.phones,[{id:'custom',name:'Side',ip:'10.0.0.101',enabled:false}]);
  assert.equal(reopened.public(config).pythonExecutable,undefined);
});
test('old CameraScope configuration migration preserves IDs, serials, CLI paths and capture options',async t=>{
  const old={...structuredClone(DEFAULT_CONFIG),cameraScopeRoot:'C:/lab/CameraScope',pythonExecutable:'C:/Python/python.exe',frameCount:145,outputRoot:'custom-captures',phones:[{id:'camera-left',name:'Left',ip:'192.168.50.121',serial:'existing-phone',enabled:false}]};
  const store=await storeFor(t);await store.write(migrateConfig(old));
  await store.update({phones:[{id:'camera-left',name:'Left renamed',ip:'192.168.50.122',enabled:false}]});
  const value=await store.read();assert.equal(value.phones[0].serial,'existing-phone');assert.equal(value.frameCount,145);assert.equal(value.cameraScopeRoot,old.cameraScopeRoot);assert.equal(value.outputRoot,'custom-captures');
});
test('invalid browser configuration leaves the saved file unchanged',async t=>{
  const store=await storeFor(t);await store.initialize();const before=await readFile(store.file,'utf8');
  for(const patch of [{pcIp:'127.0.0.1'},{phones:[DEFAULT_CONFIG.phones[0],DEFAULT_CONFIG.phones[0]]},{iso:0},{phones:[{id:'../yaml',name:'Bad',ip:'8.8.8.8'}]},{phones:[{id:1,name:'Bad',ip:'10.0.0.1'}]},{phones:[{id:'x',name:'Bad'}]},{phones:[{...DEFAULT_CONFIG.phones[0],enabled:'false'}]},{pythonExecutable:'unsafe.exe'},{cameraScopeRoot:'elsewhere'}]) {
    await assert.rejects(()=>store.update(patch));assert.equal(await readFile(store.file,'utf8'),before);
  }
});
test('malformed saved configuration fails closed instead of resetting the phone inventory',async t=>{
  const store=await storeFor(t);await writeFile(store.file,'not JSON');
  await assert.rejects(()=>store.initialize(),{code:'CONFIG_UNAVAILABLE'});assert.equal(await readFile(store.file,'utf8'),'not JSON');
  assert.throws(()=>validateConfig({...DEFAULT_CONFIG,pcIp:'example.org'}));
});
test('import command reads old file without modifying it and refuses unintended overwrite',async t=>{
  const store=await storeFor(t),source=path.join(path.dirname(store.file),'old.json');
  const original=JSON.stringify({...DEFAULT_CONFIG,pcIp:'10.0.0.25'});await writeFile(source,original);
  const execute=promisify(execFile),args=[path.join(PROJECT_ROOT,'scripts/import-config.mjs'),source];
  await execute(process.execPath,args,{env:{...process.env,RIG_CONFIG_PATH:store.file}});
  assert.equal((await store.read()).pcIp,'10.0.0.25');assert.equal(await readFile(source,'utf8'),original);
  await assert.rejects(()=>execute(process.execPath,args,{env:{...process.env,RIG_CONFIG_PATH:store.file}}));
});
