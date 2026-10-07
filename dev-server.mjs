import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.replace(/^--/,'').split('=')));
const host=args.host||process.env.HOST||'127.0.0.1';
const port=Number(args.port||process.env.PORT||4317);
let participant={phase:'idle',sessionName:'Waiting for a session',remaining:0,simulation:true,updatedAt:Date.now()};
const clients=new Set();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const broadcast=()=>{for(const res of clients)res.write(`data: ${JSON.stringify(participant)}\n\n`);};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/participant/events'&&req.method==='GET') {
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});
      clients.add(res);res.write(`data: ${JSON.stringify(participant)}\n\n`);
      const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),10000);
      req.on('close',()=>{clients.delete(res);clearInterval(heartbeat);});return;
    }
    if(url.pathname==='/api/participant/state'&&req.method==='POST') {
      // UI-only state relay; never invokes a device, shell command, or capture API.
      // Same-origin writes prevent other websites from changing the participant display.
      if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Same-origin requests only'});
      let body='';
      for await(const chunk of req){body+=chunk;if(body.length>8192)return json(res,413,{error:'Request too large'});}
      const value=JSON.parse(body);
      const phases=['idle','preparing','capturing','done','cancelled','interrupted'];
      if(!phases.includes(value.phase))return json(res,400,{error:'Invalid display phase'});
      participant={phase:value.phase,sessionName:String(value.sessionName||'Untitled session').slice(0,120),remaining:Math.max(0,Math.min(600,Number(value.remaining)||0)),simulation:true,updatedAt:Date.now()};
      broadcast();return json(res,200,{ok:true,displays:clients.size});
    }
    if(url.pathname==='/api/demo-status')return json(res,200,{mode:'simulation',displays:clients.size});
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
    const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=path.resolve(root,`.${requested}`);
    if(file!==root&&!file.startsWith(root+path.sep))return json(res,403,{error:'Forbidden'});
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});
    res.end(req.method==='HEAD'?undefined:bytes);
  }catch(error){json(res,error.code==='ENOENT'?404:400,{error:error.code==='ENOENT'?'Not found':'Invalid request'});}
});
server.listen(port,host,()=>console.log(`Rice Experiential Pixels Lab UI: http://${host}:${port}\nParticipant display: http://${host}:${port}/participant.html\nSIMULATION ONLY — no camera or training commands are enabled.`));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
const close=()=>{for(const res of clients)res.end();server.close(()=>process.exit(0));};
process.on('SIGINT',close);process.on('SIGTERM',close);
