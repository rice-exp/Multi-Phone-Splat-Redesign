import {analyseCaptureReport} from './capture-metrics.js';
export const STORAGE_KEY = 'splat-studio-ui-v1';
export const STEPS = [
  {id:'prepare',name:'Prepare rig',detail:'Connect & configure',icon:'grid'},
  {id:'calibration',name:'Calibration',detail:'Check camera geometry',icon:'target'},
  {id:'capture',name:'Capture',detail:'Record & transfer',icon:'camera'},
  {id:'frames',name:'Frame review',detail:'Inspect your take',icon:'frames'},
  {id:'reconstruct',name:'Reconstruction',detail:'Build the scene',icon:'cube'},
  {id:'results',name:'Splat review',detail:'Explore in 4D',icon:'aperture'}
];
export const DEFAULT_SETTINGS = { exposure:8,iso:200,temperature:5600,contrast:100,frames:90,fps:30,quality:90,stagger:0 };
const positions=['Front left','Front right','Right front','Right rear','Rear right','Rear left','Left rear','Left front'];
export function makeEvent(level,message,extra={}) {
  return {id:globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random()}`,time:new Date().toISOString(),level,message,stage:'prepare',cameraId:null,code:null,resolved:false,...extra};
}
export function initialState() {
  return {
    version:1,sessionName:'Movement study · Take 01',step:'prepare',checked:false,
    cameras:positions.map((position,i)=>({id:`cam-${i+1}`,name:`Camera ${String(i+1).padStart(2,'0')}`,position,selected:true,online:true,synced:i!==6,configured:true,settings:{...DEFAULT_SETTINGS},battery:92-i*3,signal:87-i*2})),
    settings:{...DEFAULT_SETTINGS},calibration:null,
    capture:{status:'idle',phase:'idle',progress:0,remaining:0},take:null,takes:[],runs:[],
    reconstruction:{status:'idle',progress:0},model:'4dgs',geometry:'colmap',
    autoParticipant:true,simulateTransferFailure:false,
    events:[makeEvent('info','Demo workspace ready. All eight cameras are selected.',{code:'DEMO_READY'}),makeEvent('warning','Camera 07 needs a fresh synchronization check.',{cameraId:'cam-7',code:'SYNC_CHECK_REQUIRED',detail:'Simulated clock status is out of date. No capture has started.',impact:'Check the rig before starting a take.'})]
  };
}
export function selectedCameras(state) { return state.cameras.filter(c=>c.selected); }
export function cameraIssue(camera) {
  if(!camera.online)return {label:'Not responding',reason:'The phone has not acknowledged the last readiness check.',code:'PHONE_OFFLINE'};
  if(!camera.synced)return {label:'Sync check needed',reason:'The clock check is out of date. Run a fresh readiness check.',code:'SYNC_CHECK_REQUIRED'};
  if(!camera.configured)return {label:'Settings differ',reason:'This camera has not confirmed the saved capture settings.',code:'CONFIG_MISMATCH'};
  return null;
}
export function readiness(state) {
  const cameras=selectedCameras(state),issues=cameras.filter(cameraIssue);
  return {total:state.cameras.length,selected:cameras.length,running:state.cameras.filter(c=>c.online).length,ready:cameras.length-issues.length,issues,
    canCapture:!!cameras.length&&state.checked&&!issues.length};
}
export function captureBlocker(state,dirty=false) {
  if(!selectedCameras(state).length)return 'Select at least one camera in Prepare rig.';
  if(dirty)return 'Apply or discard your settings preview before capture.';
  if(readiness(state).issues.length)return 'Resolve the selected cameras that need attention.';
  if(!state.checked)return 'Run a readiness check for the selected cameras.';
  if(state.capture.status==='running')return 'A capture is already in progress.';
  if(state.reconstruction.status==='running')return 'Wait for reconstruction to finish.';
  return '';
}
export function generationBlocker(state) {
  if(!state.take)return 'Capture and transfer a take first.';
  if(state.take.failedTransfers)return 'Retry the missing transfers before reconstructing this demo.';
  if(state.take.cameraIds.length<3)return 'This reconstruction demo requires at least three captured camera views.';
  if(state.model==='4dgs'&&state.take.frames<2)return '4DGS needs at least two frames. Choose 3DGS for a single frame.';
  if(state.geometry==='calibration'&&(!state.calibration||!state.take.cameraIds.every(id=>state.calibration.cameraIds.includes(id))))return 'Choose a calibration profile covering every camera in this take.';
  if(state.capture.status==='running')return 'Wait for capture to finish.';
  if(state.reconstruction.status==='running')return 'Reconstruction is already running.';
  return '';
}
export function toggleCamera(state,id,selected) {
  if(state.capture.status==='running'||state.reconstruction.status==='running')return state;
  return {...state,checked:false,cameras:state.cameras.map(c=>c.id===id?{...c,selected,configured:JSON.stringify(c.settings||state.settings)===JSON.stringify(state.settings)}:c)};
}
export function setAllCameras(state,selected) {
  if(state.capture.status==='running'||state.reconstruction.status==='running')return state;
  return {...state,checked:false,cameras:state.cameras.map(c=>({...c,selected,configured:JSON.stringify(c.settings||state.settings)===JSON.stringify(state.settings)}))};
}
export function completeReadiness(state) {
  return {...state,checked:true,cameras:state.cameras.map(c=>c.selected?{...c,online:true,synced:true,configured:true,settings:{...state.settings}}:c),events:[...state.events.map(e=>['SYNC_CHECK_REQUIRED','PHONE_OFFLINE','CONFIG_MISMATCH'].includes(e.code)&&state.cameras.some(c=>c.selected&&c.id===e.cameraId)?{...e,resolved:true}:e),makeEvent('success',`${selectedCameras(state).length} cameras passed the simulated readiness check.`,{code:'READINESS_PASSED'})]};
}
export function applySettings(state,settings) {
  if(state.capture.status==='running'||state.reconstruction.status==='running'||!selectedCameras(state).length)return state;
  return {...state,settings:{...settings},checked:false,cameras:state.cameras.map(c=>c.selected?{...c,settings:{...settings},configured:true}:c)};
}
export function saveState(state,storage=globalThis.localStorage) {
  try { storage.setItem(STORAGE_KEY,JSON.stringify({...state,events:state.events.slice(-500)}));return true; }catch{return false;}
}
export function restoreState(storage=globalThis.localStorage) {
  try {
    const saved=JSON.parse(storage.getItem(STORAGE_KEY));
    if(saved?.version!==1||!Array.isArray(saved.cameras)||saved.cameras.length!==8||!Array.isArray(saved.events)||!saved.settings)return initialState();
    const defaults=initialState();
    const state={...defaults,...saved,capture:{...defaults.capture,...saved.capture},reconstruction:{...defaults.reconstruction,...saved.reconstruction}};
    if(!STEPS.some(s=>s.id===state.step))state.step='prepare';
    if(state.capture.status==='running'||state.reconstruction.status==='running') {
      if(state.capture.status==='running')state.capture={...state.capture,status:'cancelled',phase:'interrupted'};
      if(state.reconstruction.status==='running')state.reconstruction={...state.reconstruction,status:'cancelled'};
      state.events.push(makeEvent('warning','The demo was interrupted when the operator page closed.',{code:'DEMO_INTERRUPTED',detail:'Completed takes and earlier events are preserved. Start the interrupted operation again.'}));
    }
    return state;
  }catch{return initialState();}
}
export function createTake(state,failedTransfers=0) {
  const ids=selectedCameras(state).map(c=>c.id),expected=ids.length*state.settings.frames;
  const intervalNs=Math.round(1e9/state.settings.fps);
  const report={frameCount:state.settings.frames,intervalNs,phaseStaggerMs:state.settings.stagger,results:ids.map((id,i)=>({host:id,ok:true,phaseOffsetNs:i*state.settings.stagger*1e6,frames:Array.from({length:state.settings.frames},(_,f)=>({event:'sequenceFrameSaved',sequenceIndex:f,actualLeaderNs:1e9+f*intervalNs+i*100000+i*state.settings.stagger*1e6}))}))};
  return {id:`demo-${Date.now()}`,name:state.sessionName,createdAt:new Date().toISOString(),cameraIds:ids,frames:state.settings.frames,fps:state.settings.fps,settings:{...state.settings},expected,saved:expected,transferred:expected-failedTransfers,failedTransfers,metrics:analyseCaptureReport(report),simulation:true};
}
export function recoverTransfers(state,takeId=state.take?.id) {
  const take=state.takes.find(t=>t.id===takeId)|| (state.take?.id===takeId?state.take:null);
  if(!take||!take.failedTransfers||state.capture.status==='running'||state.reconstruction.status==='running')return state;
  const recovered={...take,transferred:take.expected,failedTransfers:0};
  return {...state,take:recovered,takes:state.takes.map(t=>t.id===takeId?recovered:t),capture:{status:'complete',phase:'complete',progress:100,remaining:0},events:state.events.map(e=>e.code==='TRANSFER_PARTIAL'&&e.takeId===takeId?{...e,resolved:true}:e)};
}
export function formatTime(seconds) {
  const total=Math.max(0,Math.ceil(Number(seconds)||0));
  return `${String(Math.floor(total/60)).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`;
}
