const paths = {
  aperture:'<circle cx="12" cy="12" r="9"/><path d="m14.3 3.3 3.5 6M20.8 9H14M18.5 18.5l-3.5-6M9.7 20.7l-3.5-6M3.2 15H10M5.5 5.5l3.5 6"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  camera:'<path d="M8 5 6 8H3v12h18V8h-3l-2-3Z"/><circle cx="12" cy="13" r="3.5"/>',
  frames:'<rect x="3" y="3" width="14" height="14" rx="2"/><path d="M7 21h12a2 2 0 0 0 2-2V7M3 13l4-4 6 6 4-4"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7Zm0 10 9-5M12 12 3 7m9 5v10M7.5 4.5l9 5"/>',
  play:'<path d="m8 5 11 7-11 7Z"/>', pause:'<path d="M8 5v14M16 5v14"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  wifi:'<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="20" r=".6"/>',
  check:'<path d="m5 12 4 4L19 6"/>', chevron:'<path d="m9 5 7 7-7 7"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', back:'<path d="M20 12H4m6 6-6-6 6-6"/>',
  warning:'<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.1"/>', info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  log:'<path d="M8 6h12M8 12h12M8 18h12M3 6h.1M3 12h.1M3 18h.1"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
  refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 6"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>', external:'<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  battery:'<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M5 10v4m3-4v4m3-4v4"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M3 16v5h18v-5"/>', folder:'<path d="M3 5h6l2 3h10v12H3Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  link:'<path d="m10 13 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 3a3 3 0 0 1 4 0l5-5a3 3 0 0 0-4-4l-2 2"/>',
  expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>', eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  stop:'<rect x="5" y="5" width="14" height="14" rx="2"/>', plus:'<path d="M12 5v14M5 12h14"/>', minus:'<path d="M5 12h14"/>'
};
export const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.info}</svg>`;
export const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
