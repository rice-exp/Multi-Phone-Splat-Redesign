import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {open, rename, rm} from 'node:fs/promises';

// CameraScope uploads a requested phone file with a bearer token. Some Android
// builds split it across several ordered POSTs, each with its own HTTP reply.
export class CaptureUpload {
  constructor(host, port, command, timeoutMs = 90000) {
    this.host = host;
    this.command = command;
    this.port = Number(port);
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.server = http.createServer((req, res) => this.receive(req, res));
    this.server.requestTimeout = timeoutMs;
  }

  async start() {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, resolve);
    });
    this.port = this.server.address().port;
  }

  async receive(req, res) {
    const item = this.pending.get(req.url);
    if (req.method !== 'POST' || !item || req.headers.authorization !== 'Bearer ' + item.token) {
      req.resume(); res.writeHead(403).end(); return;
    }
    if (item.request || item.done) { req.resume(); res.writeHead(409).end(); return; }
    item.request = req;
    try {
      const h = req.headers;
      const chunkId = h['x-camerascope-upload-id'];
      const size = Number(h['content-length']);
      const total = chunkId ? Number(h['x-camerascope-total-bytes']) : size;
      const count = chunkId ? Number(h['x-camerascope-total-chunks']) : 1;
      const index = chunkId ? Number(h['x-camerascope-chunk-index']) : 0;
      const offset = chunkId ? Number(h['x-camerascope-chunk-offset']) : 0;
      if (h['x-camerascope-filename'] !== item.filename ||
          ![size, total, count, index, offset].every(Number.isSafeInteger) ||
          size <= 0 || total > 128 * 1024 * 1024 || index !== item.next || offset !== item.bytes ||
          count <= index || offset + size > total || (index + 1 === count) !== (offset + size === total) ||
          (index && (chunkId !== item.chunkId || total !== item.total || count !== item.count))) {
        throw Error('CameraScope sent an unexpected filename, size or chunk sequence.');
      }
      Object.assign(item, {chunkId, total, count});
      let received = 0;
      for await (const bytes of req) {
        received += bytes.length;
        if (received > size) throw Error('Upload exceeded the reported file size.');
        await item.handle.writeFile(bytes);
      }
      if (received !== size) throw Error('Incomplete frame upload.');
      item.bytes += received;
      item.next++;
      item.done = item.bytes === total;
      res.writeHead(item.done ? 200 : 202, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true, complete:item.done, sizeBytes:item.bytes}));
      if (item.done) item.resolve(item.bytes);
    } catch (error) {
      item.done = true;
      res.writeHead(400).end();
      item.reject(error);
    } finally {
      item.request = null;
      item.drained?.();
    }
  }

  async transfer(ip, file, destination) {
    const id = randomUUID(), token = randomUUID(), route = '/upload/' + id;
    const partial = destination + '.' + id + '.part';
    const handle = await open(partial, 'wx+');
    const item = {handle, token, filename:path.posix.basename(file), bytes:0, next:0};
    const upload = new Promise((resolve, reject) => Object.assign(item, {resolve, reject}));
    this.pending.set(route, item);
    const timer = setTimeout(() => item.reject(Error('Upload timed out. Check the laptop IP and inbound TCP port ' + this.port + '.')), this.timeoutMs);
    try {
      const payload = {cmd:'uploadFile', requestId:id, file, uploadUrl:'http://' + this.host + ':' + this.port + route, uploadToken:token};
      const acknowledgement = this.command(ip, payload, {timeoutMs:8000}).then(ack => {
        if (ack?.ok !== true || ack.file !== file || !Number.isSafeInteger(ack.sizeBytes) || ack.sizeBytes < 1)
          throw Error('CameraScope did not acknowledge the requested JPEG.');
        return ack.sizeBytes;
      });
      const [expected, bytes] = await Promise.all([acknowledgement, upload]);
      if (expected !== bytes) throw Error('The uploaded size differs from the phone’s report.');
      const signature = Buffer.alloc(2);
      await handle.read(signature, 0, 2, 0);
      if (signature.readUInt16BE() !== 0xffd8) throw Error('The transferred frame is not a JPEG.');
      await handle.close();
      await rename(partial, destination);
    } finally {
      clearTimeout(timer);
      this.pending.delete(route);
      if (item.request) {
        const drained = new Promise(resolve => { item.drained = resolve; });
        item.request.destroy();
        await drained;
      }
      await handle.close();
      await rm(partial, {force:true});
    }
  }

  async close() {
    if (!this.server.listening) return;
    await new Promise(resolve => {
      this.server.close(resolve);
      this.server.closeAllConnections();
    });
  }
}
