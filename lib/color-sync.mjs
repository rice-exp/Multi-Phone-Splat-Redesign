import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';

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

// Readback is the requested CameraScope state. Matching it does not measure scene color.
export class CameraColorSync {
  last = null;

  async run(phones, {leaderId, retryId, source = 'measure'}, command, now, onWrite = () => {}) {
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
        if ((retryId !== undefined || source === 'current') && !differences(snapshot, phone.state).length) return {...result, ok:true};
        let writeError;
        onWrite(phone.id);
        try { await command(phone.ip, {cmd:'setColorProcessing', value:snapshot}); }
        catch (error) { writeError = error; }
        // UDP can lose an acknowledgement even when the phone applied the request.
        const readback = await command(phone.ip, {cmd:'getState'});
        const missing = differences(snapshot, readback.state);
        if (missing.length) throw new Error([writeError?.message, 'Readback differs: ' + missing.join(', ')].filter(Boolean).join(' '));
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
