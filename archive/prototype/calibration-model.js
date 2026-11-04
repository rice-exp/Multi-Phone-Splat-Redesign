// UI simulation only. These records contain no images or measured calibration matrices.
export const SOLVE_STAGES = [
  ['Coverage audit', 'Review board coverage and pose diversity.'],
  ['K1 stability', 'Diagnose intrinsic stability for each camera.'],
  ['Observation filtering', 'Filter per-camera and per-pose observations.'],
  ['Observation export', 'Separate accepted, flagged, and rejected observations.'],
  ['Intrinsic calibration', 'Solve the filtered pinhole_k1 intrinsics.'],
  ['Rig extrinsics', 'Solve the fixed camera rig and assemble the profile.']
];
export const boardDefaults = {name:'Board session',columns:8,rows:11,squareMm:67,markerMm:50,dictionary:'DICT_4X4_50',poses:12,interval:2};
export const freshCalibration = () => ({tab:'board',draft:{...boardDefaults},sessions:[],activeId:null,profiles:[],profileId:null,poseResults:[],tagSizeMm:100,tagFamily:'tag36h11',job:null,message:''});
export const activeSession = w => w.sessions.find(s=>s.id===w.activeId);
export const activeProfile = w => w.profiles.find(p=>p.id===w.profileId);
const id = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const identities = cameras => cameras.map(c=>({id:c.id,name:c.name,facing:c.facing||'rear'}));
export function validateBoard(b) {
  if(!b.name?.trim())return 'Name the board session.';
  if(!Number.isInteger(b.columns)||b.columns<3||b.columns>20||!Number.isInteger(b.rows)||b.rows<3||b.rows>20)return 'Use 3–20 whole squares per board dimension.';
  if(!Number.isFinite(b.squareMm)||b.squareMm<=0||b.squareMm>500||!Number.isFinite(b.markerMm)||b.markerMm<=0||b.markerMm>=b.squareMm)return 'Marker length must be positive and smaller than the square length (up to 500 mm).';
  const capacities={DICT_4X4_50:50,DICT_5X5_100:100,DICT_6X6_250:250};
  if(!capacities[b.dictionary]||Math.floor(b.rows*b.columns/2)>capacities[b.dictionary])return 'The board needs more marker IDs than this dictionary provides. Choose a larger dictionary or smaller board.';
  if(!Number.isInteger(b.poses)||b.poses<1||b.poses>100)return 'Choose 1–100 poses for this demo batch.';
  if(!Number.isFinite(b.interval)||b.interval<1||b.interval>30)return 'Choose an interval from 1 to 30 seconds.';
  return '';
}
export function poseBlocker(w,cameras) {
  const p=activeProfile(w);
  if(!p)return 'Complete all six solver stages and select an intrinsic profile first.';
  if(!cameras.length)return 'Select at least one camera in Prepare rig.';
  if(cameras.some(c=>!p.cameras.some(pc=>pc.id===c.id&&pc.facing===(c.facing||'rear'))))return 'Selected cameras and facing must match the source intrinsic profile. Restore that selection in Prepare rig.';
  if(!Number.isFinite(w.tagSizeMm)||w.tagSizeMm<=0||w.tagSizeMm>1000)return 'Enter a tag size greater than 0 and no more than 1000 mm.';
  return '';
}
export function calibrationAction(current,action,cameras,now=Date.now()) {
  const w=structuredClone(current),s=activeSession(w);
  w.message='';
  const fail=message=>({...w,message});
  if(action==='cancel') {
    if(s&&['armed','transferring'].includes(s.status))s.status='paused';
    w.job=null;
    w.message='Demo stopped. Existing observations, completed stages, and earlier results are preserved.';
    return w;
  }
  if(w.job&&!(action==='finish'&&w.job.kind==='board'))return fail('Finish or stop the current calibration operation first.');
  if(action==='new') {
    const error=validateBoard(w.draft);if(error)return fail(error);
    if(!cameras.length)return fail('Select cameras in Prepare rig before starting a batch.');
    const session={id:id('demo-charuco'),name:w.draft.name.trim(),createdAt:new Date(now).toISOString(),board:{...w.draft},cameras:identities(cameras),observations:[],status:'armed',solvedStages:0,profileId:null,simulation:true};
    w.sessions.push(session);w.activeId=session.id;
    w.job={kind:'board',remaining:w.draft.poses,total:w.draft.poses,nextAt:now+w.draft.interval*1000};
  } else if(action==='resume') {
    if(!s||!['paused','captured','armed'].includes(s.status))return fail('Select a board session first.');
    if(s.observations.length>=100)return fail('This demo session has reached its 100-pose limit. Start a new session.');
    if(s.cameras.length!==cameras.length||cameras.some(c=>!s.cameras.some(sc=>sc.id===c.id&&sc.facing===(c.facing||'rear'))))return fail('Restore the original camera selection and facing before adding poses.');
    s.status='armed';s.solvedStages=0;s.profileId=null;
    w.job={kind:'board',remaining:1,total:1,nextAt:now+s.board.interval*1000};
  } else if(action==='finish') {
    if(!s||!s.observations.length||s.status==='captured')return fail('Capture at least one sample pose before finishing the session.');
    w.job={kind:'transfer',nextAt:now+800};s.status='transferring';
  } else if(action==='solve-all'||action==='solve-next') {
    if(!s||s.status!=='captured')return fail('Finish and transfer a board session before solving.');
    if(s.solvedStages===6)return fail('This session is already solved. Its profile is available below.');
    w.job={kind:'solve',all:action==='solve-all',nextAt:now+700};
  } else if(action==='poses') {
    const error=poseBlocker(w,cameras);if(error)return fail(error);
    w.job={kind:'poses',stage:0,sourceId:w.profileId,cameras:identities(cameras),tagSizeMm:w.tagSizeMm,tagFamily:w.tagFamily,nextAt:now+700};
  }
  return w;
}
export function tickCalibration(current,now=Date.now()) {
  if(!current.job||now<current.job.nextAt)return current;
  const w=structuredClone(current),j=w.job,s=activeSession(w);
  if(j.kind==='board') {
    s.observations.push({index:s.observations.length+1,cameraCount:s.cameras.length,transferred:false});
    j.remaining--;j.nextAt=now+s.board.interval*1000;
    if(!j.remaining){w.job=null;w.message='Sample batch complete. Add poses or finish and transfer the session.';}
  } else if(j.kind==='transfer') {
    s.observations.forEach(o=>o.transferred=true);s.status='captured';w.job=null;
    w.message='Sample observations transferred. The session is ready for the solver walkthrough.';
  } else if(j.kind==='solve') {
    s.solvedStages++;j.nextAt=now+700;
    if(s.solvedStages===6) {
      const profile={id:id('demo-intrinsics'),name:`${s.name} · sample profile`,sourceSessionId:s.id,cameras:structuredClone(s.cameras),poseCount:s.observations.length,createdAt:new Date(now).toISOString(),simulation:true};
      w.profiles.push(profile);w.profileId=profile.id;s.profileId=profile.id;w.job=null;
      w.message='Sample profile created. No intrinsics or extrinsics were computed.';
    } else if(!j.all)w.job=null;
  } else if(j.kind==='poses') {
    j.stage++;j.nextAt=now+700;
    if(j.stage===3) {
      w.poseResults.push({id:id('demo-apriltag'),sourceProfileId:j.sourceId,cameras:j.cameras,tagSizeMm:j.tagSizeMm,tagFamily:j.tagFamily,createdAt:new Date(now).toISOString(),simulation:true});
      w.job=null;w.message='Separate sample pose result saved. The source intrinsic profile is unchanged.';
    }
  }
  return w;
}
export function restoreCalibration(value) {
  if(!value||!Array.isArray(value.sessions)||!Array.isArray(value.profiles))return freshCalibration();
  const w={...freshCalibration(),...structuredClone(value)};
  if(w.job){const s=activeSession(w);if(s&&['armed','transferring'].includes(s.status))s.status='paused';w.job=null;w.message='The demo was interrupted. Saved observations and completed solver stages are preserved.';}
  return w;
}
