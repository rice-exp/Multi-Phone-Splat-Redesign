import {esc,icon} from './icons.js';
import {studioPreview} from './preview.js';
import {activeSession,activeProfile,poseBlocker,SOLVE_STAGES} from './calibration-model.js';
import {colorScreen} from './color-workbench.js';

const action=(label,name,disabled=false,primary=false)=>`<button class="button ${primary?'primary':'secondary'}" data-cal-action="${name}" ${disabled?'disabled':''}>${label}</button>`;
const tabButton=(id,title,detail,current)=>`<button class="cal-tab ${current===id?'active':''}" data-cal-tab="${id}" aria-pressed="${current===id}"><span>${title}</span><small>${detail}</small></button>`;
const fact=(title,value)=>`<div><span>${title}</span><strong>${value}</strong></div>`;
const heading=(n,title,description)=>`<div class="section-heading"><div class="section-title"><span class="section-number">${n}</span><div><h2>${title}</h2><p>${description}</p></div></div></div>`;
const field=(key,label,value,extra='',disabled=false)=>`<label>${label}<input data-cal-field="${key}" value="${esc(String(value))}" ${extra} ${disabled?'disabled':''}></label>`;
const selectOptions=(items,value)=>items.map(([id,label])=>`<option value="${esc(id)}" ${id===value?'selected':''}>${esc(label)}</option>`).join('');
const sessions=(w,disabled)=>`<label class="cal-session-select">Board session<select data-cal-select="session" ${disabled||!w.sessions.length?'disabled':''}>${!w.sessions.length?'<option>No board sessions yet</option>':selectOptions(w.sessions.map(s=>[s.id,`${s.name} · ${s.observations.length} poses · ${s.status}`]),w.activeId)}</select></label>`;
const cameraNames=cameras=>cameras.map(c=>esc(c.name||c.id)).join(', ');

export function calibrationWorkspace(state) {
  const w=state.calibrationWorkbench,selected=state.cameras.filter(c=>c.selected),s=activeSession(w);
  const externalBusy=state.capture.status==='running'||state.reconstruction.status==='running';
  return `<div class="page-heading"><div><div class="eyebrow">STEP 02 OF 06</div><h1>Calibration</h1><p>Set camera geometry, update poses, and bring color into alignment.</p></div><a class="button secondary" href="/">${icon('back',16)} Live rig</a></div>
    <div class="cal-demo-note">${icon('info',19)}<div><strong>${w.tab==='color'?'Color calibration · camera frames & photos':'Calibration workspace preview'}</strong><p>${w.tab==='color'?'Capture a frame from a connected camera or upload a photo. Chart detection and color correction run locally. The preview does not change phone settings or full-resolution capture files. Geometry screens still use sample data.':'Sample geometry observations and results only. No phones are commanded and no geometry calibration is computed. Color calibration supports local image processing.'}</p></div></div>
    ${w.tab==='color'?'':`<div class="cal-summary">${fact('Selected demo cameras',selected.length)}${fact('Board poses',s?.observations.length||0)}${fact('Intrinsic profiles',w.profiles.length)}${fact('Pose updates',w.poseResults.length)}</div>`}
    <nav class="cal-tabs" aria-label="Calibration screens">${tabButton('board','01  ChArUco capture','Collect board observations',w.tab)}${tabButton('solve','02  Solve calibration','Build an intrinsic profile',w.tab)}${tabButton('poses','03  AprilTag poses','Update camera positions',w.tab)}${tabButton('color','04  Color calibration','Match colors across cameras',w.tab)}</nav>
    ${externalBusy?'<div class="notice warning-notice">Finish the active capture or reconstruction before changing calibration.</div>':''}
    <div id="cal-message" class="cal-message" role="status" aria-live="polite">${esc(w.message)}</div>
    ${w.tab==='color'?colorScreen():w.tab==='board'?boardScreen(w,selected,externalBusy):w.tab==='solve'?solveScreen(w,externalBusy):poseScreen(w,selected,externalBusy)}
    <div class="step-footer"><span class="footer-hint">${w.tab==='color'?'Color profiles are saved separately from geometry.':'Sample sessions are saved in this browser.'}</span><button class="button secondary" data-step="capture" ${w.job?'disabled':''}>Continue to capture ${icon('arrow',16)}</button></div>`;
}

function boardScreen(w,selected,externalBusy) {
  const s=activeSession(w),busy=!!w.job||externalBusy,b=w.draft;
  const armed=s&&(s.status==='armed'||s.status==='paused'&&s.observations.length>0);
  return `<div class="cal-layout"><section class="work-section">${heading('1','Board & batch settings','Match the physical board dimensions before collecting observations.')}
    <form id="cal-board-form"><fieldset ${busy||armed?'disabled':''}><div class="cal-fields">
    ${field('name','Session name',b.name,'maxlength="80" type="text"')}
    <label>ArUco dictionary<select data-cal-field="dictionary">${selectOptions(['DICT_4X4_50','DICT_5X5_100','DICT_6X6_250'].map(v=>[v,v]),b.dictionary)}</select></label>
    ${field('columns','Columns (squares)',b.columns,'type="number" min="3" max="20" step="1" required')}
    ${field('rows','Rows (squares)',b.rows,'type="number" min="3" max="20" step="1" required')}
    ${field('squareMm','Square length (mm)',b.squareMm,'type="number" min="0.1" max="500" step="any" required')}
    ${field('markerMm','Marker length (mm)',b.markerMm,'type="number" min="0.1" max="500" step="any" required')}
    ${field('poses','Poses in this batch',b.poses,'type="number" min="1" max="100" step="1" required')}
    ${field('interval','Interval (seconds)',b.interval,'type="number" min="1" max="30" step="any" required')}
    </div></fieldset><p class="cal-caption">Board dimensions and camera identities are saved with each session. These defaults are examples; verify them against your board.</p>
    <button type="submit" class="button primary" ${busy||armed||!selected.length?'disabled':''}>${icon('camera',17)} Start sample batch</button></form>
    ${!selected.length?'<p class="cal-warning">Select cameras in Prepare rig to start a batch.</p>':''}
    ${armed?'<p class="cal-caption">Finish this session before starting a new batch with different settings.</p>':''}
    <details class="cal-details"><summary>${selected.length} demo cameras selected</summary><p>${cameraNames(selected)||'None selected'}</p><p>Selection comes from Prepare rig in the demo workspace.</p></details>
    </section><section class="work-section">${heading('2','Capture session','Move the board across the shared field of view and vary its angle.')}
    ${sessions(w,busy)}
    <div class="cal-board-preview">${studioPreview(2,{board:true,pose:s?.observations.length||0})}<span>BOARD ILLUSTRATION · NOT A LIVE IMAGE</span></div>
    <div class="cal-session-status"><strong>${!s?'Ready for a new session':w.job?.kind==='board'?'Collecting sample poses':w.job?.kind==='transfer'?'Simulating transfer':s.status==='captured'?'Session transferred':s.status==='paused'?'Session paused':'Batch complete · awaiting transfer'}</strong><span>${s?`${s.observations.length} poses · ${s.cameras.length} cameras`:'No observations yet'}</span></div>
    ${w.job?.kind==='board'?`<p class="cal-caption">Next sample pose in <b id="cal-countdown">${s.board.interval}</b>s · ${w.job.remaining} remaining in batch.</p>`:''}
    <p class="cal-caption">${armed||w.job?.kind==='board'?'In the real workflow, previews stay paused while armed. Clock sync runs once at arming, and each pose gets phase alignment.':'Finishing a session will transfer observations and restore previews in the real workflow.'}</p>
    <div class="cal-actions">${action('Add one sample pose','resume',busy||!s||s.observations.length>=100)}${action('Finish + transfer session','finish',externalBusy||!s?.observations.length||s.status==='captured'||!!w.job&&w.job.kind!=='board',true)}${w.job? action('Stop demo operation','cancel',externalBusy):armed?action('Pause session','cancel',false):''}</div>
    ${s?`<details class="cal-details"><summary>Saved board configuration</summary><p>${s.board.columns} × ${s.board.rows} squares · ${s.board.squareMm} mm squares · ${s.board.markerMm} mm markers · ${esc(s.board.dictionary)}</p><p>${cameraNames(s.cameras)}</p></details>`:''}
    </section></div>
    <section class="work-section">${heading('3','Board observations','Sample records show how each pose will move from capture to transfer.')}
    ${s?.observations.length?`<div class="cal-table-wrap"><table class="cal-table"><thead><tr><th>Pose</th><th>Camera views</th><th>Transfer</th><th>Board detection</th></tr></thead><tbody>${s.observations.slice().reverse().map(o=>`<tr><td>Pose ${String(o.index).padStart(3,'0')}</td><td>${o.cameraCount} sample views</td><td><span class="pill ${o.transferred?'success':'neutral'}">${o.transferred?'Sample transferred':'Pending transfer'}</span></td><td>Not measured</td></tr>`).join('')}</tbody></table></div>`:`<div class="cal-empty">${icon('frames',30)}<h3>No board observations yet</h3><p>Start a sample batch to explore capture, pause, and transfer.</p></div>`}
    ${s?.status==='captured'?'<div class="cal-actions"><button class="button primary" data-cal-tab="solve">Open calibration solver →</button></div>':''}</section>`;
}

function solveScreen(w,externalBusy) {
  const s=activeSession(w),busy=!!w.job||externalBusy,ready=s?.status==='captured',done=s?.solvedStages||0;
  const p=w.profiles.find(p=>p.id===s?.profileId);
  return `<section class="work-section">${heading('1','Choose a transferred session','Only a finished board session can enter the calibration solver.')}
    ${sessions(w,busy)}<div class="cal-inline-facts">${fact('Observations',s?`${s.observations.length} poses`:'—')}${fact('Camera views',s?`${s.observations.length*s.cameras.length}`:'—')}${fact('Transfer state',s?.status==='captured'?'Sample transferred':'Awaiting transfer')}</div>
    ${!ready?'<div class="notice warning-notice">Finish and transfer a session in ChArUco capture to unlock the solver.</div>':''}
    <div class="cal-actions">${action('Run all sample stages','solve-all',busy||!ready||done===6,true)}${action('Run next stage','solve-next',busy||!ready||done===6)}${w.job?.kind==='solve'?action('Stop solver demo','cancel'):''}</div></section>
    <div class="cal-layout"><section class="work-section">${heading('2','Calibration pipeline','Inspect each stage or run the sequence automatically.')}
    <ol class="cal-stages">${SOLVE_STAGES.map(([title,detail],i)=>`<li class="${i<done?'complete':i===done&&w.job?.kind==='solve'?'running':''}"><span class="cal-stage-number">${i<done?icon('check',16):i+1}</span><div><h3>${title}</h3><p>${detail}</p></div><span class="cal-stage-state">${i<done?'Sample complete':i===done&&w.job?.kind==='solve'?'Simulating':!ready?'Locked':i===done?'Ready':'Queued'}</span></li>`).join('')}</ol>
    <div class="progress-track" role="progressbar" aria-label="Sample solver stages" aria-valuemin="0" aria-valuemax="6" aria-valuenow="${done}"><div style="width:${done/6*100}%"></div></div><p class="cal-caption">${done} of 6 stages complete. Numerical quality metrics require the real solver.</p></section>
    <section class="work-section">${heading('3','Profile & outputs','The intrinsic profile becomes the input for pose updates and reconstruction.')}
    ${p?`<div class="cal-result"><span class="pill success">Sample profile available</span><h3>${esc(p.name)}</h3><p>${p.cameras.length} cameras · ${p.poseCount} board poses</p><p>Coverage, reprojection error, and K1 stability have not been measured.</p><div class="cal-actions">${action('Use sample profile for capture','use',busy)}<button class="button primary" data-cal-tab="poses">Open AprilTag poses →</button></div></div>`:`<div class="cal-empty">${icon('target',30)}<h3>Profile awaits all six stages</h3><p>Complete the sample pipeline to explore profile selection and pose updates.</p></div>`}
    <details class="cal-details" open><summary>Expected backend output files</summary><ul class="cal-files"><li><code>intrinsics.json</code><span>Per-camera intrinsic parameters</span></li><li><code>extrinsics-camera-frame.json</code><span>Fixed-rig camera poses</span></li><li><code>calibration-summary.json</code><span>Quality and solver diagnostics</span></li></ul><p>Contract from the Notion workflow. This preview does not generate these files.</p></details></section></div>`;
}

function poseScreen(w,selected,externalBusy) {
  const p=activeProfile(w),blocker=poseBlocker(w,selected),busy=!!w.job||externalBusy;
  const stages=['Capture synchronized views','Transfer + retain intrinsics','Detect tags + solve poses'];
  return `<div class="cal-layout"><section class="work-section">${heading('1','Source intrinsic profile','Reuse the solved intrinsics while updating the cameras’ positions.')}
    <label>Intrinsic profile<select data-cal-select="profile" ${busy||!w.profiles.length?'disabled':''}>${w.profiles.length?selectOptions(w.profiles.map(p=>[p.id,p.name]),w.profileId):'<option>No solved profiles yet</option>'}</select></label>
    ${p?`<div class="cal-profile-details"><h3>${esc(p.name)}</h3><p>${p.cameras.length} cameras · rear-facing demo lenses · ${p.poseCount} board poses</p><details class="cal-details"><summary>Camera identities</summary><p>${cameraNames(p.cameras)}</p></details></div>`:'<p class="cal-caption">Complete Solve calibration to create a source profile.</p>'}
    <div class="cal-fields cal-tag-fields"><label>AprilTag family<select data-cal-select="tagFamily" ${busy?'disabled':''}><option value="tag36h11">tag36h11</option></select></label>${field('tagSizeMm','Tag side length (mm)',w.tagSizeMm,'type="number" min="0.1" max="1000" step="any" required',busy)}</div>
    <p class="cal-caption">Use the size and family of the tags in your rig. These sample settings will need verification when the real solver is connected.</p>
    ${blocker?`<div class="notice warning-notice">${esc(blocker)}</div>`:`<div class="notice success-notice">${selected.length} selected demo camera identities and facing directions match the source profile.</div>`}
    <div class="cal-actions">${action('Run sample pose update','poses',busy||!!blocker,true)}${w.job?.kind==='poses'?action('Stop pose demo','cancel'):''}</div></section>
    <section class="work-section">${heading('2','Pose update','One synchronized image per selected camera, then a separate result.')}
    <ol class="cal-stages">${stages.map((label,i)=>`<li class="${w.job?.kind==='poses'&&w.job.stage===i?'running':''}"><span class="cal-stage-number">${i+1}</span><div><h3>${label}</h3><p>${['Check identity and facing before acquisition.','The real pipeline copies intrinsic JSON byte-for-byte.','Jointly solve tag layout and camera poses.'][i]}</p></div></li>`).join('')}</ol>
    <div class="cal-preserve-note">${icon('folder',20)}<p>Each update creates a new session. The source intrinsic profile and previous pose results remain unchanged.</p></div></section></div>
    <section class="work-section">${heading('3','Pose results','Keep a traceable link from each new pose session to its source intrinsics.')}
    ${w.poseResults.length?`<div class="cal-result-list">${w.poseResults.slice().reverse().map((r,i)=>`<article><div><span class="pill neutral">Sample result ${w.poseResults.length-i}</span><h3>${esc(w.profiles.find(p=>p.id===r.sourceProfileId)?.name||r.sourceProfileId)}</h3><p>${r.cameras.length} cameras · ${r.tagSizeMm} mm · ${esc(r.tagFamily)}</p><small>${esc(new Date(r.createdAt).toLocaleString())}</small></div><div><strong>Source preserved</strong><p>Pose quality not measured</p></div></article>`).join('')}</div>`:'<div class="cal-empty">'+icon('target',30)+'<h3>No pose updates yet</h3><p>Select a solved profile, confirm the camera set, and run a sample update.</p></div>'}</section>`;
}
