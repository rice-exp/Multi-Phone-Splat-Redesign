// Illustrative studio previews. These are deliberately generated, never labeled as live camera feeds.
export function studioPreview(index=0,options={}) {
  const {pose=0,board=false}=options;
  const shift=Math.sin(index*Math.PI/4)*13,turn=Math.cos(index*Math.PI/4),arm=Math.sin(pose*.15)*9;
  const id=`studio-${index}-${board?'board':'person'}`;
  return `<svg class="studio-scene" viewBox="0 0 400 252" role="img" aria-label="Simulated studio view from camera ${index+1}">
    <defs><linearGradient id="${id}-wall" x2="0" y2="1"><stop stop-color="#526067"/><stop offset="1" stop-color="#7b898a"/></linearGradient><linearGradient id="${id}-shirt" x2="1" y2=".8"><stop stop-color="#e5d9c3"/><stop offset=".45" stop-color="#bfb198"/><stop offset="1" stop-color="#8d867b"/></linearGradient><radialGradient id="${id}-light"><stop stop-color="#d4d7bf" stop-opacity=".3"/><stop offset="1" stop-color="#9bafab" stop-opacity="0"/></radialGradient></defs>
    <rect width="400" height="252" fill="url(#${id}-wall)"/><rect width="400" height="252" fill="url(#${id}-light)"/>
    <path d="M0 171h400v81H0Z" fill="#414d50"/><path d="M0 201h400M0 234h400M35 252l99-81m31 81 11-81m58 81-14-81m121 81-94-81" stroke="#94a4a0" opacity=".19"/>
    <path d="M49 0v170m302-170v170" stroke="#acb8b3" opacity=".3"/><path d="M0 169h400" stroke="#b0b9af" opacity=".22"/>
    <ellipse cx="${200+shift}" cy="221" rx="53" ry="10" fill="#17282c" opacity=".35"/>
    <path d="M154 224h23m46 0h23m-78-7v14m64-14v14" stroke="#baab65" stroke-width="2" opacity=".7"/>
    ${board?`<g transform="translate(153 63) rotate(${index*2-7} 48 60)"><rect width="94" height="122" fill="#eceae3" rx="2"/>${Array.from({length:7},(_,r)=>Array.from({length:5},(_,c)=>`<rect x="${7+c*16}" y="${6+r*16}" width="16" height="16" fill="${(r+c)%2?'#deddd5':'#263638'}"/>`).join('')).join('')}</g>`:`<g transform="translate(${shift} 0)">
    <path d="m181 144-4 64 13 1 12-55 5 55 13-1-4-65Z" fill="#26373d"/><path d="m177 207-6 12q10 4 22 0l-3-11m17 0-1 12q13 3 23-1l-9-11" fill="#d8d4c7"/>
    <path d="M183 89q15-10 34 0l9 57q-23 12-50-1Z" fill="url(#${id}-shirt)"/>
    <path d="m183 91-15 24 ${-(3+arm)} 33m52-57 14 24 ${3+arm} 33" fill="none" stroke="#b7a992" stroke-width="13" stroke-linecap="round"/><path d="M${165-arm} 145l-1 9M${234+arm} 145l1 9" stroke="#b4947e" stroke-width="9" stroke-linecap="round"/>
    <path d="M191 77v13q9 6 17 0V77" fill="#b99b84"/><ellipse cx="${200+turn*2}" cy="65" rx="16" ry="22" fill="#c2a48c"/><path d="M185 66q-8-33 20-26 17 1 11 30l-5-17q-14 0-23 8Z" fill="#333a37"/><path d="m${201+turn*8} 64 2 7-3 1" fill="none" stroke="#9a7a64" stroke-width="1.5"/>
    </g>`}
    <path d="M15 31V15h16m338 0h16v16M15 221v16h16m338 0h16v-16" stroke="#e0e8da" stroke-width="1" opacity=".55"/>
    <circle cx="200" cy="125" r="26" fill="none" stroke="#e6ece1" opacity=".15"/><path d="M191 125h18m-9-9v18" stroke="#e6ece1" opacity=".3"/>
  </svg>`;
}
export function settingsFilter(settings) {
  const brightness=Math.max(.3,Math.min(1.9,Math.sqrt(settings.exposure/8)*Math.sqrt(settings.iso/200)));
  return `brightness(${brightness}) contrast(${settings.contrast/100}) sepia(${Math.min(.32,Math.abs(settings.temperature-5600)/9000)}) hue-rotate(${(settings.temperature-5600)/-130}deg)`;
}
