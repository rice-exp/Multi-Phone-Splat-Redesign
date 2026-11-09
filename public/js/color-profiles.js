// Browser preview profiles are separate from phone/sensor settings.
export const LEADER_COLOR_STORAGE='splat-color-leader-presets-v1';
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));

export function rigColorSource(phone,status) {
  return {kind:'rig-video',rigBackend:status.backend||'',cameraId:phone.id,cameraName:phone.name,ip:phone.ip,route:phone.route,reportedSettings:structuredClone(phone.state||{}),settingsCheckedAt:phone.checkedAt};
}
export function colorSourceKey(source) {
  if(source?.kind==='rig-video'&&source.cameraId&&source.ip&&source.route)return JSON.stringify(['rig',source.rigBackend||'',source.cameraId,source.ip,source.route]);
  if(source?.kind==='device-video'&&source.settings?.deviceId)return JSON.stringify(['device',source.settings.deviceId]);
  return null;
}
export function colorSettingsKey(source) {
  const settings=source?.kind==='rig-video'
    ?pick(source.reportedSettings,['cameraId','selectedCameraId','physicalCameraId','lensFacing','focalLength','zoomRatio','iso','exposureMs','frameDurationMs','autoExposureEnabled','colorProcessing'])
    :pick(source?.settings,['deviceId','width','height','facingMode','resizeMode','exposureMode','exposureTime','iso','whiteBalanceMode','colorTemperature','zoom','brightness','contrast','saturation']);
  return JSON.stringify(stable(settings));
}
export function validColorProfile(profile) {
  return profile?.pipeline==='decoded-sRGB-image'&&profile.appliedToHardware===false&&typeof profile.id==='string'
    &&Array.isArray(profile.fit?.matrix)&&profile.fit.matrix.length===3&&profile.fit.matrix.every(row=>Array.isArray(row)&&row.length===3&&row.every(v=>Number.isFinite(v)&&Math.abs(v)<=8))
    &&(profile.fit.offset===undefined||Array.isArray(profile.fit.offset)&&profile.fit.offset.length===3&&profile.fit.offset.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.5))
    &&(profile.fit.model===undefined||['linear','affine'].includes(profile.fit.model))
    &&(profile.fit.model!=='affine'||Array.isArray(profile.fit.offset))
    &&[['amount',0,100],['exposure',-2,2],['warmth',-100,100],['tint',-100,100],['saturation',0,200]].every(([k,min,max])=>Number.isFinite(profile.adjustments?.[k])&&profile.adjustments[k]>=min&&profile.adjustments[k]<=max);
}
export function previewProfileStatus(profile,source) {
  if(!profile)return {usable:false,label:'Not calibrated'};
  if(!validColorProfile(profile)||profile.sample||!colorSourceKey(profile.source?.capture))return {usable:false,label:'Invalid camera profile'};
  if(colorSourceKey(profile.source.capture)!==colorSourceKey(source))return {usable:false,label:'Different camera — calibrate this camera'};
  if(colorSettingsKey(profile.source.capture)!==colorSettingsKey(source))return {usable:false,label:'Settings changed — recalibrate'};
  if(source.videoWidth&&source.videoHeight&&(source.videoWidth!==profile.source.capture.videoWidth||source.videoHeight!==profile.source.capture.videoHeight))return {usable:false,label:'Video size changed — recalibrate'};
  return {usable:true,label:'Profile applied to preview'};
}
export function validLeaderPreset(profile) {
  return validColorProfile(profile)&&profile.sample===false&&profile.source?.capture?.kind==='rig-video'&&!!colorSourceKey(profile.source.capture)
    &&typeof profile.name==='string'&&typeof profile.camera==='string'&&typeof profile.chart?.name==='string'
    &&Number.isFinite(profile.fit.after)&&profile.fit.after<=12
    &&(profile.fit.validation===undefined||Number.isFinite(profile.fit.validation?.after)&&profile.fit.validation.after<=12&&Number.isFinite(profile.fit.validation.before)&&profile.fit.validation.after<=profile.fit.validation.before+0.5)
    &&typeof profile.referenceImage?.dataUrl==='string'&&profile.referenceImage.dataUrl.startsWith('data:image/jpeg;base64,')&&profile.referenceImage.dataUrl.length<1000000
    &&profile.application?.scope==='browser-rig-preview';
}
export function readLeaderPresets(storage) {
  const value=JSON.parse(storage.getItem(LEADER_COLOR_STORAGE)||'{"activeId":null,"presets":[]}');
  if(!value||!Array.isArray(value.presets))throw new Error('Leader presets could not be read.');
  const presets=value.presets.filter(validLeaderPreset).slice(-12);
  return {activeId:presets.some(p=>p.id===value.activeId)?value.activeId:null,presets};
}
export function saveLeaderPreset(storage,profile,source) {
  const status=previewProfileStatus(profile,source);
  if(!status.usable)throw new Error(status.label);
  if(!Number.isFinite(profile.fit.after)||profile.fit.after>12)throw new Error('Chart error is too high to apply automatically. Improve lighting/alignment and recalibrate.');
  if(profile.fit.validation!==undefined&&(!Number.isFinite(profile.fit.validation?.after)||profile.fit.validation.after>12||!Number.isFinite(profile.fit.validation.before)||profile.fit.validation.after>profile.fit.validation.before+0.5))throw new Error('The correction did not validate on withheld patches. Check the chart, alignment and lighting, then capture again before applying to the rig.');
  const preset=structuredClone({...profile,application:{scope:'browser-rig-preview',appliedAt:new Date().toISOString()}});
  if(!validLeaderPreset(preset))throw new Error('Choose a rig leader and capture its chart frame before saving a shared preset.');
  const current=readLeaderPresets(storage),state={activeId:preset.id,presets:[...current.presets.filter(p=>p.id!==preset.id),preset].slice(-12)};
  storage.setItem(LEADER_COLOR_STORAGE,JSON.stringify(state));return state;
}
export function selectLeaderPreset(storage,id) {
  const current=readLeaderPresets(storage);if(id!==null&&!current.presets.some(p=>p.id===id))throw new Error('That leader preset is unavailable.');
  const state={...current,activeId:id};storage.setItem(LEADER_COLOR_STORAGE,JSON.stringify(state));return state;
}
export function removeLeaderPreset(storage,id) {
  const current=readLeaderPresets(storage),state={activeId:current.activeId===id?null:current.activeId,presets:current.presets.filter(p=>p.id!==id)};
  storage.setItem(LEADER_COLOR_STORAGE,JSON.stringify(state));return state;
}
export function sharedPreviewStatus(profile,status,now=Date.now()) {
  if(!profile)return {usable:false,label:'No shared color preset applied'};
  if(!validLeaderPreset(profile))return {usable:false,label:'Invalid leader preset'};
  if(!status?.connected||!Number.isFinite(status.checkedAt)||now-status.checkedAt>20000||status.checkedAt>now+1000)return {usable:false,label:'Preset saved · waiting for the rig'};
  if((status.backend||'')!==(profile.source.capture.rigBackend||''))return {usable:false,label:'Preset belongs to a different rig'};
  const leader=(status.phones||[]).find(p=>colorSourceKey(rigColorSource(p,status))===colorSourceKey(profile.source.capture));
  if(!leader)return {usable:false,label:'Saved leader is no longer in this rig — choose a leader'};
  if(leader.responding&&colorSettingsKey(rigColorSource(leader,status))!==colorSettingsKey(profile.source.capture))return {usable:false,label:'Leader settings changed — recalibrate'};
  // Followers deliberately share the leader's transform. Their camera identities
  // and settings are NOT required to equal the leader's.
  return {usable:true,label:`${profile.name} · shared correction from ${profile.camera}${leader.responding?'':' · leader offline, using saved preset'}`};
}
