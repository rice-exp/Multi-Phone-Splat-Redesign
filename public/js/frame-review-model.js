// Capture and transfer outcomes are independent. Older manifests used `dropped`
// for both; never reinterpret that ambiguous flag as a confirmed capture drop.
export const FILE_STATES = {
  available: {label:'Image available', next:'Inspect focus, framing and motion across cameras.'},
  capture_dropped: {label:'Dropped during capture', next:'No saved image was reported. Inspect the capture report; a transfer retry cannot recover an unsaved frame.'},
  transfer_failed: {label:'Transfer failed', next:'The image was reported saved on the phone. Retry its transfer with the capture application, then refresh this session.'},
  missing: {label:'File missing on computer', next:'The manifest names a file that is absent or empty. Check the capture folder or repeat the transfer, then refresh.'},
  unsupported: {label:'Preview unsupported', next:'This image format cannot be displayed here. Use the original file in a compatible viewer.'},
  unrecorded: {label:'No camera record', next:'This camera has no entry for this sequence index. Inspect the capture report and transfer manifest.'},
  unavailable: {label:'Capture outcome unknown', next:'The manifest does not distinguish a capture drop from a transfer problem. Inspect the original capture report.'},
  blocked: {label:'Invalid image path', next:'The manifest points outside this session or through a symbolic link. Correct the manifest or copy the actual session files.'},
  unreadable: {label:'File cannot be read', next:'Check file permissions on the lab computer, then refresh this frame.'}
};
export function recordedState(file) {
  if (!file) return 'unrecorded';
  if (file.captureDropped === true) return 'capture_dropped';
  if (file.transferFailed === true) return 'transfer_failed';
  if (file.dropped === true || !file.file) return 'unavailable';
  return 'available';
}
export function timestampNs(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value === 'string' && /^\d{1,24}$/.test(value)) return BigInt(value);
  return null;
}
export function timingFor(files, groupedLeaderNs) {
  const times=files.filter(file=>file.captureDropped!==true).map(file=>timestampNs(file.actualLeaderNs)).filter(value=>value!==null);
  const reference=timestampNs(groupedLeaderNs);
  const min=times.length?times.reduce((a,b)=>a<b?a:b):null;
  const max=times.length?times.reduce((a,b)=>a>b?a:b):null;
  return {samples:times.length, spreadMs:times.length>=2?Number(max-min)/1e6:null,
    offsets:files.map(file=>{const time=timestampNs(file.actualLeaderNs);return file.captureDropped!==true&&reference!==null&&time!==null?Number(time-reference)/1e6:null;})};
}
export function formatMs(value, signed=false) {
  return typeof value==='number'&&Number.isFinite(value)?`${signed&&value>0?'+':''}${value.toFixed(3)} ms`:'Unavailable';
}
