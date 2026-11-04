import {settingsVerification} from './settings-readback.js';

export const FRESH_MS = 20000;
export function observedPhones(status, now = Date.now()) {
  const fresh = status.connected && now - status.checkedAt <= FRESH_MS;
  return (status.phones || []).map(phone => ({...phone,
    responding:!!fresh && phone.responding,
    previewReady:!!fresh && phone.previewReady,
    sync:fresh && phone.responding && phone.sync && now - phone.sync.checkedAt < 60000 ? phone.sync : null
  }));
}
export function selectionFor(phones, previous = {}) {
  // Persist only selection; never restore device status from browser storage.
  return Object.fromEntries(phones.map(phone => [phone.id, typeof previous[phone.id]==='boolean'?previous[phone.id]:phone.enabled!==false]));
}
export function colorStatus(phone, requested) {
  const actual = phone.responding ? phone.state?.colorProcessing?.awbMode : null;
  if (!actual) return {label:'White balance unknown', tone:'warning'};
  if (!requested) return {label:`White balance: ${actual}`, tone:'neutral'};
  return actual === requested ? {label:`White balance: ${actual}`, tone:'success'} : {label:`White balance differs: ${actual}`, tone:'warning'};
}
export function configurationStatus(phone,requested) {
  const actual=phone.responding?phone.state:null;
  if(!actual||!requested)return {label:'Configuration unknown',tone:'warning'};
  const {status}=settingsVerification(actual,requested);
  return {label:status==='confirmed'?'Configuration matches':status==='partial'?'Settings partly verified':status==='unavailable'?'Configuration unknown':'Configuration differs',tone:status==='confirmed'?'success':'warning'};
}
