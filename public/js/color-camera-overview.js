import {esc,icon} from './icons.js';
import {LivePreview,previewEndpoint} from './live-preview.js';
import {availableColorCameras} from './color-camera.js';
import {ColorLivePreview} from './color-live-preview.js';
import {cameraColorView} from './color-profiles.js';

// Keep every camera in one strip, decoding only the previews in view.
export class ColorCameraOverview {
  constructor(select) {
    this.select=select;this.entries=new Map();this.element=document.createElement('div');
    this.element.className='color-camera-overview';
    this.element.innerHTML='<div class="color-camera-grid" role="region" aria-label="Camera previews"></div><div class="color-camera-navigation" hidden><span>Scroll to see more cameras</span><button type="button" class="button secondary small" data-camera-scroll="-1" aria-label="Previous cameras">←</button><button type="button" class="button secondary small" data-camera-scroll="1" aria-label="Next cameras">→</button></div><p class="cal-caption color-camera-empty"></p>';
    this.grid=this.element.querySelector('.color-camera-grid');
    this.navigation=this.element.querySelector('.color-camera-navigation');
    this.element.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.cameraSelect)this.select(button.dataset.cameraSelect);
      if(button.dataset.cameraScroll)this.grid.scrollBy({left:Number(button.dataset.cameraScroll)*this.grid.clientWidth*.85,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    });
    this.grid.addEventListener('scroll',()=>this.updateNavigation(),{passive:true});
    this.resize=new ResizeObserver(()=>this.updateNavigation());this.resize.observe(this.grid);
    this.visibility=new IntersectionObserver(changes=>{
      for(const change of changes){
        const entry=this.entries.get(change.target.dataset.cameraId);
        if(entry){entry.visible=change.isIntersecting;this.updatePreview(entry);}
      }
    },{root:this.grid,threshold:0.01});
  }
  rememberScroll(){if(this.grid.isConnected)this.scrollLeft=this.grid.scrollLeft;}
  mount(host){
    if(!host)return;
    host.replaceChildren(this.element);
    this.grid.scrollLeft=this.scrollLeft||0;
    this.updateNavigation();
  }
  updateNavigation(){
    if(!this.grid.isConnected)return;
    this.scrollLeft=this.grid.scrollLeft;
    const max=this.grid.scrollWidth-this.grid.clientWidth,overflows=max>2;
    this.navigation.hidden=!overflows;
    this.grid.tabIndex=overflows?0:-1;
    this.navigation.querySelector('[data-camera-scroll="-1"]').disabled=this.scrollLeft<=2;
    this.navigation.querySelector('[data-camera-scroll="1"]').disabled=this.scrollLeft>=max-2;
  }
  stopPreview(entry){
    entry.color?.close();entry.player?.close();entry.color=null;entry.player=null;entry.video=null;entry.live=false;
  }
  updatePreview(entry){
    const {phone,path}=entry,host=entry.card.querySelector('.color-tile-video'),stream=entry.card.querySelector('.color-tile-stream');
    if(path&&entry.visible){
      if(!entry.player){
        const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;
        video.setAttribute('aria-label',`Color overview: ${phone.name}`);
        entry.video=video;entry.failed=false;
        entry.color=new ColorLivePreview(video,{onError:()=>{entry.failed=true;entry.card.querySelector('.color-tile-profile').textContent='Correction unavailable · original preview';}});
        host.replaceChildren(video,entry.color.canvas);
        entry.player=new LivePreview(video,path,(message,tone)=>{stream.textContent=message;entry.live=tone==='success';entry.color?.setProfile(entry.live&&!entry.failed?entry.view?.render:null);});
      }
      entry.color?.setProfile(entry.live&&!entry.failed?entry.view?.render:null);
    }else{
      this.stopPreview(entry);
      host.innerHTML=`<div class="color-live-empty">${icon('camera',24)}<span>${path?'Preview loads when in view':'Preview unavailable'}</span></div>`;
      stream.textContent=path?'':phone.responding?'Start preview in Prepare rig':'Camera offline';
    }
  }
  update(context,selected='',busy=false) {
    const {status}=context,all=status?.phones||[],available=new Set(availableColorCameras(status).map(p=>p.id)),ids=new Set(all.map(p=>p.id));
    for(const [id,entry] of this.entries)if(!ids.has(id)){
      this.visibility.unobserve(entry.card);this.stopPreview(entry);entry.card.remove();this.entries.delete(id);
    }
    const empty=this.element.querySelector('.color-camera-empty');empty.hidden=!!all.length;
    empty.textContent=all.length?'':status?.connected?'No phones configured. Add phone addresses in Prepare rig.':'Camera inventory unavailable. Refresh cameras to check the connection.';
    for(const [index,phone] of all.entries()){
      let entry=this.entries.get(phone.id);
      if(!entry){
        const card=document.createElement('article');card.className='color-camera-tile';card.dataset.cameraId=phone.id;
        card.innerHTML=`<div class="color-tile-video"></div><div class="color-tile-info"><strong></strong><small></small><span class="color-tile-stream" role="status"></span><span class="color-tile-profile"></span><button type="button" class="button secondary small" data-camera-select="${esc(phone.id)}">Choose as leader</button></div>`;
        entry={card,visible:false};this.entries.set(phone.id,entry);
        this.grid.append(card);this.visibility.observe(card);
      }
      if(this.grid.children[index]!==entry.card)this.grid.insertBefore(entry.card,this.grid.children[index]);
      const path=available.has(phone.id)?previewEndpoint(phone,status,location.origin):'';
      if(entry.path!==path||entry.phone?.ip!==phone.ip)this.stopPreview(entry);
      entry.phone=phone;entry.path=path;entry.view=cameraColorView(phone,context);
      entry.card.classList.toggle('selected',selected===phone.id);
      const button=entry.card.querySelector('button');button.disabled=busy||!phone.responding;
      button.textContent=selected===phone.id?'Selected leader':'Choose as leader';button.setAttribute('aria-pressed',String(selected===phone.id));
      entry.card.querySelector('strong').textContent=phone.name;entry.card.querySelector('small').textContent=phone.ip;
      entry.card.querySelector('.color-tile-profile').textContent=entry.failed?'Correction unavailable · original preview':entry.view.label;
      this.updatePreview(entry);
    }
    this.updateNavigation();
  }
  close(){
    this.resize.disconnect();this.visibility.disconnect();
    for(const entry of this.entries.values())this.stopPreview(entry);
    this.entries.clear();this.element.replaceChildren();
  }
}
