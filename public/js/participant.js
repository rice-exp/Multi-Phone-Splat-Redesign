import {participantView} from './participant-state.js';
import {workspaceBrand,themeToggle} from './workflow.js';
document.querySelector('#participant-brand').innerHTML=workspaceBrand();
document.querySelector('#participant-theme').innerHTML=themeToggle();
const connection=document.querySelector('#connection');
const stream=new EventSource('/api/participant/events');
let lastState=null;
function render(state) {
  lastState=state;const view=participantView(state);
  document.querySelectorAll('[data-participant-stage]').forEach(el=>el.classList.toggle('active',el.dataset.participantStage===view.phase));
  document.querySelector('#participant-instruction').textContent=view.instruction;
  document.querySelector('#participant-timer').textContent=view.timer;
  document.querySelector('#participant-session').textContent=view.session;
  document.querySelector('#participant-alert').textContent=['cancelled','interrupted'].includes(view.phase)?'Capture incomplete.':'';
  connection.textContent=view.connection;connection.className=view.phase?'pill connected':'pill';
}
stream.onopen=()=>{lastState=null;render(null);};
stream.onmessage=event=>{try{render(JSON.parse(event.data));}catch{render(null);connection.textContent='Waiting for valid capture status';}};
stream.onerror=()=>{
  lastState=null;render(null);
  connection.textContent='Connection lost · reconnecting';connection.className='pill warning';
  document.querySelectorAll('[data-participant-stage]').forEach(el=>el.classList.remove('active'));
  document.querySelector('#participant-alert').textContent='Status is out of date. Stay in place and wait for your operator.';
  document.querySelector('#participant-timer').textContent='—';
};
document.querySelector('#fullscreen').onclick=async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}
  catch{connection.textContent='Use your browser’s full-screen control';}
};
document.addEventListener('fullscreenchange',()=>{document.querySelector('#fullscreen').textContent=document.fullscreenElement?'Exit full screen':'Full screen';});
// SSE heartbeats prove that the server is alive, not that capture is active.
setInterval(()=>{
  if(lastState)render(lastState);
},1000);
