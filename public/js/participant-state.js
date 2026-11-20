// Only an observed capture job may light a participant stage. A working
// websocket/HTTP connection, camera pipeline or old demo message is not a take.
export function participantView(state,now=Date.now()) {
  const unavailable={phase:null,timer:'—',session:'No active capture status',instruction:'Wait for the operator. Capture status is not connected.',connection:'Capture status unavailable'};
  if(!state||state.available!==true||state.simulation===true)return unavailable;
  const phases=['idle','preparing','capturing','saving','done','cancelled','interrupted'];
  if(!phases.includes(state.phase)||!Number.isFinite(state.updatedAt)||state.updatedAt>now+1000||now-state.updatedAt>5000)return {...unavailable,instruction:'Capture status is out of date. Wait for the operator.',connection:'Capture status out of date'};
  const instructions={idle:'Wait for the operator.',preparing:'Stay in position while the cameras synchronize.',capturing:'Follow the operator’s instructions.',saving:'Recording has ended. The operator is saving the images.',done:'Session saved. Wait for the operator.',cancelled:'Capture stopped. Wait for the operator.',interrupted:'Wait for the operator to check this take.'};
  const remaining=typeof state.remaining==='number'&&Number.isFinite(state.remaining)&&state.remaining>=0?Math.ceil(state.remaining):null;
  return {phase:state.phase,timer:state.phase==='capturing'&&remaining!==null?`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`:'—',
    session:typeof state.sessionName==='string'&&state.sessionName.trim()?state.sessionName:'Waiting for a session',instruction:instructions[state.phase],connection:'Capture status connected'};
}
