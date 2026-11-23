import {workspaceRoute} from './workflow.js';
import {mountWorkspaceHelp} from './workspace-help.js';
const route=workspaceRoute(location.pathname,location.hash);
const url=new URL(location.href);url.pathname=route.path;url.searchParams.delete('demo');
if(url.hash!=='#workspace')url.hash='';
history.replaceState(null,'',url.pathname+url.search+url.hash);
mountWorkspaceHelp(route.id);
await import(`./${route.module}.js`);
