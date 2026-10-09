import {STEPS,restoreState,saveState,makeEvent,selectedCameras,setAllCameras,toggleCamera,completeReadiness,captureBlocker,generationBlocker,createTake,recoverTransfers,applySettings,formatTime} from './model.js';
import {shell,VIEW,button,settingsDialog,issueDialog,cameraCard,phaseTitle,phaseDescription,participantIndex} from './views.js';
import {icon,esc} from './icons.js';
import {settingsFilter} from './preview.js';
import {mountViewer} from './viewer.js';

let state=restoreState();
const context={serverOnline:true,displays:0,frameIndex:0};
const app=document.querySelector('#app'),overlays=document.querySelector('#overlay-root');
let viewer,jobTimer,toastTimer,participantWindow,draftSettings,checking=false,relayBusy=false,relayPending=false;
let logOpen=false,logFollow=true,logUnread=0,logFilters={search:'',level:'all',camera:'all'};
const busy=()=>state.capture.status==='running'||state.reconstruction.status==='running';
const persist=()=>{if(!saveState(state))toast('Browser storage is unavailable. Export your session summary to keep this work.');};
const byId=id=>document.getElementById(id);
function toast(message){const el=byId('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4500);}
function record(level,message,extra={}) {
  const event=makeEvent(level,message,{stage:state.step,...extra});
  state.events=[...state.events,event].slice(-500);persist();
  if(logOpen){if(!logFollow)logUnread++;renderLogEntries();}
  updateIssueBadge();return event;
}
function updateIssueBadge(){
  const trigger=document.querySelector('.activity-trigger');if(!trigger)return;
  const count=state.events.filter(e=>['warning','error'].includes(e.level)&&!e.resolved).length;
  trigger.innerHTML=icon('log')+(count?`<span class="notification-dot">${count}</span>`:'');
}
function render(focus=false) {
  viewer?.destroy();viewer=null;
  app.innerHTML=shell(state,context);
  byId('workspace').innerHTML=VIEW[state.step](state,context);
  if(window.matchMedia('(max-width:760px)').matches)document.querySelector('.nav-step.active')?.scrollIntoView({block:'nearest',inline:'center'});
  if(state.step==='results')setupViewer();
  if(focus){byId('workspace').focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'});}
  if(logOpen)renderLogEntries();
}
function navigate(step) {
  if(!STEPS.some(s=>s.id===step))return;
  state.step=step;persist();history.replaceState(null,'',`#${step}`);render(true);
}
function modal(markup,className='') {
  closeDialog();
  const dialog=document.createElement('dialog');dialog.className=`app-dialog ${className}`;dialog.innerHTML=markup;
  overlays.append(dialog);dialog.addEventListener('close',()=>{draftSettings=null;dialog.remove();});
  const heading=dialog.querySelector('h2');if(heading){heading.id='dialog-title';dialog.setAttribute('aria-labelledby','dialog-title');}
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  dialog.showModal();return dialog;
}
function closeDialog(){const dialog=overlays.querySelector('dialog');if(dialog){if(dialog.classList.contains('log-dialog'))logOpen=false;dialog.close();dialog.remove();}draftSettings=null;}
function infoDialog(title,body,footer='') {
  modal(`<div class="dialog-heading"><div><h2>${title}</h2></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="issue-dialog-body">${body}</div><footer class="dialog-footer">${footer||button('Close','close-dialog','primary')}</footer>`);
}
function openParticipant() {
  // A user gesture is required by browsers. A named window is reused for subsequent takes.
  participantWindow=window.open('/participant.html','splat-participant','popup,width=1160,height=780');
  if(!participantWindow)toast('The display was blocked. Allow popups for this workspace or open the copied display link.');
  relayParticipant();return participantWindow;
}
function participantPayload() {
  let phase='idle';
  if(state.capture.status==='running')phase=state.capture.phase==='capturing'?'capturing':state.capture.phase==='transferring'?'done':'preparing';
  else if(['complete','warning'].includes(state.capture.status))phase='done';
  else if(state.capture.status==='cancelled')phase=state.capture.phase==='interrupted'?'interrupted':'cancelled';
  return {phase,sessionName:state.sessionName,remaining:state.capture.remaining||0};
}
async function relayParticipant() {
  if(relayBusy){relayPending=true;return;}
  relayBusy=true;
  try {
    const response=await fetch('/api/participant/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(participantPayload()),signal:AbortSignal.timeout(3500)});
    if(!response.ok)throw new Error('Display relay unavailable');
    const result=await response.json();setConnection(true,result.displays);
  }catch{setConnection(false,0);}
  finally{relayBusy=false;if(relayPending){relayPending=false;relayParticipant();}}
}
function setConnection(online,displays) {
  const changed=context.serverOnline!==online;
  context.serverOnline=online;context.displays=displays;
  const status=document.querySelector('.session-meta span:last-child');
  if(status){status.textContent=online?'Local workspace connected':'Workspace disconnected';status.className=online?'muted':'text-warning';}
  const footer=document.querySelector('.app-footer>span:last-child');
  if(footer)footer.textContent=`Step ${STEPS.findIndex(s=>s.id===state.step)+1} of 6 · ${displays?`${displays} participant display${displays>1?'s':''} connected`:'Participant display not connected'}`;
  if(changed){
    document.querySelector('.connection-banner')?.remove();
    if(!online){const banner=document.createElement('div');banner.className='connection-banner';banner.setAttribute('role','alert');banner.textContent='The local UI server is unavailable. Participant status may be stale. Waiting to reconnect.';document.querySelector('.session-bar').after(banner);}
    else state.events=state.events.map(e=>e.code==='UI_DISCONNECTED'?{...e,resolved:true}:e);
    record(online?'success':'warning',online?'Local workspace connection restored.':'Local UI server is not responding.',{code:online?'UI_RECONNECTED':'UI_DISCONNECTED',detail:'The participant screen needs the local UI server. This does not indicate a phone hardware failure.',impact:'Capture controls are simulated; check the server before continuing.'});
  }
}
async function checkReadiness() {
  if(busy()||checking||!selectedCameras(state).length)return;
  closeDialog();checking=true;
  document.querySelectorAll('[data-action="check"]').forEach(b=>{b.disabled=true;b.textContent='Checking demo rig…';});
  record('info','Checking the selected demo cameras.',{code:'READINESS_STARTED'});
  await new Promise(resolve=>setTimeout(resolve,700));
  state=completeReadiness(state);checking=false;persist();render();toast('Selected cameras passed the demo readiness check.');
}
function updateCaptureUI() {
  if(state.step!=='capture')return;
  const c=state.capture;
  byId('capture-phase-title').textContent=phaseTitle(c);byId('capture-phase-description').textContent=phaseDescription(c);
  byId('capture-timer').textContent=formatTime(c.remaining);byId('capture-progress').style.width=`${c.progress}%`;
  document.querySelectorAll('[data-job-stage]').forEach(el=>el.classList.toggle('complete',c.progress>Number(el.dataset.jobStage)*20));
  document.querySelectorAll('[data-inline-stage]').forEach(el=>el.classList.toggle('active',Number(el.dataset.inlineStage)===participantIndex(state)));
  byId('inline-timer').textContent=c.phase==='capturing'?formatTime(c.remaining):'—';
}
function startCapture() {
  const blocker=captureBlocker(state,!!draftSettings);if(blocker){toast(blocker);return;}
  if(!context.serverOnline){toast('Restart the local UI server before starting a capture.');return;}
  if(state.autoParticipant&&context.displays===0)openParticipant();
  const duration=state.settings.frames/state.settings.fps,start=Date.now();
  state.capture={status:'running',phase:'preparing',progress:0,remaining:duration};
  record('info','Capture started. Checking settings and preparing cameras.',{code:'CAPTURE_STARTED',stage:'capture'});render();relayParticipant();
  jobTimer=setInterval(()=>{
    const elapsed=(Date.now()-start)/1000;
    const phase=elapsed<1.5?'preparing':elapsed<3?'sync':elapsed<3+duration?'capturing':elapsed<5.5+duration?'transferring':'complete';
    if(phase!==state.capture.phase){
      state.capture.phase=phase;
      if(phase!=='complete')record('info',phaseDescription(state.capture),{stage:'capture',code:`CAPTURE_${phase.toUpperCase()}`});
      relayParticipant();
    }
    state.capture.remaining=phase==='capturing'?Math.max(0,duration-(elapsed-3)):phase==='preparing'||phase==='sync'?duration:0;
    state.capture.progress=phase==='preparing'?elapsed/1.5*20:phase==='sync'?20+(elapsed-1.5)/1.5*20:phase==='capturing'?40+(elapsed-3)/duration*20:phase==='transferring'?60+(elapsed-3-duration)/2.5*20:100;
    if(phase==='complete'){finishCapture();return;}
    updateCaptureUI();
  },100);
}
function finishCapture() {
  clearInterval(jobTimer);
  const failed=state.simulateTransferFailure?state.settings.frames:0;
  state.take=createTake(state,failed);state.takes=[...(state.takes||[]),state.take].slice(-30);context.frameIndex=0;
  state.capture={status:failed?'warning':'complete',phase:failed?'warning':'complete',progress:100,remaining:0};
  let event;
  if(failed)event=record('error',`${failed} images from ${state.cameras.find(c=>c.id===state.take.cameraIds.at(-1)).name} need transfer.`,{code:'TRANSFER_PARTIAL',takeId:state.take.id,cameraId:state.take.cameraIds.at(-1),stage:'capture',detail:`All ${state.take.expected} images were saved on the simulated phones. ${failed} files did not reach the workspace.`,impact:'Capture is saved. Retry only the missing files; there is no need for another take.'});
  else record('success',`${state.take.transferred} images transferred. Your take is ready to review.`,{code:'CAPTURE_COMPLETE',stage:'capture'});
  persist();render();relayParticipant();
  if(event)modal(issueDialog(state,event.cameraId,event.id),'issue-dialog');
  else toast('Take complete. Continue to frame review.');
}
function stopCapture() {
  if(state.capture.status!=='running')return;
  clearInterval(jobTimer);state.capture={...state.capture,status:'cancelled',phase:'cancelled',remaining:0};
  record('warning','Capture stopped by the operator. Earlier completed takes are preserved.',{code:'CAPTURE_CANCELLED',stage:'capture',resolved:true});persist();render();relayParticipant();
}
function retryTransfer(takeId=state.take?.id) {
  const target=state.takes.find(t=>t.id===takeId)||state.take;
  if(busy()||!target?.failedTransfers)return;
  closeDialog();const count=target.failedTransfers;
  state=recoverTransfers(state,takeId);context.frameIndex=0;
  record('success',`${count} missing files transferred in the demo. The original take was preserved.`,{code:'TRANSFER_RECOVERED',stage:'capture'});
  render();relayParticipant();toast('Missing transfers recovered. No new capture was made.');
}
function startReconstruction() {
  const blocker=generationBlocker(state);if(blocker){toast(blocker);return;}
  const start=Date.now(),snapshot={take:structuredClone(state.take),model:state.model,geometry:state.geometry,calibration:state.calibration?structuredClone(state.calibration):null};
  state.reconstruction={status:'running',progress:0};record('info','Demo reconstruction started with a snapshot of this take.',{code:'RECONSTRUCTION_STARTED',stage:'reconstruct'});render();
  let previousPhase=-1;
  jobTimer=setInterval(()=>{
    state.reconstruction.progress=Math.min(100,(Date.now()-start)/80);
    const phase=Math.min(3,Math.floor(state.reconstruction.progress/25));
    const labels=['Preparing camera geometry','Organizing the captured images','Simulating model training','Preparing the sample viewer'];
    if(phase!==previousPhase){previousPhase=phase;record('info',labels[phase],{code:'RECONSTRUCTION_PROGRESS',stage:'reconstruct'});}
    if(byId('reconstruction-progress')){byId('reconstruction-progress').style.width=`${state.reconstruction.progress}%`;byId('reconstruction-title').textContent=labels[phase];byId('reconstruction-detail').textContent=`${Math.round(state.reconstruction.progress)}% · UI simulation only`;}
    if(state.reconstruction.progress>=100){
      clearInterval(jobTimer);state.reconstruction.status='complete';
      state.runs.push({id:`run-${Date.now()}`,name:`${snapshot.take.name} · Run ${state.runs.length+1}`,model:snapshot.model,createdAt:new Date().toISOString(),input:snapshot,simulation:true});
      record('success','Demo reconstruction complete. Result available in Splat review.',{code:'RECONSTRUCTION_COMPLETE',stage:'reconstruct'});persist();render();toast('Demo complete. Open Splat review.');
    }
  },150);
}
function setupViewer() {
  const select=byId('result-select');if(state.runs.length)select.value=String(state.runs.length-1);
  function loadResult(){
    viewer?.destroy();
    const run=state.runs[Number(select.value)],frames=run?(run.model==='3dgs'?1:run.input.take.frames):90,fps=run?.input.take.fps||30;
    byId('viewer-timeline').max=frames-1;byId('viewer-timeline').value=0;byId('viewer-timeline').disabled=frames===1;
    byId('viewer-play').disabled=frames===1;byId('viewer-speed').disabled=frames===1;
    document.querySelector('.viewer-transport>span:nth-of-type(2)').textContent=formatTime(frames/fps);
    viewer=mountViewer(byId('splat-canvas'),{frames,fps,onFrame(frame){byId('viewer-timeline').value=frame;byId('viewer-frame').textContent=`FRAME ${String(frame+1).padStart(3,'0')}`;byId('viewer-time').textContent=formatTime(frame/fps);},onPlay(playing){byId('viewer-play').innerHTML=icon(playing?'pause':'play',17);byId('viewer-play').setAttribute('aria-label',playing?'Pause scene':'Play scene');}});
    viewer.setSpeed(Number(byId('viewer-speed').value));
  }
  select.onchange=loadResult;loadResult();
}
function showFrame(index) {
  if(!state.take)return;
  context.frameIndex=Math.max(0,Math.min(state.take.frames-1,index));
  const f=context.frameIndex;
  byId('frame-range').value=f;byId('frame-label').textContent=`Frame ${String(f+1).padStart(3,'0')}`;byId('frame-timestamp').textContent=`${(f/state.take.fps).toFixed(3)} s`;
  document.querySelector('[data-action="previous-frame"]').disabled=f===0;document.querySelector('[data-action="next-frame"]').disabled=f===state.take.frames-1;
  byId('frame-grid').innerHTML=state.cameras.filter(c=>state.take.cameraIds.includes(c.id)).map(c=>cameraCard(c,state.cameras.indexOf(c),{frame:true,pose:f,settings:state.take.settings,failed:!!state.take.failedTransfers&&c.id===state.take.cameraIds.at(-1)})).join('');
}
function exportJSON(value,filename) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function openLogs() {
  closeDialog();if(logOpen)return;logOpen=true;logFollow=true;logUnread=0;
  const dialog=document.createElement('dialog');dialog.className='log-dialog';
  dialog.innerHTML=`<aside class="log-drawer" aria-label="Activity log"><div class="log-heading"><div><h2>Activity log</h2></div><button class="icon-button" data-action="close-logs" aria-label="Close activity log">${icon('close')}</button></div><div class="log-filters"><label class="log-search"><span class="sr-only">Search events</span><input id="log-search" type="search" placeholder="Search messages or error codes" value="${esc(logFilters.search)}"></label><label><span class="sr-only">Event level</span><select id="log-level">${['all','error','warning','success','info'].map(v=>`<option value="${v}" ${logFilters.level===v?'selected':''}>${v==='all'?'All event levels':v[0].toUpperCase()+v.slice(1)}</option>`).join('')}</select></label><label><span class="sr-only">Camera filter</span><select id="log-camera"><option value="all">All cameras</option>${state.cameras.map(c=>`<option value="${c.id}" ${logFilters.camera===c.id?'selected':''}>${c.name}</option>`).join('')}</select></label></div><div class="log-toolbar"><span id="log-count"></span><label class="toggle-row"><input id="log-follow" type="checkbox" checked> Follow new events</label></div><div class="log-events" id="log-events" tabindex="0" aria-label="Session events"></div><button class="new-events" id="new-events" hidden data-action="follow-events"></button><div class="log-footer"><small>Last 500 events · saved in this browser</small>${button(`${icon('download',14)} Export log`,'export-log','secondary small')}</div></aside>`;
  overlays.append(dialog);dialog.addEventListener('close',()=>{if(dialog.isConnected){logOpen=false;dialog.remove();}});dialog.showModal();
  byId('log-events').addEventListener('scroll',e=>{const el=e.currentTarget;logFollow=el.scrollHeight-el.scrollTop-el.clientHeight<35;byId('log-follow').checked=logFollow;if(logFollow){logUnread=0;byId('new-events').hidden=true;}});
  renderLogEntries();
}
function renderLogEntries() {
  const el=byId('log-events');if(!el)return;
  const scroll=el.scrollTop,query=logFilters.search.toLowerCase();
  const expanded=new Set([...el.querySelectorAll('article[data-event-id]')].filter(article=>article.querySelector('details[open]')).map(article=>article.dataset.eventId));
  const entries=state.events.filter(e=>(logFilters.level==='all'||e.level===logFilters.level)&&(logFilters.camera==='all'||e.cameraId===logFilters.camera)&&`${e.message} ${e.code||''} ${e.detail||''}`.toLowerCase().includes(query));
  el.innerHTML=entries.length?entries.map(e=>`<article data-event-id="${e.id}" class="log-event ${e.level} ${e.resolved?'resolved':''}"><span class="event-icon">${icon(e.level==='error'||e.level==='warning'?'warning':e.level==='success'?'check':'info',17)}</span><div><header><strong>${esc(e.message)}</strong><time datetime="${e.time}">${new Date(e.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time></header>${e.detail?`<p>${esc(e.detail)}</p>`:''}<div class="event-tags"><span>${esc(e.stage)}</span>${e.cameraId?`<span>${esc(e.cameraId)}</span>`:''}${e.resolved?'<span>Resolved</span>':''}</div>${['warning','error'].includes(e.level)&&!e.resolved?`<button class="text-button" data-action="event-help" data-event="${e.id}" data-id="${e.cameraId||''}">Details and recovery ${icon('arrow',13)}</button>`:''}<details ${expanded.has(e.id)?'open':''}><summary>Technical details</summary><pre>${esc(JSON.stringify(e,null,2))}</pre></details></div></article>`).join(''):'<div class="empty-log">No events match these filters.</div>';
  byId('log-count').textContent=`${entries.length} event${entries.length===1?'':'s'}`;
  el.scrollTop=logFollow?el.scrollHeight:scroll;
  byId('new-events').hidden=!logUnread||logFollow;byId('new-events').textContent=`${logUnread} new event${logUnread===1?'':'s'} ↓`;
}
function historyDialog() {
  infoDialog('Take history',`<p class="dialog-intro">Select a saved take to review or reconstruct.</p><div class="take-history">${state.takes.length?state.takes.slice().reverse().map(t=>`<button class="history-item" data-action="load-take" data-id="${esc(t.id)}"><span><strong>${esc(t.name)}</strong><small>${new Date(t.createdAt).toLocaleString()} · ${t.cameraIds.length} cameras · ${t.frames} frames</small></span><span class="pill ${t.failedTransfers?'warning':'success'}">${t.failedTransfers?'Transfer incomplete':'Ready'}</span></button>`).join(''):'<p>No completed takes yet.</p>'}</div>`);
}
const actionHandlers={
  'select-all':()=>{state=setAllCameras(state,true);persist();render();},
  'deselect-all':()=>{state=setAllCameras(state,false);persist();render();},
  check:checkReadiness,
  settings:()=>{if(busy())return;modal(settingsDialog(state),'settings-dialog');draftSettings={...state.settings};},
  'apply-settings':()=>{if(!draftSettings||busy()||!selectedCameras(state).length)return;state=applySettings(state,draftSettings);record('info',`Camera settings applied to ${selectedCameras(state).length} demo cameras. Run readiness before capture.`,{code:'SETTINGS_APPLIED',detail:JSON.stringify(state.settings)});closeDialog();render();toast('Settings saved. Check readiness before capture.');},
  'close-dialog':closeDialog,
  issue:el=>modal(issueDialog(state,el.dataset.id),'issue-dialog'),
  'event-help':el=>{const id=el.dataset.id,event=el.dataset.event;closeDialog();modal(issueDialog(state,id,event),'issue-dialog');},
  'issue-to-logs':openLogs,logs:openLogs,'close-logs':closeDialog,
  'follow-events':()=>{logFollow=true;logUnread=0;byId('log-follow').checked=true;renderLogEntries();},
  'export-log':()=>exportJSON({mode:'simulation',events:state.events},'rice-experiential-pixels-lab-activity.json'),
  'export-session':()=>exportJSON({...state,exportedAt:new Date().toISOString(),mode:'simulation',notice:'UI demo. No real images, camera measurements, or trained splats.'},'rice-experiential-pixels-lab-session.json'),
  participant:openParticipant,
  'copy-participant':async()=>{const link=new URL('/participant.html',location.href).href;try{await navigator.clipboard.writeText(link);toast('Participant display link copied.');}catch{infoDialog('Participant display link',`<p>Copy this link and open it on the rig’s display. For another device, use the server’s private-network address.</p><input aria-label="Participant link" value="${esc(link)}" readonly>`);}},
  rename:()=>infoDialog('Name this session',`<label>Session name<input id="rename-input" maxlength="80" value="${esc(state.sessionName)}" ${busy()?'disabled':''}></label>`,button('Cancel','close-dialog','secondary')+button('Save name','save-name','primary',busy()?'disabled':'')),
  'save-name':()=>{const value=byId('rename-input')?.value.trim();if(!value||busy())return;state.sessionName=value;persist();closeDialog();render();relayParticipant();},
  history:historyDialog,
  'load-take':el=>{if(busy()){toast('Finish or stop the current operation before switching takes.');return;}state.take=state.takes.find(t=>t.id===el.dataset.id);context.frameIndex=0;persist();closeDialog();navigate('frames');},
  network:()=>infoDialog('Network settings',`<div class="network-diagram"><span>Phones</span>${icon('wifi',24)}<strong>Private router</strong>${icon('wifi',24)}<span>Rig computer + display</span></div><p>Connect phones, the operator computer, and the participant display to the same private network. Charging cables are independent.</p><dl class="issue-facts"><dt>Simulation status</dt><dd>Camera connections, previews, and transfers are simulated. Participant status uses the local server.</dd><dt>Participant display address</dt><dd><code>${esc(new URL('/participant.html',location.href).href)}</code></dd><dt>On a separate display device</dt><dd>Start the server with <code>npm start -- --host=0.0.0.0</code>. On the display device, open <code>http://&lt;computer-IP&gt;:4317/participant.html</code>.</dd></dl>`),
  help:()=>infoDialog('Workflow guide',`<ol class="guide-list">${STEPS.map(s=>`<li><strong>${s.name}</strong><p>${s.detail}.</p></li>`).join('')}</ol><p>Complete each page from top to bottom. Camera capture and reconstruction are simulated. Use the activity log for error details and recovery steps. Takes and settings are saved in this browser.</p>`),
  camera:el=>{const c=state.cameras.find(c=>c.id===el.dataset.id);if(!c)return;infoDialog(`${c.name} · ${c.position}`,`${cameraCard(c,state.cameras.indexOf(c),{frame:true,settings:state.step==='frames'?state.take.settings:state.settings,pose:context.frameIndex,paused:state.capture.status==='running'})}<p class="dialog-intro">Simulated camera preview.</p>`);},
  'use-profile':()=>{if(busy())return;state.calibration={id:'demo-studio-rig',name:'Studio rig · demo profile',cameraIds:state.cameras.map(c=>c.id),simulation:true};state.geometry='calibration';record('info','Demo calibration selected. It covers all eight camera positions.',{code:'CALIBRATION_SELECTED'});render();},
  'skip-profile':()=>{if(busy())return;state.calibration=null;state.geometry='colmap';persist();render();},
  calibrate:()=>{if(busy()||!selectedCameras(state).length)return;const poses=Number(byId('calibration-poses').value),interval=Number(byId('calibration-interval').value);if(!Number.isInteger(poses)||poses<6||poses>100||!Number.isFinite(interval)||interval<1||interval>10){toast('Choose 6–100 poses and a 1–10 second interval.');return;}state.calibration={id:`demo-profile-${Date.now()}`,name:'New demo calibration',cameraIds:selectedCameras(state).map(c=>c.id),poses,interval,simulation:true};state.geometry='calibration';record('success',`Demo calibration profile created for ${state.calibration.cameraIds.length} cameras.`,{code:'CALIBRATION_CREATED',detail:'No board detection or calibration computation was performed.'});render();toast('Demo profile created. Continue to capture.');},
  capture:startCapture,'stop-capture':stopCapture,'retry-transfer':el=>retryTransfer(el.dataset.take||state.take?.id),
  'previous-frame':()=>showFrame(context.frameIndex-1),'next-frame':()=>showFrame(context.frameIndex+1),
  model:el=>{if(busy())return;state.model=el.dataset.value;persist();render();},
  reconstruct:startReconstruction,
  'stop-reconstruction':()=>{if(state.reconstruction.status!=='running')return;clearInterval(jobTimer);state.reconstruction.status='cancelled';record('warning','Demo reconstruction cancelled. Earlier results are preserved.',{code:'RECONSTRUCTION_CANCELLED',resolved:true});render();},
  'reset-view':()=>viewer?.reset(),'viewer-play':()=>viewer?.togglePlay()
};
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-action],[data-step]');if(!control||control.disabled)return;
  if(control.dataset.step){navigate(control.dataset.step);return;}
  actionHandlers[control.dataset.action]?.(control);
});
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.dataset.setting&&draftSettings){draftSettings[el.dataset.setting]=Number(el.value);byId(`output-${el.dataset.setting}`).textContent=`${el.value} ${el.dataset.setting==='temperature'?'K':el.dataset.setting==='exposure'?'ms':el.dataset.setting==='contrast'?'%':''}`;byId('draft-preview').style.filter=settingsFilter(draftSettings);byId('draft-label').textContent=JSON.stringify(draftSettings)===JSON.stringify(state.settings)?'Unchanged':'Not applied';}
  if(el.id==='capture-session'&&!busy()){state.sessionName=el.value.trim()||'Untitled session';persist();document.querySelector('.session-name>span').textContent=state.sessionName;}
  if(el.id==='frame-range')showFrame(Number(el.value));
  if(el.id==='viewer-timeline')viewer?.setFrame(Number(el.value));
  if(el.id==='log-search'){logFilters.search=el.value;logUnread=0;renderLogEntries();}
});
document.addEventListener('change',event=>{
  const el=event.target;
  if(el.dataset.camera){if(checking){el.checked=state.cameras.find(c=>c.id===el.dataset.camera).selected;toast('The readiness check is finishing.');return;}state=toggleCamera(state,el.dataset.camera,el.checked);persist();render();}
  if(el.id==='auto-participant'){state.autoParticipant=el.checked;persist();}
  if(el.id==='transfer-failure'){state.simulateTransferFailure=el.checked;persist();}
  const captureFields={'capture-frames':['frames',1,300],'capture-fps':['fps',24,60],'capture-quality':['quality',1,100],'capture-stagger':['stagger',0,1000]};
  if(captureFields[el.id]&&!busy()){
    const [key,min,max]=captureFields[el.id];let n=Number(el.value);n=Number.isFinite(n)?Math.max(min,Math.min(max,n)):min;if(key!=='stagger')n=Math.round(n);
    state.settings[key]=n;state.checked=false;persist();render();
  }
  if(el.id==='geometry-source'&&!busy()){state.geometry=el.value;persist();render();}
  if(el.id==='viewer-speed')viewer?.setSpeed(Number(el.value));
  if(el.id==='log-level'||el.id==='log-camera'){logFilters[el.id==='log-level'?'level':'camera']=el.value;logUnread=0;renderLogEntries();}
  if(el.id==='log-follow'){logFollow=el.checked;logUnread=0;renderLogEntries();}
});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
window.addEventListener('pagehide',()=>{if(state.capture.status==='running')navigator.sendBeacon('/api/participant/state',JSON.stringify({...participantPayload(),phase:'interrupted',remaining:0}));});
if(STEPS.some(s=>s.id===location.hash.slice(1)))state.step=location.hash.slice(1);
render();relayParticipant();setInterval(relayParticipant,1000);
