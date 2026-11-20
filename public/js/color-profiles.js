// Browser preview profiles are separate from phone/sensor settings.
import {IDENTITY,fitDisposition} from './color-calibration.js';
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
export const referenceSettings=state=>pick(state,['cameraId','selectedCameraId','physicalCameraId','lensFacing','focalLength','zoomRatio','iso','exposureMs','frameDurationMs','autoExposureEnabled','colorProcessing']);
export function colorSettingsKey(source) {
  const settings=source?.kind==='rig-video'
    ?referenceSettings(source.reportedSettings)
    :pick(source?.settings,['deviceId','width','height','facingMode','resizeMode','exposureMode','exposureTime','iso','whiteBalanceMode','colorTemperature','zoom','brightness','contrast','saturation']);
  return JSON.stringify(stable(settings));
}
export function validCorrection(fit,adjustments) {
  return Array.isArray(fit?.matrix)&&fit.matrix.length===3&&fit.matrix.every(row=>Array.isArray(row)&&row.length===3&&row.every(v=>Number.isFinite(v)&&Math.abs(v)<=8))
    &&(fit.offset===undefined||Array.isArray(fit.offset)&&fit.offset.length===3&&fit.offset.every(v=>Number.isFinite(v)&&Math.abs(v)<=0.5))
    &&(fit.model===undefined||['linear','affine','manual'].includes(fit.model))
    &&(fit.model!=='manual'||(fit.matrix.every((row,i)=>row.every((n,j)=>n===IDENTITY[i][j]))&&!fit.offset?.some(n=>n!==0)))
    &&(fit.model!=='affine'||Array.isArray(fit.offset))
    &&[['amount',0,100],['exposure',-2,2],['warmth',-100,100],['tint',-100,100],['saturation',0,200]].every(([k,min,max])=>Number.isFinite(adjustments?.[k])&&adjustments[k]>=min&&adjustments[k]<=max);
}
export function validColorProfile(profile) {
  return profile?.pipeline==='decoded-sRGB-image'&&typeof profile.id==='string'&&validCorrection(profile.fit,profile.adjustments)
    &&(profile.appliedToHardware===false||profile.appliedToHardware===true&&Array.isArray(profile.phoneApplication?.transform)&&profile.phoneApplication.transform.length===9&&profile.phoneApplication.transform.every(Number.isFinite));
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
  const disposition=fitDisposition(profile?.fit);
  return validColorProfile(profile)&&profile.sample===false&&profile.source?.capture?.kind==='rig-video'&&!!colorSourceKey(profile.source.capture)
    &&typeof profile.name==='string'&&typeof profile.camera==='string'&&(disposition==='manual'||typeof profile.chart?.name==='string')
    &&(disposition==='automatic'||disposition==='manual'||disposition==='review'&&profile.reviewedFit===true)
    &&((disposition==='manual'&&profile.referenceImage==null)||
      (typeof profile.referenceImage?.dataUrl==='string'&&profile.referenceImage.dataUrl.startsWith('data:image/jpeg;base64,')&&profile.referenceImage.dataUrl.length<1000000))
    &&profile.application?.scope==='browser-rig-preview';
}
export function readLeaderPresets(storage) {
  const value=JSON.parse(storage.getItem(LEADER_COLOR_STORAGE)||'{"activeId":null,"presets":[]}');
  if(!value||!Array.isArray(value.presets))throw new Error('Leader presets could not be read.');
  const presets=value.presets.filter(validLeaderPreset).slice(-12);
  return {activeId:presets.some(p=>p.id===value.activeId)?value.activeId:null,presets};
}
export function prepareLeaderPreset(profile,source) {
  const status=previewProfileStatus(profile,source);
  if(!status.usable)throw new Error(status.label);
  const disposition=fitDisposition(profile.fit);
  if(disposition==='blocked')throw new Error('The correction could not be verified on withheld patches. Check the sampled chart squares before applying.');
  if(disposition==='review'&&profile.reviewedFit!==true)throw new Error('Review the before/after frame before applying this approximate correction.');
  const preset=structuredClone({...profile,application:{scope:'browser-rig-preview',appliedAt:new Date().toISOString()}});
  if(!validLeaderPreset(preset))throw new Error('Could not save this leader preset. Check the source and correction settings.');
  return preset;
}
export function saveLeaderPreset(storage,profile,source,{activate=true}={}) {
  const preset=prepareLeaderPreset(profile,source);
  const current=readLeaderPresets(storage),activeId=activate?preset.id:current.activeId;
  const presets=[...current.presets.filter(p=>p.id!==preset.id),preset];
  if(presets.length>12)presets.splice(presets.findIndex(p=>p.id!==activeId),1);
  const state={activeId,presets};
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
  if(profile.phoneApplication)return {usable:false,label:'Live views show CameraScope output. See Last sync for per-phone results.'};
  const leader=(status.phones||[]).find(p=>colorSourceKey(rigColorSource(p,status))===colorSourceKey(profile.source.capture));
  if(!leader)return {usable:false,label:'Saved leader is no longer in this rig — choose a leader'};
  if(leader.responding&&colorSettingsKey(rigColorSource(leader,status))!==colorSettingsKey(profile.source.capture))return {usable:false,label:'Leader settings changed — recalibrate'};
  // Followers deliberately share the leader's transform. Their camera identities
  // and settings are NOT required to equal the leader's.
  return {usable:true,label:`${profile.name} · shared correction from ${profile.camera}${leader.responding?'':' · leader offline, using saved preset'}`};
}

function matchesTransform(actual,expected) {
  return Array.isArray(expected)&&expected.length===9&&Array.isArray(actual)&&actual.length===9&&
    expected.every((value,i)=>Math.abs(value-actual[i])<=0.001);
}

// Only applied settings reach the preview. CameraScope output already includes phone corrections.
export function cameraColorView(phone,{status,profile,shared,selectedIds}) {
  const source=profile?.source.capture;
  const application=profile?.phoneApplication;
  const selected=selectedIds.includes(phone.id);
  if(!selected)return {label:'Outside the current selection · CameraScope video'};
  if(!status?.connected || !Number.isFinite(status.checkedAt) || Math.abs(Date.now()-status.checkedAt)>20000)return {label:'Waiting for current camera status'};
  if(!phone.responding)return {label:'Camera offline · current settings unknown'};
  if(source?.kind==='rig-video'&&(source.rigBackend||'')===(status.backend||'')){
    const sync=status.colorSync;
    const sameSync=sync?.source==='adjust'&&sync.leaderId===source.cameraId&&sync.leaderIp===source.ip&&
      matchesTransform(sync.snapshot?.colorCorrectionTransform,application?.transform);
    const results=sameSync?sync.results:application?.results;
    const reported=results?.find(r=>r.id===phone.id&&(!r.ip||r.ip===phone.ip));
    const current=phone.state?.colorProcessing?.colorCorrectionTransform;
    const sensor=phone.state?.effectiveColor?.transform;
    const hasSensor=Array.isArray(sensor)&&sensor.length===9&&sensor.every(Number.isFinite);
    const matched=matchesTransform(current,application?.transform);
    if(application){
      if(!reported)return {label:'Outside the last Apply · CameraScope video'};
      if(!reported.ok)return {label:'Apply unconfirmed · see Last sync'};
      if(!matched)return {label:'Settings changed since Apply'};
      if(hasSensor)
        return {label:matchesTransform(sensor,application.transform)?'Sensor transform matched · CameraScope video':'Requested settings matched · last sensor transform differs'};
      return {label:'Settings matched · CameraScope video'};
    }
  }
  return shared.usable?{render:profile,label:'Shared browser correction'}:{label:shared.label};
}
