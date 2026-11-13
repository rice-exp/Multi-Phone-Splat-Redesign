import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {FrameReview} from './lib/frame-review.mjs';
import {RigService,privateAddress} from './lib/rig-service.mjs';
import {RigConfigStore} from './lib/rig-config.mjs';
import {MediaGateway} from './lib/gateway.mjs';
import {CaptureSession} from './lib/capture-session.mjs';
const configStore=new RigConfigStore(),gateway=new MediaGateway();
const rig=new RigService({configStore,gateway,workflow:async()=>({state:rig.busy==='capture'?'running':'idle'})});
const review=new FrameReview({configStore});
const capture=new CaptureSession({rig,review});
try {
  const config=await configStore.initialize();
  if(config.phones.length&&process.env.RIG_GATEWAY_AUTOSTART!=='0')await gateway.start(config);
} catch(error) { console.error(`Rig setup: ${error.message}`); }
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const host=args.host||process.env.HOST||'127.0.0.1';
const port=Number(args.port||process.env.PORT||4317);
const clients=new Set();
const participantEvent=()=>`data: ${JSON.stringify(capture.participant())}\n\n`;
capture.onChange=()=>{for(const res of clients)res.write(participantEvent());};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/review/')) {
      const requestHost=new URL(`http://${req.headers.host}`).hostname;
      if(requestHost!=='localhost'&&!privateAddress(requestHost))return json(res,403,{error:'Use localhost or the computer’s private IPv4 address.'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Same-origin requests only'});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Frame review is read-only.'});
      if(url.pathname==='/api/review/sessions')return json(res,200,await review.list());
      const session=url.searchParams.get('session');
      if(url.pathname==='/api/review/session')return json(res,200,await review.session(session));
      if(!['/api/review/frame','/api/review/image'].includes(url.pathname))return json(res,404,{error:'Not found'});
      const indexText=url.searchParams.get('index');
      if(!/^\d+$/.test(indexText||'')||!Number.isSafeInteger(Number(indexText)))return json(res,400,{error:'Choose a valid sequence index.'});
      const index=Number(indexText),revision=url.searchParams.get('revision');
      if(url.pathname==='/api/review/frame')return json(res,200,await review.frame(session,index,revision));
      const {handle,type}=await review.image(session,index,url.searchParams.get('camera'),revision);
      res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'});
      if(req.method==='HEAD'){await handle.close();res.end();return;}
      await pipeline(handle.createReadStream(),res);return;
    }
    if(url.pathname.startsWith('/api/rig/')) {
      const requestHost=new URL(`http://${req.headers.host}`).hostname;
      if(requestHost!=='localhost'&&!privateAddress(requestHost))return json(res,403,{error:'Use localhost or the computer’s private IPv4 address.'});
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Same-origin requests only'});
      if(url.pathname==='/api/rig/config'&&req.method==='GET')return json(res,200,{config:configStore.public(await configStore.read())});
      if(url.pathname==='/api/rig/status'&&req.method==='GET')return json(res,200,await rig.refresh());
      if(url.pathname==='/api/rig/capture'&&req.method==='GET')return json(res,200,await capture.status());
      if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
      if(req.headers['x-rig-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Use the Prepare rig controls.'});
      let body='';
      for await(const chunk of req){body+=chunk;if(body.length>(url.pathname==='/api/rig/config'?65536:8192))return json(res,413,{error:'Request too large'});}
      const value=JSON.parse(body||'{}');
      if(!value||typeof value!=='object'||Array.isArray(value))return json(res,400,{error:'Expected a JSON object.'});
      if(closing)return json(res,503,{error:'The server is shutting down.'});
      if(url.pathname==='/api/rig/capture')return json(res,202,await capture.start(value));
      if(url.pathname==='/api/rig/capture-retry')return json(res,202,capture.retry(value.session));
      if(url.pathname==='/api/rig/refresh')return json(res,200,await rig.refresh(true));
      if(url.pathname==='/api/rig/config')return json(res,200,await rig.configure(value));
      if(['/api/rig/gateway-start','/api/rig/gateway-stop'].includes(url.pathname))return json(res,200,await rig.controlGateway(url.pathname.endsWith('start')?'start':'stop'));
      const colorSources = {'color-sync':'measure', 'color-copy':'current', 'color-adjust':'adjust'};
      const route=url.pathname.split('/').at(-1);
      const colorSource=Object.hasOwn(colorSources,route)?colorSources[route]:null;
      if(url.pathname!=='/api/rig/'+route||(!colorSource&&!['settings','sync','preview-start','preview-stop','auto-balance'].includes(route)))return json(res,404,{error:'Not found'});
      const options=colorSource?{leaderId:value.leaderId,retryId:value.retryId,source:colorSource,correction:value.correction}:value.settings;
      try{return json(res,200,await rig.operate(colorSource?'color-sync':route,value.ids,options,{refreshPreview:value.refreshPreview===true}));}
      catch(error){return json(res,error.status||503,{error:error.message,code:error.code||'RIG_ERROR',next:error.next});}
    }
    if(url.pathname==='/api/participant/events'&&req.method==='GET') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      clients.add(res);res.write(participantEvent());
      const heartbeat=setInterval(()=>res.write(participantEvent()),2000);
      req.on('close',()=>{clients.delete(res);clearInterval(heartbeat);});return;
    }
    if(url.pathname==='/api/participant/state'&&req.method==='POST') {
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Same-origin requests only'});
      return json(res,405,{error:'Only the capture job publishes participant status.',code:'READ_ONLY'});
    }
    if(url.pathname==='/api/demo-status')return json(res,410,{error:'The preview interface has been removed.'});
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const requested=decodeURIComponent(['/', '/frames','/calibration','/capture','/reconstruction','/splats'].includes(url.pathname)?'/index.html':url.pathname);
    const file=path.resolve(root,`.${requested}`);
    if(file!==root&&!file.startsWith(root+path.sep))return json(res,403,{error:'Forbidden'});
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){if(res.headersSent){res.destroy();return;}json(res,error.status||(error.code==='ENOENT'?404:error instanceof SyntaxError?400:500),{error:error.code==='ENOENT'?'Not found':error.message,code:error.code,next:error.next});}
});
server.listen(port,host,()=>console.log(`Rice Experiential Pixels Lab: http://${host}:${port}\nLocal rig configuration: ${configStore.file}\nFrame review: http://${host}:${port}/frames\nParticipant display: http://${host}:${port}/participant.html`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
let closing=false;
const close=async()=>{if(closing)return;closing=true;await capture.finished;for(const res of clients)res.end();await gateway.stop().catch(error=>console.error(error.message));server.close(()=>process.exit(0));server.closeAllConnections();};
process.on('SIGINT',close);process.on('SIGTERM',close);
