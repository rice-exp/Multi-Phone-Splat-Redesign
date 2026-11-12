import test from 'node:test';
import assert from 'node:assert/strict';
import {LEADER_COLOR_STORAGE,rigColorSource,colorSourceKey,colorSettingsKey,readLeaderPresets,saveLeaderPreset,selectLeaderPreset,removeLeaderPreset,sharedPreviewStatus} from '../public/js/color-profiles.js';
import {defaultAdjustments,IDENTITY} from '../public/js/color-calibration.js';

const phone=(id='a')=>({id,name:`Camera ${id}`,ip:`192.168.1.${id==='a'?1:2}`,route:`cam-${id==='a'?1:2}`,responding:true,state:{cameraId:'rear-0',iso:200,exposureMs:10,frameDurationMs:33,autoExposureEnabled:false,colorProcessing:{awbMode:'DAYLIGHT'}}});
const rig=()=>({backend:'http://127.0.0.1:4173',connected:true,checkedAt:Date.now(),phones:[phone(),phone('b')]});
const source=()=>rigColorSource(phone(),rig());
const preset=(id='leader-a')=>({id,name:'Studio run',camera:'Camera a',sample:false,pipeline:'decoded-sRGB-image',appliedToHardware:false,chart:{name:'Test chart'},source:{capture:{...source(),videoWidth:900,videoHeight:620}},fit:{matrix:IDENTITY,after:2},adjustments:defaultAdjustments(),referenceImage:{dataUrl:'data:image/jpeg;base64,TEST'}});
function memory(){const data=new Map();return {getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};}

test('reload keeps the original chart and the last phone transform without applying a second correction to video',()=>{
  const storage=memory(),p=preset();
  p.appliedToHardware=true;
  p.phoneApplication={transform:[.75,.2,.05,.2,.75,.05,.1,.2,.7],results:[{id:'a',ok:true},{id:'b',ok:true}]};
  saveLeaderPreset(storage,p,source());
  const [saved]=readLeaderPresets(storage).presets;
  assert.deepEqual(saved.phoneApplication,p.phoneApplication);
  assert.deepEqual(saved.source.capture.reportedSettings,p.source.capture.reportedSettings);
  assert.equal(sharedPreviewStatus(saved,rig()).usable,false);
  assert.match(sharedPreviewStatus(saved,rig()).label,/CameraScope output/);
});

test('one leader preset applies across a rig without fitting or identity-matching followers',()=>{
  const storage=memory(),state=saveLeaderPreset(storage,preset(),source()),p=state.presets[0],status=rig();
  status.phones[1].state={cameraId:'different-lens',iso:600,colorProcessing:{awbMode:'SHADE'}};
  assert.notEqual(colorSourceKey(rigColorSource(status.phones[1],status)),colorSourceKey(p.source.capture));
  assert.equal(sharedPreviewStatus(p,status).usable,true);
  assert.equal(state.activeId,p.id);assert.equal(state.presets.length,1);assert.equal(p.application.scope,'browser-rig-preview');
});

test('manual updates replace the chosen preset; new run copies and reload preserve settings and frame',()=>{
  const storage=memory(),first=preset();saveLeaderPreset(storage,first,source());first.adjustments.warmth=10;
  saveLeaderPreset(storage,first,source());assert.equal(readLeaderPresets(storage).presets.length,1);
  saveLeaderPreset(storage,{...first,id:'next-run',name:'Run 2'},source());
  const state=selectLeaderPreset(storage,'leader-a');assert.equal(state.activeId,'leader-a');assert.equal(state.presets.length,2);
  const restored=readLeaderPresets(storage).presets[0];assert.equal(restored.adjustments.warmth,10);assert.equal(restored.referenceImage.dataUrl,first.referenceImage.dataUrl);
  assert.equal(selectLeaderPreset(storage,null).activeId,null);assert.equal(readLeaderPresets(storage).presets.length,2);
  removeLeaderPreset(storage,'next-run');assert.equal(readLeaderPresets(storage).presets.length,1);
});

test('affine offsets and validation survive saving, and bad validation cannot replace the shared preset',()=>{
  const storage=memory(),profile=preset();
  profile.fit={...profile.fit,model:'affine',requestedModel:'auto',offset:[-.04,-.02,-.06],validation:{method:'leave-one-patch-out',before:20,after:1,linear:8,affine:1}};
  saveLeaderPreset(storage,profile,source());
  assert.deepEqual(readLeaderPresets(storage).presets[0].fit,profile.fit);
  for(const offset of [[NaN,0,0],[0,0],[0,0,0.6],null])assert.throws(()=>saveLeaderPreset(storage,{...profile,fit:{...profile.fit,offset}},source()));
  for(const validation of [null,{before:20,after:null},{before:20,after:30},{before:1,after:3}])assert.throws(()=>saveLeaderPreset(storage,{...profile,fit:{...profile.fit,validation}},source()),/withheld patches/);
  assert.deepEqual(readLeaderPresets(storage).presets[0].fit,profile.fit);
  assert.equal(sharedPreviewStatus(readLeaderPresets(storage).presets[0],rig()).usable,true);
});

test('sample/device/unknown camera, poor fits and failed persistence cannot replace the active preset',()=>{
  const storage=memory(),first=preset();saveLeaderPreset(storage,first,source());
  const device={kind:'device-video',settings:{deviceId:'usb-camera'}};
  for(const [bad,origin] of [[{...first,sample:true},source()],[{...first,source:{capture:null}},source()],[{...first,fit:{matrix:[[NaN]],after:0}},source()],[{...first,fit:{matrix:IDENTITY,after:20}},source()],[{...first,source:{capture:device}},device],[first,{...source(),cameraId:'wrong-camera'}]])assert.throws(()=>saveLeaderPreset(storage,bad,origin));
  assert.equal(readLeaderPresets(storage).activeId,first.id);
  assert.throws(()=>saveLeaderPreset({getItem:()=>null,setItem:()=>{throw new Error('Storage full');}},first,source()),/Storage full/);
});

test('shared reuse pauses for stale/wrong rig or changed leader settings, but not an offline leader',()=>{
  const storage=memory(),p=saveLeaderPreset(storage,preset(),source()).presets[0],status=rig();
  assert.equal(sharedPreviewStatus(p,{...status,checkedAt:Date.now()-21000}).usable,false);
  assert.equal(sharedPreviewStatus(p,{...status,backend:'http://other-rig:4173'}).usable,false);
  assert.equal(sharedPreviewStatus(p,{...status,phones:[phone('b')]}).usable,false);
  for(const change of [{iso:400},{cameraId:'front'},{exposureMs:20},{colorProcessing:{awbMode:'AUTO'}}]) {
    const leader={...phone(),state:{...phone().state,...change}};
    assert.match(sharedPreviewStatus(p,{...status,phones:[leader,phone('b')]}).label,/Leader settings changed/);
  }
  assert.equal(sharedPreviewStatus(p,{...status,phones:[{...phone(),responding:false,state:null},phone('b')]}).usable,true);
  assert.equal(colorSettingsKey(source()),colorSettingsKey({...source(),reportedSettings:{...phone().state,isCapturing:true}}));
});

test('invalid stored profiles are filtered and corrupt storage fails visibly',()=>{
  const storage=memory();storage.setItem(LEADER_COLOR_STORAGE,'bad-json');assert.throws(()=>readLeaderPresets(storage));
  storage.setItem(LEADER_COLOR_STORAGE,JSON.stringify({activeId:'bad',presets:[{id:'bad'}]}));assert.deepEqual(readLeaderPresets(storage),{activeId:null,presets:[]});
});
