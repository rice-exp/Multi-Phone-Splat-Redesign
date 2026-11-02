import test from 'node:test';
import assert from 'node:assert/strict';
import {ColorLivePreview} from '../public/js/color-live-preview.js';
import {defaultAdjustments,correctedPixels} from '../public/js/color-calibration.js';

test('live correction processes original video, toggles without stacking and cleans up callbacks',()=>{
  const raw={width:1,height:1,data:new Uint8ClampedArray([100,120,140,255])};let drawn,output,cancelled=0;
  const video={style:{},paused:false,readyState:2,videoWidth:1,videoHeight:1,currentTime:0,requestVideoFrameCallback(fn){this.frame=fn;return 42;},cancelVideoFrameCallback(){cancelled++;}};
  const canvas={hidden:true,setAttribute(){},remove(){this.removed=true;},getContext:()=>({drawImage:v=>drawn=v,getImageData:()=>structuredClone(raw),putImageData:p=>output=p.data})};
  const profile={fit:{matrix:[[1.2,0,0],[0,1,0],[0,0,.8]]},adjustments:defaultAdjustments()};
  const view=new ColorLivePreview(video,{createCanvas:()=>canvas});view.setProfile(profile);video.frame(200,{mediaTime:1});
  assert.equal(drawn,video);assert.deepEqual(output,correctedPixels(raw,profile.fit.matrix,profile.adjustments));assert.equal(video.style.opacity,'0');assert.equal(canvas.hidden,false);
  view.setProfile(null);assert.equal(canvas.hidden,true);assert.equal(video.style.opacity,'');assert.equal(cancelled,1);
  view.setProfile(profile);video.frame(400,{mediaTime:2});assert.deepEqual(output,correctedPixels(raw,profile.fit.matrix,profile.adjustments));
  view.close();assert.equal(cancelled,2);assert.equal(canvas.removed,true);assert.equal(video.style.opacity,'');
});

test('pixel access failure restores the original view and reports the failure',()=>{
  let error;const video={style:{opacity:'0'},paused:false,readyState:2,videoWidth:640,videoHeight:480,requestVideoFrameCallback(fn){this.frame=fn;return 1;}};
  const canvas={setAttribute(){},getContext(){throw new Error('Canvas unavailable');}};
  const view=new ColorLivePreview(video,{createCanvas:()=>canvas,onError:e=>error=e});view.setProfile({fit:{},adjustments:{}});video.frame(200,{mediaTime:1});
  assert.equal(error.message,'Canvas unavailable');assert.equal(video.style.opacity,'');assert.equal(canvas.hidden,true);assert.equal(view.pending,false);
});

test('live followers render the saved affine offset exactly once',()=>{
  let output;
  const video={style:{},paused:false,readyState:2,videoWidth:1,videoHeight:1,requestVideoFrameCallback(fn){this.frame=fn;return 1;},cancelVideoFrameCallback(){}};
  const canvas={setAttribute(){},remove(){},getContext:()=>({drawImage(){},getImageData:()=>({width:1,height:1,data:new Uint8ClampedArray([0,0,0,255])}),putImageData:p=>output=p.data})};
  const profile={fit:{matrix:[[1,0,0],[0,1,0],[0,0,1]],offset:[.1,.2,.3]},adjustments:defaultAdjustments()};
  const view=new ColorLivePreview(video,{createCanvas:()=>canvas});view.setProfile(profile);video.frame(200,{mediaTime:1});
  assert.deepEqual(Array.from(output),[89,124,149,255]);
  profile.adjustments.amount=0;video.frame(400,{mediaTime:2});assert.deepEqual(Array.from(output),[0,0,0,255]);view.close();
});
