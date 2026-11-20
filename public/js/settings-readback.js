// Shared by the server and camera cards. Older CameraScope builds may omit
// optional mode/lock flags; missing data must never become a confirmed match.
export function settingsVerification(state, requested) {
  const definitions = [
    ['iso','ISO',requested.iso,state?.iso,true],
    ['exposureMs','Exposure (ms)',requested.exposureMs,state?.exposureMs,true],
    ['frameDurationMs','Frame interval (ms)',1000/requested.frameRate,state?.frameDurationMs,true],
    ['autoExposureEnabled','Auto exposure',false,state?.autoExposureEnabled,false],
    ['awbMode','White balance',requested.awbMode,state?.colorProcessing?.awbMode,false],
    ['awbLock','White balance lock',false,state?.colorProcessing?.awbLock,false]
  ];
  const fields = definitions.map(([key,label,expected,reported,required]) => {
    const missing = reported === undefined || reported === null;
    const match = typeof expected === 'number' ? typeof reported === 'number' && Number.isFinite(reported) &&
      (key === 'iso' ? reported === expected : Math.abs(reported-expected) <= 0.001) : reported === expected;
    return {key,label,expected,reported:missing?null:reported,required,status:missing?'unreported':match?'match':'mismatch'};
  });
  const status = fields.some(f=>f.status==='mismatch') ? 'mismatch' : fields.some(f=>f.required&&f.status==='unreported') ? 'unavailable' :
    fields.some(f=>f.status==='unreported') ? 'partial' : 'confirmed';
  return {status,fields};
}
export function settingValue(value) {
  if(value===null||value===undefined)return 'not reported';
  if(typeof value==='boolean')return value?'on':'off';
  return typeof value==='number' ? String(Number(value.toFixed(6))) : String(value);
}
export const showReadbackWarning=r=>!!r&&(r.status==='partial'
  ?r.fields.some(f=>f.status==='unreported'&&f.key!=='autoExposureEnabled'):r.status!=='confirmed');
export function verificationMessage(verification) {
  if(verification.status==='confirmed')return 'CameraScope requested settings confirmed by readback.';
  const missing=verification.fields.filter(f=>f.status==='unreported'&&f.key!=='autoExposureEnabled').map(f=>f.label).join(', ');
  if(verification.status==='partial')return `ISO, exposure and frame interval match CameraScope.${missing?' Not reported: '+missing+'.':''}`;
  const differences=verification.fields.filter(f=>f.status==='mismatch').map(f=>`${f.label}: requested ${settingValue(f.expected)}, reported ${settingValue(f.reported)}`).join('; ');
  return [differences?`Settings differ: ${differences}.`:'',missing?`Not reported: ${missing}.`:''].filter(Boolean).join(' ');
}
