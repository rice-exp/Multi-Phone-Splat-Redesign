import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import os from 'node:os';
import path from 'node:path';
import dgram from 'node:dgram';
import {MediaGateway,gatewayConfig,routesFor,checkPorts} from '../lib/gateway.mjs';
import {DEFAULT_CONFIG} from '../lib/rig-config.mjs';

test('gateway preserves original H264 RTP routes and keeps its control API loopback-only',()=>{
  const config={...DEFAULT_CONFIG,phones:DEFAULT_CONFIG.phones.slice(0,2)};
  assert.deepEqual(routesFor(config).map(r=>[r.name,r.videoPort,r.metadataPort]),[['cam-1',5004,6004],['cam-2',5006,6006]]);
  const yaml=gatewayConfig(config);assert.match(yaml,/apiAddress: 127\.0\.0\.1:9997/);assert.match(yaml,/source: udp\+rtp:\/\/0.0.0.0:5006/);assert.match(yaml,/a=rtpmap:96 H264\/90000/);
  assert.match(gatewayConfig({...config,phones:[]}),/paths: \{\}/);
});
test('port conflict detection refuses to adopt or stop another gateway',async t=>{
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  await assert.rejects(()=>checkPorts(DEFAULT_CONFIG,{tcpPorts:[server.address().port],udpPorts:[]}),{code:'GATEWAY_PORT_CONFLICT'});assert.equal(server.listening,true);
});
test('interface-specific UDP video listeners also block gateway startup on Windows',async t=>{
  const socket=dgram.createSocket('udp4');socket.bind(0,'127.0.0.1');await once(socket,'listening');t.after(()=>socket.close());
  await assert.rejects(()=>checkPorts(DEFAULT_CONFIG,{tcpPorts:[],udpPorts:[socket.address().port]}),{code:'GATEWAY_PORT_CONFLICT'});
});
test('gateway owns its process, exposes actual route readiness and stops its child',async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),'splat-gateway-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let launched=0,killed=0,child;
  const gateway=new MediaGateway({executable:process.execPath,configFile:path.join(directory,'gateway.yml'),probe:async()=>{},launch:(_exe,args,options)=>{
    launched++;assert.equal(options.windowsHide,true);assert.equal(args[0],gateway.configFile);
    child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',0));};return child;
  },request:async()=>({ok:true,json:async()=>({items:[{name:'cam-1',ready:true,bytesReceived:123}]})})});
  const status=await gateway.start(DEFAULT_CONFIG);assert.equal(status.running,true);assert.equal(status.routes[0].ready,true);assert.equal(status.routes[1].ready,false);
  assert.match(await readFile(gateway.configFile,'utf8'),/m=video 5004 RTP\/AVP 96/);
  await gateway.start(DEFAULT_CONFIG);assert.equal(launched,1);
  const changed=await gateway.state({...DEFAULT_CONFIG,phones:DEFAULT_CONFIG.phones.slice(1)});assert.equal(changed.running,false);assert.equal(changed.error.code,'GATEWAY_CONFIG_CHANGED');
  await gateway.stop();assert.equal(killed,1);assert.equal((await gateway.state(DEFAULT_CONFIG)).running,false);
});
test('missing runtime reports a useful error and never spawns a process',async()=>{
  const gateway=new MediaGateway({executable:path.join(os.tmpdir(),'missing-mediamtx-'+crypto.randomUUID()),launch:()=>{throw Error('must not spawn');}});
  await assert.rejects(()=>gateway.start(DEFAULT_CONFIG),{code:'GATEWAY_RUNTIME_MISSING'});assert.equal(gateway.child,null);
});
