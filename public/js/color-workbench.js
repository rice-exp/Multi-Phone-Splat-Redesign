import {esc,icon} from './icons.js';
import {CLASSIC24,SPYDER24,IDENTITY,MIN_USABLE_PATCHES,PATCH_HALF_WIDTH,defaultAdjustments,validateReference,chartProjection,sampleChart,patchQualitySummary,neutralBalanceLabel,fitColor,fitDisposition,correctedPixels,clamp} from './color-calibration.js';
import {ColorCamera,availableColorCameras} from './color-camera.js';
import {LEADER_COLOR_STORAGE,rigColorSource,colorSourceKey,colorSettingsKey,referenceSettings,readLeaderPresets,prepareLeaderPreset,saveLeaderPreset,selectLeaderPreset,removeLeaderPreset,sharedPreviewStatus,cameraColorView} from './color-profiles.js';
import {ColorLivePreview} from './color-live-preview.js';
import {phoneColorPanel,selectedColorPhones,syncPhoneColor} from './phone-color-sync.js';
import {ColorCameraOverview} from './color-camera-overview.js';
import {helpLink} from './help-link.js';
import {presetBrowser,PRESET_SORTS} from './color-preset-browser.js';

const STORAGE='splat-color-profiles-v1';
const cornerNames={
  [CLASSIC24.id]:['top-left (dark skin)','top-right (bluish green)','bottom-right (black)','bottom-left (white)'],
  [SPYDER24.id]:['top-left (white)','top-right (aqua)','bottom-right (dark skin)','bottom-left (black)']
};
const w={chart:CLASSIC24,image:null,source:'',sample:false,corners:[],fit:null,samples:[],adjust:defaultAdjustments(),split:50,camera:'',name:'',message:'',profiles:[],loaded:false,loading:false,cursor:[0.5,0.5],rig:null,rigId:'',rigMessage:'Refresh cameras to find running previews.',captureMeta:null,alignment:'auto',detection:null};
let previewPixels=null,activeRoot=null,worker=null,rejectDetection=null,cameraMessage='Camera disconnected',viewGeneration=0;
let leaderState={activeId:null,presets:[]},overview=null,liveColor=null,pollTimer=null,pollBusy=false,showOriginal=false,liveError='';
let syncMessage='', syncSource='current', rigOperation=0, displayedPhoneIds=[];
let appliedAdjustments=defaultAdjustments();
let browsedPresetId=null,presetSort='date-desc',presetNotice='';
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
function restoreManualLeader(phone,status) {
  if(!phone||w.captureMeta||w.image)return;
  const profile=activeLeaderPreset(),source=rigColorSource(phone,status);
  if(profile?.fit.model!=='manual'||!profile.appliedToHardware||colorSourceKey(profile.source.capture)!==colorSourceKey(source))return;
  const actual=source.reportedSettings.colorProcessing?.colorCorrectionTransform,last=profile.phoneApplication.transform;
  if(!Array.isArray(actual)||actual.length!==9||!actual.every((v,i)=>Math.abs(v-last[i])<=0.001))return;
  const original=profile.source.capture;
  if(!Array.isArray(original.reportedSettings?.colorProcessing?.colorCorrectionTransform))return;
  source.reportedSettings.colorProcessing.colorCorrectionTransform=original.reportedSettings.colorProcessing.colorCorrectionTransform;
  if(colorSettingsKey(source)!==colorSettingsKey(original))return;
  w.captureMeta=structuredClone(original);w.phoneApplication=profile.phoneApplication;w.editingPresetId=profile.id;
  w.name=profile.name;w.camera=phone.name;w.adjust={...profile.adjustments};appliedAdjustments={...profile.adjustments};
}
function adjustmentState(){
  return Object.keys(w.adjust).some(key=>w.adjust[key]!==appliedAdjustments[key])?'Unapplied edits. Press Apply to update the previews.':'';
}
function refreshBindings() {try{leaderState=readLeaderPresets(localStorage);}catch{leaderState={activeId:null,presets:[]};w.message='Saved presets could not be read. Keep your browser data and try reloading the page.';}}
function updateLiveColor() {
  if(!activeRoot)return;
  if(liveColor?.video!==camera.video){liveColor?.close();liveColor=null;liveError='';if(camera.video)liveColor=new ColorLivePreview(camera.video,{onError:()=>{liveError='Correction could not be displayed. Original preview is shown.';updateLiveColor();}});}
  const host=activeRoot.querySelector('#color-live-host');
  if(host&&camera.video){if(camera.video.parentNode!==host)host.replaceChildren(camera.video);if(liveColor.canvas.parentNode!==host)host.append(liveColor.canvas);}
  const source=connectedSource(),profile=activeLeaderPreset(),check=sharedPreviewStatus(profile,w.rig);
  const connect=activeRoot.querySelector('[data-color-action="connect-rig"]');
  if(connect){connect.disabled=w.loading||!availableColorCameras(w.rig).some(p=>p.id===w.rigId);connect.hidden=camera.ready;}
  const selected=selectedColorPhones(w.rig);
  const leader=selected.find(p=>p.id===w.rigId&&p.responding&&(!w.captureMeta||colorSourceKey(rigColorSource(p,w.rig))===colorSourceKey(w.captureMeta)));
  const context={status:w.rig,profile,shared:check,selectedIds:selected.map(phone=>phone.id)};
  const phone=source?.kind==='rig-video'&&w.rig?.phones.find(p=>colorSourceKey(rigColorSource(p,w.rig))===colorSourceKey(source));
  const view=phone?cameraColorView(phone,context):{label:check.label};
  liveColor?.setProfile(camera.ready&&!showOriginal&&!liveError?view.render:null);
  const label=activeRoot.querySelector('#color-applied-status');
  if(label)label.textContent=liveError||(!camera.source?'Choose the leader from the camera previews above.':!camera.ready?'Camera not live · correction paused':showOriginal&&view.render?'CameraScope video':view.label);
  const toggle=activeRoot.querySelector('[data-color-action="toggle-original"]');if(toggle){toggle.disabled=!view.render||!camera.ready;toggle.textContent=showOriginal?'Show corrected':'Show original';}
  const remove=activeRoot.querySelector('[data-color-action="disable-shared"]');if(remove)remove.disabled=!profile||!!profile.phoneApplication;
  const apply=activeRoot.querySelector('[data-color-action="apply"]');
  const rigInput=!w.captureMeta||w.captureMeta.kind==='rig-video';
  if(apply)apply.disabled=w.loading||(rigInput?(!leader||w.sample||(w.fit&&fitDisposition(w.fit)==='blocked')||!w.rig?.workflowKnown||w.rig.workflowBusy||!!w.rig.busy):!w.image);
  for(const slider of activeRoot.querySelectorAll('[data-color-adjust]'))slider.disabled=w.loading||(!w.image&&!(rigInput&&leader))||(slider.dataset.colorAdjust==='amount'&&!w.fit);
  const reset=activeRoot.querySelector('[data-color-action="reset"]');if(reset)reset.disabled=w.loading||(!w.image&&!(rigInput&&leader));
  const targets=activeRoot.querySelector('#color-adjust-targets');
  if(targets)targets.textContent=!rigInput?'Apply updates the image comparison.':leader&&w.fit&&fitDisposition(w.fit)==='blocked'?'Choose Use manual adjustments only to discard the unverified chart fit.':leader?`Apply updates ${leader.name} first, then copies its verified settings to ${selected.filter(p=>p.id!==leader.id).map(p=>p.name).join(', ')||'no followers (leader only)'}.`:'Choose a responding leader selected in Prepare rig. Manual adjustments work without a chart or photo.';
  const presetStatus=activeRoot.querySelector('#color-shared-status');if(presetStatus)presetStatus.textContent=check.label;
  overview?.update(context,w.rigId,w.loading);
  const panel=activeRoot.querySelector('#color-phone-sync');
  if (panel) {
    const phones=selected;
    displayedPhoneIds=phones.map(phone=>phone.id);
    const html=phoneColorPanel(w.rig,phones,w.rigId,w.loading,syncMessage,syncSource);
    if (html!==panel.renderedMarkup) {
      const open=[...panel.querySelectorAll('details')].map(el=>el.open);
      const focused=panel.contains(document.activeElement)?document.activeElement:null;
      panel.innerHTML=html;panel.renderedMarkup=html;
      const details=[...panel.querySelectorAll('details')];
      if(open.length===details.length)details.forEach((el,index)=>{el.open=open[index];});
      if(focused?.id)panel.querySelector('#'+focused.id)?.focus({preventScroll:true});
      else if(focused?.dataset.colorAction)panel.querySelector('[data-color-action="'+focused.dataset.colorAction+'"]')?.focus({preventScroll:true});
    }
  }
}

async function pollCameras() {
  if(!activeRoot||pollBusy||w.loading)return;
  pollBusy=true;const generation=viewGeneration, operation=rigOperation;
  try {
    if(w.rig||w.rigId||!w.captureMeta) {
      const status=await rigStatus({background:true});if(!status||generation!==viewGeneration)return;
      if(camera.source?.kind==='rig-video'){
        const source=camera.source,phone=availableColorCameras(status).find(p=>colorSourceKey(rigColorSource(p,status))===colorSourceKey(source));
        if(phone)camera.source=rigColorSource(phone,status);else camera.close();
      }
      const statusText=activeRoot.querySelector('#color-rig-status');if(statusText)statusText.textContent=w.rigMessage;
    }
    refreshBindings();updateLiveColor();
  }catch{if(generation===viewGeneration&&operation===rigOperation&&!w.loading){w.rig=null;if(camera.source?.kind==='rig-video')camera.close();updateLiveColor();}}
  finally{pollBusy=false;}
}

function profileSnapshot() {
  if(!w.camera.trim()||!w.name.trim())throw new Error('Enter a camera / lens and profile name before saving.');
  return {version:1,id:crypto.randomUUID(),name:w.name.trim(),camera:w.camera.trim(),createdAt:new Date().toISOString(),sample:w.sample,pipeline:'decoded-sRGB-image',appliedToHardware:false,target:w.fit?{kind:'chart-reference',name:w.chart.name}:{kind:'manual'},chart:w.fit?structuredClone(w.chart):null,source:{filename:w.source,width:w.image?.width,height:w.image?.height,corners:structuredClone(w.corners),capture:w.captureMeta?structuredClone(w.captureMeta):null,detection:w.detection?structuredClone(w.detection):null},fit:structuredClone(w.fit||{model:'manual',matrix:IDENTITY}),adjustments:{...appliedAdjustments}};
}
function referenceImage() {
  if(!w.image)return null;
  const canvas=document.createElement('canvas'),scale=Math.min(1,640/w.image.width,480/w.image.height),original=document.createElement('canvas');
  original.width=w.image.width;original.height=w.image.height;original.getContext('2d').putImageData(w.image,0,0);
  canvas.width=Math.round(w.image.width*scale);canvas.height=Math.round(w.image.height*scale);canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);
  return {dataUrl:canvas.toDataURL('image/jpeg',.9),width:canvas.width,height:canvas.height};
}
async function applyCurrentProfile({newPreset=false,toPhones=false}={}) {
  const generation=viewGeneration;
  const saved=leaderState.presets.find(p=>p.id===w.editingPresetId);
  let source=w.captureMeta;
  const ids=[...displayedPhoneIds],leaderId=w.rigId;
  const intended={...w.adjust};
  if(w.sample||(source&&source.kind!=='rig-video'))throw new Error('Choose a rig leader before applying to phones.');
  if(w.image&&!saved&&(!camera.ready||colorSourceKey(source)!==colorSourceKey(camera.source)))throw new Error('Reconnect the selected leader before applying a new calibration.');
  let status=await rigStatus();if(generation!==viewGeneration)throw new Error('Camera view changed before applying.');
  let leader=(status.phones||[]).find(p=>p.responding&&(source?colorSourceKey(rigColorSource(p,status))===colorSourceKey(source):p.id===leaderId));
  if(!source&&toPhones){
    if(!leader||!ids.includes(leaderId))throw new Error('Choose a responding leader selected in Prepare rig.');
    const color=leader.state?.colorProcessing;
    if(color?.awbMode!=='OFF'||color?.colorCorrectionMode!=='TRANSFORM_MATRIX'){
      rigOperation++;
      status=await syncPhoneColor(status,[leaderId],leaderId,false,'measure');
      if(generation!==viewGeneration)return;
      const updated=status.phones.find(p=>p.id===leaderId&&p.responding&&p.ip===leader.ip&&p.route===leader.route);
      if(!updated)throw new Error('The leader could not be verified after locking white balance. Refresh cameras and try again.');
      leader=updated;w.rig=status;
    }
    source=rigColorSource(leader,status);w.captureMeta=source;w.camera=leader.name;
    if(!w.name.trim())w.name=leader.name+' · manual color';
  }
  if(!saved&&!leader)throw new Error('Leader is unavailable. Reconnect before applying a new calibration.');
  const profile={...profileSnapshot(),adjustments:intended,id:!newPreset&&saved?saved.id:crypto.randomUUID(),samples:structuredClone(w.samples),referenceImage:referenceImage()};
  const prior=w.phoneApplication||saved?.phoneApplication;
  profile.reviewedFit=fitDisposition(w.fit)==='review'&&(toPhones||newPreset);
  let verifySource=leader?rigColorSource(leader,status):source;
  if(toPhones){
    if(!leader||leader.id!==leaderId||!ids.includes(leaderId))throw new Error('Select this reference camera as the leader in Prepare rig and Calibration.');
    prepareLeaderPreset(profile,source);
    rigOperation++;
    status=await syncPhoneColor(status,ids,leaderId,false,'adjust',{
      ip:source.ip,route:source.route,reference:referenceSettings(source.reportedSettings),
      reviewedFit:profile.reviewedFit,fit:profile.fit,adjustments:profile.adjustments,previousTransform:prior?.transform
    });
    if(generation!==viewGeneration)return;
    w.rig=status;
    const sync=status.colorSync, others=sync.results.filter(r=>r.id!==leaderId);
    syncMessage=`${leader.name} updated. ${others.filter(r=>r.ok).length} of ${others.length} selected followers matched.`;
    if(others.some(r=>!r.ok))syncMessage+=' See Last sync and use Retry with same settings.';

    w.phoneApplication={transform:sync.snapshot.colorCorrectionTransform,at:sync.at,adjustments:{...profile.adjustments},matrix:structuredClone(profile.fit.matrix),results:sync.results.map(({id,ip,ok})=>({id,ip,ok}))};
    appliedAdjustments={...intended};previewPixels=null;
    verifySource=source;
  }
  const lastApplication=w.phoneApplication||prior;
  if(lastApplication){
    profile.phoneApplication=lastApplication;
    profile.appliedToHardware=toPhones||(JSON.stringify(profile.adjustments)===JSON.stringify(lastApplication.adjustments)&&JSON.stringify(profile.fit.matrix)===JSON.stringify(lastApplication.matrix));
    verifySource=source;
  }
  try {leaderState=saveLeaderPreset(localStorage,profile,verifySource,{activate:!newPreset});}
  catch(error){if(toPhones)throw new Error(syncMessage+' Could not save the preset in this browser: '+error.message);throw error;}
  w.editingPresetId=profile.id;browsedPresetId=profile.id;presetNotice=`Saved “${profile.name}”.`;showOriginal=false;liveError='';
  w.message=toPhones?syncMessage+` Saved “${profile.name}”.`:`Saved “${profile.name}” from ${profile.camera}. ${sharedPreviewStatus(activeLeaderPreset(),status).label}`;
  return profile;
}

async function loadPreset(id,root) {
  const profile=leaderState.presets.find(p=>p.id===id);if(!profile)throw new Error('That preset is unavailable.');
  const generation=viewGeneration;w.loading=true;redraw(root);
  try {
    let bitmap=null;
    if(profile.referenceImage){const response=await fetch(profile.referenceImage.dataUrl);bitmap=await createImageBitmap(await response.blob());}
    try {
      if(generation!==viewGeneration)return;
      let image=null;
      if(bitmap){
        const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
        const c=canvas.getContext('2d');c.drawImage(bitmap,0,0);image=c.getImageData(0,0,canvas.width,canvas.height);
      }
      const previous=activeLeaderPreset();
      camera.close();clearReference();
      w.phoneApplication=profile.phoneApplication||null;w.image=image;w.captureMeta=structuredClone(profile.source.capture);w.camera=profile.camera;w.name=profile.name;w.chart=structuredClone(profile.chart||CLASSIC24);w.fit=profile.fit.model==='manual'?null:structuredClone(profile.fit);w.adjust={...profile.adjustments};appliedAdjustments=previous?.id===id?{...previous.adjustments}:defaultAdjustments();w.corners=structuredClone(profile.source.corners);w.detection=profile.source.detection;w.samples=profile.samples||[];w.source=image?`Saved leader frame · ${profile.camera}`:'';w.editingPresetId=id;w.rigId=profile.source.capture.cameraId;previewPixels=null;
      browsedPresetId=id;presetNotice=`Loaded “${profile.name}”. Review the adjustments, then press Apply.`;
      w.message=presetNotice;
    }finally{bitmap?.close();}
  }finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

function sourceControls() {
  const available=availableColorCameras(w.rig).some(p=>p.id===w.rigId);
  return `<p class="cal-caption"><span id="color-rig-status">${esc(w.rigMessage)}</span> Start phone previews in <a href="/">Prepare rig</a>.</p>
    <div id="color-live-host" class="color-live-host">${!camera.video?`<div class="color-live-empty">${icon('camera',26)}<span>Choose a leader above to see its preview</span></div>`:''}</div><p id="color-camera-status" class="cal-caption" role="status">${esc(cameraMessage)}</p>
    <p id="color-applied-status" class="color-application-status" role="status"></p><div class="cal-actions">${button('Show original','toggle-original',true)}${button('Connect leader preview','connect-rig',w.loading||!available)}</div>
    <div class="cal-actions">${button('Lock color & capture chart','capture',w.loading||!camera.ready,true)}</div><p class="cal-caption">Locks white balance on the leader if needed, captures a fresh chart frame and previews the fit. Adjust the sliders below, then apply to the selected phones.</p>`;
}

function patchChecks() {
  if(!w.samples.length)return '';
  const quality=patchQualitySummary(w.samples);
  const guidance={
    'Clipped':'A color channel reached its bright or dark limit. Capture again with less glare and balanced exposure; preview sliders cannot recover lost color.',
    'Unconfirmed position':'The grid predicts this position, but the patch was not identified. Check for an obstruction or use manual alignment.',
    'Uneven patch':'Pixels vary too much within a patch. Check the boxes for edges, glare, shadows or printed marks.',
    'Too small':'The chart is too small to measure reliably. Move closer so the chart fills more of the frame.',
    'Outside image':'A sample falls outside the photo or includes transparency. Keep the whole chart in view and check the corner centers.'
  };
  return `<div id="color-patch-quality" class="color-patch-quality ${quality.rejected.length?'has-rejections':''}"><strong>${quality.usable} / ${quality.total} usable patches · ${MIN_USABLE_PATCHES} required</strong><p>${esc(neutralBalanceLabel(w.samples,w.chart))}</p><p>Green solid boxes pass the checks. Orange dashed boxes are rejected. Alignment and pixel quality are checked separately.</p>
    ${quality.rejected.map(({reason,count})=>`<p><b>${count} ${esc(reason.toLowerCase())}.</b> ${esc(guidance[reason]||'Check the marked patches and capture again.')}</p>`).join('')}
    <details ${!w.fit?'open':''}><summary>Inspect all ${quality.total} patches</summary><p>Same layout as the chart, numbered left to right, then top to bottom. Each patch needs at least 75% consistent, unclipped pixels.</p><ol class="color-patch-checks" style="grid-template-columns:repeat(${w.chart.columns},minmax(0,1fr))">${w.samples.map(s=>`<li class="${s.usable?'':'rejected'}"><b>${s.index+1}</b><span>${s.usable?'Usable':esc(s.reason)}</span>${s.reason==='Clipped'&&Number.isFinite(s.quality?.clippedFraction)?`<small>${Math.round(s.quality.clippedFraction*100)}% clipped · ${esc((s.quality.clippedChannels||[]).join('/'))}</small>`:''}</li>`).join('')}</ol></details></div>`;
}

function savedPresetBrowser() {
  if(!leaderState.presets.some(p=>p.id===browsedPresetId))browsedPresetId=null;
  return presetBrowser(leaderState,{selectedId:browsedPresetId,sort:presetSort,busy:w.loading,editingId:w.editingPresetId});
}
function refreshPresetBrowser(root,focusId) {
  root.querySelector('#color-preset-browser').innerHTML=savedPresetBrowser();
  if(focusId)root.querySelector('#'+focusId)?.focus({preventScroll:true});
}
function focusColorSection(id) {
  const section=activeRoot?.querySelector('#'+id);
  if(!section)return;
  section.focus({preventScroll:true});
  section.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

function markup() {
  const ready=!!w.image,fit=w.fit,disposition=fitDisposition(fit),quality=patchQualitySummary(w.samples);
  return `<aside class="color-preset-shortcut" aria-label="Saved color presets"><div><strong>Already have a saved color preset?</strong><p>Find your saved setups at the bottom of this page. Load one, review it, then press Apply.</p></div><a class="button secondary" href="#color-saved-presets">View saved presets (${leaderState.presets.length}) ↓</a></aside>
  <section class="work-section color-fleet"><div class="section-heading"><div><h2>Select a leader camera</h2><p>Choose the camera whose color settings you want to share. For chart calibration, place the chart in its view.</p></div>${button('Refresh cameras','refresh-cameras',w.loading)}</div><div class="color-fleet-chart"><label>Chart reference<select id="color-chart" ${w.loading?'disabled':''}><option value="classic" ${w.chart.id===CLASSIC24.id?'selected':''}>Calibrite ColorChecker Classic</option><option value="spyder" ${w.chart.id===SPYDER24.id?'selected':''}>Spyder Checkr 24</option><option value="custom" ${w.chart.id==='custom'?'selected':''}>${w.chart.id==='custom'?esc(w.chart.name):'Custom chart · import reference'}</option></select></label></div><div id="color-camera-overview"></div><div id="color-phone-sync" class="color-phone-sync"></div><div class="color-shared-summary"><p id="color-shared-status" class="color-application-status" role="status"></p>${button('Disable browser correction','disable-shared',!activeLeaderPreset()||w.loading)}</div><p class="cal-caption"><a href="#color-adjustments">Adjust color manually</a> for the selected phones, or capture a chart for a measured correction.</p></section>
  <div class="color-layout"><div class="color-setup"><section class="work-section"><div class="section-title"><span class="section-number">1</span><div><h2>Get a reference frame</h2><p>For a chart fit or a before/after image, use the same lighting and camera settings as your capture.</p></div></div>
    <div class="cal-fields color-fields"><label>Leader / reference camera<input id="color-camera" value="${esc(w.camera)}" placeholder="Choose a leader above" readonly></label><div class="color-preset-field"><div class="field-help-label"><label for="color-name">Run / lighting preset name</label>${helpLink('help-color-presets','What is a run / lighting preset name?')}</div><input id="color-name" value="${esc(w.name)}" maxlength="80"></div></div>

    <p class="cal-caption">Default: Calibrite ColorChecker Classic · 24 patches. Match your physical chart, or import a custom reference below.</p>
    ${sourceControls()}
    <details class="cal-details"><summary>Chart layout & custom reference</summary><p>Reference order: left to right, then top to bottom. Rotate the photo to match this layout. Mark the centers of the four corner patches.</p><div class="color-reference-grid" style="grid-template-columns:repeat(${w.chart.columns},1fr)">${w.chart.patches.map((rgb,i)=>`<span style="background:rgb(${rgb.join(',')})" title="Patch ${i+1}: ${rgb.join(', ')}"><small>${i+1}</small></span>`).join('')}</div><p>${esc(w.chart.name)} · ${w.chart.columns} columns × ${w.chart.rows} rows. ${w.chart.id===CLASSIC24.id?`<a href="${CLASSIC24.source}" target="_blank" rel="noreferrer">Classic reference data</a> · post-November 2014, converted to sRGB.`:w.chart.id===SPYDER24.id?`<a href="${SPYDER24.source}" target="_blank" rel="noreferrer">Datacolor reference data</a>`:'User-supplied sRGB values.'}</p>${upload('Import reference JSON','color-reference','.json',w.loading)}<div class="cal-actions">${button('Download reference template','reference-template')}</div><p>The template contains example values. Replace them with verified values for your chart; a printed copy is not a calibrated target.</p></details>
  </section><section class="work-section"><div class="section-title"><span class="section-number">2</span><div><h2>Find chart & calibrate</h2><p>${ready?'Automatic detection locates and orients the patch grid.':'Capture a frame from the leader camera.'}</p></div></div>
    ${ready?`<div class="color-align-wrap"><canvas id="color-alignment" tabindex="0" role="img" aria-label="Chart alignment. In manual mode click corner patch centers or use arrow keys and Enter. Top left, top right, bottom right, bottom left."></canvas></div><p id="color-corner-status" class="cal-caption" role="status" aria-live="polite">${alignmentMessage()}</p>${w.alignment==='manual'?`<div class="color-corner-progress" aria-label="Corner selection">${['Top left','Top right','Bottom right','Bottom left'].map((n,i)=>`<span class="${i<w.corners.length?'complete':''}">${i<w.corners.length?'✓':i+1} ${n}</span>`).join('')}</div>`:''}<div class="cal-actions">${button(w.loading?'Working…':'Auto-calibrate','solve',w.loading,true)}${button('Manual alignment','align',w.loading)}${w.alignment==='manual'?button('Calibrate from points','solve-manual',w.corners.length!==4||w.loading,true):''}${button('Rotate photo ↻','rotate',w.loading)}</div>`:'<div class="cal-empty">'+icon('target',28)+'<p>The detected chart and sampling points will appear here.</p></div>'}
    ${patchChecks()}
    <p class="cal-caption">Show one complete, matching chart with clear gaps between patches. Check that the sampling boxes sit inside each color patch. For camera calibration, photograph the physical chart under your capture lighting; a product listing image can only test the workflow.</p>
  </section></div>
  <div class="color-main"><section class="work-section color-preview-section"><div class="section-heading"><div class="section-title"><span class="section-number">3</span><div><h2>Before / after</h2><p>${ready?esc(w.source):'Your color preview will appear here.'}</p></div></div></div>
    ${ready?`<div class="color-comparison" style="aspect-ratio:${w.image.width}/${w.image.height}"><canvas id="color-before" aria-label="Original photo"></canvas><canvas id="color-after" aria-label="Corrected photo" style="clip-path:inset(0 0 0 ${w.split}%)"></canvas><span class="color-image-label original">Original</span><span class="color-image-label corrected">${fit?'Corrected + adjustments':'Manual preview'}</span><span id="color-divider" style="left:${w.split}%"></span></div><label class="color-comparison-control">Comparison <input id="color-split" type="range" min="0" max="100" value="${w.split}" aria-label="Before after split"></label>`:`<div class="color-preview-empty">${icon('frames',32)}<h3>No reference frame</h3><p>Capture a leader frame or load a saved preset. Manual adjustments also work without a frame.</p></div>`}
    <div class="color-fit-stats"><div><span>Usable chart patches</span><strong>${quality.total?`${quality.usable} / ${quality.total}`:fit?`${fit.accepted} / ${fit.total}`:'—'}</strong></div><div><span>Before fit · RGB error</span><strong>${fit?number(fit.before):'—'}</strong></div><div><span>After fit · RGB error</span><strong>${fit?number(fit.after):'—'}</strong></div></div>
    <p class="cal-caption">${fit?'Error is RGB RMSE (0–255) on the fitted chart, before manual adjustments. It is not an independent accuracy test.':'Calibrate to compare measured patch error. For manual color, choose a leader and use Adjust correction.'}</p>
    <div id="color-status" class="color-status" role="status" aria-live="polite">${esc(w.message)}</div>
    ${fit?`<div class="color-fit-method"><strong>${fit.model==='affine'?'Saved correction':'Standard color correction'}</strong><p>${fit.validation?`Withheld-patch RGB error: ${Number.isFinite(fit.validation.after)?number(fit.validation.after):'unavailable'} (before: ${number(fit.validation.before)}). Each patch is predicted by a fit that excluded it. This is not a test on a separate photo.`:'Saved legacy fit; withheld-patch checks were not recorded.'}</p>${disposition==='review'?'<p>Approximate correction. Held-out patches improved, but the remaining RGB error is above the automatic target of 12. Review the split preview before applying.</p>':disposition==='blocked'?'<p class="color-fit-warning">The withheld patches did not verify this correction. Check the sampling boxes before applying.</p>':''}</div><details class="cal-details"><summary>Correction details</summary><pre class="color-matrix">${fit.matrix.map(row=>row.map(n=>n.toFixed(5).padStart(9)).join(' ')).join('\n')}${fit.offset?.some(n=>n!==0)?`\n\nSaved offset: ${fit.offset.map(n=>n.toFixed(5)).join('  ')}`:''}</pre><p>${fit.model==='affine'?'This older preset retains its saved correction. Recalibrating uses the standard 3 × 3 matrix.':'Uses a 3 × 3 matrix in linear sRGB to correct color balance and exposure.'} Apply combines this correction with the leader’s original sensor transform.</p></details>`:''}
  </section><section id="color-adjustments" class="work-section" tabindex="-1" aria-labelledby="color-adjustments-heading"><div class="section-heading"><div class="section-title"><span class="section-number">4</span><div><h2 id="color-adjustments-heading">Adjust correction</h2><p>Choose a leader and adjust its color manually, or use a chart fit.</p></div></div></div>
    ${w.editingPresetId?`<p class="cal-caption color-editing-preset">Editing preset: <strong>${esc(w.name)}</strong>. Press Apply after reviewing your settings.</p>`:''}
    <div class="color-sliders">${[['amount','Calibration strength',0,100,1,'%'],['exposure','Exposure',-2,2,0.05,' EV'],['warmth','Warmth',-100,100,1,''],['tint','Tint',-100,100,1,''],['saturation','Saturation',0,200,1,'%']].map(([key,label,min,max,step,unit])=>`<label><span>${label}<output id="color-value-${key}">${w.adjust[key]}${unit}</output></span><input type="range" data-color-adjust="${key}" data-unit="${unit}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${w.adjust[key]}" ${w.loading||!ready||key==='amount'&&!fit?'disabled':''}></label>`).join('')}</div>
    <div class="cal-actions">${button('Reset adjustments','reset',w.loading)}${fit&&disposition==='blocked'?button('Use manual adjustments only','manual-only',w.loading):''}${button(disposition==='review'?'Apply approximate correction to leader & followers':fit?'Apply to leader & followers':'Apply manual adjustments to leader & followers','apply',true,true)}${button('Save as new run preset','save-run',(fit&&disposition==='blocked')||w.loading||w.sample||w.captureMeta?.kind!=='rig-video')}${button('Save image profile copy','save',!fit||w.loading)}${button('Download preview PNG','png',!ready||w.loading)}</div><p class="cal-caption"><strong>Apply</strong> sends these settings to the cameras and saves this preset. <strong>Save as new run preset</strong> keeps a separate copy without changing the cameras.</p><p id="color-edit-status" class="cal-caption" role="status">${esc(adjustmentState())}</p><p id="color-adjust-targets" class="cal-caption" role="status"></p>
  </section></div></div>
  <section id="color-saved-presets" class="work-section" tabindex="-1" aria-labelledby="color-saved-presets-heading"><div class="section-heading"><div class="section-title"><span class="section-number">5</span><div><h2 id="color-saved-presets-heading">Saved run presets</h2><p>Choose a saved color setup below. Load restores it for review; Apply sends it to the cameras.</p></div></div></div>
    <div id="color-preset-browser">${savedPresetBrowser()}</div>
    <p id="color-preset-notice" class="cal-caption" role="status">${esc(presetNotice)}</p>
    <p class="cal-caption">Up to 12 presets are kept in this browser. Use the same cameras and lighting when reusing a setup.</p>
    ${w.profiles.length?`<details class="cal-details"><summary>Image profile copies</summary><div class="color-profile-list">${w.profiles.slice().reverse().map(p=>`<article><div><span class="pill neutral">Image-space profile</span><h3>${esc(p.name)}</h3><p>${esc(p.camera)} · ${esc(p.chart.name)} · ${new Date(p.createdAt).toLocaleString()}</p></div>${button('Export JSON',`export:${p.id}`)}</article>`).join('')}</div></details>`:''}
  </section>`;
}

function alignmentMessage() {
  if(w.loading)return 'Working on the reference frame…';
  if(w.samples.length){
    const {usable,total}=patchQualitySummary(w.samples);
    if(usable<MIN_USABLE_PATCHES)return `${usable} of ${total} usable patches. At least ${MIN_USABLE_PATCHES} are required. Inspect the marked patches and retake the chart.`;
    return `${usable} of ${total} usable patches. ${usable<total?'Orange patches are excluded from the fit.':'All patches passed.'}`;
  }
  if(w.detection)return `Chart detected: ${w.detection.matched} / ${w.detection.total} patch positions. Check the green sampling boxes before saving.`;
  if(w.alignment==='auto')return 'Choose Auto-calibrate to detect the chart and calculate the correction.';
  if(w.corners.length===4)return 'All four points are marked. Click Calibrate from points next.';
  const label=(cornerNames[w.chart.id]||['top-left','top-right','bottom-right','bottom-left'])[w.corners.length];
  return `Click the ${label} patch center (${w.corners.length+1}/4). Keyboard: arrows move the crosshair; Enter selects.`;
}

function clearFit() {w.fit=null;w.samples=[];w.detection=null;w.adjust=defaultAdjustments();previewPixels=null;appliedAdjustments=defaultAdjustments();}
function draw(root,recompute=false) {
  if(!w.image)return;
  const before=root.querySelector('#color-before'),after=root.querySelector('#color-after'),alignment=root.querySelector('#color-alignment');
  if(!before||!after||!alignment)return;
  for(const canvas of [before,after,alignment]){canvas.width=w.image.width;canvas.height=w.image.height;}
  before.getContext('2d',{colorSpace:'srgb'}).putImageData(w.image,0,0);
  if(!previewPixels||recompute)previewPixels=correctedPixels(w.image,w.fit?.matrix||IDENTITY,appliedAdjustments,w.fit?.offset);
  after.getContext('2d',{colorSpace:'srgb'}).putImageData(new ImageData(previewPixels,w.image.width,w.image.height),0,0);
  drawAlignment(alignment);
}

function drawAlignment(canvas) {
  const c=canvas.getContext('2d',{colorSpace:'srgb'}),{width,height}=w.image;
  c.putImageData(w.image,0,0);c.lineWidth=3;c.strokeStyle='#82ffbb';c.fillStyle='#153f29';
  if(w.corners.length===4)try {
    const project=chartProjection(w.corners);
    for(let r=0;r<w.chart.rows;r++)for(let col=0;col<w.chart.columns;col++) {
      const u=col/(w.chart.columns-1),v=r/(w.chart.rows-1),du=PATCH_HALF_WIDTH/(w.chart.columns-1),dv=PATCH_HALF_WIDTH/(w.chart.rows-1);
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
function redraw(root) {root=root?.isConnected?root:activeRoot;if(!root?.isConnected)return;overview?.rememberScroll();root.innerHTML=markup();overview?.mount(root.querySelector('#color-camera-overview'));updateLiveColor();draw(root);}
function clearReference(){w.image=null;w.source='';w.captureMeta=null;w.phoneApplication=null;w.sample=false;w.corners=[];w.editingPresetId=null;clearFit();showOriginal=false;liveError='';}

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

async function rigStatus({background=false}={}) {
  const operation=rigOperation, generation=viewGeneration;
  const response=await fetch('/api/rig/status',{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Could not read the rig. Check the local server and refresh cameras.');
  const status=await response.json();
  if(background && (operation!==rigOperation || generation!==viewGeneration || w.loading))return null;
  w.rig=status;
  const phones=availableColorCameras(status);
  if(!status.phones?.some(p=>p.responding && p.id===w.rigId))w.rigId='';
  w.rigMessage=status.connected?`${phones.length} live preview${phones.length===1?'':'s'} available.`:'Rig status unavailable. Check the local server and refresh cameras.';
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
        const color=phone.state?.colorProcessing;
        if(color?.awbMode!=='OFF'||color.colorCorrectionMode!=='TRANSFORM_MATRIX'){
          if(!displayedPhoneIds.includes(id))throw new Error('Select the leader in Prepare rig before locking its white balance.');
          rigOperation++;
          w.message=`Locking ${phone.name} white balance before capturing the chart…`;redraw(root);
          const locked=await syncPhoneColor(status,[id],id,false,'measure');
          if(generation!==viewGeneration)return;
          const updated=availableColorCameras(locked).find(p=>colorSourceKey(rigColorSource(p,locked))===colorSourceKey(source));
          if(!updated)throw new Error('White balance was measured. Reconnect the leader preview to capture the chart.');
          w.rig=locked;camera.source=rigColorSource(updated,locked);
        }else camera.source=rigColorSource(phone,status);
      }
      const frame=await camera.capture();if(generation!==viewGeneration)return;
      w.image=frame.image;w.captureMeta=frame.source;w.sample=false;w.camera=frame.source.cameraName;w.editingPresetId=null;w.phoneApplication=null;
      if(!w.name.trim())w.name=`${w.camera} · ${new Date().toLocaleDateString()}`;
      w.source=`${frame.source.cameraName} · video frame · ${new Date(frame.source.capturedAt).toLocaleTimeString()}`;
      w.corners=[];w.alignment='auto';clearFit();w.message='Frame captured. Finding the chart…';redraw(root);
    }
    if(!w.image)throw new Error('Capture a leader frame or load a saved frame first.');
    clearFit();
    if(!manual){w.corners=[];w.alignment='auto';const detection=await findChart(w.image,w.chart);if(generation!==viewGeneration)return;w.detection=detection;w.corners=detection.corners;}
    w.samples=sampleChart(w.image,w.chart,w.corners,w.detection?.matchedIndices);w.fit=fitColor(w.samples);previewPixels=null;
    const disposition=fitDisposition(w.fit);
    w.message=`Correction calculated from ${w.fit.accepted} patches. `+
      (disposition==='review'?'Check the approximate correction in Before / after.':
       disposition==='blocked'?'The fit could not be verified on withheld patches. Check the marked squares.':
       'Review the before/after comparison.');
    if(disposition==='automatic'&&capture&&w.captureMeta?.kind==='rig-video')await applyCurrentProfile();
  }catch(error){if(generation===viewGeneration)w.message=`${error.message}${capture&&activeLeaderPreset()?' The existing shared preset has not been replaced.':''}`;}
  finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

async function synchronizePhones(root, retry) {
  const generation=viewGeneration;
  const ids=displayedPhoneIds;
  rigOperation++;
  w.loading=true;
  syncMessage=retry?'Checking phones against the last snapshot…':syncSource==='current'?'Copying the leader’s current settings…':'Waiting for the leader to lock white balance…';
  redraw(root);
  try {
    const status=await syncPhoneColor(w.rig,ids,w.rigId,retry,syncSource);
    if(generation!==viewGeneration)return;
    w.rig=status;
    const all=status.colorSync.results.every(result=>result.ok);
    syncMessage=all?'Settings matched. Check neutral patches from each angle before capture.':'Some phones did not match. See the per-phone results below.';

    if(camera.source?.kind==='rig-video'){
      const phone=availableColorCameras(status).find(p=>p.id===camera.source.cameraId);
      if(phone)camera.source=rigColorSource(phone,status);else camera.close();
    }
  }catch(error){
    if(generation!==viewGeneration)return;
    syncMessage=error.message+' Refresh camera status before retrying.';
  }finally{if(generation===viewGeneration){w.loading=false;redraw(root);}}
}

async function command(action,root) {
  if(w.loading)return;
  const generation=viewGeneration;
  try {
    if(action==='sync-color'||action==='retry-color'){await synchronizePhones(root,action==='retry-color');return;}
    if(action==='solve'||action==='capture'||action==='solve-manual'){await calibrate(root,{capture:action==='capture',manual:action==='solve-manual'});return;}
    if(action==='refresh-cameras') {w.loading=true;redraw(root);await rigStatus();if(generation!==viewGeneration)return;refreshBindings();w.loading=false;
    } else if(action==='connect-rig'||action.startsWith('inspect:')) {
      const id=action.startsWith('inspect:')?action.slice(8):w.rigId;
      if(w.rigId!==id){camera.close();clearReference();w.message='';}
      w.rigId=id;w.camera=w.rig?.phones.find(p=>p.id===id)?.name||'';syncMessage='';
      if(!id){redraw(root);return;}
      w.loading=true;redraw(root);
      const status=await rigStatus(),phone=status.phones?.find(p=>p.id===id&&p.responding);
      if(generation!==viewGeneration)return;
      if(!phone)throw new Error('That camera is unavailable. Refresh cameras and check its connection in Prepare rig.');
      restoreManualLeader(phone,status);w.camera=phone.name;
      if(availableColorCameras(status).some(p=>p.id===id))camera.connectRig(phone,status,location.origin);
      else camera.close();
      w.loading=false;w.message=`Leader: ${phone.name}. Use Adjust correction for manual color, or ${camera.video?'capture a chart for a measured fit':'start its preview in Prepare rig to capture a chart'}.`;
    } else if(action==='toggle-original') {showOriginal=!showOriginal;updateLiveColor();return;
    } else if(action==='disable-shared'){leaderState=selectLeaderPreset(localStorage,null);w.message='Shared correction disabled. All rig previews show original video. Saved presets are kept.';
    } else if(action.startsWith('remove-preset:')){
      const id=action.slice(14),name=leaderState.presets.find(p=>p.id===id)?.name||'Preset';
      leaderState=removeLeaderPreset(localStorage,id);if(w.editingPresetId===id)w.editingPresetId=null;
      presetNotice=`Deleted “${name}” from saved presets.`;w.message=presetNotice;redraw(root);
      root.querySelector(leaderState.presets.length?'#color-preset-select':'#color-saved-presets')?.focus({preventScroll:true});return;
    } else if(action.startsWith('load-preset:')){await loadPreset(action.slice(12),root);if(generation===viewGeneration)focusColorSection('color-adjustments');return;
    } else if(action==='apply'||action==='save-run') {
      w.loading=true;redraw(root);await applyCurrentProfile({newPreset:action==='save-run',toPhones:action==='apply'});if(generation!==viewGeneration)return;w.loading=false;
    } else if(action==='align') {w.corners=[];w.alignment='manual';clearFit();w.message='Mark the four corner patch centers in order. Calibrate from points will become available after the fourth point.';
    } else if(action==='rotate'&&w.image) {
      const source=document.createElement('canvas');source.width=w.image.width;source.height=w.image.height;source.getContext('2d').putImageData(w.image,0,0);
      const canvas=document.createElement('canvas');canvas.width=source.height;canvas.height=source.width;
      const c=canvas.getContext('2d');c.translate(canvas.width,0);c.rotate(Math.PI/2);c.drawImage(source,0,0);
      w.image=c.getImageData(0,0,canvas.width,canvas.height);w.corners=[];w.alignment='auto';clearFit();w.message='Photo rotated. Press Auto-calibrate to find the chart again.';
    } else if(action==='manual-only') {w.fit=null;previewPixels=null;w.message='Chart fit discarded. Press Apply to use your manual adjustments.';
    } else if(action==='reset') {w.adjust=defaultAdjustments();w.message='Reset staged. Press Apply to use the default adjustments.';
    } else if(action==='save') {
      if(!w.fit)return;
      const profile=profileSnapshot();
      const profiles=[...w.profiles,profile].slice(-20);localStorage.setItem(STORAGE,JSON.stringify(profiles));w.profiles=profiles;w.message='Color profile saved in this browser. Export JSON for a portable copy. No phone settings changed.';
    } else if(action.startsWith('export:')) {
      const profile=w.profiles.find(p=>p.id===action.slice(7));if(profile)download(profile,`color-profile-${profile.id}.json`);return;
    } else if(action==='reference-template') {
      download({name:'Replace with your measured chart',colorSpace:'sRGB',columns:w.chart.columns,rows:w.chart.rows,source:'Replace with reference source and illuminant',patches:w.chart.patches},'color-chart-reference-template.json');return;
    } else if(action==='png') {
      draw(root,true);
      root.querySelector('#color-after')?.toBlob(blob=>{if(blob)download(blob,'color-preview.png');},'image/png');return;
    }
    redraw(root);
  }catch(error){
    if(generation!==viewGeneration)return;
    w.loading=false;
    if(action==='apply'&&!w.image&&error.code==='COLOR_REFERENCE_CHANGED'){
      w.captureMeta=null;w.phoneApplication=null;w.editingPresetId=null;
      error.message='Leader settings changed. Press Apply again to use its current settings as the starting point.';
    }
    showError(root,error);
  }
}

function addCorner(root,point) {
  if(w.alignment!=='manual'||w.corners.length===4||w.loading)return;
  w.corners.push(point);w.cursor=point;clearFit();redraw(root);root.querySelector('#color-alignment')?.focus({preventScroll:true});
}

export function mountColorWorkbench(root) {
  activeRoot=root;
  if(!root){viewGeneration++;camera.close();liveColor?.close();liveColor=null;overview?.close();overview=null;clearInterval(pollTimer);pollTimer=null;cancelDetection();w.loading=false;return;}
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
    if(el.id==='color-name')w.name=el.value;
    if(el.id==='color-split'){w.split=Number(el.value);root.querySelector('#color-after').style.clipPath=`inset(0 0 0 ${w.split}%)`;root.querySelector('#color-divider').style.left=`${w.split}%`;}
    if(key){w.adjust[key]=Number(el.value);root.querySelector(`#color-value-${key}`).textContent=`${el.value}${el.dataset.unit}`;root.querySelector('#color-edit-status').textContent=adjustmentState();}
  };
  root.onchange=async event=>{
    const el=event.target;
    try {
      if(w.loading)return;
      if(el.id==='color-preset-select'){browsedPresetId=el.value;refreshPresetBrowser(root,el.id);return;}
      if(el.id==='color-preset-sort'){
        if(PRESET_SORTS.some(([value])=>value===el.value))presetSort=el.value;
        refreshPresetBrowser(root,el.id);return;
      }
      if(el.id==='color-sync-source'){syncSource=el.value;syncMessage='';updateLiveColor();}
      if(el.id==='color-sync-leader')await command(`inspect:${el.value}`,root);
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
