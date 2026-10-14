import {readFile, writeFile, mkdir, rename, unlink} from 'node:fs/promises';
import {isIP} from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_CONFIG = {
  phones: ['ZY22FT5P9Z','ZY22D6TCB4','ZY22GWLVGK','ZY22F5KW3M','ZY22G3DNSR','ZY22GV79Q4','ZY22G39ZN4','ZD2224GFNF'].map((serial,i)=>({
    id:`cam-${i+1}`, name:`CAM ${String(i+1).padStart(2,'0')}`, ip:`192.168.50.${101+i}`, serial, enabled:true
  })),
  pcIp:'192.168.50.10', iso:100, exposureMs:8, frameRate:30,
  colorProcessing:{awbMode:'OFF',awbLock:false}, cameraScopeRoot:'', pythonExecutable:'python',
  duration:5, cameraFacing:'rear', captureKind:'yuv-jpeg', jpegQuality:90, frameCount:90,
  sessionPrefix:'multi-phone-splat', alignBeforeCapture:true, intervalMode:'auto', syncSamples:30,
  wakeBeforeCapture:false, adbExecutable:'adb', outputRoot:'captures/multi-phone-splat'
};
export function privateAddress(host) {
  if (typeof host !== 'string' || isIP(host) !== 4) return false;
  const [a,b] = host.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
function invalid(message) { return Object.assign(new Error(message), {code:'CONFIG_INVALID',status:400,next:'Correct the Connection setup form or local rig configuration file.'}); }
export function validateConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.phones) || value.phones.length > 64) throw invalid('Configure at most 64 phones.');
  const ids=new Set(),ips=new Set();
  for(const phone of value.phones) {
    if (!phone || typeof phone.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(phone.id) || ids.has(phone.id) || !privateAddress(phone.ip) || ips.has(phone.ip) || typeof phone.name !== 'string' || !phone.name.trim() || phone.name.length > 100 || (phone.enabled!==undefined&&typeof phone.enabled!=='boolean')) throw invalid('Phones require unique IDs, unique private IPv4 addresses, names and boolean selection flags.');
    ids.add(phone.id);ips.add(phone.ip);
  }
  if (!privateAddress(value.pcIp) || value.pcIp.startsWith('127.')) throw invalid('PC destination must be a private LAN IPv4 address, not loopback.');
  for(const [key,min,max] of [['iso',25,12800],['exposureMs',0.1,1000],['frameRate',1,120]]) {
    if(typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key]<min || value[key]>max || (key!=='exposureMs'&&!Number.isInteger(value[key]))) throw invalid(`Invalid saved ${key}.`);
  }
  if(value.exposureMs>1000/value.frameRate) throw invalid('Saved exposure exceeds the frame interval.');
  if(!['OFF','AUTO','INCANDESCENT','FLUORESCENT','WARM_FLUORESCENT','DAYLIGHT','CLOUDY_DAYLIGHT','TWILIGHT','SHADE'].includes(value.colorProcessing?.awbMode)) throw invalid('Invalid saved white balance mode.');
  for(const key of ['cameraScopeRoot','pythonExecutable']) if(typeof value[key]!=='string'||value[key].length>2048||/[\r\n\0]/.test(value[key])) throw invalid(`Invalid ${key} installation setting.`);
  return value;
}
export function migrateConfig(value) {
  return validateConfig({...structuredClone(DEFAULT_CONFIG),...value,
    colorProcessing:{...DEFAULT_CONFIG.colorProcessing,...value.colorProcessing},
    phones:(value.phones||DEFAULT_CONFIG.phones).map((p,i)=>({...p,id:String(p.id||`cam-${i+1}`),name:String(p.name||`CAM ${i+1}`)}))});
}
export class RigConfigStore {
  constructor({file=process.env.RIG_CONFIG_PATH||path.join(PROJECT_ROOT,'.camerascope','rig-config.json'),env=process.env}={}) {
    this.file=path.resolve(file);this.env=env;
  }
  async initialize() {
    try { await readFile(this.file,'utf8'); }
    catch(error) { if(error.code!=='ENOENT')throw error;await this.write(structuredClone(DEFAULT_CONFIG)); }
    return this.read();
  }
  async read() {
    try {
      const value=validateConfig(JSON.parse(await readFile(this.file,'utf8')));
      return validateConfig({...value,
        cameraScopeRoot:this.env.CAMERASCOPE_ROOT??value.cameraScopeRoot,
        pythonExecutable:this.env.CAMERASCOPE_PYTHON??value.pythonExecutable});
    } catch(error) { throw Object.assign(new Error(`Cannot read rig configuration: ${error.message}`),{code:'CONFIG_UNAVAILABLE',status:503,next:'Fix .camerascope/rig-config.json or use the import-config command, then refresh.'}); }
  }
  async write(value) {
    validateConfig(value);await mkdir(path.dirname(this.file),{recursive:true});
    const temporary=`${this.file}.${crypto.randomUUID()}.tmp`;
    try { await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx'});await rename(temporary,this.file); }
    finally { await unlink(temporary).catch(()=>{}); }
    return value;
  }
  public(value) {
    return {phones:value.phones.map(({id,name,ip,enabled})=>({id,name,ip,enabled:enabled!==false})),
      pcIp:value.pcIp,iso:value.iso,exposureMs:value.exposureMs,frameRate:value.frameRate,colorProcessing:value.colorProcessing};
  }
  async update(patch) {
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!['phones','pcIp','iso','exposureMs','frameRate','colorProcessing'].includes(key))) throw invalid('Only phone inventory, destination and saved camera defaults can be changed from the browser.');
    const saved=JSON.parse(await readFile(this.file,'utf8'));
    validateConfig({...saved,...patch});
    const prior=new Map(saved.phones.map(phone=>[phone.id,phone]));
    const next=validateConfig({...saved,...patch,...(Array.isArray(patch.phones)?{phones:patch.phones.map(phone=>({
      ...prior.get(phone.id),id:phone.id,name:phone.name,ip:phone.ip,enabled:phone.enabled!==false
    }))}:{})});
    await this.write(next);return this.read();
  }
}
