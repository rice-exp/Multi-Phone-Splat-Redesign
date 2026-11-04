import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {LivePreview,previewEndpoint,sessionEndpoint} from '../public/js/live-preview.js';

const endpoint='http://127.0.0.1:8889/cam-1/whep';
class Peer extends EventTarget {
  constructor(options) { super(); this.options=options;this.iceGatheringState='complete';this.connectionState='new'; }
  addTransceiver(kind, options) { this.transceiver={kind,...options}; }
  async createOffer() { return {type:'offer',sdp:'receive-only offer'}; }
  async setLocalDescription(offer) { this.localDescription=offer; }
  async setRemoteDescription(answer) { this.answer=answer; }
  close() { this.closed=true; }
}
const video=()=>({srcObject:null,play:async()=>{},currentTime:1,readyState:2,paused:false,videoWidth:640,videoHeight:480});
const response=()=>({status:201,headers:new Headers({Location:'/cam-1/whep/session-123'}),text:async()=> 'gateway answer'});

test('gateway URLs use the reachable lab computer and validate session destinations',()=>{
  assert.equal(previewEndpoint({route:'cam-3'},{previewHost:'127.0.0.1'},'http://192.168.50.10:4317'), 'http://192.168.50.10:8889/cam-3/whep');
  assert.equal(previewEndpoint({route:'cam-3'},{previewHost:'10.0.0.5'},'http://127.0.0.1:4317'), 'http://10.0.0.5:8889/cam-3/whep');
  assert.throws(()=>previewEndpoint({route:'../api'},{},endpoint));
  assert.equal(sessionEndpoint('/cam-1/whep/123',endpoint), `${endpoint}/123`);
  for(const location of [null,'https://example.org/session','/cam-2/whep/123','/cam-1/whep/../../api','/cam-1/whep/123?token=x'])assert.throws(()=>sessionEndpoint(location,endpoint));
});

test('WHEP negotiates receive-only video and releases the session on close',async()=>{
  const calls=[],statuses=[];
  const player=new LivePreview(video(),endpoint,(...s)=>statuses.push(s),{Peer,request:async(url,options)=>{calls.push({url,...options});return response();}});
  await delay(20);
  const peer=player.run.peer;
  assert.deepEqual(peer.options,{iceServers:[]});assert.deepEqual(peer.transceiver,{kind:'video',direction:'recvonly'});
  assert.equal(calls[0].method,'POST');assert.equal(calls[0].headers['Content-Type'],'application/sdp');
  assert.equal(peer.answer.sdp,'gateway answer');
  assert.ok(!statuses.some(s=>s[1]==='success'),'negotiation alone never reports Live');
  player.close();assert.equal(peer.closed,true);assert.equal(calls.at(-1).method,'DELETE');assert.equal(calls.at(-1).url,`${endpoint}/session-123`);
});

test('frame observation is required for Live and frozen frames lose green status',async()=>{
  let clock=10000,frame;
  const output=video(),statuses=[];
  output.requestVideoFrameCallback=callback=>{frame=callback;return 1;};output.cancelVideoFrameCallback=()=>{};
  const player=new LivePreview(output,endpoint,(...s)=>statuses.push(s),{Peer,now:()=>clock,request:async()=>response()});
  await delay(10);frame(0,{mediaTime:1});await delay(1050);
  assert.ok(statuses.some(s=>s[0]==='Live · 640 × 480'&&s[1]==='success'));
  clock+=6000;await delay(1050);assert.match(statuses.at(-1)[0],/stalled/);assert.equal(statuses.at(-1)[1],'warning');
  player.close();
});

test('gateway errors schedule reconnect without leaking peers',async()=>{
  const statuses=[];
  const player=new LivePreview(video(),endpoint,(...s)=>statuses.push(s),{Peer,request:async()=>({status:404})});
  await delay(20);assert.equal(player.run,null);assert.match(statuses.at(-1)[0],/HTTP 404.*Retrying/);assert.ok(player.retryTimer);
  player.close();
});

test('default browser fetch keeps its native global receiver',async t=>{
  const original=globalThis.fetch;
  t.after(()=>globalThis.fetch=original);
  globalThis.fetch=async function(){assert.equal(this,globalThis);return response();};
  const player=new LivePreview(video(),endpoint,()=>{},{Peer});
  await delay(20);assert.ok(player.run.session);player.close();
});

test('closing while a gateway POST completes releases the late session',async()=>{
  let complete;
  const calls=[];
  const player=new LivePreview(video(),endpoint,()=>{},{Peer,request:async(url,options)=>{
    calls.push({url,...options});return options.method==='POST'?new Promise(resolve=>complete=resolve):response();
  }});
  await delay(10);player.close();complete(response());await delay(10);
  assert.equal(calls.at(-1).method,'DELETE');assert.equal(player.video.srcObject,null);
});
