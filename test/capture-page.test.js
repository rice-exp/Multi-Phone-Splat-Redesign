import test from 'node:test';
import assert from 'node:assert/strict';

test('Capture lists configured cameras independently of recording availability and recovers on refresh',async t=>{
  const nodes=new Map(),element=id=>{
    if(!nodes.has(id))nodes.set(id,{dataset:{},textContent:'',innerHTML:''});
    return nodes.get(id);
  };
  globalThis.document={getElementById:element,documentElement:{dataset:{}}};
  globalThis.matchMedia=()=>({matches:false});
  globalThis.localStorage={getItem:()=>null,setItem:()=>{}};
  const phones=[{id:'left',name:'Left',ip:'10.0.0.1'},{id:'right',name:'Right',ip:'10.0.0.2'}];
  let configOk=true,captureStatus=405,refresh,setup=null;
  t.mock.method(globalThis,'setInterval',fn=>{refresh=fn;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(options.method,undefined);
    if(url==='/api/rig/config')return Response.json(configOk?{config:{phones}}:{error:'Rig unavailable'},{status:configOk?200:503});
    assert.equal(url,'/api/rig/capture');
    return Response.json(captureStatus===200?{phones,frameCount:90,framesRoot:'frames',setup}:{error:'Method not allowed'},{status:captureStatus});
  });
  await import('../public/js/capture-app.js');
  assert.match(element('take-list').innerHTML,/Left/);
  assert.match(element('take-list').innerHTML,/Right/);
  assert.equal(element('take-cameras').disabled,false);
  assert.equal(element('take-start').disabled,true);
  assert.match(element('take-error').textContent,/Restart the web server/);
  element('take-list').onchange({target:{value:'right',checked:false}});
  configOk=false;
  await refresh();
  assert.match(element('take-list').textContent,/Camera list unavailable/);
  captureStatus=200;
  await refresh();
  assert.match(element('take-list').innerHTML,/value="left" checked/);
  assert.doesNotMatch(element('take-list').innerHTML,/value="right" checked/);
  assert.equal(element('take-error').textContent,'');
  assert.equal(element('take-start').disabled,false);
  configOk=true;setup='Configure the desktop capture tool';
  await refresh();
  assert.equal(element('take-start').disabled,true);
  assert.equal(element('take-cameras').disabled,false);
  assert.equal(element('take-setup').textContent,setup);
});
