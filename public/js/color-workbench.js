import {esc,icon} from './icons.js';
import {CLASSIC24,SPYDER24,IDENTITY,MIN_USABLE_PATCHES,defaultAdjustments,validateReference,chartProjection,sampleChart,patchQualitySummary,fitColor,correctedPixels,clamp} from './color-calibration.js';
import {ColorCamera,availableColorCameras} from './color-camera.js';
import {LEADER_COLOR_STORAGE,rigColorSource,colorSourceKey,readLeaderPresets,saveLeaderPreset,selectLeaderPreset,removeLeaderPreset,sharedPreviewStatus} from './color-profiles.js';
import {ColorLivePreview} from './color-live-preview.js';
import {ColorCameraOverview} from './color-camera-overview.js';

const STORAGE='splat-color-profiles-v1';
const cornerNames={
  [CLASSIC24.id]:['top-left (dark skin)','top-right (bluish green)','bottom-right (black)','bottom-left (white)'],
  [SPYDER24.id]:['top-left (white)','top-right (aqua)','bottom-right (dark skin)','bottom-left (black)']
};
const w={chart:CLASSIC24,image:null,source:'',sample:false,corners:[],fit:null,samples:[],adjust:defaultAdjustments(),split:50,camera:'',name:'',message:'',profiles:[],loaded:false,loading:false,cursor:[0.5,0.5],input:'rig',rig:null,rigId:'',rigMessage:'Refresh cameras to find running previews.',captureMeta:null,alignment:'auto',detection:null};
let previewPixels=null,animation,activeRoot=null,worker=null,rejectDetection=null,cameraMessage='Camera disconnected',viewGeneration=0,connecting=false;
let leaderState={activeId:null,presets:[]},overview=null,liveColor=null,pollTimer=null,pollBusy=false,showOriginal=false,liveError='';
w.editingPresetId=null;
w.rigId=new URLSearchParams(location.search).get('colorCamera')||'';
const camera=new ColorCamera((message,ready)=>{
  cameraMessage=message;
  const status=activeRoot?.querySelector('#color-camera-status');if(status)status.textContent=message;
  const capture=activeRoot?.querySelector('[data-color-action="capture"]');if(capture)capture.disabled=w.loading||!ready;
  if(!ready)liveColor?.setProfile(null);
  queueMicrotask(()=>updateLiveColor());
});
const button=(label,action,disabled=false,primary=false)=>`<button class="button ${primary?'primary':'secondary'}" data-color-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
const upload=(label,id,accept,disabled=false)=>`<label class="color-upload">${label}<input id="${id}" type="file" accept="${accept}" ${disabled?'disabled':''}></label>`;
const number=v=>v.toFixed(1);

export function colorScreen() {
  return '<div id="color-workbench"></div>';
}

function connectedSource() {
  camera.refreshSettings();
  return camera.source?{...camera.source,videoWidth:camera.video?.videoWidth,videoHeight:camera.video?.videoHeight}:null;
}
const activeLeaderPreset=()=>leaderState.presets.find(p=>p.id===leaderState.activeId)||null;
function refreshBindings() {try{leaderState=readLeaderPresets(localStorage);}catch{leaderState={activeId:null,presets:[]};w.message='Saved leader presets could not be read. Export your work before clearing browser storage.';}}
function updateLiveColor() {
  if(!activeRoot)return;
  if(liveColor?.video!==camera.video){liveColor?.close();liveColor=null;liveError='';if(camera.video)liveColor=new ColorLivePreview(camera.video,{onError:()=>{liveError='Correction could not be displayed. Original preview is shown.';updateLiveColor();}});}
  const host=activeRoot.querySelector('#color-live-host');
  if(host&&camera.video){if(camera.video.parentNode!==host)host.replaceChildren(camera.video);if(liveColor.canvas.parentNode!==host)host.append(liveColor.canvas);}
  const source=connectedSource(),profile=activeLeaderPreset(),check=sharedPreviewStatus(profile,w.rig);
  const selector=activeRoot.querySelector('#color-rig-camera');
  if(selector){const phones=availableColorCameras(w.rig),options=(phones.length&&!w.rigId?'<option value="">Choose a leader camera</option>':'')+phones.map(p=>`<option value="${esc(p.id)}" ${p.id===w.rigId?'selected':''}>${esc(p.name)} · ${esc(p.ip)}</option>`).join('')||'<option>No live rig previews available</option>';if(selector.innerHTML!==options)selector.innerHTML=options;selector.disabled=w.loading||!phones.length;const connect=activeRoot.querySelector('[data-color-action="connect-rig"]');if(connect)connect.disabled=w.loading||!phones.some(p=>p.id===w.rigId);}
  const usesShared=source?.kind==='rig-video'&&check.usable;
  liveColor?.setProfile(camera.ready&&usesShared&&!showOriginal&&!liveError?profile:null);
  const label=activeRoot.querySelector('#color-applied-status');
  if(label)label.textContent=liveError||(!camera.source?'Choose the leader from the camera previews above.':!camera.ready?'Camera not live · correction paused':usesShared?`${showOriginal?'Original view · correction bypassed':'Shared correction preview'} · ${profile.name}`:check.label);
  const toggle=activeRoot.querySelector('[data-color-action="toggle-original"]');if(toggle){toggle.disabled=!usesShared||!camera.ready;toggle.textContent=showOriginal?'Show corrected':'Show original';}
  const remove=activeRoot.querySelector('[data-color-action="disable-shared"]');if(remove)remove.disabled=!profile;
  const apply=activeRoot.querySelector('[data-color-action="apply"]');if(apply)apply.disabled=w.loading||!w.fit||w.sample||w.captureMeta?.kind!=='rig-video'||(!w.editingPresetId&&(!camera.ready||colorSourceKey(w.captureMeta)!==colorSourceKey(source)));
  const presetStatus=activeRoot.querySelector('#color-shared-status');if(presetStatus)presetStatus.textContent=check.label;
  overview?.update(w.rig,profile,w.rigId,w.loading);
}

async function pollCameras() {
  if(!activeRoot||pollBusy||w.loading)return;
  pollBusy=true;const generation=viewGeneration;
  try {
    if(w.input==='rig'||w.rig) {
      const status=await rigStatus();if(generation!==viewGeneration)return;
      if(camera.source?.kind==='rig-video'){
        const source=camera.source,phone=availableColorCameras(status).find(p=>colorSourceKey(rigColorSource(p,status))===colorSourceKey(source));
        if(phone)camera.source=rigColorSource(phone,status);else camera.close();
      }
      const statusText=activeRoot.querySelector('#color-rig-status');if(statusText)statusText.textContent=w.rigMessage;
    }
    refreshBindings();updateLiveColor();
  }catch{if(generation===viewGeneration){w.rig=null;if(camera.source?.kind==='rig-video')camera.close();updateLiveColor();}}
  finally{pollBusy=false;}
}

function profileSnapshot() {
  if(!w.fit)throw new Error('Calibrate a reference frame first.');
  if(!w.camera.trim()||!w.name.trim())throw new Error('Enter a camera / lens and profile name before saving.');
  return {version:1,id:crypto.randomUUID(),name:w.name.trim(),camera:w.camera.trim(),createdAt:new Date().toISOString(),sample:w.sample,pipeline:'decoded-sRGB-image',appliedToHardware:false,target:{kind:'chart-reference',name:w.chart.name},chart:structuredClone(w.chart),source:{filename:w.source,width:w.image.width,height:w.image.height,corners:structuredClone(w.corners),capture:w.captureMeta?structuredClone(w.captureMeta):null,detection:w.detection?structuredClone(w.detection):null},fit:structuredClone(w.fit),adjustments:{...w.adjust}};
}
async function applyCurrentProfile({newPreset=false}={}) {
  const generation=viewGeneration;
  const saved=leaderState.presets.find(p=>p.id===w.editingPresetId),source=w.captureMeta;
  if(w.sample||source?.kind!=='rig-video')throw new Error('Choose a rig camera as leader and capture its chart frame first.');
  if(!saved&&(!camera.ready||colorSourceKey(source)!==colorSourceKey(camera.source)))throw new Error('Reconnect the selected leader before applying a new calibration.');
  const status=await rigStatus();if(generation!==viewGeneration)throw new Error('Camera view changed before applying.');
  const leader=(status.phones||[]).find(p=>p.responding&&colorSourceKey(rigColorSource(p,status))===colorSourceKey(source));
  if(!saved&&!leader)throw new Error('Leader is unavailable. Reconnect before applying a new calibration.');
  const canvas=document.createElement('canvas'),scale=Math.min(1,640/w.image.width,480/w.image.height),original=document.createElement('canvas');
  original.width=w.image.width;original.height=w.image.height;original.getContext('2d').putImageData(w.image,0,0);
  canvas.width=Math.round(w.image.width*scale);canvas.height=Math.round(w.image.height*scale);canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
  const profile={...profileSnapshot(),id:!newPreset&&saved?saved.id:crypto.randomUUID(),samples:structuredClone(w.samples),referenceImage:{dataUrl:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height}};
  leaderState=saveLeaderPreset(localStorage,profile,leader?rigColorSource(leader,status):source);w.editingPresetId=profile.id;showOriginal=false;liveError='';
  w.message=`Saved “${profile.name}” from leader ${profile.camera}. ${sharedPreviewStatus(activeLeaderPreset(),status).usable?'The same correction is applied to every rig preview in this Calibration tab.':'It will apply when the matching rig is available.'} Final capture files and phone settings are unchanged.`;
  return profile;
}

async function loadPreset(id,root) {
  const profile=leaderState.presets.find(p=>p.id===id);if(!profile)throw new Error('That preset is unavailable.');
  const generation=viewGeneration;w.loading=true;redraw(root);
  try {
    const response=await fetch(profile.referenceImage.dataUrl),bitmap=await createImageBitmap(await response.blob());
    try {
      if(generation!==viewGeneration)return;
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const c=canvas.getContext('2d');c.drawImage(bitmap,0,0);
      leaderState=selectLeaderPreset(localStorage,id);camera.close();clearReference();
      w.image=c.getImageData(0,0,canvas.width,canvas.height);w.captureMeta=structuredClone(profile.source.capture);w.camera=profile.camera;w.name=profile.name;w.chart=structuredClone(profile.chart);w.fit=structuredClone(profile.fit);w.adjust={...profile.adjustments};w.corners=structuredClone(profile.source.corners);w.detection=profile.source.detection;w.samples=profile.samples||[];w.source=`Saved leader frame · ${profile.camera}`;w.editingPresetId=id;w.rigId=profile.source.capture.cameraId;w.input='rig';previewPixels=null;
      w.message=`Loaded “${profile.name}”. ${sharedPreviewStatus(profile,w.rig).label}. Adjust the saved frame and apply again, or reconnect the leader to take a new calibration frame.`;
    }finally{bitmap.close();}
  }finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

function sourceControls() {
  const phones=availableColorCameras(w.rig);
  return `<label>Reference source<select id="color-source" ${w.loading?'disabled':''}><option value="rig" ${w.input==='rig'?'selected':''}>Rig camera · wireless preview</option><option value="device" ${w.input==='device'?'selected':''}>This device’s camera</option><option value="photo" ${w.input==='photo'?'selected':''}>Upload a photo</option></select></label>
  ${w.input==='photo'?upload('Open chart photo','color-photo','image/jpeg,image/png,image/webp',w.loading):`
    ${w.input==='rig'?`<label class="color-camera-select">Selected leader<select id="color-rig-camera" ${w.loading||!phones.length?'disabled':''}>${!phones.length?'<option>No live rig previews available</option>':phones.map(p=>`<option value="${esc(p.id)}" ${p.id===w.rigId?'selected':''}>${esc(p.name)} · ${esc(p.ip)}</option>`).join('')}</select></label><p class="cal-caption"><span id="color-rig-status">${esc(w.rigMessage)}</span> Start phone previews in <a href="/" target="_blank">Prepare rig</a>.</p><div class="cal-actions">${button('Refresh cameras','refresh-cameras',w.loading)}${button('Connect leader preview','connect-rig',w.loading||!phones.some(p=>p.id===w.rigId))}</div>`:`<p class="cal-caption">Capture a reference image from this device’s camera. A shared rig preset needs a leader chosen from the rig previews above. No microphone is used.</p><div class="cal-actions">${button('Connect device camera','connect-device',w.loading)}</div>`}
    <div id="color-live-host" class="color-live-host">${!camera.video?`<div class="color-live-empty">${icon('camera',26)}<span>Connect a camera to frame the chart</span></div>`:''}</div><p id="color-camera-status" class="cal-caption" role="status">${esc(cameraMessage)}</p>
    <p id="color-applied-status" class="color-application-status" role="status"></p><div class="cal-actions">${button('Show original','toggle-original',true)}</div>
    <div class="cal-actions">${button(w.input==='rig'?'Capture leader & apply to all':'Capture & calibrate','capture',w.loading||!camera.ready,true)}${button('Disconnect camera','disconnect',!camera.video)}</div><p class="cal-caption">${w.input==='rig'?'Takes one original frame from the leader, finds the chart, saves a shared preset and applies the same correction to every rig preview. You can then remove the chart. Keep lighting, lens, exposure and white balance consistent.':'Captures one fresh frame for the local chart comparison. Device-camera corrections are not applied to the rig.'}</p>`}`;
}

function patchChecks() {
  if(!w.samples.length)return '';
  const quality=patchQualitySummary(w.samples);
  const guidance={
    'Clipped':'A color channel reached its bright or dark limit. Capture again with less glare and balanced exposure; preview sliders cannot recover lost color.',
    'Uneven patch':'Pixels vary too much within a patch. Check the boxes for edges, glare, shadows or printed marks.',
    'Too small':'The chart is too small to measure reliably. Move closer so the chart fills more of the frame.',
    'Outside image':'A sample falls outside the photo or includes transparency. Keep the whole chart in view and check the corner centers.'
  };
  return `<div id="color-patch-quality" class="color-patch-quality ${quality.rejected.length?'has-rejections':''}"><strong>${quality.usable} / ${quality.total} usable patches · ${MIN_USABLE_PATCHES} required</strong><p>Green solid boxes pass the checks. Orange dashed boxes are rejected. Alignment and pixel quality are checked separately.</p>
    ${quality.rejected.map(({reason,count})=>`<p><b>${count} ${esc(reason.toLowerCase())}.</b> ${esc(guidance[reason]||'Check the marked patches and capture again.')}</p>`).join('')}
    <details ${!w.fit?'open':''}><summary>Inspect all ${quality.total} patches</summary><p>Same layout as the chart, numbered left to right, then top to bottom. Percentages show clipped pixels in each sample.</p><ol class="color-patch-checks" style="grid-template-columns:repeat(${w.chart.columns},minmax(0,1fr))">${w.samples.map(s=>`<li class="${s.usable?'':'rejected'}"><b>${s.index+1}</b><span>${s.usable?'Usable':esc(s.reason)}</span>${s.reason==='Clipped'&&Number.isFinite(s.quality?.clippedFraction)?`<small>${Math.round(s.quality.clippedFraction*100)}%</small>`:''}</li>`).join('')}</ol></details></div>`;
}

function markup() {
  const ready=!!w.image,fit=w.fit,quality=patchQualitySummary(w.samples);
  return `<section class="color-intro"><div><div class="eyebrow">LEADER COLOR CALIBRATION</div><h2>Calibrate once. Share across the rig.</h2><p>Choose one leader camera. Every camera uses that leader’s color correction.</p></div><span class="pill neutral">${w.captureMeta?'Leader / reference frame':ready?'Uploaded photo':'Choose a leader'}</span></section>
  <section class="work-section color-fleet"><div class="section-heading"><div><h2>Choose the leader from your previews</h2><p>Pick a camera with a clear view of the color chart under your capture lighting. The other cameras do not need to see the chart.</p></div>${button('Refresh camera overview','refresh-cameras',w.loading)}</div><div id="color-camera-overview"></div><div class="color-shared-summary"><p id="color-shared-status" class="color-application-status" role="status"></p>${button('Disable shared correction','disable-shared',!activeLeaderPreset()||w.loading)}</div><p class="cal-caption">One shared preset assumes similar cameras and stable lighting. It applies to Calibration previews in this browser; phone settings and final capture files are not changed yet.</p></section>
  <div class="color-layout"><div class="color-setup"><section class="work-section"><div class="section-title"><span class="section-number">1</span><div><h2>Get a reference frame</h2><p>Use the same lighting and camera settings as your capture.</p></div></div>
    <div class="cal-fields color-fields"><label>Leader / reference camera<input id="color-camera" value="${esc(w.camera)}" maxlength="80" ${w.captureMeta?'readonly':''}></label><label>Run / lighting preset name<input id="color-name" value="${esc(w.name)}" maxlength="80"></label></div>
    <label>Chart reference<select id="color-chart" ${w.loading?'disabled':''}><option value="classic" ${w.chart.id===CLASSIC24.id?'selected':''}>Calibrite ColorChecker Classic</option><option value="spyder" ${w.chart.id===SPYDER24.id?'selected':''}>Spyder Checkr 24</option><option value="custom" ${w.chart.id==='custom'?'selected':''}>${w.chart.id==='custom'?esc(w.chart.name):'Custom chart · import reference'}</option></select></label>
    <p class="cal-caption">Default: Calibrite ColorChecker Classic · 24 patches. Match your physical chart, or import a custom reference below.</p>
    ${sourceControls()}
    <details class="cal-details"><summary>Chart layout & custom reference</summary><p>Reference order: left to right, then top to bottom. Rotate the photo to match this layout. Mark the centers of the four corner patches.</p><div class="color-reference-grid" style="grid-template-columns:repeat(${w.chart.columns},1fr)">${w.chart.patches.map((rgb,i)=>`<span style="background:rgb(${rgb.join(',')})" title="Patch ${i+1}: ${rgb.join(', ')}"><small>${i+1}</small></span>`).join('')}</div><p>${esc(w.chart.name)} · ${w.chart.columns} columns × ${w.chart.rows} rows. ${w.chart.id===CLASSIC24.id?`<a href="${CLASSIC24.source}" target="_blank" rel="noreferrer">Classic reference data</a> · post-November 2014, converted to sRGB.`:w.chart.id===SPYDER24.id?`<a href="${SPYDER24.source}" target="_blank" rel="noreferrer">Datacolor reference data</a>`:'User-supplied sRGB values.'}</p>${upload('Import reference JSON','color-reference','.json',w.loading)}<div class="cal-actions">${button('Download reference template','reference-template')}</div><p>The template contains example values. Replace them with verified values for your chart; a printed copy is not a calibrated target.</p></details>
  </section><section class="work-section"><div class="section-title"><span class="section-number">2</span><div><h2>Find chart & calibrate</h2><p>${ready?'Automatic detection locates and orients the patch grid.':'Capture a camera frame or upload a chart photo.'}</p></div></div>
    ${ready?`<div class="color-align-wrap"><canvas id="color-alignment" tabindex="0" role="img" aria-label="Chart alignment. In manual mode click corner patch centers or use arrow keys and Enter. Top left, top right, bottom right, bottom left."></canvas></div><p id="color-corner-status" class="cal-caption">${alignmentMessage()}</p>${w.alignment==='manual'?`<div class="color-corner-progress" aria-label="Corner selection">${['Top left','Top right','Bottom right','Bottom left'].map((n,i)=>`<span class="${i<w.corners.length?'complete':''}">${i<w.corners.length?'✓':i+1} ${n}</span>`).join('')}</div>`:''}<div class="cal-actions">${button(w.loading?'Working…':'Auto-calibrate','solve',w.loading,true)}${button('Manual alignment','align',w.loading)}${w.alignment==='manual'?button('Calibrate from points','solve-manual',w.corners.length!==4||w.loading):''}${button('Rotate photo ↻','rotate',w.loading)}</div>`:'<div class="cal-empty">'+icon('target',28)+'<p>The detected chart and sampling points will appear here.</p></div>'}
    ${patchChecks()}
    <p class="cal-caption">Show one complete, matching chart with clear gaps between patches. Check that the sampling boxes sit inside each color patch. For camera calibration, photograph the physical chart under your capture lighting; a product listing image can only test the workflow.</p>
  </section></div>
  <div class="color-main"><section class="work-section color-preview-section"><div class="section-heading"><div class="section-title"><span class="section-number">3</span><div><h2>Before / after</h2><p>${ready?esc(w.source):'Your color preview will appear here.'}</p></div></div></div>
    ${ready?`<div class="color-comparison" style="aspect-ratio:${w.image.width}/${w.image.height}"><canvas id="color-before" aria-label="Original photo"></canvas><canvas id="color-after" aria-label="Corrected photo" style="clip-path:inset(0 0 0 ${w.split}%)"></canvas><span class="color-image-label original">Original</span><span class="color-image-label corrected">${fit?'Corrected + adjustments':'Manual preview'}</span><span id="color-divider" style="left:${w.split}%"></span></div><label class="color-comparison-control">Comparison <input id="color-split" type="range" min="0" max="100" value="${w.split}" aria-label="Before after split"><span>Same frame, two treatments</span></label>`:`<div class="color-preview-empty">${icon('aperture',48)}<h3>One leader. One reference frame.</h3><p>Choose a leader above, then Capture leader & apply to all. Load a saved run preset below to reuse its frame and adjustments.</p></div>`}
    <div class="color-fit-stats"><div><span>Usable chart patches</span><strong>${quality.total?`${quality.usable} / ${quality.total}`:fit?`${fit.accepted} / ${fit.total}`:'—'}</strong></div><div><span>Before fit · RGB error</span><strong>${fit?number(fit.before):'—'}</strong></div><div><span>After fit · RGB error</span><strong>${fit?number(fit.after):'—'}</strong></div></div>
    <p class="cal-caption">${fit?'Error is RGB RMSE (0–255) on the fitted chart, before manual adjustments. It is not an independent accuracy test.':'Calibrate to compare measured patch error. Manual adjustments work as soon as a photo is loaded.'}</p>
    <div id="color-status" class="color-status" role="status" aria-live="polite">${esc(w.message||'Ready when you are.')}</div>
    ${fit?`<div class="color-fit-method"><strong>${fit.model==='affine'?'Saved correction':'Standard color correction'}</strong><p>${fit.validation?`Withheld-patch RGB error: ${Number.isFinite(fit.validation.after)?number(fit.validation.after):'unavailable'} (before: ${number(fit.validation.before)}). Each patch is predicted by a fit that excluded it. This is not a test on a separate photo.`:'Saved legacy fit; withheld-patch checks were not recorded.'}</p>${fit.validation&&(!Number.isFinite(fit.validation.after)||fit.validation.after>12||fit.validation.after>fit.validation.before+.5)?'<p class="color-fit-warning">Poor validation: check the reference, alignment and lighting. This fit cannot be applied across the rig.</p>':''}</div><details class="cal-details"><summary>Correction details</summary><p>${fit.after>12?'The residual error is high. Check chart choice, illumination and alignment.':'Inspect the preview and test on a separate photo under the same lighting.'}</p><pre class="color-matrix">${fit.matrix.map(row=>row.map(n=>n.toFixed(5).padStart(9)).join(' ')).join('\n')}${fit.offset?.some(n=>n!==0)?`\n\nSaved offset: ${fit.offset.map(n=>n.toFixed(5)).join('  ')}`:''}</pre><p>${fit.model==='affine'?'This older preset retains its saved correction. Recalibrating uses the standard 3 × 3 matrix.':'Uses a 3 × 3 matrix in linear sRGB to correct color balance and exposure.'} This is an image correction, not a phone sensor transform.</p></details>`:''}
  </section><section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">4</span><div><h2>Fine-tune the result</h2><p>Adjustments sit on top of the automatic correction.</p></div></div></div>
    <div class="color-sliders">${[['amount','Calibration strength',0,100,1,'%'],['exposure','Exposure',-2,2,0.05,' EV'],['warmth','Warmth',-100,100,1,''],['tint','Tint',-100,100,1,''],['saturation','Saturation',0,200,1,'%']].map(([key,label,min,max,step,unit])=>`<label><span>${label}<output id="color-value-${key}">${w.adjust[key]}${unit}</output></span><input type="range" data-color-adjust="${key}" data-unit="${unit}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${w.adjust[key]}" ${!ready||key==='amount'&&!fit?'disabled':''}></label>`).join('')}</div>
    <div class="cal-actions">${button('Reset adjustments','reset',!ready)}${button('Apply adjustments to all cameras','apply',true,true)}${button('Save as new run preset','save-run',!fit||w.loading||w.sample||w.captureMeta?.kind!=='rig-video')}${button('Save image profile copy','save',!fit||w.loading)}${button('Download preview PNG','png',!ready||w.loading)}</div><p class="cal-caption">Sliders first update this frozen frame. Apply adjustments updates the shared preset and every rig preview. The preset and a small reference frame are saved in this browser for future runs. Give a new run preset a name above before saving it.</p>
  </section></div></div>
  <section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">5</span><div><h2>Saved run presets</h2><p>Reuse a preset for the same rig and lighting, or choose a leader and recalibrate. The last active preset is restored on reload. Up to 12 presets are kept; export a portable copy for your run records.</p></div></div></div>
    ${leaderState.presets.length?`<div class="color-profile-list">${leaderState.presets.slice().reverse().map(p=>`<article><div><span class="pill ${p.id===leaderState.activeId?'success':'neutral'}">${p.id===leaderState.activeId?'Selected shared preset':'Saved run preset'}</span><h3>${esc(p.name)}</h3><p>Leader: ${esc(p.camera)} · ${new Date(p.application.appliedAt).toLocaleString()}</p></div><div class="cal-actions">${button('Load preset & frame',`load-preset:${p.id}`,w.loading)}${button('Export preset',`export-preset:${p.id}`,w.loading)}${button('Remove preset',`remove-preset:${p.id}`,w.loading)}</div></article>`).join('')}</div>`:'<div class="cal-empty"><p>No leader preset saved yet. Choose a camera and capture the chart once.</p></div>'}
    ${w.profiles.length?`<details class="cal-details"><summary>Image profile copies</summary><div class="color-profile-list">${w.profiles.slice().reverse().map(p=>`<article><div><span class="pill neutral">Image-space profile</span><h3>${esc(p.name)}</h3><p>${esc(p.camera)} · ${esc(p.chart.name)} · ${new Date(p.createdAt).toLocaleString()}</p></div>${button('Export JSON',`export:${p.id}`)}</article>`).join('')}</div></details>`:''}
  </section>`;
}

function alignmentMessage() {
  if(w.loading)return 'Working on the reference frame…';
  if(w.samples.length){const quality=patchQualitySummary(w.samples);return `${quality.usable} / ${quality.total} patches passed pixel checks. ${quality.rejected.length?'Inspect the orange dashed boxes and the reasons below.':'All sampling boxes passed.'}`;}
  if(w.detection)return `Chart detected: ${w.detection.matched} / ${w.detection.total} patch positions. Check the green sampling boxes before saving.`;
  if(w.alignment==='auto')return 'Press Auto-calibrate to find the chart and calculate the correction. No corner clicks needed.';
  if(w.corners.length===4)return 'Four corners set. Check the green sampling boxes, then choose Calibrate from points.';
  const label=(cornerNames[w.chart.id]||['top-left','top-right','bottom-right','bottom-left'])[w.corners.length];
  return `Click the ${label} patch center (${w.corners.length+1}/4). Keyboard: arrows move the crosshair; Enter selects.`;
}

function clearFit() {w.fit=null;w.samples=[];w.detection=null;w.adjust=defaultAdjustments();previewPixels=null;}
function draw(root,recompute=false) {
  if(!w.image)return;
  const before=root.querySelector('#color-before'),after=root.querySelector('#color-after'),alignment=root.querySelector('#color-alignment');
  if(!before||!after||!alignment)return;
  for(const canvas of [before,after,alignment]){canvas.width=w.image.width;canvas.height=w.image.height;}
  before.getContext('2d',{colorSpace:'srgb'}).putImageData(w.image,0,0);
  if(!previewPixels||recompute)previewPixels=correctedPixels(w.image,w.fit?.matrix||IDENTITY,w.adjust,w.fit?.offset);
  after.getContext('2d',{colorSpace:'srgb'}).putImageData(new ImageData(previewPixels,w.image.width,w.image.height),0,0);
  drawAlignment(alignment);
}

function drawAlignment(canvas) {
  const c=canvas.getContext('2d',{colorSpace:'srgb'}),{width,height}=w.image;
  c.putImageData(w.image,0,0);c.lineWidth=3;c.strokeStyle='#82ffbb';c.fillStyle='#153f29';
  if(w.corners.length===4)try {
    const project=chartProjection(w.corners);
    for(let r=0;r<w.chart.rows;r++)for(let col=0;col<w.chart.columns;col++) {
      const u=col/(w.chart.columns-1),v=r/(w.chart.rows-1),du=0.17/(w.chart.columns-1),dv=0.17/(w.chart.rows-1);
      const rejected=w.samples[r*w.chart.columns+col]?.usable===false;
      c.strokeStyle=rejected?'#ff9b42':'#82ffbb';c.setLineDash(rejected?[5,3]:[]);
      c.beginPath();[[-du,-dv],[du,-dv],[du,dv],[-du,dv]].forEach(([dx,dy],i)=>{const [x,y]=project(u+dx,v+dy);c[i?'lineTo':'moveTo'](x*width,y*height);});c.closePath();c.stroke();
    }
  }catch{/* The solve action displays the validation message. */}
  c.strokeStyle='#82ffbb';c.setLineDash([]);
  w.corners.forEach(([x,y],i)=>{c.beginPath();c.arc(x*width,y*height,12,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='white';c.font='bold 16px system-ui';c.textAlign='center';c.fillText(i+1,x*width,y*height+6);c.fillStyle='#153f29';});
  if(w.alignment==='manual'&&w.corners.length<4){const [x,y]=w.cursor;c.strokeStyle='white';c.beginPath();c.moveTo(x*width-10,y*height);c.lineTo(x*width+10,y*height);c.moveTo(x*width,y*height-10);c.lineTo(x*width,y*height+10);c.stroke();}
}

function download(value,name,type='application/json') {
  const blob=value instanceof Blob?value:new Blob([JSON.stringify(value,null,2)],{type});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function showError(root,error) {w.message=error.message||String(error);redraw(root);}
function redraw(root) {root=root?.isConnected?root:activeRoot;if(!root?.isConnected)return;root.innerHTML=markup();overview?.mount(root.querySelector('#color-camera-overview'));updateLiveColor();draw(root);}
function clearReference(){w.image=null;w.source='';w.captureMeta=null;w.sample=false;w.corners=[];w.editingPresetId=null;clearFit();showOriginal=false;liveError='';}

function cancelDetection() {if(worker){worker.terminate();worker=null;rejectDetection?.(new Error('Chart detection cancelled.'));rejectDetection=null;}}
function findChart(image,chart) {
  cancelDetection();
  return new Promise((resolve,reject)=>{
    const task=new Worker(new URL('./color-detection-worker.js',import.meta.url),{type:'module'});worker=task;
    const cleanup=()=>{clearTimeout(timer);task.terminate();if(worker===task){worker=null;rejectDetection=null;}};
    rejectDetection=error=>{cleanup();reject(error);};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Chart detection took too long. Try a closer, clearer view or manual alignment.'));},12000);
    task.onmessage=({data})=>{cleanup();data.error?reject(new Error(data.error)):resolve(data.result);};
    task.onerror=()=>{cleanup();reject(new Error('Chart detection could not start. Reload the page or use manual alignment.'));};
    const pixels=new Uint8ClampedArray(image.data);task.postMessage({image:{width:image.width,height:image.height,data:pixels},chart},[pixels.buffer]);
  });
}

async function rigStatus() {
  const response=await fetch('/api/rig/status',{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Could not read the rig. Check the local server and refresh cameras.');
  const status=await response.json();w.rig=status;
  const phones=availableColorCameras(status);
  if(!phones.some(p=>p.id===w.rigId))w.rigId='';
  w.rigMessage=status.connected?`${phones.length} live preview${phones.length===1?'':'s'} available.`:'Rig status unavailable. Check the local server, or choose This device’s camera.';
  return status;
}

async function calibrate(root,{capture=false,manual=false}={}) {
  if(w.loading)return;
  const generation=viewGeneration;
  w.loading=true;w.message=capture?'Waiting for a fresh camera frame…':manual?'Calculating from the selected patches…':'Finding the color chart…';redraw(root);
  try {
    if(capture) {
      if(camera.source?.kind==='rig-video') {
        const source=structuredClone(camera.source),id=source.cameraId,status=await rigStatus(),phone=availableColorCameras(status).find(p=>colorSourceKey(rigColorSource(p,status))===colorSourceKey(source));
        if(generation!==viewGeneration)return;
        if(!phone){camera.close();throw new Error('Selected rig preview is no longer available. Reconnect before capturing.');}
        if(camera.source?.cameraId!==id)throw new Error('Camera disconnected before capture. Reconnect and try again.');
        camera.source=rigColorSource(phone,status);
      }
      const frame=await camera.capture();if(generation!==viewGeneration)return;
      w.image=frame.image;w.captureMeta=frame.source;w.sample=false;w.camera=frame.source.cameraName;w.editingPresetId=null;
      w.source=`${frame.source.cameraName} · video frame · ${new Date(frame.source.capturedAt).toLocaleTimeString()}`;
      w.corners=[];w.alignment='auto';clearFit();w.message='Frame captured. Finding the chart…';redraw(root);
    }
    if(!w.image)throw new Error('Capture a camera frame or load a photo first.');
    clearFit();
    if(!manual){w.corners=[];w.alignment='auto';const detection=await findChart(w.image,w.chart);if(generation!==viewGeneration)return;w.detection=detection;w.corners=detection.corners;}
    w.samples=sampleChart(w.image,w.chart,w.corners);w.fit=fitColor(w.samples);previewPixels=null;
    w.message=`${manual?'Aligned chart':`Chart detected (${w.detection.matched}/${w.detection.total} positions)`}. Image correction calculated from ${w.fit.accepted} patches. Review the same-frame comparison before saving. ${w.fit.after>12?'High residual error: review lighting and alignment.':''}`;
    if(capture&&w.captureMeta?.kind==='rig-video'){await applyCurrentProfile();}
  }catch(error){if(generation===viewGeneration)w.message=`${error.message}${capture&&activeLeaderPreset()?' The existing shared preset has not been replaced.':''}`;}
  finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

async function readPhoto(file,root) {
  if(!file)return;
  const generation=viewGeneration;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Choose a JPEG, PNG or WebP photo under 20 MB. Convert RAW/HEIC to sRGB first.');
  w.loading=true;redraw(root);
  try {
    const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
    try {
      if(generation!==viewGeneration)return;
      const scale=Math.min(1,1000/bitmap.width,750/bitmap.height),canvas=document.createElement('canvas');
      canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      if(canvas.width<100||canvas.height<100)throw new Error('Choose a larger chart photo (at least 100 pixels on each side).');
      const c=canvas.getContext('2d',{colorSpace:'srgb'});c.drawImage(bitmap,0,0,canvas.width,canvas.height);
      w.image=c.getImageData(0,0,canvas.width,canvas.height);w.source=file.name;w.sample=false;w.captureMeta=null;w.corners=[];w.alignment='auto';clearFit();
      w.message='Photo loaded. Match the chart reference, then press Auto-calibrate. No corner clicks needed.';
    }finally{bitmap.close();}
  }finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

async function command(action,root) {
  if(action==='disconnect'){camera.close();if(connecting){viewGeneration++;connecting=false;w.loading=false;}redraw(root);return;}
  if(w.loading)return;
  const generation=viewGeneration;
  try {
    if(action==='solve'||action==='capture'||action==='solve-manual'){await calibrate(root,{capture:action==='capture',manual:action==='solve-manual'});return;}
    if(action==='refresh-cameras') {w.loading=true;redraw(root);await rigStatus();if(generation!==viewGeneration)return;refreshBindings();w.loading=false;
    } else if(action==='connect-device') {w.loading=true;connecting=true;const connection=camera.connectDevice();redraw(root);await connection;if(generation!==viewGeneration)return;connecting=false;w.loading=false;
    } else if(action==='connect-rig'||action.startsWith('inspect:')) {
      if(action.startsWith('inspect:')){w.input='rig';w.rigId=action.slice(8);camera.close();clearReference();}
      const id=w.rigId;w.loading=true;connecting=true;redraw(root);const status=await rigStatus(),phone=availableColorCameras(status).find(p=>p.id===id);
      if(generation!==viewGeneration)return;
      if(!phone)throw new Error('That camera preview is unavailable. Refresh cameras and start its preview in Prepare rig.');
      camera.connectRig(phone,status,location.origin);w.camera=phone.name;connecting=false;w.loading=false;w.message=`Selected leader: ${phone.name}. Frame the chart, then Capture leader & apply to all.`;
    } else if(action==='toggle-original') {showOriginal=!showOriginal;updateLiveColor();return;
    } else if(action==='disable-shared'){leaderState=selectLeaderPreset(localStorage,null);w.message='Shared correction disabled. All rig previews show original video. Saved presets are kept.';
    } else if(action.startsWith('remove-preset:')){const id=action.slice(14);leaderState=removeLeaderPreset(localStorage,id);if(w.editingPresetId===id)w.editingPresetId=null;w.message='Preset removed. Exported copies are unchanged.';
    } else if(action.startsWith('load-preset:')){await loadPreset(action.slice(12),root);return;
    } else if(action==='apply'||action==='save-run') {w.loading=true;redraw(root);await applyCurrentProfile({newPreset:action==='save-run'});if(generation!==viewGeneration)return;w.loading=false;
    } else if(action==='align') {w.corners=[];w.alignment='manual';clearFit();w.message='Manual fallback: mark the corner patch centers in the reference order, then Calibrate from points.';
    } else if(action==='rotate'&&w.image) {
      const source=document.createElement('canvas');source.width=w.image.width;source.height=w.image.height;source.getContext('2d').putImageData(w.image,0,0);
      const canvas=document.createElement('canvas');canvas.width=source.height;canvas.height=source.width;
      const c=canvas.getContext('2d');c.translate(canvas.width,0);c.rotate(Math.PI/2);c.drawImage(source,0,0);
      w.image=c.getImageData(0,0,canvas.width,canvas.height);w.corners=[];w.alignment='auto';clearFit();w.message='Photo rotated. Press Auto-calibrate to find the chart again.';
    } else if(action==='reset') {w.adjust=defaultAdjustments();previewPixels=null;w.message='Manual adjustments reset. The fitted correction is preserved.';
    } else if(action==='save') {
      if(!w.fit)return;
      const profile=profileSnapshot();
      const profiles=[...w.profiles,profile].slice(-20);localStorage.setItem(STORAGE,JSON.stringify(profiles));w.profiles=profiles;w.message='Color profile saved in this browser. Export JSON for a portable copy. No phone settings changed.';
    } else if(action.startsWith('export-preset:')) {
      const profile=leaderState.presets.find(p=>p.id===action.slice(14));if(profile)download(profile,`color-leader-preset-${profile.id}.json`);return;
    } else if(action.startsWith('export:')) {
      const profile=w.profiles.find(p=>p.id===action.slice(7));if(profile)download(profile,`color-profile-${profile.id}.json`);return;
    } else if(action==='reference-template') {
      download({name:'Replace with your measured chart',colorSpace:'sRGB',columns:w.chart.columns,rows:w.chart.rows,source:'Replace with reference source and illuminant',patches:w.chart.patches},'color-chart-reference-template.json');return;
    } else if(action==='png') {
      draw(root,true);
      root.querySelector('#color-after')?.toBlob(blob=>{if(blob)download(blob,'color-preview.png');},'image/png');return;
    }
    redraw(root);
  }catch(error){if(generation!==viewGeneration)return;connecting=false;w.loading=false;showError(root,error);}
}

function addCorner(root,point) {
  if(w.alignment!=='manual'||w.corners.length===4||w.loading)return;
  w.corners.push(point);w.cursor=point;clearFit();redraw(root);root.querySelector('#color-alignment')?.focus({preventScroll:true});
}

export function mountColorWorkbench(root) {
  activeRoot=root;
  if(!root){viewGeneration++;camera.close();liveColor?.close();liveColor=null;overview?.close();overview=null;clearInterval(pollTimer);pollTimer=null;cancelDetection();connecting=false;w.loading=false;return;}
  if(!overview)overview=new ColorCameraOverview(id=>command(`inspect:${id}`,activeRoot));
  refreshBindings();
  if(!pollTimer){pollTimer=setInterval(pollCameras,5000);pollCameras();}
  if(!w.loaded){w.loaded=true;try{const profiles=JSON.parse(localStorage.getItem(STORAGE)||'[]');if(Array.isArray(profiles))w.profiles=profiles.filter(p=>p.sample===false&&p.version===1&&typeof p.id==='string'&&typeof p.name==='string'&&p.chart?.name&&p.fit?.matrix).slice(-20);}catch{w.message='Saved profiles could not be read. New work can still be exported.';}}
  redraw(root);
  root.onclick=event=>{
    const control=event.target.closest('[data-color-action]');if(control&&!control.disabled)command(control.dataset.colorAction,root);
    if(event.target.id==='color-alignment'){const rect=event.target.getBoundingClientRect();addCorner(root,[clamp((event.clientX-rect.left)/rect.width),clamp((event.clientY-rect.top)/rect.height)]);}
  };
  root.onkeydown=event=>{
    if(event.target.id!=='color-alignment'||w.alignment!=='manual'||w.corners.length===4||w.loading)return;
    const direction={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(direction){event.preventDefault();w.cursor=w.cursor.map((n,i)=>clamp(n+direction[i]*(event.shiftKey?0.02:0.002)));drawAlignment(event.target);}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();addCorner(root,[...w.cursor]);}
  };
  root.oninput=event=>{
    const el=event.target,key=el.dataset.colorAdjust;
    if(el.id==='color-camera')w.camera=el.value;
    if(el.id==='color-name')w.name=el.value;
    if(el.id==='color-split'){w.split=Number(el.value);root.querySelector('#color-after').style.clipPath=`inset(0 0 0 ${w.split}%)`;root.querySelector('#color-divider').style.left=`${w.split}%`;}
    if(key){w.adjust[key]=Number(el.value);root.querySelector(`#color-value-${key}`).textContent=`${el.value}${el.dataset.unit}`;cancelAnimationFrame(animation);animation=requestAnimationFrame(()=>draw(root,true));}
  };
  root.onchange=async event=>{
    const el=event.target;
    try {
      if(w.loading)return;
      if(el.id==='color-source'){camera.close();clearReference();w.input=el.value;redraw(root);pollCameras();}
      if(el.id==='color-rig-camera'){await command(`inspect:${el.value}`,root);}
      if(el.id==='color-photo')await readPhoto(el.files[0],root);
      if(el.id==='color-reference'&&el.files[0]) {
        if(el.files[0].size>100000)throw new Error('Reference JSON must be smaller than 100 KB.');
        w.chart=validateReference(JSON.parse(await el.files[0].text()));w.corners=[];w.alignment='auto';clearFit();w.message='Custom reference loaded. Auto-calibrate can find regular grids with clear patch gaps; manual alignment is available if needed.';redraw(root);
      }
      if(el.id==='color-chart') {
        const chart={classic:CLASSIC24,spyder:SPYDER24}[el.value];
        if(chart){w.chart=chart;w.corners=[];w.alignment='auto';clearFit();w.message='Reference changed. Press Auto-calibrate to find the matching chart.';redraw(root);}
        else {el.value=w.chart.id===CLASSIC24.id?'classic':w.chart.id===SPYDER24.id?'spyder':'custom';root.querySelector('.cal-details').open=true;root.querySelector('#color-reference').focus();}
      }
    }catch(error){showError(root,error);}
  };
}
window.addEventListener('storage',event=>{if(event.key===LEADER_COLOR_STORAGE&&activeRoot){refreshBindings();redraw(activeRoot);}});
window.addEventListener('pagehide',()=>{camera.close();liveColor?.close();overview?.close();clearInterval(pollTimer);cancelDetection();});
