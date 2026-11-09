import {STEPS,workspaceShell,centerWorkflow} from './workflow.js';
import {mountColorWorkbench} from './color-workbench.js';

document.getElementById('app').innerHTML=workspaceShell(STEPS[1],'Sync phone white balance and check color against the mat.');
document.getElementById('workspace-content').innerHTML='<p class="rig-caption">Camera geometry acquisition and solving are not connected yet.</p><div id="color-workbench"></div>';
mountColorWorkbench(document.getElementById('color-workbench'));
centerWorkflow();
window.addEventListener('pagehide',()=>mountColorWorkbench(null));
window.addEventListener('pageshow',event=>{if(event.persisted)mountColorWorkbench(document.getElementById('color-workbench'));});
