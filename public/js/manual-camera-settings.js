// Transport limits (Android int / nanoseconds), not a camera capability table.
export const numericFields=['iso','exposureMs','frameRate'];
export function validCameraNumber(key,n) {
  if(!Number.isFinite(n)||n<=0)return false;
  if(key==='iso')return Number.isInteger(n)&&n<=2147483647;
  const ns=Math.round(key==='frameRate'?1e9/n:n*1e6);
  return Number.isSafeInteger(ns)&&ns>=1;
}
export function effectiveRate(exposureMs,frameRate) {
  return Math.min(frameRate,1000/exposureMs);
}
export function reportedManualSettings(state) {
  return {iso:state?.iso,exposureMs:state?.exposureMs,
    frameRate:state?.frameDurationMs>0?Number((1000/state.frameDurationMs).toFixed(6)):undefined,
    awbMode:state?.colorProcessing?.awbMode};
}
