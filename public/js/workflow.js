import {icon,esc} from './icons.js';

export const STEPS=[
  {id:'prepare',name:'Prepare rig',detail:'Connect & configure',path:'/'},
  {id:'calibration',name:'Calibration',detail:'Color correction',path:'/calibration'},
  {id:'capture',name:'Capture',detail:'Not connected',path:'/capture'},
  {id:'frames',name:'Frame review',detail:'Review saved captures',path:'/frames'},
  {id:'reconstruct',name:'Reconstruction',detail:'Not connected',path:'/reconstruction'},
  {id:'results',name:'Splat review',detail:'Not connected',path:'/splats'}
];
export function workflowNavigation(active){
  return STEPS.map((step,index)=>`<a class="nav-step ${step.id===active?'active':''}" href="${step.path}" ${step.id===active?'aria-current="step"':''}><span class="nav-number">${String(index+1).padStart(2,'0')}</span><span><b>${step.name}</b><small>${step.detail}</small></span></a>`).join('');
}
export function workspaceRoute(pathname,hash=''){
  // Old preview bookmarks open the corresponding real page; browser-stored
  // demo devices, take history and progress never enter the active workspace.
  const legacy=['/','/index.html'].includes(pathname)?STEPS.find(step=>`#${step.id}`===hash):null;
  const step=legacy||STEPS.find(step=>step.path===pathname)||STEPS[0];
  return {...step,module:step.id==='prepare'?'rig-app':step.id==='frames'?'frame-review':step.id==='calibration'?'calibration-app':'pending-workflow'};
}
export function workspaceShell(step,description){
  return `<a class="skip-link" href="#workspace">Skip to workspace</a><aside class="sidebar"><a class="brand" href="/">${icon('aperture',30)}<div><span>Rice Experiential Pixels Lab</span><small>CAPTURE WORKSPACE</small></div></a><div class="sidebar-label">WORKFLOW</div><nav class="step-nav" aria-label="Capture workflow">${workflowNavigation(step.id)}</nav><div class="sidebar-bottom"><a class="sidebar-action" href="/">${icon('back',18)} Prepare rig</a><a class="sidebar-action" href="/participant.html" target="participant-display">${icon('monitor',18)} Participant display</a></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb">Capture workspace ${icon('chevron',14)} <strong>${esc(step.name)}</strong></div></header><main id="workspace" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">STEP ${String(STEPS.findIndex(s=>s.id===step.id)+1).padStart(2,'0')} OF 06</div><h1>${esc(step.name)}</h1><p>${esc(description)}</p></div></div><div id="workspace-content"></div></main></div>`;
}
export function centerWorkflow(){
  if(matchMedia('(max-width:760px)').matches)document.querySelector('.nav-step.active')?.scrollIntoView({block:'nearest',inline:'center'});
}
