import {setTimeout as sleep} from 'node:timers/promises';

const frameStamp=s=>s?.phase?.frameTimestampNs??s?.frameTimestampNs;
const failure=(code,message,next)=>Object.assign(new Error(message),{code,next});

// Read-only polling: an acknowledgement may precede a Camera2 transition.
// Never resend a mutation after an uncertain outcome.
async function observe(read,accept,ms) {
  const deadline=Date.now()+ms;
  let last=await read();
  while(last.responding&&!accept(last.state)&&Date.now()<deadline){
    await sleep(150);last=await read();
  }
  return last;
}

export async function applyManualToPhone(phone,target,refreshPreview,{send,read}) {
  const original=phone.state,reopen=refreshPreview&&original.isCapturing===true&&original.streamEnabled===true;
  const payload={cmd:'set',iso:target.iso,exposureMs:target.exposureMs,frameDurationMs:1000/target.frameRate,
    autoExposureEnabled:false,colorProcessing:{awbMode:target.awbMode,awbLock:false}};
  if(!reopen){await send(payload);return {readback:await read(),live:null};}
  if(original.isH264Recording!==false)throw failure('RECORDING_UNKNOWN','Cannot safely reload a camera whose recording state is unknown.','Finish any recording and refresh the phone status.');
  try {
    await send({cmd:'set',capture:false});
    const stopped=await observe(read,s=>s?.isCapturing===false,2500);
    if(!stopped.responding||stopped.state?.isCapturing!==false||stopped.state?.isH264Recording!==false)
      throw new Error('Could not confirm that the selected camera pipeline stopped.');
    // CameraScope's capture setup sets manual controls when opening the
    // session. Preserve the original stream flags and destination ports.
    for(const key of ['streamEnabled','udpHost','udpVideoPort','udpMetadataPort']){
      if(original[key]!=null&&stopped.state[key]!==original[key])payload[key]=original[key];
    }
    await send({...payload,capture:true});
    const resumed=await observe(read,s=>s?.isCapturing===true&&s.streamEnabled===true,3500);
    if(!resumed.responding||!resumed.state?.isCapturing||!resumed.state?.streamEnabled)
      throw new Error('Could not confirm that the selected camera resumed streaming.');
    let first=frameStamp(resumed.state);
    const next=await observe(read,s=>{
      first??=frameStamp(s);
      return s?.isCapturing&&s.streamEnabled&&first!=null&&frameStamp(s)>first;
    },Math.min(5000,Math.max(1500,2200/target.frameRate)));
    if(!next.responding||!next.state?.isCapturing||!next.state?.streamEnabled)throw new Error('The live camera became unavailable during verification.');
    const fresh=first!=null&&frameStamp(next.state)>first;
    const interval=next.state.phase?.lastFrameIntervalMs;
    const before=new Set(original.logLines||[]);
    const overrides=(next.state.logLines||[]).filter(l=>typeof l==='string'&&!before.has(l)&&/^Device override:/i.test(l)).slice(-3);
    return {readback:next,live:{fresh,intervalMs:fresh&&Number.isFinite(interval)&&interval>0?interval:null,overrides}};
  } catch(error) {
    throw failure('LIVE_SETTINGS_NOT_CONFIRMED',error.message,'Check the camera card. If its pipeline is stopped, use Start selected previews to reconnect. The command was not retried.');
  }
}
