import {esc} from './icons.js';
import {selectionFor} from './rig-model.js';

export function selectedColorPhones(status) {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('rig-selection-v1')) || {}; } catch { saved = {}; }
  const phones = status?.phones || [];
  const selected = selectionFor(phones, saved);
  return phones.filter(phone => selected[phone.id]);
}

export function phoneColorPanel(status, phones, leaderId, busy, message) {
  const leader = phones.find(p => p.id === leaderId && p.responding);
  const disabled = busy || status?.busy || !status?.connected || !status.workflowKnown || status.workflowBusy;
  const last = status?.colorSync;
  const canRetry = last?.leaderId === leaderId && last.results.some(r => !r.ok && phones.some(p => p.id === r.id && p.ip === r.ip));
  const options = phones.filter(p => p.responding).map(p =>
    `<option value="${esc(p.id)}" ${p.id === leaderId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const gains = value => Array.isArray(value) ? value.map(n => Number(n).toFixed(2)).join(' / ') : 'unreported';
  return `<h3>Phone white balance</h3>
    <p class="cal-caption">Place the mat at the subject position under capture lighting. Choose a leader with an evenly lit view and no glare.</p>
    <label>White balance leader<select id="color-sync-leader" ${disabled || !options ? 'disabled' : ''}><option value="">Choose a phone</option>${options}</select></label>
    <p class="cal-caption">${phones.length} selected in <a href="/">Prepare rig</a>${phones.length ? ' · ' + phones.map(p => esc(p.name) + (p.responding ? '' : ' (offline)')).join(', ') : ''}</p>
    <div class="cal-actions"><button class="button primary" data-color-action="sync-color" ${disabled || !leader ? 'disabled' : ''}>Sync white balance to phones</button>
    ${canRetry ? `<button class="button secondary" data-color-action="retry-color" ${disabled || !leader ? 'disabled' : ''}>Retry with same settings</button>` : ''}</div>
    <p class="cal-caption" role="status">${esc(message)}</p>
    ${last ? `<details open><summary>Last sync · ${new Date(last.at).toLocaleTimeString()} · ${last.results.filter(r => r.ok).length} / ${last.results.length} matched</summary>
      <p class="cal-caption">Leader RGGB gains: ${esc(gains(last.snapshot.whiteBalanceGains))}. Results are CameraScope settings readbacks.</p>
      <ul>${last.results.map(r => `<li><strong>${esc(r.name)}</strong> · ${r.ok ? 'Settings matched' : esc(r.error.message + ' ' + r.error.next)}</li>`).join('')}</ul></details>` : ''}
    ${phones.length ? `<details><summary>Current CameraScope settings</summary><ul>${phones.map(p => {
      const color = p.state?.colorProcessing, effective = p.state?.effectiveColor;
      return `<li><strong>${esc(p.name)}</strong> · ${p.responding ? `AWB ${esc(color?.awbMode ?? 'unreported')}, requested RGGB ${esc(gains(color?.whiteBalanceGains))} · last sensor RGGB ${esc(gains(effective?.gains))}` : 'Offline'}</li>`;
    }).join('')}</ul></details>` : ''}`;
}

export async function syncPhoneColor(status, ids, leaderId, retry) {
  const body = {ids, leaderId};
  if (retry) body.retryId = status.colorSync.id;
  const response = await fetch('/api/rig/color-sync', {
    method:'POST', headers:{'Content-Type':'application/json', 'X-Rig-Request':'1'},
    body:JSON.stringify(body), signal:AbortSignal.timeout(45000)
  });
  const data = await response.json();
  if (!response.ok) throw new Error([data.error, data.next].filter(Boolean).join(' '));
  return data.status;
}
