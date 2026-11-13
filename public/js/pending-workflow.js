import {workspaceRoute,workspaceShell,centerWorkflow} from './workflow.js';
import {esc,icon} from './icons.js';

const step=workspaceRoute(location.pathname);
const descriptions={reconstruct:'Reconstruction is not connected yet.',results:'A trained-splat viewer is not connected yet.'};
document.getElementById('app').innerHTML=workspaceShell(step,descriptions[step.id]||'This workflow is not connected yet.');
document.getElementById('workspace-content').innerHTML=`<section class="work-section"><div class="rig-empty">${icon('cube',32)}<h2>${esc(step.name)} unavailable</h2><p>Open saved capture images in Frame review.</p><a class="button secondary" href="/frames">Open Frame review</a></div></section>`;
centerWorkflow();
