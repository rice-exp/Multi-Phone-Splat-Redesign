import {formatTime} from './model.js';
const connection=document.querySelector('#connection');
const stream=new EventSource('/api/participant/events');
let lastState=null;
function render(state) {
  lastState=state;
  document.querySelectorAll('[data-participant-stage]').forEach(el=>el.classList.toggle('active',el.dataset.participantStage===state.phase));
  const instructions={idle:'Stand in the marked area and wait for the operator.',preparing:'Stay in position. Capture starts shortly.',capturing:'Follow the operator’s movement instructions.',done:'Capture complete. Wait for the operator’s instructions.',cancelled:'Capture stopped. Wait for the operator.',interrupted:'Capture interrupted. Wait for the operator.'};
  document.querySelector('#participant-instruction').textContent=instructions[state.phase]||instructions.idle;
  document.querySelector('#participant-timer').textContent=state.phase==='capturing'?formatTime(state.remaining):'—';
  document.querySelector('#participant-session').textContent=state.sessionName;
  document.querySelector('#participant-alert').textContent=['cancelled','interrupted'].includes(state.phase)?'Capture incomplete.':'';
}
stream.onopen=()=>{connection.textContent='Display connected';connection.className='pill connected';if(lastState)render(lastState);};
stream.onmessage=event=>{try{render(JSON.parse(event.data));connection.textContent='Display connected';connection.className='pill connected';}catch{connection.textContent='Waiting for valid status';}};
stream.onerror=()=>{
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
// SSE heartbeats prove that the server is alive, not that the operator still is.
setInterval(()=>{
  if(lastState&&['preparing','capturing'].includes(lastState.phase)&&Date.now()-lastState.updatedAt>5000){
    connection.textContent='Operator status is stale';connection.className='pill warning';
    document.querySelectorAll('[data-participant-stage]').forEach(el=>el.classList.remove('active'));
    document.querySelector('#participant-timer').textContent='—';
    document.querySelector('#participant-alert').textContent='Capture status is out of date. Stay in place and wait for your operator.';
  }
},1000);
