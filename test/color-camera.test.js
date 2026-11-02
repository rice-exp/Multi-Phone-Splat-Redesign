import test from 'node:test';
import assert from 'node:assert/strict';
import {ColorCamera,availableColorCameras,nextVideoFrame} from '../public/js/color-camera.js';

function video() {
  return {srcObject:null,currentTime:1,readyState:2,paused:false,ended:false,videoWidth:1920,videoHeight:1080,
    play:async()=>{},pause(){this.paused=true;},setAttribute(){},requestVideoFrameCallback(fn){this.frame=fn;return 1;},cancelVideoFrameCallback(){this.cancelled=true;}};
}
const phone={id:'phone-4',name:'Lab phone 4',ip:'192.168.1.4',route:'cam-4',responding:true,previewReady:true,state:{iso:200,colorProcessing:{awbMode:'OFF'}},checkedAt:Date.now()};
const status=()=>({connected:true,checkedAt:Date.now(),phones:[phone],previewHost:'127.0.0.1'});

test('only fresh, responding rig streams appear as camera sources',()=>{
  const s=status();assert.equal(availableColorCameras(s).length,1);
  assert.equal(availableColorCameras({...s,checkedAt:Date.now()-21000}).length,0);
  assert.equal(availableColorCameras({...s,connected:false}).length,0);
  assert.equal(availableColorCameras({...s,phones:[{...phone,previewReady:false}]}).length,0);
  assert.equal(availableColorCameras({...s,phones:[{...phone,route:'../../x'}]}).length,0);
});

test('capture waits for a new frame and frozen/aborted sources fail',async()=>{
  const v=video();let completed=false;
  const frame=nextVideoFrame(v).then(()=>completed=true);
  await Promise.resolve();assert.equal(completed,false);v.frame();await frame;assert.equal(completed,true);
  await assert.rejects(nextVideoFrame(video(),{timeoutMs:15}),/No fresh/);
  const controller=new AbortController(),pending=nextVideoFrame(video(),{signal:controller.signal});controller.abort();await assert.rejects(pending,/cancelled/);
});

test('device capture uses video only, snapshots the source identity and releases tracks',async()=>{
  let constraints,stops=0;const v=video(),track={label:'USB camera',getSettings:()=>({deviceId:'test-device',width:1920}),stop:()=>stops++,addEventListener(){}};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track]},canvas={};let drawn;
  canvas.getContext=()=>({drawImage:(...args)=>drawn=args,getImageData:()=>({width:canvas.width,height:canvas.height,data:new Uint8ClampedArray(4)})});
  const camera=new ColorCamera(()=>{},{mediaDevices:{getUserMedia:async value=>{constraints=value;return stream;}},createVideo:()=>v,createCanvas:()=>canvas});
  await camera.connectDevice();assert.equal(constraints.audio,false);assert.equal(camera.ready,true);
  const pending=camera.capture();v.frame();const captured=await pending;
  assert.equal(captured.image.width,1000);assert.equal(captured.image.height,563);assert.equal(drawn[0],v);
  assert.equal(captured.source.kind,'device-video');assert.equal(captured.source.cameraName,'USB camera');assert.equal(captured.source.videoWidth,1920);
  camera.close();assert.equal(stops,1);assert.equal(camera.ready,false);assert.equal(v.srcObject,null);
});

test('a late camera permission response cannot restart a disconnected camera',async()=>{
  let grant,stops=0;const track={stop:()=>stops++};
  const camera=new ColorCamera(()=>{},{mediaDevices:{getUserMedia:()=>new Promise(resolve=>grant=resolve)},createVideo:video});
  const connecting=camera.connectDevice();camera.close();grant({getTracks:()=>[track]});await connecting;
  assert.equal(stops,1);assert.equal(camera.video,null);assert.equal(camera.ready,false);
});

test('denied camera access has a recoverable message',async()=>{
  const camera=new ColorCamera(()=>{},{mediaDevices:{getUserMedia:async()=>{throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}},createVideo:video});
  await assert.rejects(camera.connectDevice(),/access was denied/);assert.equal(camera.video,null);
});

test('rig capture connects only the selected existing WHEP stream and closes the peer',()=>{
  let player;
  class Player {constructor(v,endpoint,notify){player=this;this.endpoint=endpoint;this.notify=notify;}close(){this.closed=true;}}
  const camera=new ColorCamera(()=>{},{createVideo:video,Player});
  camera.connectRig(phone,status(),'http://127.0.0.1:4317');
  assert.equal(player.endpoint,'http://127.0.0.1:8889/cam-4/whep');assert.equal(camera.ready,false);
  player.notify('Live','success');assert.equal(camera.ready,true);assert.equal(camera.source.cameraId,'phone-4');
  assert.notEqual(camera.source.reportedSettings,phone.state);
  player.notify('Stalled','warning');assert.equal(camera.ready,false);camera.close();assert.equal(player.closed,true);
});
