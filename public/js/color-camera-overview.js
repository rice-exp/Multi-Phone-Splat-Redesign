import {esc,icon} from './icons.js';
import {LivePreview,previewEndpoint} from './live-preview.js';
import {availableColorCameras} from './color-camera.js';
import {ColorLivePreview} from './color-live-preview.js';
import {colorSourceKey,sharedPreviewStatus,rigColorSource} from './color-profiles.js';

// Four streams at a time keeps the overview usable on a laptop or phone.
export class ColorCameraOverview {
  constructor(select) {
    this.select=select;this.page=0;this.entries=new Map();this.element=document.createElement('div');
    this.element.className='color-camera-overview';
    this.element.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||button.disabled)return;
      if(button.dataset.cameraSelect)this.select(button.dataset.cameraSelect);
      if(button.dataset.cameraPage){this.page+=Number(button.dataset.cameraPage);this.update(this.status,this.profile,this.selected,this.busy);}
    });
  }
  mount(host){if(host)host.replaceChildren(this.element);}
  update(status,profile=null,selected='',busy=false) {
    this.status=status;this.profile=profile;this.selected=selected;this.busy=busy;
    const all=status?.phones||[],available=availableColorCameras(status);
    this.page=Math.min(this.page,Math.max(0,Math.ceil(all.length/4)-1));
    const visible=all.slice(this.page*4,this.page*4+4),ids=new Set(visible.map(p=>p.id));
    for(const [id,entry] of this.entries)if(!ids.has(id)){entry.color?.close();entry.player?.close();entry.card.remove();this.entries.delete(id);}
    if(!this.grid){this.element.innerHTML='<div class="color-camera-grid"></div><div class="color-camera-pagination"></div>';this.grid=this.element.querySelector('.color-camera-grid');}
    this.element.querySelector('.color-camera-pagination').innerHTML=all.length?`<span>${all.length} cameras · showing ${this.page*4+1}–${Math.min(all.length,this.page*4+4)}</span>${all.length>4?`<button class="button secondary small" data-camera-page="-1" ${this.page===0?'disabled':''}>Previous</button><button class="button secondary small" data-camera-page="1" ${(this.page+1)*4>=all.length?'disabled':''}>Next</button>`:''}`:'<p class="cal-caption">Refresh cameras to load the rig. No cameras are invented when the rig is offline.</p>';
    for(const phone of visible) {
      let entry=this.entries.get(phone.id);
      if(!entry){
        const card=document.createElement('article');card.className='color-camera-tile';
        card.innerHTML=`<div class="color-tile-video"></div><div class="color-tile-info"><strong>${esc(phone.name)}</strong><small>${esc(phone.ip)}</small><span class="color-tile-stream" role="status"></span><span class="color-tile-profile"></span><button class="button secondary small" data-camera-select="${esc(phone.id)}">Choose as leader</button></div>`;
        entry={card};this.entries.set(phone.id,entry);this.grid.append(card);
      }
      const online=available.some(p=>p.id===phone.id),path=online?previewEndpoint(phone,status,location.origin):'';
      const host=entry.card.querySelector('.color-tile-video'),stream=entry.card.querySelector('.color-tile-stream');
      if(entry.path!==path){
        entry.color?.close();entry.player?.close();entry.color=null;entry.player=null;entry.video=null;entry.path=path;entry.live=false;
        if(path){
          const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.setAttribute('aria-label',`Color overview: ${phone.name}`);
          entry.video=video;entry.color=new ColorLivePreview(video,{onError:()=>{entry.failed=true;entry.card.querySelector('.color-tile-profile').textContent='Correction unavailable · original preview';}});
          host.replaceChildren(video,entry.color.canvas);entry.failed=false;
          entry.player=new LivePreview(video,path,(message,tone)=>{stream.textContent=message;entry.live=tone==='success';if(!entry.live)entry.color.setProfile(null);});
        }else{host.innerHTML=`<div class="color-live-empty">${icon('camera',24)}<span>Preview unavailable</span></div>`;stream.textContent=phone.responding?'Start preview in Prepare rig':'Camera offline';}
      }
      entry.card.classList.toggle('selected',selected===phone.id);
      const button=entry.card.querySelector('button');button.disabled=busy||!online;button.textContent=selected===phone.id?'Selected leader':'Choose as leader';
      const isLeader=profile&&colorSourceKey(rigColorSource(phone,status))===colorSourceKey(profile.source.capture);
      const check=sharedPreviewStatus(profile,status);
      entry.color?.setProfile(online&&entry.live&&check.usable&&!entry.failed?profile:null);
      entry.card.querySelector('strong').textContent=phone.name;
      entry.card.querySelector('.color-tile-profile').textContent=entry.failed?'Correction unavailable · original preview':!online&&profile?'Shared preset saved · camera offline':profile?check.usable?(entry.live?`${isLeader?'Preset leader':'Follower'} · shared correction`:'Shared preset · waiting for video'):check.label:'Original preview · no shared preset';
    }
  }
  close(){for(const entry of this.entries.values()){entry.color?.close();entry.player?.close();}this.entries.clear();this.element.replaceChildren();this.grid=null;}
}
