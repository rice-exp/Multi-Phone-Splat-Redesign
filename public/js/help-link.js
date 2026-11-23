import {esc} from './icons.js';

export function helpLink(topic,label,hint='What is this?') {
  return `<button type="button" class="field-help" data-help-open data-help-topic="${esc(topic)}" aria-label="${esc(label)}" aria-haspopup="dialog" aria-controls="workspace-help" data-tooltip="${esc(hint)}"><span aria-hidden="true">?</span></button>`;
}
