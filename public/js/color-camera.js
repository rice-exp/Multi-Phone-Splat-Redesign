import {LivePreview,previewEndpoint} from './live-preview.js';
import {rigColorSource} from './color-profiles.js';

export function availableColorCameras(status,now=Date.now()) {
  if(!status?.connected||!Number.isFinite(status.checkedAt)||now-status.checkedAt>20000||status.checkedAt>now+1000)return [];
  return (status.phones||[]).filter(p=>p.responding&&p.previewReady&&/^cam-\d+$/.test(p.route));
}

// Wait for a NEW decoded frame after the click. A previously displayed/frozen
// frame must not silently become a new reference photo.
export function nextVideoFrame(video,{signal,timeoutMs=4000}={}) {
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(new Error('Camera capture cancelled.'));
    let callback,timer,poll,done=false;const initialTime=video.currentTime;
    const finish=error=>{
      if(done)return;done=true;clearTimeout(timer);clearInterval(poll);
      if(callback!=null)video.cancelVideoFrameCallback?.(callback);
      signal?.removeEventListener('abort',abort);error?reject(error):resolve();
    };
    const abort=()=>finish(new Error('Camera capture cancelled.'));
    const check=()=>{if(!video.paused&&!video.ended&&video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0)finish();};
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>finish(new Error('No fresh camera frame arrived. Reconnect the camera and try again.')),timeoutMs);
    if(video.requestVideoFrameCallback)callback=video.requestVideoFrameCallback(check);
    else poll=setInterval(()=>{if(video.currentTime!==initialTime)check();},50);
  });
}

export class ColorCamera {
  constructor(onStatus,{mediaDevices=globalThis.navigator?.mediaDevices,createVideo=()=>document.createElement('video'),createCanvas=()=>document.createElement('canvas'),Player=LivePreview}={}) {
    this.onStatus=onStatus;this.mediaDevices=mediaDevices;this.createVideo=createVideo;this.createCanvas=createCanvas;this.Player=Player;this.token=0;this.ready=false;this.video=null;this.source=null;
  }
  status(message,ready=false){this.ready=ready;this.onStatus(message,ready);}
  prepare(){this.close();this.controller=new AbortController();this.video=this.createVideo();this.video.autoplay=true;this.video.muted=true;this.video.playsInline=true;this.video.setAttribute?.('aria-label','Live color reference camera');return this.token;}
  async connectDevice() {
    const token=this.prepare();this.status('Waiting for camera permission…');
    try {
      if(!this.mediaDevices?.getUserMedia)throw new Error('Camera access requires localhost or HTTPS and a browser that supports camera access.');
      const stream=await this.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
      if(token!==this.token){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;const track=stream.getVideoTracks()[0];
      this.source={kind:'device-video',cameraName:track.label||'This device camera',settings:track.getSettings?.()||{}};
      track.addEventListener?.('ended',()=>{if(token===this.token)this.status('Camera disconnected. Reconnect to capture.');});
      this.video.srcObject=stream;await this.video.play();
      if(token===this.token)this.status('Camera connected · frame capture available',true);
    }catch(error) {
      if(token!==this.token)return;
      this.close();
      throw new Error(error.name==='NotAllowedError'?'Camera access was denied. Allow camera access in the browser, or use a rig stream/upload.':error.name==='NotFoundError'?'No camera is connected to this device. Use a rig camera or upload a photo.':error.message);
    }
  }
  connectRig(phone,status,origin) {
    if(!availableColorCameras(status).some(p=>p.id===phone.id))throw new Error('That rig preview is unavailable or stale. Refresh cameras and start its preview in Prepare rig.');
    const token=this.prepare();
    this.source=rigColorSource(phone,status);
    this.status('Connecting to the selected rig preview…');
    this.player=new this.Player(this.video,previewEndpoint(phone,status,origin),(message,tone)=>{if(token===this.token)this.status(message,tone==='success');});
  }
  async capture() {
    if(!this.video||!this.ready||!this.source)throw new Error('Connect a camera and wait for live frames before capturing.');
    this.refreshSettings();
    const token=this.token,video=this.video,source=structuredClone(this.source);
    await nextVideoFrame(video,{signal:this.controller.signal});
    if(token!==this.token)throw new Error('The camera changed before capture completed.');
    const scale=Math.min(1,1000/video.videoWidth,750/video.videoHeight),canvas=this.createCanvas();
    canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
    const context=canvas.getContext('2d',{colorSpace:'srgb'});context.drawImage(video,0,0,canvas.width,canvas.height);
    return {image:context.getImageData(0,0,canvas.width,canvas.height),source:{...source,capturedAt:new Date().toISOString(),videoWidth:video.videoWidth,videoHeight:video.videoHeight}};
  }
  refreshSettings(){if(this.source?.kind==='device-video'){const track=this.stream?.getVideoTracks()[0];if(track?.getSettings)this.source.settings=track.getSettings();}}
  close() {
    this.token++;this.controller?.abort();this.player?.close();this.player=null;
    this.stream?.getTracks().forEach(track=>track.stop());this.stream=null;
    if(this.video){this.video.pause?.();this.video.srcObject=null;}this.video=null;this.source=null;
    this.status('Camera disconnected');
  }
}
