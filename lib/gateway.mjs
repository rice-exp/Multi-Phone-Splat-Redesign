import {spawn} from 'node:child_process';
import {access, mkdir, writeFile} from 'node:fs/promises';
import {createServer,createConnection} from 'node:net';
import {networkInterfaces} from 'node:os';
import dgram from 'node:dgram';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {PROJECT_ROOT} from './rig-config.mjs';

export function routesFor(config) {
  return config.phones.map((phone,i)=>({name:`cam-${i+1}`,ip:phone.ip,videoPort:5004+i*2,metadataPort:6004+i*2}));
}
export function gatewayConfig(config) {
  const paths=routesFor(config).map(r=>`  ${r.name}:\n    source: udp+rtp://0.0.0.0:${r.videoPort}\n    rtpSDP: |\n      v=0\n      o=- 0 0 IN IP4 127.0.0.1\n      s=CameraScope ${r.name}\n      c=IN IP4 0.0.0.0\n      t=0 0\n      m=video ${r.videoPort} RTP/AVP 96\n      a=rtpmap:96 H264/90000\n      a=fmtp:96 packetization-mode=1\n`).join('');
  return `logLevel: info\napi: true\napiAddress: 127.0.0.1:9997\nrtsp: false\nrtmp: false\nhls: false\nsrt: false\nplayback: false\nwebrtc: true\nwebrtcAddress: :8889\nwebrtcAllowOrigins: ['*']\nwebrtcLocalUDPAddress: :8189\nwebrtcLocalTCPAddress: :8189\npaths:${paths?'\n'+paths:' {}\n'}`;
}
const failure=(code,message,next)=>Object.assign(new Error(message),{code,status:503,next});
export async function checkPorts(config,{tcpPorts=[8889,8189,9997],udpPorts=[8189,...routesFor(config).map(r=>r.videoPort)]}={}) {
  const localAddresses=[...new Set(['127.0.0.1',...Object.values(networkInterfaces()).flat().filter(item=>item.family==='IPv4').map(item=>item.address)])];
  const listening=(port,host)=>new Promise(resolve=>{
    const socket=createConnection({port,host});
    const finish=value=>{socket.removeAllListeners();socket.destroy();resolve(value);};
    socket.setTimeout(200);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
  });
  const tcp=async port=>{
    // Windows can allow a wildcard bind alongside an interface-specific
    // listener. Check actual listeners as well as attempting the bind.
    if((await Promise.all(localAddresses.map(host=>listening(port,host)))).some(Boolean))throw Object.assign(new Error('Already listening'),{code:'EADDRINUSE'});
    await new Promise((resolve,reject)=>{
      const server=createServer();server.once('error',reject);server.listen(port,'0.0.0.0',()=>server.close(resolve));
    });
  };
  const udp=async port=>{
    for(const address of [...localAddresses,'0.0.0.0'])await new Promise((resolve,reject)=>{
      const socket=dgram.createSocket('udp4');socket.once('error',error=>{socket.close();reject(error);});socket.bind({port,address,exclusive:true},()=>socket.close(resolve));
    });
  };
  for(const [protocol,ports,check] of [['TCP',tcpPorts,tcp],['UDP',udpPorts,udp]]) {
    for(const port of ports) {
      try { await check(port); }
      catch(error) { throw failure('GATEWAY_PORT_CONFLICT',`${protocol} port ${port} is unavailable (${error.code}).`,'Stop the old webapp/gateway or the other process using this port, then start the gateway here.'); }
    }
  }
}
export class MediaGateway {
  constructor({executable=process.env.MEDIAMTX_EXECUTABLE||path.join(PROJECT_ROOT,'tools','mediamtx',process.platform==='win32'?'mediamtx.exe':'mediamtx'),
    configFile=path.join(PROJECT_ROOT,'.camerascope','mediamtx.generated.yml'),request=fetch,launch=spawn,probe=checkPorts}={}) {
    this.executable=path.resolve(executable);this.configFile=path.resolve(configFile);
    this.request=request;this.launch=launch;this.probe=probe;this.child=null;this.starting=null;this.logs=[];this.error=null;this.signature=null;
  }
  async start(config) {
    if(this.starting)return this.starting;
    if(this.child)return this.state(config);
    this.starting=this.launchGateway(config);
    try { return await this.starting; } finally { this.starting=null; }
  }
  async launchGateway(config) {
    try {
      await access(this.executable);
      await this.probe(config);
      await mkdir(path.dirname(this.configFile),{recursive:true});
      await writeFile(this.configFile,gatewayConfig(config));
      this.logs=[];this.error=null;
      const child=this.child=this.launch(this.executable,[this.configFile],{cwd:path.dirname(this.executable),windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.signature=JSON.stringify(routesFor(config));
      const log=bytes=>{this.logs.push(...String(bytes).trim().split(/\r?\n/));this.logs=this.logs.slice(-80);};
      child.stdout?.on('data',log);child.stderr?.on('data',log);
      child.on('error',error=>{this.error={code:'GATEWAY_START_FAILED',message:error.message,next:'Check the local MediaMTX runtime.'};});
      child.on('close',code=>{
        if(this.child!==child)return;
        this.child=null;this.signature=null;
        if(code && !this.stopping)this.error={code:'GATEWAY_EXITED',message:`MediaMTX exited (${code}).`,next:'Inspect gateway logs and check for port conflicts.'};
      });
      for(let i=0;i<30;i++) {
        await delay(150);
        if(this.child!==child)throw failure('GATEWAY_START_FAILED',this.error?.message||'MediaMTX exited during startup.','Inspect gateway logs.');
        const status=await this.state(config);
        if(status.running)return status;
      }
      throw failure('GATEWAY_START_FAILED','MediaMTX did not expose its control API during startup.','Inspect gateway logs and firewall settings.');
    } catch(error) {
      await this.stop();
      this.error={code:error.code==='ENOENT'?'GATEWAY_RUNTIME_MISSING':error.code||'GATEWAY_START_FAILED',
        message:error.code==='ENOENT'?'MediaMTX runtime is missing.':error.message,next:error.next||'Use the bundled Windows runtime or set MEDIAMTX_EXECUTABLE to your local MediaMTX executable.'};
      throw Object.assign(new Error(this.error.message),this.error,{status:503});
    }
  }
  async stop() {
    const child=this.child;if(!child)return;
    this.stopping=true;
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(failure('GATEWAY_STOP_FAILED','MediaMTX did not stop.','Stop the redesign process and inspect the owned gateway process.')),3000);
        child.once('close',()=>{clearTimeout(timer);resolve();});child.kill();
      });
    } finally { this.stopping=false; }
  }
  async state(config) {
    let items=[],healthy=false,error=this.error;
    if(this.child) {
      try {
        const response=await this.request('http://127.0.0.1:9997/v3/paths/list',{signal:AbortSignal.timeout(1000)});
        if(!response.ok)throw new Error(`HTTP ${response.status}`);
        const value=await response.json();if(!Array.isArray(value.items))throw new Error('Invalid gateway path report.');
        items=value.items;healthy=true;error=null;
      } catch(cause) { error={code:'GATEWAY_API_UNAVAILABLE',message:`MediaMTX control API unavailable (${cause.message}).`,next:'Inspect gateway logs and restart the gateway.'}; }
    }
    const matches=this.signature===JSON.stringify(routesFor(config));
    if(this.child&&!matches)error={code:'GATEWAY_CONFIG_CHANGED',message:'Phone routes changed since the gateway started.',next:'Restart the gateway to use the saved phone inventory.'};
    return {running:!!this.child&&healthy&&matches,processRunning:!!this.child,error,logs:this.logs.slice(-20),routes:routesFor(config).map(route=>{
      const state=items.find(p=>p.name===route.name);return {...route,ready:healthy&&matches&&state?.ready===true,inboundBytes:state?.bytesReceived||state?.inboundBytes||0};
    })};
  }
}
