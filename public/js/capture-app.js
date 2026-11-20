import {centerWorkflow, workspaceRoute, workspaceShell} from './workflow.js';
import {esc, icon} from './icons.js';
import {selectionFor} from './rig-model.js';

const $ = id => document.getElementById(id);
$('app').innerHTML = workspaceShell(workspaceRoute('/capture'), 'Record synchronized images from the cameras and save a session for reconstruction.');
$('workspace-content').innerHTML = `
  <section class="work-section"><div class="section-heading"><h2>New session</h2>
    <a href="/participant.html" target="participant-display" class="button secondary">${icon('monitor',16)} Participant display</a></div>
    <form id="take-form"><div class="cal-fields"><label>Session name<input id="take-name" maxlength="64" value="Take" required></label>
    <label>Frames per camera<input id="take-count" type="number" min="1" max="300" step="1" required></label></div>
    <fieldset id="take-cameras"><legend>Cameras to record</legend><div id="take-list">Loading cameras…</div></fieldset>
    <p id="take-setup" class="rig-caption"></p><p id="take-error" role="alert"></p>
    <button id="take-start" class="button primary" disabled>${icon('camera',17)} Record and save</button></form>
    <p class="rig-caption">Session folder · <span id="take-folder"></span></p>
  </section>
  <section class="work-section" id="take-job" hidden><div class="section-heading"><h2 id="take-title"></h2></div>
    <p id="take-status" role="status"></p><p id="take-totals" class="rig-caption"></p>
    <p id="take-message"></p><p id="take-warnings"></p>
    <div class="take-actions"><a id="take-review" class="button secondary" hidden>Open in Frame review</a>
    <button type="button" id="take-retry" class="button secondary" hidden>Retry missing transfers</button></div>
  </section>`;
centerWorkflow();
const phaseLabels = {preparing:'Preparing cameras and synchronizing clocks', recording:'Recording the synchronized sequence',
  transferring:'Saving images to this computer', saved:'Session saved', partial:'Session saved with missing images', failed:'Capture could not finish'};
let status, submitting = false, loading = false, previousList, selected = {};
try { selected = JSON.parse(localStorage.getItem('rig-selection-v1') || '{}') || {}; } catch {}
function render() {
  const job = status?.job;
  const locked = submitting || !status || Boolean(status.busy);
  $('take-cameras').disabled = submitting || !!status?.busy || previousList === undefined;
  $('take-name').disabled = locked;
  $('take-count').disabled = locked;
  $('take-start').disabled = locked || previousList === undefined || !!status?.setup || !Object.values(selected).some(Boolean);
  $('take-setup').textContent = status?.setup || (status?.busy && !job ? 'Wait for the current rig operation to finish.' : '');
  $('take-job').hidden = !job;
  if (!job) return;
  $('take-title').textContent = job.name;
  $('take-status').textContent = phaseLabels[job.phase];
  $('take-totals').textContent = job.reviewable ? `${job.savedOnPhone} of ${job.expected} images reported saved on phones · ${job.transferred} on this computer` : `${job.frameCount} frames requested per camera`;
  $('take-message').textContent = job.message || '';
  $('take-warnings').textContent = job.warnings.join(' ');
  $('take-review').hidden = !job.reviewable;
  $('take-review').href = '/frames?' + new URLSearchParams({session:job.session});
  $('take-retry').hidden = !job.retryable;
  $('take-retry').disabled = locked;
}
async function readCaptureApi(path) {
  const response=await fetch('/api/rig/'+path,{cache:'no-store',signal:AbortSignal.timeout(6000)});
  if(path==='capture' && [404,405].includes(response.status))
    throw Error('Restart the web server with Ctrl+C and npm start to enable recording on this version.');
  const value=await response.json();
  if(!response.ok)throw Error(value.error || 'Request failed ('+response.status+').');
  return value;
}
function showCameras(phones) {
  if(!Array.isArray(phones))throw Error('The rig did not return a camera list.');
  const list = JSON.stringify(phones);
  if (previousList !== list) {
    selected = selectionFor(phones, selected);
    $('take-list').innerHTML = phones.map(p => `<label><input type="checkbox" value="${esc(p.id)}" ${selected[p.id]?'checked':''}> ${esc(p.name)} <small>${esc(p.ip)}</small></label>`).join('') ||
      '<a href="/">Add cameras in Prepare rig</a>';
    previousList = list;
  }
}
async function refresh() {
  if (loading || submitting) return;
  loading = true;
  try {
    const [inventory,capture] = await Promise.allSettled([
      readCaptureApi('config').then(({config})=>showCameras(config?.phones)), readCaptureApi('capture')
    ]);
    if (submitting) return;
    if(inventory.status==='rejected'){
      if(capture.status==='fulfilled')showCameras(capture.value.phones);
      else {
        previousList=undefined;
        $('take-list').textContent='Camera list unavailable. '+inventory.reason.message;
      }
    }
    if(capture.status==='rejected')throw capture.reason;
    const next=capture.value;
    if (!$('take-count').dataset.initialized) {
      $('take-count').value = next.frameCount;
      $('take-count').dataset.initialized = 'true';
    }
    $('take-folder').textContent = next.framesRoot;
    if (!status) $('take-error').textContent = '';
    status = next;
  } catch (error) { status = null; $('take-error').textContent = 'Capture status unavailable. ' + error.message; }
  finally { loading = false; render(); }
}
$('take-list').onchange = event => {
  selected[event.target.value] = event.target.checked;
  try { localStorage.setItem('rig-selection-v1', JSON.stringify(selected)); } catch {}
  render();
};
async function submit(url, value) {
  if (submitting || !status || status.busy) return;
  submitting = true; render(); $('take-error').textContent = '';
  try {
    const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Rig-Request':'1'},body:JSON.stringify(value)});
    const job = await response.json();
    if (!response.ok) throw Error(job.error);
    status = {...status, job, busy:'capture'};
  } catch (error) { $('take-error').textContent = error.message; }
  finally { submitting = false; render(); await refresh(); }
}
$('take-form').onsubmit = event => {
  event.preventDefault();
  submit('/api/rig/capture',{ids:Object.keys(selected).filter(id=>selected[id]),name:$('take-name').value,frameCount:$('take-count').valueAsNumber});
};
$('take-retry').onclick = () => submit('/api/rig/capture-retry',{session:status.job.session});
await refresh();
setInterval(refresh,1500);
