import {esc} from './icons.js';

export const PRESET_SORTS=[['date-desc','Date: newest first'],['date-asc','Date: oldest first'],['name-asc','Name: A–Z'],['name-desc','Name: Z–A']];
const savedTime=p=>Date.parse(p.application?.appliedAt)||0;
const compareNames=(a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base',numeric:true});

export function sortedPresets(presets,sort='date-desc') {
  const compare={
    'date-desc':(a,b)=>savedTime(b)-savedTime(a),
    'date-asc':(a,b)=>savedTime(a)-savedTime(b),
    'name-asc':compareNames,
    'name-desc':(a,b)=>compareNames(b,a)
  }[sort]||((a,b)=>savedTime(b)-savedTime(a));
  return [...presets].sort((a,b)=>compare(a,b)||compareNames(a,b)||a.id.localeCompare(b.id));
}

export function presetBrowser(state,{selectedId,sort='date-desc',busy=false,editingId}={}) {
  const presets=sortedPresets(state.presets,sort),selected=presets.find(p=>p.id===selectedId)||presets[0];
  const date=p=>savedTime(p)?new Date(savedTime(p)).toLocaleString():'Date unavailable';
  return `<div class="color-preset-browser">
    <div class="color-preset-picker">
      <label for="color-preset-select">Choose a saved preset</label>
      <select id="color-preset-select" ${busy||!presets.length?'disabled':''}>${presets.length?presets.map(p=>`<option value="${esc(p.id)}" ${p.id===selected.id?'selected':''}>${esc(p.name)} · ${esc(date(p))}</option>`).join(''):'<option>No saved presets yet</option>'}</select>
      <label for="color-preset-sort">Sort presets</label>
      <select id="color-preset-sort" ${busy||!presets.length?'disabled':''}>${PRESET_SORTS.map(([value,label])=>`<option value="${value}" ${sort===value?'selected':''}>${label}</option>`).join('')}</select>
      <p class="cal-caption">${presets.length?`${presets.length} saved preset${presets.length===1?'':'s'} in this browser. Choosing one here shows its details.`:'Apply your color settings to save your first preset. It will appear here.'}</p>
    </div>
    <div id="color-preset-details" class="color-preset-details" aria-live="polite" aria-atomic="true">
      ${selected?`<h3>${esc(selected.name)}</h3><dl><div><dt>Last saved</dt><dd>${savedTime(selected)?`<time datetime="${new Date(savedTime(selected)).toISOString()}">${esc(date(selected))}</time>`:'Date unavailable'}</dd></div><div><dt>Leader camera</dt><dd>${esc(selected.camera)}</dd></div></dl>
        <p class="cal-caption">${selected.id===editingId?'Loaded for editing. Review the adjustments, then press Apply to use them.':'Load this preset to review its settings. Then press Apply to use them on the cameras.'}</p>
        <div class="cal-actions"><button type="button" class="button primary" data-color-action="load-preset:${esc(selected.id)}" ${busy?'disabled':''}>Load preset</button><button type="button" class="button secondary" data-color-action="remove-preset:${esc(selected.id)}" ${busy?'disabled':''}>Delete preset</button></div>`:
        '<h3>No saved presets yet</h3><p>Once you save a color setup, its name, date and controls will appear here.</p>'}
    </div>
  </div>`;
}
