import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,selectedCameras,readiness,captureBlocker,generationBlocker,setAllCameras,toggleCamera,completeReadiness,applySettings,createTake,recoverTransfers,saveState,restoreState,formatTime} from '../public/js/model.js';

test('all phones begin selected, and a selected sync issue blocks capture',()=>{
  const state=initialState();
  assert.equal(selectedCameras(state).length,8);
  assert.equal(readiness(state).running,8);
  assert.equal(readiness(state).issues.length,1);
  assert.match(captureBlocker(state),/attention/);
  const checked=completeReadiness(state);
  assert.equal(captureBlocker(checked),'');
  assert.equal(checked.events.find(e=>e.code==='SYNC_CHECK_REQUIRED').resolved,true);
});
test('deselecting every camera blocks capture and does not mutate the source',()=>{
  const original=completeReadiness(initialState()),none=setAllCameras(original,false);
  assert.equal(selectedCameras(none).length,0);
  assert.equal(selectedCameras(original).length,8);
  assert.match(captureBlocker(none),/Select/);
  assert.equal(setAllCameras(none,true).checked,false);
});
test('readiness rechecks only the selected cameras',()=>{
  const state=completeReadiness(toggleCamera(initialState(),'cam-7',false));
  assert.equal(readiness(state).issues.length,0);
  assert.equal(state.cameras[6].synced,false);
  assert.equal(state.events.find(e=>e.code==='SYNC_CHECK_REQUIRED').resolved,false);
  assert.equal(captureBlocker(state),'');
  assert.match(captureBlocker(toggleCamera(state,'cam-7',true)),/attention/);
});
test('capture and reconstruction lock camera selection',()=>{
  for(const job of ['capture','reconstruction']){
    const state=initialState();state[job].status='running';
    assert.equal(toggleCamera(state,'cam-1',false),state);
    assert.equal(setAllCameras(state,false),state);
  }
});
test('applying settings excludes deselected cameras and reselecting exposes the mismatch',()=>{
  const original=toggleCamera(completeReadiness(initialState()),'cam-1',false);
  const state=applySettings(original,{...original.settings,iso:400});
  assert.equal(state.cameras[0].settings.iso,200);assert.equal(state.cameras[1].settings.iso,400);
  assert.equal(state.checked,false);
  const selected=toggleCamera(state,'cam-1',true);
  assert.equal(selected.cameras[0].configured,false);assert.match(captureBlocker(selected),/attention/);
  assert.equal(completeReadiness(selected).cameras[0].settings.iso,400);
});
test('a take is a snapshot and retains source timing analysis',()=>{
  const state=completeReadiness(initialState());state.take=createTake(state);
  assert.equal(state.take.expected,720);
  assert.equal(state.take.metrics.crossPhoneSpan.groups,90);
  assert.equal(state.take.metrics.crossPhoneSpan.medianNs,700000);
  state.settings.frames=25;
  assert.equal(state.take.frames,90);assert.equal(state.take.settings.frames,90);
});
test('reconstruction validates transfers, camera coverage and temporal frames',()=>{
  const state=initialState();assert.match(generationBlocker(state),/Capture/);
  state.take=createTake(state,90);assert.match(generationBlocker(state),/transfers/);
  state.take=createTake(state);assert.equal(generationBlocker(state),'');
  state.geometry='calibration';state.calibration={cameraIds:['cam-1']};assert.match(generationBlocker(state),/covering/);
  state.geometry='colmap';state.take.frames=1;assert.match(generationBlocker(state),/two frames/);
  state.model='3dgs';assert.equal(generationBlocker(state),'');
  state.take.cameraIds=['cam-1','cam-2'];assert.match(generationBlocker(state),/three/);
});
test('retry preserves take identity and resolves only that take’s transfer issue',()=>{
  const state=initialState();const first={...createTake(state,90),id:'first'},second={...createTake(state,90),id:'second'};
  state.take=second;state.takes=[first,second];
  state.events=[{code:'TRANSFER_PARTIAL',takeId:'first',resolved:false},{code:'TRANSFER_PARTIAL',takeId:'second',resolved:false}];
  const recovered=recoverTransfers(state,'first');
  assert.equal(recovered.take.id,'first');assert.equal(recovered.take.createdAt,first.createdAt);
  assert.equal(recovered.take.transferred,720);assert.equal(recovered.take.failedTransfers,0);
  assert.equal(recovered.takes[1].failedTransfers,90);
  assert.deepEqual(recovered.events.map(e=>e.resolved),[true,false]);
  assert.equal(state.take.failedTransfers,90);
});
test('refresh interrupts active work while preserving completed takes',()=>{
  let value;const storage={getItem:()=>value,setItem:(_,v)=>{value=v;}};
  const state=initialState();state.take=createTake(state);state.takes=[state.take];state.capture.status='running';
  assert.equal(saveState(state,storage),true);
  const restored=restoreState(storage);
  assert.equal(restored.capture.status,'cancelled');assert.equal(restored.capture.phase,'interrupted');
  assert.equal(restored.take.id,state.take.id);assert.equal(restored.takes.length,1);
  assert.equal(restored.events.at(-1).code,'DEMO_INTERRUPTED');
});
test('corrupt or unavailable storage falls back safely',()=>{
  assert.equal(restoreState({getItem:()=>'{invalid'}).cameras.length,8);
  assert.equal(saveState(initialState(),{setItem(){throw Error('Quota exceeded');}}),false);
});
test('countdown never formats sixty seconds as 00:60',()=>{
  assert.equal(formatTime(59.5),'01:00');assert.equal(formatTime(-1),'00:00');assert.equal(formatTime(3),'00:03');
});
