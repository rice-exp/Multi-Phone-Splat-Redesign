import test from 'node:test';
import assert from 'node:assert/strict';
import {freshCalibration,validateBoard,calibrationAction,tickCalibration,activeSession,poseBlocker,restoreCalibration} from '../archive/prototype/calibration-model.js';
import {initialState,captureBlocker,generationBlocker,setAllCameras,restoreState} from '../archive/prototype/model.js';
const cameras=[{id:'cam-1',name:'Camera 01',facing:'rear'},{id:'cam-2',name:'Camera 02',facing:'rear'}];
const command=(w,action,at=0)=>calibrationAction(w,action,cameras,at);
function transferred() {
  let w=freshCalibration();w.draft.poses=2;
  w=command(w,'new');w=tickCalibration(w,2000);w=tickCalibration(w,4000);
  w=command(w,'finish',4000);return tickCalibration(w,4800);
}
function solved() {
  let w=command(transferred(),'solve-all',5000);
  for(let n=1;n<=6;n++)w=tickCalibration(w,5000+n*700);
  return w;
}
test('rejects invalid board geometry and insufficient marker dictionary capacity',()=>{
  const b=freshCalibration().draft;
  assert.equal(validateBoard(b),'');
  assert.match(validateBoard({...b,markerMm:b.squareMm}),/smaller/);
  assert.match(validateBoard({...b,rows:20,columns:20}),/dictionary/);
  assert.match(validateBoard({...b,poses:1.5}),/poses/);
  assert.equal(command(freshCalibration(),'solve-all').job,null);
});
test('early finish stops batch capture, transfers saved poses, then unlocks solving',()=>{
  let w=command(freshCalibration(),'new');w=tickCalibration(w,2000);
  w=command(w,'finish',2000);assert.equal(w.job.kind,'transfer');
  assert.equal(command(w,'solve-all').job.kind,'transfer');
  w=tickCalibration(w,2800);
  assert.equal(activeSession(w).observations.length,1);
  assert.equal(activeSession(w).status,'captured');
  assert.ok(activeSession(w).observations.every(o=>o.transferred));
  assert.equal(command(w,'solve-next').job.kind,'solve');
});
test('stopping and restoring preserves observations without completing an interrupted transfer',()=>{
  let w=command(freshCalibration(),'new');w=tickCalibration(w,2000);
  w=command(w,'cancel');assert.equal(activeSession(w).status,'paused');
  assert.equal(activeSession(w).observations.length,1);
  w=command(w,'finish');w=restoreCalibration(w);
  assert.equal(w.job,null);assert.equal(activeSession(w).status,'paused');
  assert.equal(activeSession(w).observations[0].transferred,false);
  assert.equal(command(w,'solve-all').job,null);
});
test('solver stages produce a profile only after the sixth step; more poses invalidate session solve',()=>{
  let w=transferred();
  for(let n=0;n<6;n++) {
    assert.equal(w.profiles.length,0);
    w=command(w,'solve-next',n*1000);w=tickCalibration(w,n*1000+700);
  }
  assert.equal(w.profiles.length,1);
  const snapshot=structuredClone(w.profiles[0]);
  w=command(w,'resume',7000);
  assert.equal(activeSession(w).solvedStages,0);
  assert.equal(activeSession(w).profileId,null);
  assert.deepEqual(w.profiles[0],snapshot);
});
test('AprilTag requires matching camera identity and facing, and creates a distinct immutable result',()=>{
  let w=solved();const original=structuredClone(w.profiles[0]);
  assert.match(poseBlocker(w,[{...cameras[0],facing:'front'}]),/match/);
  assert.match(poseBlocker(w,[{id:'cam-99'}]),/match/);
  w=command(w,'poses',10000);
  for(let n=1;n<=3;n++)w=tickCalibration(w,10000+n*700);
  assert.equal(w.poseResults.length,1);
  assert.equal(w.poseResults[0].sourceProfileId,original.id);
  assert.notEqual(w.poseResults[0].id,original.id);
  assert.deepEqual(w.profiles[0],original);
});
test('calibration work blocks concurrent capture/reconstruction and camera selection changes',()=>{
  const state=initialState();state.calibrationWorkbench=command(freshCalibration(),'new');
  assert.match(captureBlocker(state),/calibration/);
  assert.match(generationBlocker(state),/calibration/);
  assert.equal(setAllCameras(state,false),state);
  const restored=restoreState({getItem:()=>JSON.stringify(state)});
  assert.equal(restored.calibrationWorkbench.job,null);
  assert.equal(activeSession(restored.calibrationWorkbench).status,'paused');
});
