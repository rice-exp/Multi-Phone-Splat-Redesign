import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {correctLinear,fitDisposition} from '../public/js/color-calibration.js';
import {referenceSettings,validCorrection} from '../public/js/color-profiles.js';

const modes = {
  tonemapMode: ['CONTRAST_CURVE', 'FAST', 'HIGH_QUALITY', 'GAMMA_VALUE', 'PRESET_CURVE'],
  tonemapPreset: ['SRGB', 'REC709'],
  noiseReductionMode: ['OFF', 'FAST', 'HIGH_QUALITY', 'MINIMAL', 'ZERO_SHUTTER_LAG'],
  edgeMode: ['OFF', 'FAST', 'HIGH_QUALITY', 'ZERO_SHUTTER_LAG'],
  hotPixelMode: ['OFF', 'FAST', 'HIGH_QUALITY'],
  shadingMode: ['OFF', 'FAST', 'HIGH_QUALITY'],
};
const inRange = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const vector = (v, size, min, max) => Array.isArray(v) && v.length === size && v.every(n => inRange(n, min, max));
function validCurve(v) {
  return Array.isArray(v) && v.length >= 4 && v.length % 2 === 0 && v[0] === 0 && v.at(-2) === 1 &&
    v.every((n, i) => inRange(n, 0, 1) && (i < 2 || i % 2 === 1 || n > v[i - 2]));
}

function manualSnapshot(value) {
  if (value?.awbMode !== 'OFF' || typeof value.awbLock !== 'boolean' || value.colorCorrectionMode !== 'TRANSFORM_MATRIX' ||
      !vector(value.whiteBalanceGains, 4, 0, 16) || !vector(value.colorCorrectionTransform, 9, -100, 100) ||
      !inRange(value.tonemapGamma, 1, 5) || !Object.entries(modes).every(([key, options]) => options.includes(value[key])) ||
      !['tonemapCurveRed', 'tonemapCurveGreen', 'tonemapCurveBlue'].every(key => validCurve(value[key]))) {
    throw new Error('CameraScope returned an incomplete or invalid manual color snapshot.');
  }
  // Only these documented CameraScope fields may be sent to other phones.
  const keys = ['awbMode', 'awbLock', 'colorCorrectionMode', 'whiteBalanceGains', 'colorCorrectionTransform',
    ...Object.keys(modes), 'tonemapGamma', 'tonemapCurveRed', 'tonemapCurveGreen', 'tonemapCurveBlue'];
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function differences(snapshot, state) {
  return Object.keys(snapshot).filter(key => !isDeepStrictEqual(snapshot[key], state?.colorProcessing?.[key]));
}

function issue(code, message, next, status = 409) {
  return Object.assign(new Error(message), {code, next, status});
}

// Android's row-major transform maps sensor RGB to linear sRGB. Apply the
// chart and sliders to its output, using the transform at frame capture.
function adjustedSnapshot(leader, correction) {
  const {ip,route,reference,fit,adjustments,previousTransform}=correction||{};
  const disposition=fitDisposition(fit);
  if (!validCorrection(fit,adjustments) || fit.offset?.some(n=>n!==0) || disposition==='blocked' ||
      (disposition==='review'&&correction.reviewedFit!==true)) {
    throw issue('COLOR_FIT_INVALID','The chart fit cannot be applied to CameraScope.','Capture a new chart and check the patch fit.',400);
  }
  const refreshReference=fit.model==='manual'?'Choose the leader again to read its current settings.':'Capture a new chart from this leader.';
  if (leader.ip!==ip || leader.route!==route || !reference) throw issue('COLOR_REFERENCE_CHANGED','The selected leader differs from the saved reference.',refreshReference);
  let base;
  try { base=manualSnapshot(reference.colorProcessing); }
  catch { throw issue('COLOR_MANUAL_REQUIRED','The leader reference has incomplete manual color settings.','Measure and lock white balance on the leader, then '+(fit.model==='manual'?'select it again.':'capture a new chart.')); }
  const current=referenceSettings(leader.state);
  const {colorProcessing:currentColor,...currentSettings}=current;
  const {colorProcessing:originalColor,...capturedSettings}=reference;
  const transform=base.colorCorrectionTransform;
  const result=Array(9);
  for(let column=0;column<3;column++){
    const output=correctLinear([transform[column],transform[3+column],transform[6+column]],fit.matrix,adjustments);
    output.forEach((value,row)=>{result[3*row+column]=value;});
  }
  if (!vector(result,9,-100,100)) throw issue('COLOR_RANGE','The requested transform exceeds CameraScope’s supported range.','Reduce the adjustment and apply again.',400);
  // An identical target can be verified after a lost acknowledgment. A saved
  // prior target also allows editing the same original frame across restarts.
  const allowed=[transform,result];
  if(vector(previousTransform,9,-100,100))allowed.push(previousTransform);
  if(!isDeepStrictEqual(currentSettings,capturedSettings) ||
      !isDeepStrictEqual({...currentColor,colorCorrectionTransform:null},{...originalColor,colorCorrectionTransform:null}) ||
      !allowed.some(matrix=>sameTransform(currentColor?.colorCorrectionTransform,matrix))) {
    throw issue('COLOR_REFERENCE_CHANGED','Leader settings changed since the reference was saved.',refreshReference);
  }
  return {...base,colorCorrectionTransform:result};
}

// Allow one thousandth for CameraScope's float/rational representation.
function sameTransform(actual,expected) {
  return vector(actual,9,-100,100)&&expected.every((n,i)=>Math.abs(n-actual[i])<=0.001);
}
function adjustedDifferences(snapshot,state) {
  return differences(snapshot,state).filter(key=>key!=='colorCorrectionTransform'||!sameTransform(state?.colorProcessing?.[key],snapshot[key]));
}
async function writeAndVerify(phone,snapshot,command,onWrite,compare=differences) {
  let writeError;
  onWrite(phone.id);
  try { await command(phone.ip,{cmd:'setColorProcessing',value:snapshot}); }
  catch(error) { writeError=error; }
  const readback=await command(phone.ip,{cmd:'getState'});
  const missing=compare(snapshot,readback.state);
  if(missing.length)throw new Error([writeError?.message,'Readback differs: '+missing.join(', ')].filter(Boolean).join(' '));
  return manualSnapshot(readback.state.colorProcessing);
}

// Readback is the requested CameraScope state. Matching it does not measure scene color.
export class CameraColorSync {
  last = null;

  async run(phones, {leaderId, retryId, source = 'measure', correction}, command, now, onWrite = () => {}) {
    const leader = phones.find(phone => phone.id === leaderId);
    if (!leader) throw issue('COLOR_LEADER', 'Select the leader in Prepare rig and Calibration.', 'Choose a selected phone with the mat in view.', 400);
    if (!leader.responding) throw issue('COLOR_LEADER_OFFLINE', 'The leader did not respond.', 'Open CameraScope on the leader and refresh the rig.');
    const previous = this.last;
    let snapshot;
    if (retryId !== undefined) {
      if (!previous || retryId !== previous.id || leader.id !== previous.leaderId || leader.ip !== previous.leaderIp ||
          leader.state.selectedCameraId !== previous.lens || differences(previous.snapshot, leader.state).length) {
        throw issue('COLOR_SNAPSHOT_CHANGED', 'The leader or its color settings changed.', 'Sync again to measure a new white balance.');
      }
      snapshot = previous.snapshot;
      source = previous.source;
    } else if (source === 'adjust') {
      const target=adjustedSnapshot(leader,correction);
      this.last=null;
      try {
        snapshot=adjustedDifferences(target,leader.state).length
          ? await writeAndVerify(leader,target,command,onWrite,adjustedDifferences)
          : manualSnapshot(leader.state.colorProcessing);
      } catch(error) {
        throw issue('COLOR_LEADER_FAILED',leader.name+': '+error.message,'Check the leader in CameraScope. Followers will receive settings after leader readback succeeds.');
      }
    } else if (source === 'current') {
      if (phones.length < 2) throw issue('COLOR_NO_FOLLOWERS', 'No followers selected.', 'Select at least one other phone in Prepare rig.', 400);
      // operate() has just refreshed getState for every selected phone.
      try {
        snapshot = manualSnapshot(leader.state?.colorProcessing);
      } catch {
        throw issue('COLOR_MANUAL_REQUIRED', 'The leader has no complete manual color settings to copy.',
          'Choose “Measure new white balance” or set manual gains and a sensor transform in CameraScope.');
      }
    } else {
      this.last = null;
      try {
        onWrite(leader.id);
        const response = await command(leader.ip, {cmd:'autoColorSnapshot', timeoutMs:8000}, {timeoutMs:12000});
        snapshot = manualSnapshot(response.snapshot);
        const current = await command(leader.ip, {cmd:'getState'});
        if (differences(snapshot, current.state).length) throw new Error('Leader settings did not match its snapshot on readback.');
      } catch (error) {
        throw issue('COLOR_LEADER_FAILED', leader.name + ': ' + error.message,
          'No follower was sent settings. Keep CameraScope open on the leader, check the mat lighting and verify the phone supports autoColorSnapshot.');
      }
    }

    const results = await Promise.all(phones.map(async phone => {
      const result = {id:phone.id, ip:phone.ip, name:phone.name, ok:false};
      if (phone.id === leaderId) return {...result, ok:true};
      if (!phone.responding) return {...result, error:{code:'PHONE_OFFLINE', message:'Phone offline.', next:'Reconnect CameraScope and retry.'}};
      try {
        // The preflight read covers every selected phone.
        const compare=source==='adjust'?adjustedDifferences:differences;
        if ((retryId !== undefined || source !== 'measure') && !compare(snapshot,phone.state).length) return {...result, ok:true};
        await writeAndVerify(phone,snapshot,command,onWrite,compare);
        return {...result, ok:true};
      } catch (error) {
        return {...result, error:{code:'COLOR_NOT_CONFIRMED', message:error.message, next:'Check CameraScope connectivity and retry with the same leader settings.'}};
      }
    }));
    this.last = {id:retryId ?? randomUUID(), leaderId, leaderIp:leader.ip, lens:leader.state.selectedCameraId,
      at:now(), source, snapshot, results};
    return results;
  }
}
