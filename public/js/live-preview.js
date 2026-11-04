// Receive-only WHEP for the existing private-LAN MediaMTX gateway.
// ICE is gathered before POST; no camera/microphone permission or public STUN.
export function previewEndpoint(phone, status, pageOrigin) {
  if (!/^cam-\d+$/.test(phone.route)) throw new Error('Invalid preview route.');
  const url = new URL(pageOrigin);
  if (status.previewHost && !['localhost', '127.0.0.1'].includes(status.previewHost)) url.hostname = status.previewHost;
  url.port = '8889'; url.pathname = `/${phone.route}/whep`; url.search = ''; url.hash = '';
  return url.href;
}

export function sessionEndpoint(location, endpoint) {
  if (!location) throw new Error('Gateway returned no WHEP session.');
  const url = new URL(location, endpoint), base = new URL(endpoint);
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`) || url.username || url.password || url.search || url.hash) {
    throw new Error('Gateway returned an invalid WHEP session.');
  }
  return url.href;
}

export class LivePreview {
  constructor(video, endpoint, onStatus, {request = (...args) => globalThis.fetch(...args), Peer = globalThis.RTCPeerConnection, now = Date.now} = {}) {
    this.video = video; this.endpoint = endpoint; this.onStatus = onStatus;
    this.request = request; this.Peer = Peer; this.now = now;
    this.closed = false; this.attempt = 0; this.run = null;
    this.connect();
  }
  async connect() {
    if (this.closed) return;
    if (!this.Peer) { this.onStatus('WebRTC unavailable in this browser', 'warning'); return; }
    const run = {controller:new AbortController(), session:null, peer:null, frame:null, timer:null, monitor:null};
    this.run = run;
    const active = () => !this.closed && this.run === run;
    this.onStatus(this.attempt ? 'Reconnecting…' : 'Connecting live view…', 'neutral');
    try {
      const peer = run.peer = new this.Peer({iceServers:[]});
      peer.addTransceiver('video', {direction:'recvonly'});
      peer.ontrack = event => {
        if (!active()) return;
        this.video.srcObject = event.streams[0] || new MediaStream([event.track]);
        this.video.play().catch(() => { if (active()) this.onStatus('Playback paused · Retry to play', 'warning'); });
      };
      peer.onconnectionstatechange = () => {
        if (active() && ['failed','closed'].includes(peer.connectionState)) this.fail(run, 'Video connection lost');
      };
      await peer.setLocalDescription(await peer.createOffer());
      if (!active()) return;
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', check);
          run.controller.signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve();
        };
        const check = () => { if (peer.iceGatheringState === 'complete') finish(); };
        const abort = () => finish(new Error('Preview closed'));
        const timer = setTimeout(() => finish(new Error('Browser ICE gathering timed out')), 6000);
        peer.addEventListener('icegatheringstatechange', check);
        run.controller.signal.addEventListener('abort', abort, {once:true}); check();
      });
      if (!active()) return;
      run.timer = setTimeout(() => run.controller.abort(), 10000);
      const response = await this.request(this.endpoint, {method:'POST', headers:{'Content-Type':'application/sdp'},
        body:peer.localDescription.sdp, signal:run.controller.signal, credentials:'omit', redirect:'error'});
      if (response.status !== 201) throw new Error(`Gateway HTTP ${response.status}`);
      run.session = sessionEndpoint(response.headers.get('Location'), this.endpoint);
      if (!active()) { this.release(run); return; }
      const sdp = await response.text();
      await peer.setRemoteDescription({type:'answer', sdp});
      if (!active()) return;
      clearTimeout(run.timer);
      run.lastFrame = this.now(); run.displayed = false; run.mediaTime = -1;
      const frame = (_time, metadata) => {
        if (!active()) return;
        if (metadata.mediaTime !== run.mediaTime) {
          run.mediaTime = metadata.mediaTime; run.lastFrame = this.now(); run.displayed = true; this.attempt = 0;
        }
        run.frame = this.video.requestVideoFrameCallback(frame);
      };
      if (this.video.requestVideoFrameCallback) run.frame = this.video.requestVideoFrameCallback(frame);
      run.monitor = setInterval(() => {
        if (!active()) return;
        if (!this.video.requestVideoFrameCallback && !this.video.paused && this.video.readyState >= 2 && this.video.currentTime !== run.mediaTime) {
          run.mediaTime = this.video.currentTime; run.lastFrame = this.now(); run.displayed = true; this.attempt = 0;
        }
        const age = this.now() - run.lastFrame;
        if (age > 12000) { this.fail(run, 'No video frames · Check Wi-Fi and gateway'); return; }
        this.onStatus(!run.displayed ? 'Waiting for video frames…' : age > 5000 ? 'Video stalled · Reconnecting soon' :
          `Live · ${this.video.videoWidth} × ${this.video.videoHeight}`, run.displayed && age <= 5000 ? 'success' : 'warning');
      }, 1000);
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Video gateway timed out' : error instanceof TypeError ? 'Video gateway unreachable · Check ports 8889 / 8189' : error.message;
      if (active()) this.fail(run, message);
    }
  }
  release(run) {
    clearTimeout(run.timer); clearInterval(run.monitor); run.controller.abort();
    if (run.frame != null) this.video.cancelVideoFrameCallback?.(run.frame);
    if (run.peer) { run.peer.ontrack = null; run.peer.onconnectionstatechange = null; run.peer.close(); }
    if (run.session) {
      const session = run.session; run.session = null;
      this.request(session, {method:'DELETE', credentials:'omit', redirect:'error', keepalive:true, signal:AbortSignal.timeout(3000)}).catch(() => {});
    }
  }
  fail(run, message) {
    if (this.closed || this.run !== run) return;
    this.run = null; this.release(run); this.video.srcObject = null;
    this.onStatus(`${message} · Retrying`, 'warning');
    const delay = Math.min(10000, 1000 * 2 ** Math.min(this.attempt++, 4));
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }
  close() {
    this.closed = true; clearTimeout(this.retryTimer);
    const run = this.run; this.run = null;
    if (run) this.release(run);
    this.video.srcObject = null;
  }
}
