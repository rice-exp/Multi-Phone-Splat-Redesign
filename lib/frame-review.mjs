import {readFile, readdir, realpath, lstat, open} from 'node:fs/promises';
import path from 'node:path';
import {PROJECT_ROOT} from './rig-config.mjs';
import {recordedState, timingFor, timestampNs, FILE_STATES} from '../public/js/frame-review-model.js';

const IMAGE_TYPES={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const MAX_MANIFEST_BYTES=64*1024*1024;
const asList=value=>value==null?[]:Array.isArray(value)?value:[value];
const fail=(message,code='REVIEW_INVALID',status=400,next='Check the session’s frame-manifest.json, then refresh.')=>Object.assign(new Error(message),{code,status,next});
const within=(root,target)=>{const relative=path.relative(root,target);return !path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`);};
const safePart=value=>typeof value==='string'&&value.length>0&&value.length<=255&&!/[\\/\x00-\x1f:]/.test(value)&&value!=='.'&&value!=='..';
const cameraKey=file=>String(file.cameraId||file.device||file.host||'');

// Resolve each component explicitly: a symlink inside a trusted root must not
// turn an image/manifest request into an arbitrary local-file read.
async function contained(root,...parts) {
  const base=await realpath(root);
  let target=base;
  for(const part of parts) {
    if(!safePart(part))throw fail('Invalid session file path.','REVIEW_PATH',400);
    target=path.join(target,part);
    const info=await lstat(target);
    if(info.isSymbolicLink())throw fail('Symbolic links inside capture sessions are not supported.','REVIEW_PATH',400);
    if(!within(base,await realpath(target)))throw fail('File is outside the capture directory.','REVIEW_PATH',400);
  }
  return target;
}
function normalizeManifest(manifest,session,revision) {
  if(!manifest||typeof manifest!=='object'||Array.isArray(manifest))throw fail('The frame manifest must be a JSON object.');
  const source=asList(manifest.frames);
  if(source.length>50000)throw fail('This session exceeds the 50,000-frame review limit.');
  const cameras=new Map(), indices=new Set();let entries=0;
  const frames=source.map((frame,position)=>{
    if(!frame||typeof frame!=='object'||!safePart(frame.folder))throw fail(`Invalid folder for frame ${position+1}.`);
    const index=frame.sequenceIndex??frame.frameIndex??position;
    if(!Number.isSafeInteger(index)||index<0||indices.has(index))throw fail('Sequence indices must be unique nonnegative integers.');
    indices.add(index);
    const files=asList(frame.files),seen=new Set();
    if(files.length>64||(entries+=files.length)>1000000)throw fail('The frame manifest contains too many camera records.');
    for(const file of files) {
      if(!file||typeof file!=='object')throw fail(`Invalid camera record at sequence ${index}.`);
      const key=cameraKey(file);
      if(!key||key.length>128||seen.has(key))throw fail(`Camera identifiers must be present and unique at sequence ${index}.`);
      seen.add(key);cameras.set(key,{id:key,name:String(file.cameraId||file.device||file.host),host:String(file.host||'')});
    }
    return {...frame,index,files};
  }).sort((a,b)=>a.index-b.index);
  if(cameras.size>64)throw fail('The session contains more than 64 cameras.');
  const cameraList=[...cameras.values()].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
  const totals={recordedTransfers:0,captureDropped:0,transferFailed:0,unknown:0};
  const timeline=frames.map(frame=>{
    const timing=timingFor(frame.files,frame.groupedLeaderNs);
    let issues=cameraList.length-frame.files.length;
    totals.unknown+=issues;
    for(const file of frame.files){const state=recordedState(file);if(state==='available')totals.recordedTransfers++;else{issues++;totals[state==='capture_dropped'?'captureDropped':state==='transfer_failed'?'transferFailed':'unknown']++;}}
    return {index:frame.index,issues,spreadMs:timing.spreadMs,timingSamples:timing.samples};
  });
  const interval=Number(manifest.intervalNs);
  const expected=Number(manifest.metrics?.frameCount);
  const expectedFrames=Number.isSafeInteger(expected)&&expected>=0?expected:null;
  const missingSequenceCount=expectedFrames!==null?Math.max(0,expectedFrames-frames.filter(frame=>frame.index<expectedFrames).length):0;
  return {frames,byIndex:new Map(frames.map(frame=>[frame.index,frame])),metadata:{session,revision,createdAt:manifest.createdAt||null,
    intervalMs:Number.isFinite(interval)&&interval>0?interval/1e6:null,intervalSource:manifest.intervalSource||null,
    phaseStaggerMs:Number(manifest.metrics?.phaseStaggerMs)||0,cameras:cameraList,frames:timeline,totals,expectedFrames,missingSequenceCount}};
}

export class FrameReview {
  constructor({configStore,env=process.env,projectRoot=PROJECT_ROOT}={}) {this.configStore=configStore;this.env=env;this.projectRoot=projectRoot;this.cache=new Map();}
  async roots() {
    const config=await this.configStore.read();
    const configured=this.env.RIG_CAPTURE_ROOT??config.outputRoot??'captures/multi-phone-splat';
    if(typeof configured!=='string'||!configured.trim()||configured.includes('\0'))throw fail('Set a valid capture output folder.','REVIEW_ROOT',503,'Set RIG_CAPTURE_ROOT to the capture output folder containing frames, then restart the server.');
    const captureRoot=path.resolve(this.projectRoot,configured);
    return {captureRoot,framesRoot:path.join(captureRoot,'frames')};
  }
  async list() {
    const roots=await this.roots();let entries;
    try {entries=await readdir(roots.framesRoot,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return {...roots,sessions:[]};throw fail('The capture folder cannot be read.','REVIEW_ROOT',503,'Check the configured capture folder and read permissions on this computer.');}
    const sessions=[];
    for(const entry of entries) {
      if(!entry.isDirectory()||!safePart(entry.name))continue;
      try {
        const manifest=await contained(roots.framesRoot,entry.name,'frame-manifest.json');
        const stat=await lstat(manifest);
        if(stat.isFile())sessions.push({id:entry.name,modifiedAt:stat.mtime.toISOString()});
      }catch(error){if(error.code!=='ENOENT')sessions.push({id:entry.name,modifiedAt:null,error:'Manifest cannot be read. Check its path and permissions.'});}
    }
    sessions.sort((a,b)=>String(b.modifiedAt||'').localeCompare(String(a.modifiedAt||''))||b.id.localeCompare(a.id));
    return {...roots,sessions};
  }
  async load(session,revision) {
    if(!safePart(session))throw fail('Choose a valid capture session.');
    const {framesRoot}=await this.roots();
    let file,stat;
    try {file=await contained(framesRoot,session,'frame-manifest.json');stat=await lstat(file);}
    catch(error){if(error.code==='ENOENT')throw fail('This session’s frame manifest was not found.','REVIEW_NOT_FOUND',404,'Refresh the session list. Transfer the capture before reviewing it.');throw error;}
    if(!stat.isFile()||stat.size>MAX_MANIFEST_BYTES)throw fail('The frame manifest is not a file or exceeds 64 MB.');
    const version=`${stat.mtimeMs}-${stat.ctimeMs}-${stat.size}`;
    if(revision&&revision!==version)throw fail('The session changed while you were reviewing it.','REVIEW_CHANGED',409,'Refresh the session to load the updated manifest.');
    let data=this.cache.get(file);
    if(data?.metadata.revision!==version) {
      let manifest;
      try {manifest=JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}
      catch(error){throw fail(error instanceof SyntaxError?'The frame manifest is incomplete or contains invalid JSON.':'The frame manifest cannot be read.','REVIEW_MANIFEST',422,'Wait for transfer to finish, then refresh. If this persists, inspect frame-manifest.json.');}
      data=normalizeManifest(manifest,session,version);
      if(this.cache.size>=4)this.cache.delete(this.cache.keys().next().value);
      this.cache.set(file,data);
    }
    return {...data,framesRoot,session};
  }
  async session(session) {return (await this.load(session)).metadata;}
  async locate(data,frame,file) {
    try {
      const target=await contained(data.framesRoot,data.session,frame.folder,file.file);
      const stat=await lstat(target);
      if(!stat.isFile()||!stat.size)return {state:'missing'};
      const type=IMAGE_TYPES[path.extname(target).toLowerCase()];
      return {state:type?'available':'unsupported',target,type};
    }catch(error){return {state:error.code==='ENOENT'?'missing':error.code==='REVIEW_PATH'?'blocked':'unreadable'};}
  }
  async frame(session,index,revision) {
    const data=await this.load(session,revision),frame=data.byIndex.get(index);
    if(!frame)throw fail('This sequence index is not in the session.','REVIEW_NOT_FOUND',404);
    const timing=timingFor(frame.files,frame.groupedLeaderNs);
    const files=await Promise.all(data.metadata.cameras.map(async camera=>{
      const source=frame.files.find(file=>cameraKey(file)===camera.id);
      let state=recordedState(source),url=null;
      if(state==='available') {
        const located=await this.locate(data,frame,source);state=located.state;
        if(state==='available')url=`/api/review/image?${new URLSearchParams({session,index:String(index),camera:camera.id,revision:data.metadata.revision})}`;
      }
      const timestamp=timestampNs(source?.actualLeaderNs);
      return {...camera,state,url,label:FILE_STATES[state].label,next:FILE_STATES[state].next,
        file:typeof source?.file==='string'?source.file:null,error:source?.error?String(source.error):null,
        actualLeaderNs:timestamp===null?null:String(timestamp),offsetMs:source?timing.offsets[frame.files.indexOf(source)]:null,
        phaseOffsetMs:source?.phaseOffsetNs!=null&&Number.isFinite(Number(source.phaseOffsetNs))?Number(source.phaseOffsetNs)/1e6:null,
        targetErrorMs:source?.targetLeaderErrorNs!=null&&Number.isFinite(Number(source.targetLeaderErrorNs))?Number(source.targetLeaderErrorNs)/1e6:null};
    }));
    return {session,revision:data.metadata.revision,index,folder:frame.folder,spreadMs:timing.spreadMs,timingSamples:timing.samples,
      groupedLeaderNs:timestampNs(frame.groupedLeaderNs)?.toString()??null,files};
  }
  async image(session,index,camera,revision) {
    const data=await this.load(session,revision),frame=data.byIndex.get(index);
    const file=frame?.files.find(file=>cameraKey(file)===camera);
    if(recordedState(file)!=='available')throw fail('No transferred image is recorded for this camera and frame.','REVIEW_IMAGE',404);
    const located=await this.locate(data,frame,file);
    if(located.state!=='available')throw fail(FILE_STATES[located.state].label,'REVIEW_IMAGE',404,FILE_STATES[located.state].next);
    // Open before writing HTTP headers so a disappearing file is a proper error.
    const handle=await open(located.target,'r');
    return {handle,type:located.type};
  }
}
