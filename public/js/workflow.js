import {icon,esc} from './icons.js';

export const STEPS=[
  {id:'prepare',name:'Prepare rig',detail:'Connect & configure',path:'/'},
  {id:'calibration',name:'Calibration',detail:'Color correction',path:'/calibration'},
  {id:'capture',name:'Capture',detail:'Not connected',path:'/capture'},
  {id:'frames',name:'Frame review',detail:'Review saved captures',path:'/frames'},
  {id:'reconstruct',name:'Reconstruction',detail:'Not connected',path:'/reconstruction'},
  {id:'results',name:'Splat review',detail:'Not connected',path:'/splats'}
];
export function workspaceBrand(){
  return `<div class="workspace-brand"><span class="rice-crest"><img src="/assets/rice-shield.png" width="29" height="34" alt="Rice University crest"></span><div class="brand-text"><a class="brand-title" href="/">Rice Experiential Pixels Lab</a><a class="lab-link" href="https://pixels.rice.edu/" target="_blank" rel="noopener noreferrer" aria-label="Pixels lab website (opens in a new tab)">pixels.rice.edu ${icon('external',12)}</a></div></div>`;
}
export function themeToggle(){
  return `<button type="button" class="button secondary theme-toggle" data-theme-toggle aria-label="Dark mode" aria-pressed="${document.documentElement.dataset.theme==='dark'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 13.3A9 9 0 0 1 10.7 3.2a9 9 0 1 0 10.1 10.1Z"/></svg><span>Dark mode</span></button>`;
}
export function workspaceHeader(name,tools=''){
  return `<header class="topbar"><div class="breadcrumb"><span class="breadcrumb-root">Capture workspace</span>${icon('chevron',14)}<strong>${esc(name)}</strong></div><div class="topbar-tools">${tools}${themeToggle()}</div></header>`;
}
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
  return `<a class="skip-link" href="#workspace">Skip to workspace</a><aside class="sidebar">${workspaceBrand()}<div class="sidebar-label">WORKFLOW</div><nav class="step-nav" aria-label="Capture workflow">${workflowNavigation(step.id)}</nav><div class="sidebar-bottom"><a class="sidebar-action" href="/">${icon('back',18)} Prepare rig</a><a class="sidebar-action" href="/participant.html" target="participant-display">${icon('monitor',18)} Participant display</a></div></aside><div class="main-shell">${workspaceHeader(step.name)}<main id="workspace" tabindex="-1"><div class="page-heading"><div><div class="eyebrow">STEP ${String(STEPS.findIndex(s=>s.id===step.id)+1).padStart(2,'0')} OF 06</div><h1>${esc(step.name)}</h1><p>${esc(description)}</p></div></div><div id="workspace-content"></div></main></div>`;
}
export function centerWorkflow(){
  if(matchMedia('(max-width:760px)').matches)document.querySelector('.nav-step.active')?.scrollIntoView({block:'nearest',inline:'center'});
}
