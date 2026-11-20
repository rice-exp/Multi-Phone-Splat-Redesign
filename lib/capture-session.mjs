import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir, stat, writeFile, rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {CaptureUpload} from './capture-upload.mjs';
import {parseCliJson, rigError} from './rig-service.mjs';
import {analyseCaptureReport} from '../public/js/capture-metrics.js';
import {timestampNs} from '../public/js/frame-review-model.js';

const setup = 'Set CAMERASCOPE_ROOT to the CameraScope desktop folder containing scripts/camerascope_cli.py, then restart the web app.';
const positive = (n, fallback, max) => Number.isInteger(n) && n > 0 && n <= max ? n : fallback;
const remoteJpeg = /^\/(?:storage\/emulated\/0|sdcard)\/Android\/data\/com\.explab\.camera\/files\/CameraScope\/transfer\/[\w.-]+\.jpe?g$/i;
const pad = index => String(index).padStart(6, '0');
async function writeJson(directory, name, value) {
  const target = path.join(directory, name);
  await writeFile(target + '.tmp', JSON.stringify(value));
  await rename(target + '.tmp', target);
}

async function captureCli(config) {
  const cli = path.join(config.cameraScopeRoot, 'scripts', 'camerascope_cli.py');
  if (!config.cameraScopeRoot || !(await stat(cli).catch(() => null))?.isFile()) return null;
  return cli;
}

function manifestFor(report, job, phones) {
  const metrics = analyseCaptureReport(report, phones);
  const frames = Array.from({length:job.frameCount}, (_, sequenceIndex) => ({
    sequenceIndex, folder:'frame-' + pad(sequenceIndex), files:[]
  }));
  for (const phone of phones) {
    const result = report.results.find(row => row.host === phone.ip);
    const events = new Map((result?.frames || []).map(event => [Number(event.sequenceIndex), event]));
    for (const frame of frames) {
      const event = events.get(frame.sequenceIndex);
      const saved = event?.event === 'sequenceFrameSaved';
      frame.files.push({
        cameraId:phone.id, host:phone.ip, sequenceIndex:frame.sequenceIndex,
        actualLeaderNs:event?.actualLeaderNs ?? null, targetLeaderNs:event?.targetLeaderNs ?? null,
        targetLeaderErrorNs:event?.targetLeaderErrorNs ?? null, phaseOffsetNs:result?.phaseOffsetNs ?? 0,
        frameNumber:event?.frameNumber ?? null, captureDropped:event?.event === 'sequenceFrameDropped',
        transferFailed:saved, remoteFile:saved && remoteJpeg.test(event.file) ? event.file : null,
        file:null, error:saved ? 'Awaiting transfer.' : event?.error || result?.error || 'No saved frame reported.'
      });
    }
  }
  for (const frame of frames) {
    const times = frame.files.filter(file => file.transferFailed).map(file => timestampNs(file.actualLeaderNs))
      .filter(time => time !== null).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
    if (times.length) {
      const mid = Math.floor(times.length/2);
      frame.groupedLeaderNs = String(times.length % 2 ? times[mid] : (times[mid-1] + times[mid] + 1n) / 2n);
    }
  }
  return {session:job.session, name:job.name, createdAt:job.createdAt, metrics, intervalNs:report.intervalNs,
    transferTransport:'wireless', targetLeaderNs:report.targetLeaderNs, sourceReport:'camerascope-sequence.json',
    intervalSource:report.intervalSource, frames};
}

export class CaptureSession {
  constructor({rig, review, findCli = captureCli, receiver = (config) => new CaptureUpload(config.pcIp, config.wirelessTransferPort ?? 8080, rig.command)}) {
    this.rig = rig;
    this.review = review;
    this.findCli = findCli;
    this.receiver = receiver;
    this.job = null;
    this.current = null;
    this.onChange = () => {};
  }

  participant() {
    const phases = {preparing:'preparing', recording:'capturing', transferring:'saving', saved:'done', partial:'interrupted', failed:'interrupted'};
    return {available:true, phase:phases[this.job?.phase] || 'idle', remaining:null,
      sessionName:this.job?.name || null, updatedAt:Date.now()};
  }

  update(patch) { Object.assign(this.job, patch); this.onChange(); }

  async status() {
    const config = await this.rig.configStore.read();
    const {framesRoot} = await this.review.roots();
    return {phones:this.rig.inventory(config), frameCount:positive(config.frameCount, 90, 300),
      setup:await this.findCli(config) ? null : setup, framesRoot, busy:this.rig.busy, job:this.job};
  }

  async start({ids, name, frameCount}) {
    if (this.rig.busy) throw rigError('RIG_BUSY','A rig operation is in progress. Wait for it to finish.',null,409);
    this.rig.busy = 'capture';
    try {
      const config = await this.rig.configStore.read();
      const phones = this.rig.inventory(config).filter(phone => Array.isArray(ids) && ids.includes(phone.id));
      if (!phones.length || phones.length !== ids.length) throw rigError('INVALID_SELECTION','Select one or more configured cameras.',null,400);
      if (!positive(frameCount, 0, 300)) throw rigError('INVALID_COUNT','Choose 1 to 300 frames per camera.',null,400);
      if (typeof name !== 'string' || !name.trim() || name.length > 64) throw rigError('INVALID_NAME','Enter a session name of up to 64 characters.',null,400);
      if (config.captureKind && config.captureKind !== 'yuv-jpeg') throw rigError('CAPTURE_FORMAT','Choose yuv-jpeg in the rig configuration for synchronized capture.',null,400);
      const port = Number(config.wirelessTransferPort ?? 8080);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw rigError('CAPTURE_PORT','Set wirelessTransferPort to a TCP port between 1024 and 65535 in the rig configuration.',null,400);
      if (Number(config.phaseStaggerMs) > 0) throw rigError('CAPTURE_STAGGER','This Capture tab records simultaneous views. Set phaseStaggerMs to 0 to use it.',null,400);
      const cli = await this.findCli(config);
      if (!cli) throw rigError('CLI_MISSING',setup,null);
      const {framesRoot} = await this.review.roots();
      const createdAt = new Date().toISOString();
      const session = 'take-' + createdAt.replace(/[:.]/g,'-') + '-' + (name.trim().replace(/[^a-z0-9_-]+/gi,'-').slice(0,36) || 'capture') + '-' + randomUUID().slice(0,8);
      const directory = path.join(framesRoot, session);
      await mkdir(framesRoot, {recursive:true});
      await mkdir(directory);
      this.current = {config, phones, cli, directory, manifest:null};
      this.job = {name:name.trim(), session, createdAt, frameCount, phase:'preparing',
        expected:phones.length * frameCount, savedOnPhone:0, transferred:0, reviewable:false, warnings:[], retryable:false};
      this.onChange();
      this.launch(() => this.record(this.current));
      return this.job;
    } catch (error) { this.rig.busy = null; throw error; }
  }

  launch(work) {
    this.finished = work().catch(error => this.update({phase:'failed', message:error.message,
      retryable:this.job.reviewable && this.job.transferred < this.job.savedOnPhone})).finally(() => {
      this.rig.busy = null;
      this.rig.snapshot = null;
      this.onChange();
    });
  }

  async cli(ctx, args, timeout = 120000, acceptPartial = false) {
    const options = {timeout, windowsHide:true, maxBuffer:32 * 1024 * 1024};
    try {
      const {stdout} = await this.rig.run(ctx.config.pythonExecutable, [ctx.cli, ...args], options);
      return stdout;
    } catch (error) {
      if (acceptPartial && !error.killed && error.stdout) {
        try { if (Array.isArray(parseCliJson(error.stdout).results)) return error.stdout; } catch {}
      }
      throw Error(String(error.stderr || error.message).trim().slice(-1600) || 'CameraScope command failed.');
    }
  }

  async record(ctx) {
    const {config, phones, directory} = ctx;
    const hosts = ['--hosts', ...phones.map(p => p.ip), '--jobs', String(phones.length)];
    // Probe the installed Python and CLI, output directory and receiver before touching a phone.
    await this.cli(ctx, ['capture-sequence','--help'], 15000);
    const upload = this.receiver(config);
    await upload.start();
    try {
      const readings = await Promise.all(phones.map(phone => this.rig.readPhone(phone)));
      for (const phone of readings) {
        if (!phone.responding || !phone.state) throw Error(phone.name + ': ' + (phone.error?.message || 'CameraScope did not respond.'));
        if (phone.state.isH264Recording !== false || typeof phone.state.streamEnabled !== 'boolean' || typeof phone.state.isCapturing !== 'boolean')
          throw Error(phone.name + ': finish any recording and refresh CameraScope before starting a session.');
      }
      const touched = [];
      try {
        for (const phone of readings) {
          touched.push(phone);
          this.rig.sync.delete(phone.id);
          await this.cli(ctx, ['--host', phone.ip, '--timeout','12','stop']);
          const prepare = ['--host', phone.ip, '--timeout','12','set','--no-stream','--capture'];
          if (typeof phone.state.rawEnabled === 'boolean') prepare.push('--no-raw');
          await this.cli(ctx, prepare);
        }
        const sync = parseCliJson(await this.cli(ctx, ['sync-many', ...hosts, '--count', String(positive(config.syncSamples,30,200))]));
        for (const phone of phones) {
          const matches = sync.results?.filter(row => row.host === phone.ip);
          if (matches?.length !== 1 || matches[0].ok !== true) throw Error('Clock synchronization failed for ' + phone.name + '.');
        }
        let alignment = null;
        if (config.alignBeforeCapture !== false) {
          alignment = parseCliJson(await this.cli(ctx, ['phase-align', ...hosts, '--anchor-delay-ms','5000','--iterations','5','--tolerance-ms','1']));
          if (alignment.results?.some(row => row.ok === false) || !timestampNs(alignment.targetLeaderTimestampNs))
            throw Error('CameraScope did not confirm a shared target time for the sequence.');
        }
        await writeJson(directory, 'timing.json', {sync, alignment});
        const interval = Number(config.captureIntervalMs);
        const seconds = Math.max(60, Math.ceil(this.job.frameCount * (interval > 0 ? interval/1000 : 1/Math.max(1,config.frameRate))) + 45);
        const args = ['capture-sequence', ...hosts, '--skip-prepare',
          '--frame-count',String(this.job.frameCount),'--jpeg-quality',String(positive(config.jpegQuality,90,100)),
          '--completion-timeout',String(seconds),'--prefix',this.job.session];
        if (alignment) args.push('--target-leader-ns',String(alignment.targetLeaderTimestampNs));
        if (interval > 0) args.push('--interval-ms',String(Math.max(5,interval)));
        this.update({phase:'recording'});
        const stdout = await this.cli(ctx, args, (seconds + 60) * 1000, true);
        await writeFile(path.join(directory,'sequence-output.txt'),stdout);
        const report = parseCliJson(stdout);
        await writeJson(directory,'camerascope-sequence.json',report);
        if (!Array.isArray(report.results) || Number(report.frameCount) !== this.job.frameCount) throw Error('Unexpected capture report. The phone output is preserved in the session folder.');
        ctx.manifest = manifestFor(report,this.job,phones);
        await writeJson(directory,'frame-manifest.json',ctx.manifest);
        const savedOnPhone = ctx.manifest.frames.reduce((sum, frame) => sum + frame.files.filter(f => f.transferFailed).length, 0);
        this.update({phase:'transferring', reviewable:true, savedOnPhone});
      } finally {
        const restore = await Promise.allSettled(touched.map(async phone => {
          const before = phone.state;
          await this.cli(ctx, ['--host', phone.ip, 'stop']);
          if (before.rawEnabled === true) await this.cli(ctx, ['--host', phone.ip, 'set', '--raw']);
          await this.rig.command(phone.ip,{cmd:'set',streamEnabled:before.streamEnabled,capture:before.isCapturing});
          let current = await this.rig.readPhone(phone);
          for (let attempt = 0; current.responding && (current.state?.isCapturing !== before.isCapturing || current.state?.streamEnabled !== before.streamEnabled) && attempt < 8; attempt++) {
            await delay(250); current = await this.rig.readPhone(phone);
          }
          if (current.state?.isCapturing !== before.isCapturing || current.state?.streamEnabled !== before.streamEnabled) throw Error('Preview state unconfirmed.');
        }));
        const warnings = touched.filter((_,i) => restore[i].status === 'rejected').map(p => 'Check ' + p.name + ' in Prepare rig. Its previous camera state could not be confirmed.');
        if (warnings.length) this.update({warnings});
      }
      await this.transfer(ctx,upload);
    } finally { await upload.close(); }
  }

  async transfer(ctx,upload) {
    const {manifest,directory} = ctx;
    const blocked = new Map();
    for (const frame of manifest.frames) {
      const folder = path.join(directory,frame.folder);
      await mkdir(folder,{recursive:true});
      for (const [i,file] of frame.files.entries()) {
        if (!file.transferFailed) continue;
        if (!file.remoteFile) { file.error = 'CameraScope did not report a valid transfer JPEG path.'; continue; }
        if (blocked.has(file.cameraId)) { file.error = blocked.get(file.cameraId); continue; }
        const filename = 'cam-' + (i+1) + '-' + file.cameraId + '-' + pad(frame.sequenceIndex) + '.jpg';
        try {
          await upload.transfer(file.host,file.remoteFile,path.join(folder,filename));
          Object.assign(file,{file:filename,transferFailed:false,error:null});
          this.update({transferred:this.job.transferred + 1});
        } catch (error) { file.error = error.message; blocked.set(file.cameraId,error.message); }
      }
      // A stopped server leaves the last completed group available to Frame review.
      if (frame.sequenceIndex % 10 === 0) await writeJson(directory,'frame-manifest.json',manifest);
    }
    await writeJson(directory,'frame-manifest.json',manifest);
    const retryable = manifest.frames.some(frame => frame.files.some(f => f.transferFailed && f.remoteFile));
    this.update({phase:this.job.transferred === this.job.expected ? 'saved' : 'partial', retryable,
      message:[...blocked.values()].join(' ') || (this.job.transferred !== this.job.expected ? 'Open Frame review to inspect missing images.' : '')});
  }

  retry(session) {
    if (this.rig.busy) throw rigError('RIG_BUSY','Wait for the current operation to finish.',null,409);
    if (!this.job?.retryable || session !== this.job.session) throw rigError('CAPTURE_RETRY','This take has no pending file transfers.',null,409);
    this.rig.busy = 'capture';
    this.update({phase:'transferring', retryable:false, message:''});
    this.launch(async () => {
      const config = await this.rig.configStore.read();
      for (const original of this.current.phones) {
        if (!config.phones.some(phone => phone.id === original.id && phone.ip === original.ip))
          throw Error(original.name + ' has changed in Prepare rig. Verify its original phone address before retrying this take.');
      }
      const upload = this.receiver(config);
      await upload.start();
      try { await this.transfer(this.current,upload); } finally { await upload.close(); }
    });
    return this.job;
  }
}
