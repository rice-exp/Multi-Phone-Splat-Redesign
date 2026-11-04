import {icon,esc} from './icons.js';
import {workflowNavigation} from './workflow.js';
import {formatMs} from './frame-review-model.js';

const app=document.getElementById('app'),overlays=document.getElementById('overlay-root');
const $=id=>document.getElementById(id);
const state={library:null,session:null,frame:null,position:0,loading:false,playing:false,visible:new Set(),onlyIssues:false,rotation:0};
let sessionRequest,frameRequest,libraryRequest,timer,dialogTrigger;
const action=(label,id,style='secondary',extra='')=>`<button class="button ${style}" data-review="${id}" ${extra}>${label}</button>`;
const section=(n,title,description)=>`<div class="section-heading"><div class="section-title"><span class="section-number">${n}</span><div><h2>${title}</h2><p>${description}</p></div></div></div>`;
app.innerHTML=`<a class="skip-link" href="#workspace">Skip to workspace</a><aside class="sidebar">
  <a class="brand" href="/">${icon('aperture',30)}<div><span>Rice Experiential Pixels Lab</span><small>CAPTURE WORKSPACE</small></div></a>
  <div class="sidebar-label">WORKFLOW</div><nav class="step-nav" aria-label="Capture workflow">${workflowNavigation('frames')}</nav><div class="sidebar-bottom"><div class="rig-card">${icon('folder',22)}<div><strong>Saved captures</strong><span>Files on the lab computer</span></div></div><a class="sidebar-action" href="/">${icon('back',18)} Back to Prepare rig</a></div></aside>
  <div class="main-shell review-shell"><header class="topbar"><div class="breadcrumb">Capture workspace ${icon('chevron',14)} <strong>Frame review</strong></div><span class="simulation-label rig-live-label">Saved capture files</span></header>
  <main id="workspace" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">STEP 04 OF 06</div><h1>Frame review</h1><p>Compare saved images at the same sequence index.</p></div>${action(`${icon('refresh',16)} Refresh sessions`,'refresh','secondary','id="review-refresh"')}</div>
  <div id="review-error" role="alert"></div>
  <section class="work-section">${section(1,'Choose a capture','Open a transferred session from the lab computer.')}
    <div class="review-session-row"><label>Capture session<select id="review-session" disabled><option value="">Loading sessions…</option></select></label>${action('Reload session','reload','secondary','id="review-reload" disabled')}${action(`${icon('download',16)} Export review summary`,'export','secondary','id="review-export" disabled')}</div>
    <p id="review-session-info" class="rig-caption" role="status"></p>
    <details class="review-source"><summary>Capture folder and setup</summary><p id="review-root"></p><p>Reads <code>frames / SESSION / frame-manifest.json</code> and its image folders. To use an existing capture folder, set <code>RIG_CAPTURE_ROOT</code> to the folder containing <code>frames</code> before starting the server.</p><p>CameraScope and the original webapp do not need to run for this review.</p></details>
    <div id="review-empty" hidden></div><div id="review-summary" class="review-summary" hidden></div>
  </section>
  <section class="work-section" id="review-controls" hidden>${section(2,'Choose a frame','All camera views use the same sequence index. Left / right arrows step through frames.')}
    <div class="review-transport">${action(icon('back',17),'previous','secondary','id="review-previous" aria-label="Previous frame"')}${action(`${icon('play',17)} Play`,'play','primary','id="review-play"')}${action(icon('arrow',17),'next','secondary','id="review-next" aria-label="Next frame"')}
      <label class="review-position-label">Position<input id="review-position" type="number" min="1" step="1" value="1"></label><span id="review-position-total"></span>
      <label class="review-speed-label">Review speed<select id="review-speed"><option value="1">1 frame / sec</option><option value="2" selected>2 frames / sec</option><option value="5">5 frames / sec</option></select></label>
      ${action('Next recorded issue','issue','secondary','id="review-next-issue"')}
    </div><label class="review-timeline-label" for="review-scrubber">Frame position</label><input id="review-scrubber" type="range" min="0" max="0" value="0" step="1"><div class="review-frame-heading"><strong id="review-frame-label"></strong><span id="review-frame-status" role="status"></span></div>
    <p class="rig-caption">Review playback waits for images and may be slower than the capture rate.</p>
  </section>
  <section class="work-section" id="review-images" hidden>${section(3,'Inspect camera images','Open an image to enlarge it, or Details for timing and recovery steps.')}
    <div class="review-view-tools"><fieldset id="review-camera-filter"><legend>Show cameras</legend></fieldset><label class="review-issues-toggle"><input id="review-only-issues" type="checkbox"> Only unavailable images</label><label>Display rotation<select id="review-rotation"><option value="0">Original</option><option value="90">90° clockwise</option><option value="-90">90° counterclockwise</option><option value="180">180°</option></select></label></div>
    <div id="review-current-metrics" class="review-current-metrics"></div><div id="review-grid" class="review-grid" aria-busy="false"></div>
    <details class="review-timing-help"><summary>How to read timing</summary><p>Spread is the difference between the earliest and latest reported <code>actualLeaderNs</code> at this sequence index. It requires at least two valid timestamps. Group offsets use the manifest’s group reference; planned phase offsets can intentionally separate exposures. These values do not certify sensor synchronization.</p></details>
  </section><div class="step-footer"><span class="footer-hint">Review does not change capture files or retry transfers.</span><div class="next-action"><small>Reconstruction integration is pending.</small><button class="button primary" disabled>Continue to reconstruction ${icon('arrow',17)}</button></div></div>
  </main><footer class="app-footer"><span>Frame review · Saved CameraScope captures</span></footer></div>`;
const narrowLayout=matchMedia('(max-width:760px)');
function centerActiveStep(){if(narrowLayout.matches)document.querySelector('.nav-step.active')?.scrollIntoView({block:'nearest',inline:'center'});}
centerActiveStep();narrowLayout.addEventListener('change',centerActiveStep);

async function request(url,signal) {
  const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||`HTTP ${response.status}`),result);
  return result;
}
function errorMessage(error) {
  $('review-error').innerHTML=error?`<div class="notice warning-notice">${icon('warning',20)}<div><strong>${esc(error.message)}</strong><p>${esc(error.next||'Check that the local server is running, then refresh.')}</p></div></div>`:'';
}
function pause(){state.playing=false;clearTimeout(timer);$('review-play').innerHTML=`${icon('play',17)} Play`;}
async function waitForImages(images,signal){
  let timeout,onAbort;
  try {
    return await Promise.race([
      Promise.all(images.map(image=>image.decode().catch(()=>{}))).then(()=>true),
      new Promise(resolve=>{timeout=setTimeout(()=>resolve(false),15000);}),
      new Promise(resolve=>{onAbort=()=>resolve(false);signal.addEventListener('abort',onAbort,{once:true});if(signal.aborted)resolve(false);})
    ]);
  }finally{clearTimeout(timeout);signal.removeEventListener('abort',onAbort);}
}
function closeDialog(){overlays.querySelector('dialog')?.close();overlays.replaceChildren();dialogTrigger?.focus();}
function dialog(title,content,wide=false){
  pause();dialogTrigger=document.activeElement;
  overlays.innerHTML=`<dialog class="app-dialog ${wide?'review-image-dialog':''}" aria-labelledby="review-dialog-title"><div class="dialog-heading"><h2 id="review-dialog-title">${esc(title)}</h2><button class="icon-button" data-review="close" aria-label="Close dialog">${icon('close')}</button></div><div class="issue-dialog-body">${content}</div><footer class="dialog-footer">${action('Close','close','primary')}</footer></dialog>`;
  const el=overlays.querySelector('dialog'),trigger=dialogTrigger;
  el.addEventListener('close',()=>{el.remove();if(!overlays.querySelector('dialog'))trigger?.focus();});el.showModal();
}
function updateControls(){
  const total=state.session?.frames.length||0,hasFrames=total>0;
  $('review-controls').hidden=!hasFrames;$('review-images').hidden=!hasFrames;
  $('review-reload').disabled=!$('review-session').value||state.loading;
  $('review-export').disabled=!state.session||state.loading;
  $('review-previous').disabled=state.position<=0||state.loading;
  $('review-next').disabled=state.position>=total-1||state.loading;
  $('review-play').disabled=!hasFrames||state.loading;
  $('review-position').max=String(total);$('review-position').value=String(state.position+1);
  $('review-position').disabled=state.loading;$('review-position-total').textContent=`of ${total}`;
  $('review-scrubber').max=String(Math.max(0,total-1));$('review-scrubber').value=String(state.position);$('review-scrubber').disabled=state.loading;
  $('review-next-issue').disabled=!state.session?.frames.some(frame=>frame.issues)||state.loading;
  const item=state.session?.frames[state.position];
  $('review-frame-label').textContent=item?`Sequence index ${item.index} · Position ${state.position+1} of ${total}`:'';
}
async function library(){
  pause();libraryRequest?.abort();sessionRequest?.abort();frameRequest?.abort();
  const controller=libraryRequest=new AbortController();
  const previous=$('review-session').value||new URL(location.href).searchParams.get('session');
  state.session=null;state.frame=null;state.loading=true;updateControls();$('review-summary').hidden=true;
  $('review-refresh').disabled=true;$('review-session').disabled=true;$('review-empty').hidden=true;errorMessage(null);
  try {
    state.library=await request('/api/review/sessions',controller.signal);
    if(controller!==libraryRequest)return;
    const sessions=state.library.sessions;
    $('review-root').textContent=`Capture folder: ${state.library.captureRoot}`;
    $('review-session').innerHTML=sessions.length?sessions.map(session=>`<option value="${esc(session.id)}">${esc(session.id)}${session.error?' · Needs attention':''}</option>`).join(''):'<option value="">No transferred sessions</option>';
    $('review-session').disabled=!sessions.length;
    $('review-empty').hidden=!!sessions.length;
    $('review-empty').innerHTML=`<div class="rig-empty">${icon('folder',32)}<h3>No transferred captures found</h3><p>Finish a transfer or point the server to an existing capture folder. Open “Capture folder and setup” above for the expected structure.</p></div>`;
    $('review-session-info').textContent=sessions.length?`${sessions.length} saved session${sessions.length===1?'':'s'}`:'No transferred captures available.';
    if(sessions.length){$('review-session').value=sessions.some(item=>item.id===previous)?previous:sessions[0].id;await loadSession();}
  }catch(error){if(!controller.signal.aborted){errorMessage(error);$('review-session').innerHTML='<option value="">Session list unavailable</option>';$('review-session-info').textContent='Refresh sessions to retry.';}}
  finally{if(controller===libraryRequest){state.loading=false;$('review-refresh').disabled=false;updateControls();}}
}
async function loadSession(){
  pause();sessionRequest?.abort();frameRequest?.abort();closeDialog();
  const controller=sessionRequest=new AbortController(),id=$('review-session').value;
  if(!id)return;
  state.loading=true;state.session=null;state.frame=null;state.position=0;state.onlyIssues=false;$('review-only-issues').checked=false;
  $('review-summary').hidden=true;updateControls();errorMessage(null);$('review-session-info').textContent='Loading capture manifest…';
  try{
    const session=await request(`/api/review/session?${new URLSearchParams({session:id})}`,controller.signal);
    if(controller!==sessionRequest)return;
    state.session=session;state.visible=new Set(session.cameras.map(camera=>camera.id));
    const query=new URL(location.href).searchParams;
    const position=query.get('session')===id?session.frames.findIndex(frame=>String(frame.index)===query.get('index')):-1;
    state.position=position<0?0:position;
    const stats=[['Recorded transfers',session.totals.recordedTransfers],['Capture drops',session.totals.captureDropped],['Transfer failures',session.totals.transferFailed],['Unknown / no record',session.totals.unknown]];
    $('review-summary').hidden=false;$('review-summary').innerHTML=stats.map(([label,value])=>`<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('review-session-info').textContent=`${session.frames.length} sequence positions · ${session.cameras.length} cameras · Capture interval: ${formatMs(session.intervalMs)}${session.missingSequenceCount?` · ${session.missingSequenceCount} expected sequence positions absent from manifest`:''}. Counts describe the manifest; local files are checked as each frame opens.`;
    $('review-camera-filter').innerHTML=`<legend>Show cameras</legend>${session.cameras.map(camera=>`<label><input type="checkbox" data-review-camera="${esc(camera.id)}" checked>${esc(camera.name)}</label>`).join('')}`;
    state.loading=false;updateControls();
    if(session.frames.length)await showFrame(state.position);
    else $('review-session-info').textContent='This manifest contains no frame entries. Finish the transfer, then reload the session.';
  }catch(error){if(!controller.signal.aborted){errorMessage(error);$('review-session-info').textContent='Session could not be opened. Correct the problem and reload.';}}
  finally{if(controller===sessionRequest){state.loading=false;updateControls();}}
}
async function showFrame(position){
  if(!state.session?.frames.length)return;
  frameRequest?.abort();const controller=frameRequest=new AbortController();
  state.position=Math.max(0,Math.min(state.session.frames.length-1,Math.trunc(position)||0));state.frame=null;
  const sequence=state.session.frames[state.position].index;
  updateControls();$('review-grid').setAttribute('aria-busy','true');$('review-grid').innerHTML='<div class="rig-empty">Loading saved images…</div>';
  $('review-current-metrics').replaceChildren();$('review-frame-status').textContent='Loading frame…';errorMessage(null);
  history.replaceState(null,'',`/frames?${new URLSearchParams({session:state.session.session,index:String(sequence)})}`);
  try {
    const frame=await request(`/api/review/frame?${new URLSearchParams({session:state.session.session,index:String(sequence),revision:state.session.revision})}`,controller.signal);
    if(controller!==frameRequest)return;
    state.frame=frame;renderImages();
    // Wait for image decoding before advancing. Old frames are removed while
    // loading, so a failed request cannot be mistaken for the selected index.
    const decoded=await waitForImages([...$('review-grid').querySelectorAll('img')],controller.signal);
    if(controller!==frameRequest)return;
    if(!decoded){pause();$('review-frame-status').textContent='Images are taking too long to load. Reload the session to retry.';}
    if(state.playing){if(state.position>=state.session.frames.length-1)pause();else timer=setTimeout(()=>showFrame(state.position+1),1000/Number($('review-speed').value));}
  }catch(error){if(!controller.signal.aborted){pause();errorMessage(error);$('review-grid').innerHTML='<div class="rig-empty">This frame could not be loaded. Reload the session to retry.</div>';$('review-frame-status').textContent='Frame unavailable';}}
  finally{if(controller===frameRequest)$('review-grid').setAttribute('aria-busy','false');}
}
function renderImages(){
  const frame=state.frame;if(!frame)return;
  const available=frame.files.filter(file=>file.state==='available').length;
  $('review-frame-status').textContent=`${available} of ${frame.files.length} image files available`;
  $('review-current-metrics').innerHTML=`<span><b>Reported timing spread</b> ${formatMs(frame.spreadMs)}</span><span>${frame.timingSamples} of ${frame.files.length} timestamps</span>${state.session.phaseStaggerMs?`<span>Planned stagger: ${formatMs(state.session.phaseStaggerMs)} / phone</span>`:''}`;
  const files=frame.files.filter(file=>state.visible.has(file.id)&&(!state.onlyIssues||file.state!=='available'));
  $('review-grid').innerHTML=files.map(file=>`<article class="camera-card review-card"><button class="review-image ${Math.abs(state.rotation)===90?'quarter-turn':''}" style="--review-rotation:${state.rotation}deg" data-review="enlarge" data-camera="${esc(file.id)}" aria-label="Enlarge ${esc(file.name)}, sequence ${frame.index}" ${file.url?'':'disabled'}>${file.url?`<img src="${esc(file.url)}" alt="${esc(file.name)} at sequence ${frame.index}" decoding="async">`:`<span>${icon('frames',28)}<strong>${esc(file.label)}</strong></span>`}</button><div class="review-card-body"><div class="review-card-heading"><strong>${esc(file.name)}</strong><span class="pill ${file.state==='available'?'neutral':'warning'}">${esc(file.label)}</span></div><div class="review-card-timing"><span>Group offset</span><b>${formatMs(file.offsetMs,true)}</b></div>${file.state!=='available'?`<p>${esc(file.next)}</p>`:''}<div class="review-card-footer"><span>Sequence ${frame.index}</span>${action('Details','details','text-button',`data-camera="${esc(file.id)}"`)}</div></div></article>`).join('')||'<div class="rig-empty">No camera images match these display filters.</div>';
  $('review-grid').querySelectorAll('img').forEach(image=>image.addEventListener('error',()=>{
    if(frame!==state.frame||!image.isConnected)return;
    const card=image.closest('.review-card'),button=card.querySelector('.review-image');
    const file=frame.files.find(file=>file.id===button.dataset.camera);
    file.state='display_failed';file.label='Image load failed';file.next='The file was found, but the browser could not display it. Reload the session and check for a corrupt image or interrupted server connection.';file.url=null;
    button.disabled=true;button.innerHTML=`<span>${icon('warning',28)}<strong>Image could not be displayed</strong><small>Reload the session. Check for a corrupt file or interrupted server connection.</small></span>`;
    card.querySelector('.pill').textContent='Image load failed';card.querySelector('.pill').className='pill warning';
    $('review-frame-status').textContent='Some image files could not be displayed. Reload the session to retry.';
    pause();
  },{once:true}));
}
function details(id){
  const file=state.frame?.files.find(file=>file.id===id);if(!file)return;
  dialog(`${file.name} · Sequence ${state.frame.index}`,`<p><strong>${esc(file.label)}</strong></p><p>${esc(file.next)}</p><dl class="issue-facts"><dt>File</dt><dd>${esc(file.file||'No transferred file recorded')}</dd><dt>Host at capture</dt><dd>${esc(file.host||'Not recorded')}</dd><dt>Actual leader timestamp</dt><dd>${esc(file.actualLeaderNs??'Unavailable')}${file.actualLeaderNs?' ns':''}</dd><dt>Group offset</dt><dd>${formatMs(file.offsetMs,true)}</dd><dt>Planned phase offset</dt><dd>${formatMs(file.phaseOffsetMs,true)}</dd><dt>Target timing error</dt><dd>${formatMs(file.targetErrorMs,true)}</dd></dl>${file.error?`<p class="text-warning">${esc(file.error)}</p>`:''}<details class="technical-details"><summary>Frame record</summary><pre>${esc(JSON.stringify(file,null,2))}</pre></details>`);
}
function enlarge(id){
  const file=state.frame?.files.find(file=>file.id===id);if(!file?.url)return;
  dialog(`${file.name} · Sequence ${state.frame.index}`,`<div class="review-image-tools"><label>Zoom<select id="review-zoom"><option value="1">Fit</option><option value="1.5">150%</option><option value="2">200%</option><option value="3">300%</option></select></label><span>Scroll to inspect enlarged images. Display changes do not edit files.</span></div><div class="review-zoom-viewport"><div class="review-zoom-surface"><img src="${esc(file.url)}" alt="${esc(file.name)} at sequence ${state.frame.index}" style="transform:rotate(${state.rotation}deg) scale(${Math.abs(state.rotation)===90?0.66:1})"></div></div>`,true);
  $('review-zoom').addEventListener('change',()=>{const surface=overlays.querySelector('.review-zoom-surface');surface.style.width=`${Number($('review-zoom').value)*100}%`;surface.style.height=`${Number($('review-zoom').value)*100}%`;});
  overlays.querySelector('img').addEventListener('error',()=>{overlays.querySelector('.review-zoom-viewport').textContent='Image could not be displayed. Reload the session and check the source file.';});
}
function exportSummary(){
  if(!state.session)return;
  const report={exportedAt:new Date().toISOString(),purpose:'Read-only frame review snapshot; not capture approval or reconstruction input.',session:state.session,currentFrame:state.frame,visibleCameras:[...state.visible]};
  const blob=new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=`${state.session.session.replace(/[^a-zA-Z0-9_-]/g,'_')}-review.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const actions={refresh:library,reload:loadSession,previous:()=>{pause();showFrame(state.position-1);},next:()=>{pause();showFrame(state.position+1);},
  play:()=>{if(state.playing){pause();return;}state.playing=true;$('review-play').innerHTML=`${icon('pause',17)} Pause`;showFrame(state.position>=state.session.frames.length-1?0:state.position);},
  issue:()=>{pause();const frames=state.session.frames;const next=frames.findIndex((frame,index)=>index>state.position&&frame.issues);showFrame(next<0?frames.findIndex(frame=>frame.issues):next);},
  details:button=>details(button.dataset.camera),enlarge:button=>enlarge(button.dataset.camera),close:closeDialog,export:exportSummary};
document.addEventListener('click',event=>{const button=event.target.closest('[data-review]');if(button&&!button.disabled)actions[button.dataset.review]?.(button);});
$('review-session').addEventListener('change',loadSession);
$('review-scrubber').addEventListener('input',event=>{pause();showFrame(Number(event.target.value));});
$('review-position').addEventListener('change',event=>{pause();showFrame(Number(event.target.value)-1);});
$('review-speed').addEventListener('change',()=>{if(state.playing){clearTimeout(timer);showFrame(state.position);}});
$('review-only-issues').addEventListener('change',event=>{pause();state.onlyIssues=event.target.checked;renderImages();});
$('review-rotation').addEventListener('change',event=>{pause();state.rotation=Number(event.target.value);renderImages();});
$('review-camera-filter').addEventListener('change',event=>{const id=event.target.dataset.reviewCamera;if(id){pause();event.target.checked?state.visible.add(id):state.visible.delete(id);renderImages();}});
document.addEventListener('keydown',event=>{
  if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.target.closest('input,select,textarea,button,a,[contenteditable]')||overlays.querySelector('dialog')||!state.session?.frames.length||state.loading)return;
  if(['ArrowLeft','ArrowRight',' '].includes(event.key)){event.preventDefault();actions[event.key==='ArrowLeft'?'previous':event.key==='ArrowRight'?'next':'play']();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
window.addEventListener('pagehide',()=>{pause();libraryRequest?.abort();sessionRequest?.abort();frameRequest?.abort();});
await library();
