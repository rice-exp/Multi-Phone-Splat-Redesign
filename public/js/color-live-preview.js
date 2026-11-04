import {correctedPixels} from './color-calibration.js';

// Always reads the original video. The corrected canvas is display-only, so a
// subsequent chart capture can never fit an already-corrected frame.
export class ColorLivePreview {
  constructor(video,{createCanvas=()=>document.createElement('canvas'),onError=()=>{},onFrame=()=>{}}={}) {
    this.video=video;this.canvas=createCanvas();this.canvas.className='color-corrected-live';
    this.canvas.setAttribute('aria-label','Corrected live camera preview');this.canvas.hidden=true;
    this.onError=onError;this.onFrame=onFrame;this.closed=false;this.last=-Infinity;this.mediaTime=-1;
  }
  setProfile(profile) {
    this.profile=profile;
    if(!profile){this.cancel();this.canvas.hidden=true;this.video.style.opacity='';return;}
    if(!this.pending&&!this.closed)this.schedule();
  }
  schedule() {
    if(this.closed||!this.profile)return;
    this.pending=true;
    const frame=(time,meta)=>{
      this.pending=false;if(this.closed||!this.profile)return;
      const mediaTime=meta?.mediaTime??this.video.currentTime;
      if(time-this.last>=160&&mediaTime!==this.mediaTime&&!this.video.paused&&this.video.readyState>=2&&this.video.videoWidth) {
        try {
          const scale=Math.min(1,480/this.video.videoWidth,360/this.video.videoHeight);
          this.canvas.width=Math.round(this.video.videoWidth*scale);this.canvas.height=Math.round(this.video.videoHeight*scale);
          const context=this.canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
          context.drawImage(this.video,0,0,this.canvas.width,this.canvas.height);
          const pixels=context.getImageData(0,0,this.canvas.width,this.canvas.height);
          pixels.data.set(correctedPixels(pixels,this.profile.fit.matrix,this.profile.adjustments,this.profile.fit.offset));context.putImageData(pixels,0,0);
          this.canvas.hidden=false;this.video.style.opacity='0';this.last=time;this.mediaTime=mediaTime;this.onFrame();
        }catch(error){this.setProfile(null);this.onError(error);return;}
      }
      this.schedule();
    };
    this.useVideo=!!this.video.requestVideoFrameCallback;
    this.frame=this.useVideo?this.video.requestVideoFrameCallback(frame):requestAnimationFrame(frame);
  }
  cancel(){if(this.pending){if(this.useVideo)this.video.cancelVideoFrameCallback(this.frame);else cancelAnimationFrame(this.frame);}this.pending=false;}
  close(){this.closed=true;this.cancel();this.canvas.remove();this.video.style.opacity='';}
}
