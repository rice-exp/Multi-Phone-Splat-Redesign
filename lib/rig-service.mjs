import dgram from 'node:dgram';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {privateAddress} from './rig-config.mjs';
export {privateAddress} from './rig-config.mjs';

// Contracts come from Multi-Phone-Splat's camerascope-color.js,
// camerascope-capture.js and server.js, and CloneCameraScope's
// CameraScopeViewModel.stateJson/applyCommandSettings. See docs/PREPARE-RIG.md.
const execute = promisify(execFile);
export const FRESH_MS = 20000;
export const SYNC_FRESH_MS = 60000;
export const AWB_MODES = ['OFF','AUTO','INCANDESCENT','FLUORESCENT','WARM_FLUORESCENT','DAYLIGHT','CLOUDY_DAYLIGHT','TWILIGHT','SHADE'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function rigError(code, message, next, status = 503) {
  return Object.assign(new Error(message), {code, next, status});
}
export function sendCommand(host, payload, {port = 5010, timeoutMs = 3000} = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.close();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(rigError('PHONE_TIMEOUT', 'CameraScope did not respond within 3 seconds.', 'Keep CameraScope open. Check the phone IP, Wi-Fi network and UDP port 5010.')), timeoutMs);
    socket.on('error', error => finish(rigError('PHONE_NETWORK', error.message, 'Check the private network and phone IP.')));
    socket.on('message', (bytes, sender) => {
      // CameraScope replies to the request's ephemeral port. Ignore other hosts.
      if (sender.address !== host) return;
      try {
        const response = JSON.parse(bytes.toString('utf8'));
        if (!object(response) || response.ok !== true) throw new Error(response?.error || 'Missing successful CameraScope acknowledgement.');
        finish(null, response);
      } catch (error) { finish(rigError('PHONE_RESPONSE', error.message, 'Inspect technical details and check the installed CameraScope version.')); }
    });
    socket.send(Buffer.from(JSON.stringify(payload)), port, host, error => { if (error) finish(error); });
  });
}
export function parseCliJson(stdout) {
  const text = String(stdout).trim();
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '{') continue;
    try { const result = JSON.parse(text.slice(index)); if (object(result)) return result; } catch {}
  }
  throw rigError('CLI_RESPONSE', 'CameraScope CLI returned no JSON report.', 'Check the CameraScope installation and Python environment.');
}
export function validateSettings(value) {
  if (!object(value) || Object.keys(value).some(key => !['iso','exposureMs','frameRate','awbMode'].includes(key))) throw rigError('INVALID_SETTINGS', 'Unsupported settings.', 'Use the camera settings form.', 400);
  const result = {};
  for (const [key,min,max] of [['iso',25,12800],['exposureMs',0.1,1000],['frameRate',1,120]]) {
    const n = value[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (key !== 'exposureMs' && !Number.isInteger(n))) throw rigError('INVALID_SETTINGS', `Invalid ${key}.`, `Use a value from ${min} to ${max}.`, 400);
    result[key] = n;
  }
  if (result.exposureMs > 1000 / result.frameRate) throw rigError('INVALID_SETTINGS', 'Exposure exceeds the requested frame interval.', 'Reduce exposure or frame rate.', 400);
  if (!AWB_MODES.includes(value.awbMode)) throw rigError('INVALID_SETTINGS', 'Invalid white balance mode.', 'Choose a supported white balance mode.', 400);
  result.awbMode = value.awbMode;
  return result;
}
export function settingsMatch(state, requested) {
  const near = (actual, expected) => typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual-expected) <= 0.001;
  return !!state && state.iso === requested.iso && near(state.exposureMs,requested.exposureMs)
    && near(state.frameDurationMs,1000/requested.frameRate) && state.autoExposureEnabled === false
    && state.colorProcessing?.awbMode === requested.awbMode && state.colorProcessing?.awbLock === false;
}
function publicError(error) {
  return {code:error.code || 'RIG_ERROR', message:error.message, next:error.next || 'Inspect technical details, correct the configuration and retry.'};
}
export class RigService {
  constructor({configStore, gateway, workflow = async()=>({state:'idle'}), command = sendCommand, run = execute, now = Date.now} = {}) {
    if(!configStore||!gateway)throw new Error('RigService requires local configuration and gateway providers.');
    this.configStore=configStore;this.gateway=gateway;this.workflow=workflow;this.command = command; this.run = run; this.now = now;
    this.snapshot = null; this.config = null; this.refreshing = null; this.busy = null;
    this.sync = new Map(); this.settings = new Map(); this.events = []; this.eventKeys = new Map();
  }
  event(level, code, message, extra = {}) {
    const key = `${extra.cameraId || 'rig'}:${code}`;
    const signature = `${level}:${message}`;
    if (this.eventKeys.get(key) === signature) return;
    this.eventKeys.set(key, signature);
    this.events.push({id:crypto.randomUUID(), time:new Date(this.now()).toISOString(), level, code, message, ...extra});
    this.events = this.events.slice(-200);
  }
  inventory(config) {
    if (!object(config) || !Array.isArray(config.phones) || config.phones.length > 64) throw rigError('CONFIG_INVALID', 'Invalid local phone inventory.', 'Check Connection setup and the local rig configuration.');
    const ids = new Set(), ips = new Set();
    return config.phones.map((phone, index) => {
      if (!phone.id || ids.has(String(phone.id)) || !privateAddress(phone.ip) || ips.has(phone.ip)) throw rigError('CONFIG_INVALID', 'Phone inventory needs unique IDs and unique private IPv4 addresses.', 'Correct the phone inventory in Connection setup.');
      ids.add(String(phone.id)); ips.add(phone.ip);
      return {id:String(phone.id), name:String(phone.name || `Camera ${index+1}`), ip:phone.ip, enabled:phone.enabled!==false, route:`cam-${index+1}`};
    });
  }
  async readPhone(phone) {
    const checkedAt = this.now();
    try {
      const response = await this.command(phone.ip, {cmd:'getState'});
      if (!object(response.state)) throw rigError('STATE_MISSING', 'CameraScope returned no state object.', 'Check the installed CameraScope version.');
      return {...phone, responding:true, checkedAt, state:response.state, error:null};
    } catch (error) { return {...phone, responding:false, checkedAt, state:null, error:publicError(error)}; }
  }
  async refresh(force = false) {
    if (this.refreshing) return this.refreshing;
    if (!force && this.snapshot && this.now() - this.snapshot.checkedAt < 4000) return this.status();
    this.refreshing = this.read();
    try { await this.refreshing; return this.status(); } finally { this.refreshing = null; }
  }
  async read() {
    try {
      const config = await this.configStore.read();
      const phones = this.inventory(config); this.config = config;
      const [readings, gatewayResult, jobResult] = await Promise.all([
        Promise.all(phones.map(phone => this.readPhone(phone))),
        this.gateway.state(config).then(value => ({value}), error => ({error:publicError(error)})),
        this.workflow().then(value => ({value}), error => ({error:publicError(error)}))
      ]);
      const gateway = gatewayResult.value;
      const validPort = port => Number.isInteger(port) && port > 0 && port <= 65535;
      for (const phone of readings) {
        const route = gateway?.routes?.find(route => route.name === phone.route && route.ip === phone.ip);
        phone.previewRoute = route && validPort(route.videoPort) && validPort(route.metadataPort)
          ? {name:phone.route, videoPort:route.videoPort, metadataPort:route.metadataPort} : null;
        phone.previewConfigured = phone.responding && phone.state?.streamEnabled === true && phone.state?.isCapturing === true &&
          phone.state?.udpHost === config.pcIp && phone.state?.udpVideoPort === route?.videoPort && phone.state?.udpMetadataPort === route?.metadataPort;
        // An edited/reordered inventory can leave phones streaming to old
        // ports. Do not label another camera's incoming video as this phone.
        phone.previewReady = gateway?.running === true && route?.ready === true && phone.previewConfigured;
        phone.previewPath = phone.previewReady ? `/${phone.route}?controls=false&muted=true&autoplay=true&playsInline=true` : null;
        const previous = this.snapshot?.phones?.find(item => item.id === phone.id && item.ip === phone.ip);
        if (!phone.responding) this.event('warning', phone.error.code, `${phone.name}: ${phone.error.message}`, {cameraId:phone.id, detail:phone.error.next});
        else if (!previous?.responding) {
          this.eventKeys.delete(`${phone.id}:PHONE_CONNECTED`);
          this.event('success', 'PHONE_CONNECTED', `${phone.name} responded to CameraScope.`, {cameraId:phone.id});
          for (const key of this.eventKeys.keys()) if (key.startsWith(`${phone.id}:`) && !key.endsWith('PHONE_CONNECTED')) this.eventKeys.delete(key);
        }
        if (!phone.responding || !previous?.responding) { this.sync.delete(phone.id); this.settings.delete(phone.id); }
      }
      const checkedAt = this.now();
      const job = jobResult.value;
      this.snapshot = {connected:true, checkedAt, phones:readings, gateway:{...gateway,running:gateway?.running === true, error:gatewayResult.error || gateway?.error || null},
        workflowBusy:job?.state === 'running', workflowKnown:!!job && typeof job.state === 'string',
        previewHost:null, destination:config.pcIp || null,
        error:null, requested:{iso:config.iso ?? null, exposureMs:config.exposureMs ?? null, frameRate:config.frameRate ?? null, awbMode:config.colorProcessing?.awbMode ?? null}};
      this.eventKeys.delete('rig:CONFIG_UNAVAILABLE');
    } catch (error) {
      // Preserve identities for troubleshooting, never preserve green status.
      this.snapshot = {connected:false, checkedAt:this.now(), phones:(this.snapshot?.phones || []).map(phone => ({...phone, responding:false, state:null, previewReady:false, previewPath:null, error:publicError(error)})), error:publicError(error), gateway:{running:false}, workflowKnown:false, workflowBusy:false};
      this.sync.clear(); this.settings.clear();
      this.event('error', error.code || 'RIG_ERROR', error.message, {detail:error.next});
    }
  }
  status() {
    const snapshot = this.snapshot || {connected:false, phones:[], checkedAt:0};
    const stale = this.now() - snapshot.checkedAt > FRESH_MS;
    return {...snapshot, connected:snapshot.connected && !stale, stale, busy:this.busy,
      phones:snapshot.phones.map(phone => {
        const sync = this.sync.get(phone.id), settings = this.settings.get(phone.id);
        return {...phone, responding:phone.responding && !stale, previewReady:phone.previewReady && !stale,
          sync:sync && sync.ip === phone.ip && this.now() - sync.checkedAt < SYNC_FRESH_MS && phone.responding && !stale ? sync : null,
          settings:settings?.ip === phone.ip && phone.responding && !stale ? settings : null};
      }), events:this.events};
  }
  async operate(action, ids, value) {
    if (this.busy) throw rigError('RIG_BUSY', 'A rig operation is already running.', 'Wait for it to finish.', 409);
    if (!['settings','sync','preview-start','preview-stop'].includes(action)) throw rigError('INVALID_ACTION', 'Unsupported rig operation.', 'Use Prepare rig controls.', 400);
    const settings = action === 'settings' ? validateSettings(value) : null;
    this.busy = action;
    try {
      await this.refresh(true);
      if (!this.snapshot.connected) throw rigError('CONFIG_UNAVAILABLE', 'The local rig configuration is unavailable.', 'Fix the configuration file and retry.');
      if (!this.snapshot.workflowKnown || this.snapshot.workflowBusy) throw rigError('WORKFLOW_BUSY', 'The workflow is running or its status is unknown.', 'Finish or stop the workflow before changing the rig.', 409);
      if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !this.snapshot.phones.some(phone => phone.id === id))) throw rigError('INVALID_SELECTION', 'Select one or more configured phones.', 'Refresh the inventory and select phones.', 400);
      const phones = this.snapshot.phones.filter(phone => ids.includes(phone.id));
      const config = this.config;
      if (action !== 'sync' && phones.some(phone => phone.state?.isH264Recording === true)) throw rigError('PHONE_RECORDING', 'A selected phone is recording video.', 'Finish recording in CameraScope before changing settings or streaming.', 409);
      const runCli = async args => {
        if (!config.cameraScopeRoot || !config.pythonExecutable) throw rigError('CLI_MISSING', 'CameraScope path or Python executable is missing.', 'Set cameraScopeRoot and pythonExecutable in .camerascope/rig-config.json, or set CAMERASCOPE_ROOT and CAMERASCOPE_PYTHON.');
        const cli = path.join(config.cameraScopeRoot, 'scripts', 'camerascope_cli.py');
        try {
          const {stdout} = await this.run(config.pythonExecutable, [cli, ...args], {timeout:90000, windowsHide:true, maxBuffer:2*1024*1024});
          return parseCliJson(stdout);
        } catch (error) { throw rigError(error.code === 'ENOENT' ? 'CLI_MISSING' : 'CLI_FAILED', String(error.stderr || error.message).slice(-2000), 'Check CameraScope, Python and the affected phone. An unsuccessful command may still have reached the phone; read status before retrying.'); }
      };
      let results;
      if (action.startsWith('preview-')) {
        const enable = action === 'preview-start';
        if (enable && !this.snapshot.gateway.running) throw rigError('GATEWAY_UNAVAILABLE', 'The preview gateway is not running.', 'Start the gateway in Connection setup, then retry.');
        if (enable && (!privateAddress(config.pcIp) || config.pcIp.startsWith('127.'))) throw rigError('DESTINATION_INVALID', 'The PC destination must be its private Wi-Fi or Ethernet IPv4 address.', 'Set the PC destination in Connection setup. A loopback address sends video to the phone itself.', 400);
        if (enable && phones.some(phone => !phone.previewRoute)) throw rigError('PREVIEW_ROUTE_MISSING', 'A selected phone has no valid gateway route.', 'Restart the gateway and check phone IPs and video/metadata ports.');
        results = await Promise.all(phones.map(async phone => {
          try {
            if (!phone.responding) throw rigError('PHONE_OFFLINE', 'No recent CameraScope response.', 'Reconnect this phone and retry.');
            if (typeof phone.state.isCapturing !== 'boolean') throw rigError('STATE_MISSING', 'CameraScope pipeline state is unknown.', 'Check the installed app version before changing its stream.');
            const payload = enable ? {cmd:'set', udpHost:config.pcIp, udpVideoPort:phone.previewRoute.videoPort,
              udpMetadataPort:phone.previewRoute.metadataPort, streamEnabled:true,
              ...(phone.state.isCapturing ? {} : {capture:true})} : {cmd:'set', streamEnabled:false};
            // Changing a stream can restart CameraScope's pipeline. Never stop
            // capture or alter exposure, camera selection, or analysis outputs.
            this.sync.delete(phone.id);
            await this.command(phone.ip, payload);
            const readback = await this.readPhone(phone);
            const state = readback.state;
            const matches = readback.responding && state.streamEnabled === enable && (!enable ||
              (state.isCapturing === true && state.udpHost === config.pcIp &&
              state.udpVideoPort === phone.previewRoute.videoPort && state.udpMetadataPort === phone.previewRoute.metadataPort));
            if (!matches) throw rigError('PREVIEW_NOT_CONFIRMED', 'Stream command acknowledged, but CameraScope readback does not match.', 'Read status and inspect the affected phone before retrying.');
            return {id:phone.id, ip:phone.ip, ok:true, streamEnabled:enable, checkedAt:this.now()};
          } catch (error) { return {id:phone.id, ip:phone.ip, ok:false, error:publicError(error)}; }
        }));
      } else if (action === 'settings') {
        results = await Promise.all(phones.map(async phone => {
          this.settings.delete(phone.id); this.sync.delete(phone.id);
          try {
            if (!phone.responding) throw rigError('PHONE_OFFLINE', 'No recent CameraScope response.', 'Reconnect this phone and retry.');
            // Explicit manual exposure avoids a misleading ISO/exposure change
            // while Camera2 auto exposure still controls the sensor.
            await this.command(phone.ip, {cmd:'set', iso:settings.iso, exposureMs:settings.exposureMs,
              frameDurationMs:1000/settings.frameRate, autoExposureEnabled:false, colorProcessing:{awbMode:settings.awbMode,awbLock:false}});
            const readback = await this.readPhone(phone);
            if (!readback.responding || !settingsMatch(readback.state,settings)) throw rigError('SETTINGS_NOT_CONFIRMED', 'Settings command acknowledged, but readback does not match.', 'Inspect the phone’s reported settings. Read status and retry only the affected phone.');
            const result = {id:phone.id, ip:phone.ip, ok:true, checkedAt:this.now(), requested:settings, requestedStateConfirmed:true};
            this.settings.set(phone.id, result); return result;
          } catch (error) { return {id:phone.id, ip:phone.ip, ok:false, error:publicError(error)}; }
        }));
      } else {
        phones.forEach(phone => this.sync.delete(phone.id));
        if (phones.some(phone => !phone.responding)) throw rigError('PHONE_OFFLINE', 'Some selected phones are not responding.', 'Reconnect them or deselect them before checking clocks.');
        const report = await runCli(['sync-many','--hosts',...phones.map(phone => phone.ip),'--count','30','--jobs',String(phones.length),'--no-save']);
        results = phones.map(phone => {
          const matches = Array.isArray(report.results) ? report.results.filter(result => result.host === phone.ip) : [];
          const reported = matches.length === 1 ? matches[0] : null;
          const summary = reported?.summary;
          const validSummary = summary && Number.isInteger(summary.count) && summary.count > 0
            && typeof summary.selectedOffsetNs === 'number' && Number.isFinite(summary.selectedOffsetNs)
            && typeof summary.selectedErrorBoundNs === 'number' && Number.isFinite(summary.selectedErrorBoundNs) && summary.selectedErrorBoundNs >= 0;
          const result = {id:phone.id, ip:phone.ip, ok:reported?.ok === true && !!validSummary, checkedAt:this.now(), report:reported};
          if (result.ok) this.sync.set(phone.id, result);
          else result.error = {code:'SYNC_FAILED', message:reported?.error || 'No valid clock-offset measurement for this phone.', next:'Check the phone connection and retry the clock check.'};
          return result;
        });
      }
      for (const result of results) {
        this.eventKeys.delete(`${result.id}:${action.toUpperCase()}`);
        const message = action === 'sync' ? 'clock offset measured' : action === 'settings' ? 'CameraScope settings confirmed by readback' : `wireless stream ${action === 'preview-start' ? 'enabled' : 'disabled'} by readback`;
        this.event(result.ok ? 'success' : 'error', action.toUpperCase(), `${result.id}: ${result.ok ? message : result.error.message}`, {cameraId:result.id, detail:result.error?.next, result});
      }
      await this.refresh(true);
      return {ok:results.every(result => result.ok), results, status:this.status()};
    } catch (error) {
      this.eventKeys.delete(`rig:${error.code || 'RIG_ERROR'}`);
      this.event('error', error.code || 'RIG_ERROR', error.message, {detail:error.next});
      throw error;
    } finally { this.busy = null; }
  }
  async configure(patch) {
    if(this.busy)throw rigError('RIG_BUSY','A rig operation is already running.','Wait for it to finish.',409);
    this.busy='configuration';
    try {
      await this.refresh(true);
      if(this.snapshot.phones.some(p=>p.state?.isH264Recording===true)||this.snapshot.workflowBusy||!this.snapshot.workflowKnown) throw rigError('WORKFLOW_BUSY','A recording or workflow is active or its status is unknown.','Finish the recording or workflow before editing configuration.',409);
      const old=await this.configStore.read();
      // Validate and persist before changing the gateway. Saving configuration
      // never sends phone commands; operators explicitly start selected streams.
      const config=await this.configStore.update(patch);
      const changed=JSON.stringify(config.phones.map(p=>({id:p.id,ip:p.ip})))!==JSON.stringify(old.phones.map(p=>({id:p.id,ip:p.ip})));
      const restart=changed&&!!this.gateway.child;
      this.sync.clear();this.settings.clear();
      if(restart) {
        try { await this.gateway.stop();await this.gateway.start(config); }
        catch(error) { error.next=`Configuration was saved. ${error.next||'Restart the gateway after correcting the reported issue.'}`;throw error; }
      }
      await this.refresh(true);
      this.event('info','CONFIG_SAVED','Local rig configuration saved.');
      return {ok:true,config:this.configStore.public(config),status:this.status()};
    } finally { this.busy=null; }
  }
  async controlGateway(action) {
    if(this.busy)throw rigError('RIG_BUSY','A rig operation is already running.','Wait for it to finish.',409);
    this.busy=`gateway-${action}`;
    try {
      if(action==='start')await this.gateway.start(await this.configStore.read());
      else if(action==='stop')await this.gateway.stop();
      else throw rigError('INVALID_ACTION','Invalid gateway action.','Use Connection setup.',400);
      await this.refresh(true);
      this.event('info','GATEWAY_CONTROL',`Local preview gateway ${action==='start'?'started':'stopped'}.`);
      return {ok:true,status:this.status()};
    } finally { this.busy=null; }
  }
}
