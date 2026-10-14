import {icon,esc} from './icons.js';
import {STEPS} from './model.js';
import {observedPhones,selectionFor,colorStatus,configurationStatus} from './rig-model.js';

const app=document.getElementById('app'), overlays=document.getElementById('overlay-root');
const byId=id=>document.getElementById(id);
const modes=['OFF','AUTO','INCANDESCENT','FLUORESCENT','WARM_FLUORESCENT','DAYLIGHT','CLOUDY_DAYLIGHT','TWILIGHT','SHADE'];
let status={connected:false,phones:[],events:[],checkedAt:0}, selection={}, busy=false, loading=true, connected=true, pollBusy=false, reviewed=null, lastResult=null;
let settingsDirty=false, initializedSettings=false, toastTimer, dialogTrigger;
try { selection=JSON.parse(localStorage.getItem('rig-selection-v1')||'{}')||{}; } catch {}
const phones=()=>observedPhones(status);
const selected=()=>phones().filter(phone=>selection[phone.id]);
const canOperate=()=>!busy&&!status.busy&&connected&&status.connected&&Date.now()-status.checkedAt<=20000&&status.workflowKnown&&!status.workflowBusy&&selected().length>0;
const button=(label,action,style='secondary',extra='')=>`<button class="button ${style}" data-rig-action="${action}" ${extra}>${label}</button>`;
const pill=(label,tone='neutral')=>`<span class="pill ${tone}">${esc(label)}</span>`;
function toast(message){const el=byId('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),5500);}
function closeDialog(){overlays.querySelector('dialog')?.close();overlays.replaceChildren();reviewed=null;dialogTrigger?.focus();}
function dialog(title,content,footer='') {
  dialogTrigger=document.activeElement;
  overlays.replaceChildren();const el=document.createElement('dialog');el.className='app-dialog';el.setAttribute('aria-labelledby','rig-dialog-title');
  el.innerHTML=`<div class="dialog-heading"><h2 id="rig-dialog-title">${esc(title)}</h2><button class="icon-button" data-rig-action="close" aria-label="Close dialog">${icon('close')}</button></div><div class="issue-dialog-body">${content}</div><footer class="dialog-footer">${footer||button('Close','close','primary')}</footer>`;
  el.addEventListener('close',()=>{reviewed=null;el.remove();dialogTrigger?.focus();});overlays.append(el);el.showModal();
}
function persistSelection(){try{localStorage.setItem('rig-selection-v1',JSON.stringify(selection));}catch{toast('Selection will reset when this page closes.');}}
function renderShell(){
  app.innerHTML=`<a class="skip-link" href="#workspace">Skip to workspace</a><aside class="sidebar">
    <a class="brand" href="/">${icon('aperture',30)}<div><span>Rice Experiential Pixels Lab</span><small>CAPTURE WORKSPACE</small></div></a>
    <div class="sidebar-label">WORKFLOW</div><nav class="step-nav" aria-label="Capture workflow">${STEPS.map((step,i)=>`<button class="nav-step ${i===0?'active':''}" ${i===0?'aria-current="step"':'disabled'}><span class="nav-number">${String(i+1).padStart(2,'0')}</span><span><b>${step.name}</b><small>${i===0?'Connect & configure':'Integration pending'}</small></span>${i===0?icon('chevron',15):''}</button>`).join('')}</nav>
    <div class="sidebar-bottom"><div class="rig-card"><div class="rig-icon">${icon('wifi',22)}</div><div><strong>Lab rig</strong><span>CameraScope · private network</span></div></div><button class="sidebar-action" data-rig-action="setup">${icon('settings',18)} Connection setup</button><a class="sidebar-action" href="/?demo=1">${icon('external',18)} Open UI demo</a></div></aside>
    <div class="main-shell"><header class="topbar"><div class="breadcrumb">Capture workspace ${icon('chevron',14)} <strong>Prepare rig</strong></div><div class="topbar-tools"><span class="simulation-label rig-live-label">Device connection</span><button class="icon-button" data-rig-action="logs" aria-label="Open activity log">${icon('log')}</button></div></header>
    <div class="session-bar"><span>Lab rig preparation</span><span id="rig-freshness" role="status">Connecting…</span></div>
    <main id="workspace" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">STEP 01 OF 06</div><h1>Prepare rig</h1><p>Check phone connections, camera settings and clock offsets.</p></div>${button(`${icon('refresh',16)} Refresh status`,'refresh','primary','id="rig-refresh"')}</div>
      <div id="rig-banner" aria-live="polite"></div><div id="rig-stats" class="stats-grid"></div>
      <section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">1</span><div><h2>Select cameras</h2><p>All phones are selected by default. Deselect any to exclude them from commands.</p></div></div><div class="section-tools">${button('Select all','select-all','secondary small')}${button('Deselect all','deselect-all','secondary small')}</div></div>
        <div id="rig-cameras" class="camera-grid"></div><div class="network-note">${icon('wifi',16)}<span id="rig-preview-note">Previews use the original app’s MediaMTX gateway.</span>${button('Preview setup','previews','text-button')}</div></section>
      <section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">2</span><div><h2>Camera settings</h2><p>Review manual exposure and white balance before applying to selected phones.</p></div></div></div>
        <form id="rig-settings"><div class="rig-fields"><label>ISO<input id="rig-iso" type="number" min="25" max="12800" step="1" required></label><label>Exposure (ms)<input id="rig-exposure" type="number" min="0.1" max="1000" step="0.1" required></label><label>Frame rate (fps)<input id="rig-fps" type="number" min="1" max="120" step="1" required></label><label>White balance<select id="rig-awb" required><option value="">Select mode</option>${modes.map(mode=>`<option value="${mode}">${mode.replaceAll('_',' ')}</option>`).join('')}</select></label></div>
        <div class="rig-settings-footer"><p id="rig-settings-source">Waiting for the original app’s saved settings.</p><button class="button secondary" type="submit" id="rig-review-settings">Review changes</button></div></form>
        <p class="rig-caption">Live previews show current output. The review shows values only; it does not alter camera output. Readback verifies CameraScope’s requested settings, not measured sensor output.</p><div id="rig-command-results" aria-live="polite"></div></section>
      <section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">3</span><div><h2>Check clock offsets</h2><p>Measure each selected phone’s clock offset relative to the lab computer.</p></div></div>${button('Check clocks','sync','secondary','id="rig-sync"')}</div><p id="rig-sync-summary"></p><p class="rig-caption">Clock results expire after 60 seconds. Sensor phase alignment and capture timing must be checked again when capture is connected.</p></section>
      <section class="work-section"><div class="section-heading"><div class="section-title"><span class="section-number">4</span><div><h2>Participant display</h2><p>Live capture status will be connected with the Capture tab.</p></div></div>${pill('Integration pending')}</div><p class="rig-caption">The participant display in the UI demo shows simulated capture stages.</p></section>
      <div class="step-footer"><span class="footer-hint">Preparation does not start a capture.</span><div class="next-action"><small>Calibration integration is next.</small><button class="button primary" disabled>Continue to calibration ${icon('arrow',17)}</button></div></div>
    </main><footer class="app-footer"><span>Prepare rig · CameraScope integration</span></footer></div>`;
}
function updateStatus(){
  const list=phones(), chosen=selected(), responding=list.filter(p=>p.responding).length, previews=list.filter(p=>p.previewReady).length;
  const running=list.filter(p=>p.responding&&p.state?.isCapturing===true).length, unknown=list.filter(p=>!p.responding||typeof p.state?.isCapturing!=='boolean').length;
  const fresh=connected&&status.connected&&Date.now()-status.checkedAt<=20000;
  byId('rig-freshness').textContent=loading?'Connecting…':fresh?`Checked ${Math.max(0,Math.floor((Date.now()-status.checkedAt)/1000))}s ago`:'Status unavailable';
  byId('rig-freshness').className=fresh?'muted':'text-warning';
  const banner=loading?'Connecting to the original rig server…':!connected?'The redesign server is unavailable. Device status is stale.':status.error?.message||(!fresh?'Status is stale. Refresh before changing settings.':status.workflowBusy?'A workflow is running in the original app. Rig changes are locked.':!status.workflowKnown?'Original workflow status is unknown. Rig changes are locked.':'');
  byId('rig-banner').innerHTML=banner?`<div class="notice warning-notice">${icon('warning',20)}<div><strong>${esc(banner)}</strong>${status.error?.next?`<p>${esc(status.error.next)}</p>`:''}</div>${button('Connection setup','setup','text-button')}</div>`:'';
  byId('rig-stats').innerHTML=[['PHONES IN RIG',list.length||(!status.connected?'—':0),status.connected?`${responding} responding`:'inventory unavailable',''],['CAMERAS RUNNING',running,unknown?`${unknown} unknown`:`of ${list.length} pipelines`,running&&running===list.length?'text-success':'text-warning'],['SELECTED',chosen.length,'phones',''],['PREVIEW STREAMS',previews,`of ${list.length}`,previews&&previews===list.length?'text-success':'text-warning']].map(([title,n,detail,tone])=>`<div class="stat"><span>${title}</span><strong class="${tone}">${n}<small>${detail}</small></strong></div>`).join('');
  const grid=byId('rig-cameras');
  const existing=new Map([...grid.querySelectorAll('[data-phone-id]')].map(el=>[el.dataset.phoneId,el]));
  if(!list.length){grid.innerHTML=`<div class="rig-empty">${icon('camera',32)}<h3>${loading?'Loading phone inventory':'No phone inventory available'}</h3><p>${loading?'':'Start the original app and check its configured phone IP addresses.'}</p>${button('Connection setup','setup','secondary')}</div>`;}
  else {
    grid.querySelector('.rig-empty')?.remove();
    for(const phone of list){
      let card=existing.get(phone.id);
      if(!card){card=document.createElement('article');card.className='camera-card';card.dataset.phoneId=phone.id;
        card.innerHTML=`<div class="camera-preview rig-camera-preview"></div><div class="camera-card-info"><div class="camera-identity"><label class="camera-selection"><input type="checkbox"><strong></strong></label><span class="rig-ip"></span></div><div class="rig-phone-status"></div></div><div class="rig-phone-checks"></div><p class="rig-phone-settings"></p><div class="camera-card-footer"><span class="rig-phone-time"></span><button class="text-button">Details</button></div>`;
        card.querySelector('input').dataset.phone=phone.id;card.querySelector('input').setAttribute('aria-label',`Include ${phone.name}`);
        card.querySelector('button').dataset.rigAction='phone';card.querySelector('button').dataset.id=phone.id;grid.append(card);
      }
      card.classList.toggle('excluded',!selection[phone.id]);card.classList.toggle('needs-attention',!phone.responding);
      card.querySelector('input').checked=!!selection[phone.id];card.querySelector('input').disabled=busy||!!status.busy;
      card.querySelector('strong').textContent=phone.name;card.querySelector('.rig-ip').textContent=phone.ip;
      const pipeline=phone.responding?phone.state?.isCapturing:null;
      card.querySelector('.rig-phone-status').innerHTML=pill(!phone.responding?'Not responding':pipeline===true?'Running':pipeline===false?'Camera stopped':'Activity unknown',pipeline===true?'success':'warning');
      card.querySelector('.rig-phone-settings').textContent=phone.responding?`ISO ${phone.state?.iso??'—'} · ${phone.state?.exposureMs??'—'} ms · WB ${phone.state?.colorProcessing?.awbMode??'—'}`:'Settings unavailable';
      const requested=phone.settings?.requested||status.requested;
      const color=colorStatus(phone,requested?.awbMode), config=configurationStatus(phone,requested);
      card.querySelector('.rig-phone-checks').innerHTML=`${pill(config.label,config.tone)}${pill(color.label,color.tone)}${pill(phone.sync?'Clock checked':'Clock not checked',phone.sync?'success':'warning')}`;
      card.querySelector('.rig-phone-time').textContent=phone.responding?'CameraScope acknowledged':phone.error?.code||'Status unavailable';
      const preview=card.querySelector('.camera-preview');
      const previewKey=fresh&&phone.previewReady&&phone.previewPath?phone.previewPath:'';
      if(preview.dataset.path!==previewKey){
        preview.dataset.path=previewKey;
        if(previewKey){
          // Use the operator's reachable hostname, never a phone or hard-coded localhost.
          const url=new URL(location.origin);url.port='8889';url.pathname=previewKey.split('?')[0];url.search=previewKey.split('?')[1]||'';
          const iframe=document.createElement('iframe');iframe.src=url.href;iframe.title=`Live preview: ${phone.name}`;iframe.allow='autoplay';iframe.loading='lazy';iframe.referrerPolicy='no-referrer';
          preview.replaceChildren(iframe);const label=document.createElement('span');label.className='preview-caption';label.textContent='GATEWAY STREAM AVAILABLE';preview.append(label);
        }else preview.innerHTML=`<div class="rig-preview-empty">${icon('camera',26)}<span>${phone.responding?'Preview unavailable':'No live preview'}</span></div>`;
      }
      existing.delete(phone.id);
    }
    existing.forEach(card=>card.remove());
  }
  if(!initializedSettings&&!settingsDirty&&status.requested){
    for(const [id,key] of [['rig-iso','iso'],['rig-exposure','exposureMs'],['rig-fps','frameRate'],['rig-awb','awbMode']])byId(id).value=status.requested[key]??'';
    initializedSettings=true;
  }
  byId('rig-settings-source').textContent=settingsDirty?'Unapplied changes':initializedSettings?'Starting values from the original app’s saved configuration.':'Waiting for the original app’s saved settings.';
  byId('rig-refresh').disabled=busy||pollBusy;
  byId('rig-review-settings').disabled=!canOperate();byId('rig-sync').disabled=!canOperate();
  document.querySelectorAll('#rig-settings input,#rig-settings select,[data-rig-action="select-all"],[data-rig-action="deselect-all"]').forEach(el=>el.disabled=busy||!!status.busy);
  byId('rig-sync').textContent=busy&&status.busy==='sync'?'Checking clocks…':'Check clocks';
  byId('rig-sync-summary').textContent=`${chosen.filter(p=>p.sync).length} of ${chosen.length} selected phones have a fresh successful clock-sync result.`;
  byId('rig-preview-note').textContent=status.gateway?.running?'Preview gateway available. If a frame is blank, check browser access to port 8889 and WebRTC port 8189.':'Preview gateway unavailable. Start previews in the original app.';
  if(lastResult)byId('rig-command-results').innerHTML=`<div class="rig-result-list"><strong>${lastResult.action==='settings'?'Settings results':'Clock check results'}</strong>${lastResult.results.map(r=>`<p class="${r.ok?'text-success':'text-warning'}">${esc(r.id)}: ${esc(r.ok?(lastResult.action==='settings'?'CameraScope settings confirmed by readback.':'Clock offset measured.'):`${r.error.message} ${r.error.next}`)}</p>`).join('')}${lastResult.action==='settings'?'<p class="rig-caption">Results record the last command. Check live state for later changes. Capture settings in the original app are unchanged.</p>':''}</div>`;
}
async function request(url,value){const response=await fetch(url,{...(value===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Rig-Request':'1'},body:JSON.stringify(value)}),signal:AbortSignal.timeout(value===undefined?12000:120000)});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||`HTTP ${response.status}`),result);return result;}
async function refresh(manual=false){
  if(pollBusy||busy)return;pollBusy=true;
  try{status=await request(manual?'/api/rig/refresh':'/api/rig/status',manual?{}:undefined);connected=true;if(status.connected){selection=selectionFor(status.phones,selection);persistSelection();}}
  catch{connected=false;status={...status,connected:false};}
  finally{loading=false;pollBusy=false;updateStatus();}
}
async function operate(action,settings,ids=selected().map(p=>p.id)){
  if(!canOperate())return;closeDialog();busy=true;status.busy=action;updateStatus();
  try{const result=await request(`/api/rig/${action}`,{ids,settings});lastResult={action,results:result.results};status=result.status;status.busy=null;
    if(action==='settings'&&result.ok)settingsDirty=false;
    toast(result.ok?'Command completed. Review the per-phone results.':'Some phones need attention. Review the per-phone results.');
    if(!result.ok)dialog('Some phones need attention',result.results.filter(r=>!r.ok).map(r=>`<p><strong>${esc(r.id)}</strong>: ${esc(r.error.message)}</p><p>${esc(r.error.next)}</p>`).join(''));
  }catch(error){dialog('Rig operation could not complete',`<p>${esc(error.message)}</p><p>${esc(error.next||'Read status before retrying. A timed-out command may still be running on the server.')}</p>`);}
  finally{busy=false;status.busy=null;await refresh(true);}
}
function reviewSettings(){
  if(!canOperate()||!byId('rig-settings').reportValidity())return;
  const value={iso:Number(byId('rig-iso').value),exposureMs:Number(byId('rig-exposure').value),frameRate:Number(byId('rig-fps').value),awbMode:byId('rig-awb').value};
  if(value.exposureMs>1000/value.frameRate){toast('Exposure must not exceed the requested frame interval.');return;}
  const chosen=selected();
  dialog('Review camera settings',`<p>Apply to ${chosen.length} selected phones: ${esc(chosen.map(p=>p.name).join(', '))}.</p><dl class="issue-facts"><dt>ISO</dt><dd>${value.iso}</dd><dt>Exposure</dt><dd>${value.exposureMs} ms</dd><dt>Requested rate</dt><dd>${value.frameRate} fps</dd><dt>White balance</dt><dd>${esc(value.awbMode)}</dd></dl><p>Changes selected phones only. Auto exposure and white balance lock will be off. Readback verifies CameraScope settings; measured sensor output is not verified.</p><p class="rig-caption">Capture in the original app may overwrite these settings.</p>`,`${button('Cancel','close')}${button('Apply to selected phones','apply','primary')}`);
  reviewed={value,ids:chosen.map(p=>p.id)};
}
function setup(){dialog('Connect the lab rig',`<ol class="rig-instructions"><li>Start the original Multi-Phone-Splat app on this computer, normally on port 4173.</li><li>Connect the computer and phones to the same private network. Keep CameraScope open on each phone.</li><li>Check phone IPs, CameraScope path and Python executable in the original app.</li><li>Start this redesign with <code>npm start</code>, then refresh status.</li></ol><dl class="issue-facts"><dt>Original backend</dt><dd><code>${esc(status.backend||'http://127.0.0.1:4173')}</code></dd><dt>Different port</dt><dd>Set <code>RIG_BACKEND_URL</code> before starting this server. Both apps must run on the lab computer.</dd><dt>Phone commands</dt><dd>UDP port 5010. A timeout can mean the app is closed, the IP changed, or the network is blocking traffic.</dd></dl>`);}
function phoneDetails(id){const phone=phones().find(p=>p.id===id);if(!phone)return;dialog(phone.name,`<dl class="issue-facts"><dt>IP address</dt><dd>${esc(phone.ip)}</dd><dt>Connection</dt><dd>${phone.responding?'CameraScope responded.':esc(phone.error?.message||'No current status.')}</dd><dt>Next step</dt><dd>${esc(phone.error?.next||'Check the live preview and review settings before checking clocks.')}</dd><dt>Camera pipeline</dt><dd>${phone.responding&&typeof phone.state?.isCapturing==='boolean'?(phone.state.isCapturing?'Running':'Stopped'):'Unknown'}. This is not a recording indicator.</dd><dt>Reported settings</dt><dd>${phone.responding?esc(`ISO ${phone.state?.iso??'unknown'} · exposure ${phone.state?.exposureMs??'unknown'} ms · frame interval ${phone.state?.frameDurationMs??'unknown'} ms · auto exposure ${phone.state?.autoExposureEnabled??'unknown'}`):'Unavailable'}</dd><dt>Clock</dt><dd>${phone.sync?`Offset measured ${Math.floor((Date.now()-phone.sync.checkedAt)/1000)} seconds ago. Offset: ${phone.sync.report?.summary?.selectedOffsetNs!=null?esc((phone.sync.report.summary.selectedOffsetNs/1e6).toFixed(3))+' ms':'not reported'}; estimated error bound: ${phone.sync.report?.summary?.selectedErrorBoundNs!=null?esc((phone.sync.report.summary.selectedErrorBoundNs/1e6).toFixed(3))+' ms':'not reported'}.`:'No fresh clock-sync result.'} Sensor alignment is not checked here.</dd><dt>Preview</dt><dd>${phone.previewReady?'MediaMTX reports an active stream. Browser decoding is not verified.':'No active stream reported by MediaMTX.'}</dd></dl><details class="technical-details"><summary>CameraScope state and command results</summary><pre>${esc(JSON.stringify(phone,null,2))}</pre></details>`);}
function logs(){dialog('Rig activity log',`<p>Connection changes and commands from this server session.</p><label class="rig-log-filter">Filter<input id="rig-log-filter" type="search" placeholder="Phone, message or error code"></label><div id="rig-log-events">${[...(status.events||[])].reverse().map(event=>`<article class="rig-log-event"><strong class="${event.level==='success'?'text-success':event.level==='info'?'':'text-warning'}">${esc(event.message)}</strong><small>${esc(new Date(event.time).toLocaleTimeString())} · ${esc(event.code)}</small>${event.detail?`<p>${esc(event.detail)}</p>`:''}<details><summary>Technical details</summary><pre>${esc(JSON.stringify(event,null,2))}</pre></details></article>`).join('')||'<p>No rig events recorded.</p>'}</div>`);}
const actions={refresh:()=>refresh(true),'select-all':()=>{if(busy||status.busy)return;selection=Object.fromEntries(phones().map(p=>[p.id,true]));persistSelection();updateStatus();},'deselect-all':()=>{if(busy||status.busy)return;selection=Object.fromEntries(phones().map(p=>[p.id,false]));persistSelection();updateStatus();},close:closeDialog,setup,logs,
  apply:()=>{if(reviewed)operate('settings',reviewed.value,reviewed.ids);},sync:()=>operate('sync'),phone:el=>phoneDetails(el.dataset.id),
  previews:()=>dialog('Camera previews',`<ol class="rig-instructions"><li>Start the preview gateway in the original app. That control configures its phone fleet; check its selections before using it.</li><li>Verify the PC destination IP in the original app matches this computer’s private-network IP.</li><li>Allow MediaMTX traffic on ports 8889 and 8189 and the original per-camera UDP video ports.</li><li>Refresh status here. Available streams appear automatically.</li></ol><p>Preview setup stays in the original app for this first integration. Phone selection here controls settings and clock commands only.</p>`)
};
document.addEventListener('click',event=>{const el=event.target.closest('[data-rig-action]');if(el&&!el.disabled)actions[el.dataset.rigAction]?.(el);});
document.addEventListener('change',event=>{if(event.target.dataset.phone){selection[event.target.dataset.phone]=event.target.checked;persistSelection();updateStatus();}});
document.addEventListener('input',event=>{if(event.target.closest('#rig-settings')){settingsDirty=true;byId('rig-settings-source').textContent='Unapplied changes';}if(event.target.id==='rig-log-filter'){const query=event.target.value.toLowerCase();byId('rig-log-events').querySelectorAll('article').forEach(el=>el.hidden=!el.textContent.toLowerCase().includes(query));}});
renderShell();byId('rig-settings').addEventListener('submit',event=>{event.preventDefault();reviewSettings();});updateStatus();refresh();
setInterval(()=>{updateStatus();refresh();},5000);
