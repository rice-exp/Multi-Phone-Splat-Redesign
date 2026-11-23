import {icon} from './icons.js';

const external = (url, label) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label} ${icon('external',14)}<span class="help-sr-only"> (opens in a new tab)</span></a>`;

function helpContent() {
  return `
    <header class="help-heading" tabindex="0" aria-label="Move or resize Help" aria-describedby="help-window-controls">
      <div><h2 id="workspace-help-title">Help &amp; setup</h2><p>Drag this header to move. Drag an edge or corner to resize.</p></div>
      <button type="button" class="icon-button help-close" data-help-close aria-label="Close help">${icon('close',20)}</button>
    </header>
    <span id="help-window-controls" class="help-sr-only">Use arrow keys to move this window, or Shift and arrow keys to resize it. Press Escape inside Help to close it. You can use the page while Help is open.</span>
    <div class="help-body">
      <p class="help-intro">Open a topic below and follow the steps. A <strong>rig</strong> is the group of phones you use together as cameras.</p>

      <details class="help-topic" name="workspace-help-topics" data-help-section="start">
        <summary><span>Start the app<small>Open it on your Windows laptop</small></span>${icon('chevron',18)}</summary>
        <div class="help-content">
          <p>You need the project folder, Node.js on your laptop, and CameraScope on each Android phone. If CameraScope is missing, get the app from the person who supplied your camera setup.</p>
          <ol>
            <li>Open <strong>File Explorer</strong> and find your <strong>Multi-Phone-Splat-Redesign</strong> project folder. A downloaded copy may have <strong>-calibration</strong> at the end of its name. Open it. You should see a file named <code>package.json</code>.</li>
            <li>Click the address bar at the top of File Explorer, type <code>cmd</code>, and press <strong>Enter</strong>. A Command Prompt window opens in that folder.</li>
            <li>Type <code>npm start</code> and press <strong>Enter</strong>. This runs the app on your laptop. Keep that window open while using the app.</li>
            <li>Open a browser and enter <code>http://127.0.0.1:4317</code> in its address bar. You should see <strong>Prepare rig</strong>.</li>
          </ol>
          <p>To stop the app, click the Command Prompt window and press <kbd>Ctrl</kbd> + <kbd>C</kbd>. To start it again, type <code>npm start</code> and press Enter. After an update, restart the app and refresh the browser.</p>
          <details class="help-more">
            <summary>First time on this laptop?</summary>
            <p>Download the project’s <strong>calibration</strong> branch using <strong>Code → Download ZIP</strong> on GitHub. Right-click the downloaded ZIP, select <strong>Extract All</strong>, then open the extracted project folder.</p>
            <p>${external('https://github.com/rice-exp/Multi-Phone-Splat-Redesign/tree/calibration','Open the calibration branch on GitHub')}</p>
            <p>Install the current <strong>LTS</strong> release of Node.js using its Windows installer. LTS is the version maintained for longer use. Reopen Command Prompt after installing. The app requires Node.js 20 or newer.</p>
            <p>${external('https://nodejs.org/en/download','Download Node.js from the official site')}</p>
            <p>This guide uses Windows, which includes the project’s video gateway. A Mac or Linux laptop also needs a matching MediaMTX installation. Complete that setup before following the camera steps.</p>
          </details>
        </div>
      </details>

      <details class="help-topic" name="workspace-help-topics" data-help-section="prepare">
        <summary><span>Prepare rig<small>Connect phones and get a live picture</small></span>${icon('chevron',18)}</summary>
        <div class="help-content">
          <h3>Connect to the same network</h3>
          <ol>
            <li>Connect your laptop and every phone to the same Wi-Fi network. Check that the Wi-Fi name matches on each device. A laptop connected by Ethernet can use that same network.</li>
            <li>Open <strong>CameraScope</strong> on every phone. Allow camera access if asked and keep the app visible.</li>
            <li>In CameraScope, enable the <strong>UDP command server</strong> on port <strong>5010</strong>. This lets the laptop send camera controls. Check your CameraScope version’s instructions if its labels differ.</li>
          </ol>
          <details class="help-more" id="help-ip-addresses">
            <summary>Find the laptop and phone IP addresses</summary>
            <p>An <strong>IP address</strong> is a device’s address on the network. You need the laptop’s address and a separate address for each phone. Copy the <strong>IPv4</strong> address, which has four groups of numbers separated by dots.</p>
            <h4 id="help-laptop-ip" tabindex="-1">Windows laptop</h4>
            <ol>
              <li>Click <strong>Start → Settings → Network &amp; internet</strong>.</li>
              <li>Select <strong>Wi-Fi</strong>, then the network you are connected to. For a wired connection, select <strong>Ethernet</strong>.</li>
              <li>Find <strong>IPv4 address</strong> in the connection properties and write it down.</li>
            </ol>
            <p>${external('https://support.microsoft.com/en-us/windows/experience/connectivity-networking/essential-network-settings-and-tasks-in-windows','Microsoft’s guide to finding your IP address')}</p>
            <h4 id="help-phone-ip" tabindex="-1">Android phone</h4>
            <ol>
              <li>Connect to the same Wi-Fi as your laptop, then open the phone’s <strong>Settings</strong> app.</li>
              <li>Open <strong>About phone</strong> and look for <strong>IP address</strong>. On Samsung Galaxy phones, open <strong>Status information</strong> inside About phone.</li>
              <li>Write down the address with four groups of numbers separated by dots. Repeat for each phone, keeping its name beside its address.</li>
            </ol>
            <p>Menu names vary by phone. Searching for <strong>IP address</strong> inside Settings can also help. If the address says “Unavailable,” reconnect to Wi-Fi first.</p>
            <p>${external('https://ncsu.service-now.com/sp?id=kb_article_view&sysparm_article=KB0021137','NC State’s Android IP address guide')}<br>${external('https://www.samsung.com/ca/support/mobile-devices/connect-your-samsung-galaxy-to-the-internet/','Samsung’s illustrated Wi-Fi setup guide')}</p>
            <div class="help-note">Use the addresses shown in device settings. The browser address <code>127.0.0.1</code> refers to the laptop itself. The phones need its Wi-Fi or Ethernet address to send video.</div>
            <p>For example, a laptop might use <code>192.168.50.10</code> and a phone <code>192.168.50.201</code>. These are examples only. Enter the addresses you found on your devices. Recheck them after changing networks.</p>
          </details>
          <h3>Add the cameras to the app</h3>
          <ol>
            <li>In <strong>Prepare rig</strong>, click <strong>Connection setup</strong> near the top.</li>
            <li>In <strong>Computer destination IP</strong>, enter the laptop’s IPv4 address.</li>
            <li>Click <strong>Add camera</strong> for each phone. Give it a unique <strong>Camera ID</strong> such as <code>cam-1</code>, a recognizable <strong>Name</strong> such as “Front,” and that phone’s <strong>Phone IP</strong>. Use letters, numbers or dashes in the ID.</li>
            <li>Click <strong>Save configuration</strong>. Open Connection setup again and click <strong>Start gateway</strong> if it is stopped. The gateway makes the phones’ video visible in your browser.</li>
            <li>Close Connection setup, click <strong>Refresh status</strong>, and tick the box beside each camera you want to use.</li>
            <li>Click <strong>Start selected previews</strong>, then <strong>Start previews</strong> in the confirmation window.</li>
          </ol>
          <div class="help-note"><strong>Ready to continue</strong><p>Each selected camera shows a moving picture and a <strong>Live</strong> label. These checkboxes also choose which phones receive settings and color adjustments.</p></div>
          <details class="help-more">
            <summary>What about the host, video and metadata ports?</summary>
            <p>Keep CameraScope’s command port at <strong>5010</strong>. When you click <strong>Start selected previews</strong>, the app sends the computer destination and the video and metadata ports for each phone automatically.</p>
            <p>If you need to check them, the first phone in the saved list uses video port <strong>5004</strong> and metadata port <strong>6004</strong>. The next uses <strong>5006</strong> and <strong>6006</strong>, increasing by two for each phone. The destination or UDP host is the laptop’s IPv4 address.</p>
          </details>
          <details class="help-more">
            <summary>Make the picture brighter or adjust camera settings</summary>
            <p>Use <strong>Camera settings</strong> in Prepare rig. Change one value at a time, click <strong>Apply to selected phones</strong>, and watch the picture after it reconnects.</p>
            <dl>
              <dt>ISO</dt><dd>Controls image brightness through gain. A higher value brightens the picture and can add grain. The saved starting value is 1600 on a new setup. Each phone has its own supported range.</dd>
              <dt>Exposure (ms)</dt><dd>How long the camera gathers light for each frame. A higher value brightens the picture and can blur movement. “ms” means milliseconds.</dd>
              <dt>Frame rate (fps)</dt><dd>How many frames the camera takes per second. “fps” means frames per second. A long exposure can lower this rate. For example, 100 ms allows at most 10 fps.</dd>
              <dt>White balance</dt><dd>Adjusts the overall color cast so neutral objects look neutral. The Calibration tab can measure it on a leader phone and share it with the others.</dd>
            </dl>
            <p><strong>Save configuration</strong> keeps setup information on the laptop. <strong>Apply to selected phones</strong> sends your camera-setting edits to the phones.</p>
          </details>
          <details class="help-more">
            <summary>Check clocks and open the participant display</summary>
            <p><strong>Check clocks</strong> measures timing differences between the phones and laptop. It requires the CameraScope desktop tools. You can use previews and color calibration before setting up those tools.</p>
            <p><strong>Open display</strong> opens the participant screen, which shows recording progress during a Capture session. You can leave it closed while setting up colors.</p>
          </details>
          <p class="help-next">When the cameras are live and the picture is bright enough, click <strong>Open color calibration</strong> at the bottom of Prepare rig.</p>
        </div>
      </details>

      <details class="help-topic" name="workspace-help-topics" data-help-section="calibration">
        <summary><span>Calibration<small>Adjust colors with or without a chart</small></span>${icon('chevron',18)}</summary>
        <div class="help-content">
          <h3>Choose a leader camera</h3>
          <p>The <strong>leader</strong> is the phone you adjust first. The other selected phones are <strong>followers</strong> and receive its color settings. Select the phones in Prepare rig, then click <strong>Choose as leader</strong> on a camera preview in Calibration. You can also choose it in the <strong>Leader phone</strong> menu.</p>
          <p>Use the lighting you plan to record in. Check all the previews after applying, since lighting and camera differences can affect their appearance.</p>
          <details class="help-more" open>
            <summary>Adjust colors manually without a chart</summary>
            <ol>
              <li>Choose your leader, then click <strong>Adjust color manually</strong> to jump to the sliders. A photo is optional.</li>
              <li>Adjust <strong>Exposure</strong>, <strong>Warmth</strong>, <strong>Tint</strong> or <strong>Saturation</strong>. Start with small changes.</li>
              <li>Click <strong>Apply manual adjustments to leader &amp; followers</strong>. The camera previews update when you press Apply.</li>
              <li>Look at <strong>Last sync</strong>. Each selected phone should report <strong>Settings matched</strong>. If one failed, reconnect it and choose <strong>Retry with same settings</strong>.</li>
            </ol>
            <p>On the first Apply, the app locks the leader’s white balance if needed, applies your adjustments, then copies the verified settings to the selected followers.</p>
            <div class="help-note"><strong>Try a small change, then Apply</strong><p>For a grayscale check, set just Saturation to 0% and press Apply. To restore the original saturation, set it back to 100% and press Apply again using the same preset.</p></div>
          </details>
          <details class="help-more">
            <summary>Calibrate automatically with a color chart</summary>
            <ol>
              <li>Place the physical chart where the subject will be, under the recording lights. Face it toward the leader camera so every colored square is visible and free of glare.</li>
              <li>Choose the matching <strong>Chart reference</strong>. The default is <strong>Calibrite ColorChecker Classic</strong>. Spyder Checkr 24 and a custom reference are also available.</li>
              <li>Enter a <strong>Run / lighting preset name</strong> so you can recognize this setup later.</li>
              <li>Wait for the leader’s live video, then click <strong>Lock color &amp; capture chart</strong>. The app takes a frame from that video, finds the chart and calculates a correction.</li>
              <li>Review <strong>Before / after</strong>. Drag the comparison slider to reveal more of either version.</li>
              <li>Click <strong>Apply to leader &amp; followers</strong> to send the correction to the phones. Adjust the manual sliders afterward if needed, and press Apply again.</li>
            </ol>
            <p>A successful automatic fit can appear in the browser previews before it is sent to the phones. Apply sends it to CameraScope. Manual slider edits take effect when you press Apply.</p>
            <p>If detection fails, open <strong>Manual alignment</strong>. Click the centers of the four outer corner patches in the order shown, then click <strong>Calibrate from points</strong> when it lights up after the fourth point. Use the colored squares themselves when choosing the points.</p>
            <p>A fit with larger remaining error may offer <strong>Apply approximate correction to leader &amp; followers</strong>. Review the result first. If application is blocked, try brighter, even lighting and check the chart model and points. <strong>Use manual adjustments only</strong> lets you discard that fit and work with the sliders.</p>
            <p>To use a custom chart, open <strong>Chart layout &amp; custom reference</strong> and import a reference JSON file containing its layout and known sRGB colors. Ask the chart supplier for those values.</p>
          </details>
          <details class="help-more">
            <summary>What the color sliders do</summary>
            <dl>
              <dt>Exposure</dt><dd>Brightens or darkens the color correction. The camera’s ISO and shutter time are adjusted in Prepare rig.</dd>
              <dt>Warmth</dt><dd>Shifts colors toward warmer red or cooler blue.</dd>
              <dt>Tint</dt><dd>Adjusts the balance between green and magenta.</dd>
              <dt>Saturation</dt><dd>Controls color intensity. 100% keeps the starting intensity. 0% removes color.</dd>
              <dt>Calibration strength</dt><dd>Controls how much of a chart correction is used. It becomes available after fitting a chart.</dd>
            </dl>
            <p><strong>Reset adjustments</strong> returns the sliders to their defaults. Press <strong>Apply</strong> afterward to send that reset to the phones.</p>
          </details>
          <details class="help-more" id="help-color-presets">
            <summary>Run / lighting preset names and saved settings</summary>
            <p>A <strong>preset</strong> is a saved set of color settings. Give it a name that helps you remember the lighting and setup, such as “Window daylight” or “Evening indoor.” You choose this name; it is not an address or a camera setting.</p>
            <p>Apply automatically saves the preset in this browser on this laptop. Use <strong>Save as new run preset</strong> to keep a separate named copy. To continue later, find it under <strong>Saved run presets</strong>, load it, adjust if needed, then press Apply.</p>
            <p>Use <strong>Export preset</strong> to download a record of the settings. Clearing browser storage can remove local presets. Recheck the colors when the lighting, camera or exposure changes.</p>
          </details>
          <details class="help-more">
            <summary>The preview starts out dark or strongly tinted</summary>
            <p>First check the light and camera settings in <strong>Prepare rig</strong>. Adjust ISO, exposure and white balance there before taking a chart frame.</p>
            <p>Wait for the picture to settle. Then adjust colors manually, or capture a fresh chart frame. To measure white balance and share it immediately, choose <strong>Measure new white balance</strong> and click <strong>Measure and sync phones</strong>.</p>
          </details>
        </div>
      </details>

      <details class="help-topic" name="workspace-help-topics" data-help-section="troubleshooting">
        <summary><span>Something isn’t working<small>Find the next thing to check</small></span>${icon('chevron',18)}</summary>
        <div class="help-content">
          <details class="help-more">
            <summary>The webpage will not open</summary>
            <p>On the laptop running the app, check that the Command Prompt window is open and shows the app address. Enter <code>http://127.0.0.1:4317</code> in the browser address bar. If the app was stopped, run <code>npm start</code> again from the project folder.</p>
            <p>If you see “npm is not recognized,” install Node.js and open a new Command Prompt. If you see “Could not read package.json,” open Command Prompt from inside the extracted project folder.</p>
          </details>
          <details class="help-more">
            <summary>The terminal says EADDRINUSE or “address already in use”</summary>
            <p>A program is already using the app’s port. Try opening the app in the browser first. To restart your existing copy, go to the Command Prompt where it is running, press <kbd>Ctrl</kbd> + <kbd>C</kbd>, wait for it to stop, then run <code>npm start</code> once.</p>
          </details>
          <details class="help-more">
            <summary>A phone is missing or says offline</summary>
            <p>Keep CameraScope open, confirm its command server is enabled on port 5010, and check that the phone and laptop use the same network. Recheck the phone’s IP address in Settings, update it in <strong>Connection setup</strong> if needed, save and click <strong>Refresh status</strong>.</p>
            <p>If it still cannot connect, check whether the Wi-Fi allows devices to talk to each other, or ask the person who manages the network. Guest networks can block this.</p>
          </details>
          <details class="help-more">
            <summary>The phone responds, but there is no live picture</summary>
            <p>Check the <strong>Computer destination IP</strong> and the gateway status in Connection setup. Start the gateway if stopped. Select the phone and click <strong>Start selected previews</strong>, then confirm. Use <strong>Retry</strong> on its card if video still fails.</p>
            <p>If Windows asks whether to allow Node.js or MediaMTX through the firewall, allow access on the private network you trust and use for this setup. If your computer is managed by an organization, ask its IT support for help with that permission.</p>
          </details>
          <details class="help-more">
            <summary>The video freezes or looks blocky</summary>
            <p>Check the phone’s own picture in CameraScope. If it looks clear there, move closer to the Wi-Fi access point, try fewer simultaneous previews, then use <strong>Retry</strong>. Wait for stable video before capturing a calibration frame.</p>
          </details>
          <details class="help-more">
            <summary>Apply is unavailable, or the sliders seem to do nothing</summary>
            <p>Select the leader’s checkbox in Prepare rig and choose it as <strong>Leader phone</strong> in Calibration. Check that it responds and that another rig operation has finished. Move a slider, then press <strong>Apply</strong> to see the change. A blocked chart fit can be removed with <strong>Use manual adjustments only</strong>.</p>
          </details>
          <details class="help-more">
            <summary>Capture or Check clocks asks for CameraScope desktop tools</summary>
            <p>Install the desktop CameraScope tools on the laptop and configure their location, or ask the person who supplied your camera setup for help. The folder must contain <code>scripts/camerascope_cli.py</code>. The project’s <code>.camerascope</code> folder stores settings and may not contain those tools.</p>
            <p>${external('https://github.com/rice-exp/Multi-Phone-Splat-Redesign/blob/calibration/docs/PREPARE-RIG.md#saved-configuration-and-clock-cli','CameraScope desktop tool setup')}</p>
            <p>After setup, restart the app and refresh the browser. For “Method not allowed” or an old Capture page, restart the updated app first.</p>
          </details>
        </div>
      </details>
      <p class="help-links-note">External guides ${icon('external',13)} open in a new tab so you can keep your place here.</p>
    </div>`;
}

export function mountWorkspaceHelp(section) {
  if(document.getElementById('workspace-help'))return;
  const storageKey='splat-workspace-help-v1';
  let saved={};
  try { saved=JSON.parse(sessionStorage.getItem(storageKey))||{}; } catch {}
  const dialog=document.createElement('dialog');
  dialog.id='workspace-help';
  dialog.className='workspace-help';
  dialog.setAttribute('aria-labelledby','workspace-help-title');
  dialog.setAttribute('aria-modal','false');
  dialog.innerHTML=helpContent()+['n','e','s','w','ne','se','sw','nw'].map(edge=>
    `<span class="help-resize" data-help-resize="${edge}" aria-hidden="true"></span>`).join('');
  document.body.append(dialog);
  const heading=dialog.querySelector('.help-heading'),body=dialog.querySelector('.help-body');
  const topics=[...dialog.querySelectorAll('details')];
  const initial=dialog.querySelector(`[data-help-section="${section}"]`)||dialog.querySelector('[data-help-section="start"]');
  initial.open=true;
  if(saved.open&&Array.isArray(saved.topics))topics.forEach((topic,index)=>{topic.open=saved.topics.includes(index);});

  const clamp=(value,min,max)=>Math.max(min,Math.min(value,max));
  function limits() {
    const viewport=window.visualViewport;
    const left=(viewport?.offsetLeft||0)+8,top=(viewport?.offsetTop||0)+8;
    const width=Math.max(1,(viewport?.width||document.documentElement.clientWidth)-16);
    const height=Math.max(1,(viewport?.height||innerHeight)-16);
    return {left,top,width,height,right:left+width,bottom:top+height,minWidth:Math.min(320,width),minHeight:Math.min(240,height)};
  }
  const view=limits();
  let bounds={left:view.right-480,top:view.top+60,width:480,height:Math.min(640,view.height*.75)};
  if(['left','top','width','height'].every(key=>Number.isFinite(saved.bounds?.[key])))bounds=saved.bounds;
  function place(next) {
    const view=limits();
    const width=clamp(next.width,view.minWidth,view.width),height=clamp(next.height,view.minHeight,view.height);
    bounds={left:clamp(next.left,view.left,view.right-width),top:clamp(next.top,view.top,view.bottom-height),width,height};
    for(const [key,value] of Object.entries(bounds))dialog.style[key]=value+'px';
  }
  function remember() {
    try {
      sessionStorage.setItem(storageKey,JSON.stringify({bounds,open:dialog.open,
        topics:topics.flatMap((topic,index)=>topic.open?[index]:[]),scrollTop:body.scrollTop}));
    } catch { /* The window still works when browser storage is unavailable. */ }
  }
  let opener,workspaceFocus,gesture;
  function openHelp(focus=true) {
    place(bounds);
    // A nonmodal dialog leaves the workspace interactive.
    dialog.open=true;
    if(focus)heading.focus({preventScroll:true});
    remember();
  }
  function closeHelp() {
    const restoreFocus=dialog.contains(document.activeElement);
    dialog.close();
    finishGesture();
    remember();
    if(restoreFocus)(workspaceFocus?.isConnected?workspaceFocus:opener)?.focus({preventScroll:true});
  }
  document.addEventListener('focusin',event=>{
    if(!dialog.contains(event.target))workspaceFocus=event.target;
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-help-open]');
    if(!button)return;
    opener=button;
    openHelp();
    const target=dialog.querySelector('[id="'+CSS.escape(button.dataset.helpTopic||'')+'"]');
    if(target){
      for(let parent=target;parent&&parent!==dialog;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
      const focus=target.tagName==='DETAILS'?target.querySelector('summary'):target;
      requestAnimationFrame(()=>{
        if(!dialog.open)return;
        focus.focus({preventScroll:true});
        body.scrollTop+=focus.getBoundingClientRect().top-body.getBoundingClientRect().top-16;
        remember();
      });
    }
  });
  dialog.addEventListener('click',event=>{
    if(event.target.closest('[data-help-close]'))closeHelp();
  });
  dialog.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    const resize=event.target.closest('[data-help-resize]');
    if(!resize&&(!heading.contains(event.target)||event.target.closest('button,a')))return;
    event.preventDefault();
    const handle=resize||heading;
    gesture={id:event.pointerId,handle,edge:resize?.dataset.helpResize||'',x:event.clientX,y:event.clientY,start:{...bounds}};
    handle.setPointerCapture(event.pointerId);
    heading.focus({preventScroll:true});
    dialog.classList.add('help-dragging');
  });
  dialog.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const {edge,start}=gesture,dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
    if(!edge){place({...start,left:start.left+dx,top:start.top+dy});return;}
    const view=limits();
    let left=start.left,top=start.top,right=left+start.width,bottom=top+start.height;
    if(edge.includes('w'))left=clamp(left+dx,view.left,right-view.minWidth);
    if(edge.includes('e'))right=clamp(right+dx,left+view.minWidth,view.right);
    if(edge.includes('n'))top=clamp(top+dy,view.top,bottom-view.minHeight);
    if(edge.includes('s'))bottom=clamp(bottom+dy,top+view.minHeight,view.bottom);
    place({left,top,width:right-left,height:bottom-top});
  });
  function finishGesture() {
    const ended=gesture;
    gesture=null;
    dialog.classList.remove('help-dragging');
    if(ended?.handle.hasPointerCapture(ended.id))ended.handle.releasePointerCapture(ended.id);
    if(ended)remember();
  }
  for(const type of ['pointerup','pointercancel','lostpointercapture'])dialog.addEventListener(type,finishGesture);
  dialog.addEventListener('keydown',event=>{
    // Keep workspace shortcuts from firing while reading or moving Help.
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();closeHelp();return;}
    const step={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
    if(event.target!==heading||!step||event.altKey||event.ctrlKey||event.metaKey)return;
    event.preventDefault();
    const [x,y]=step;
    place(event.shiftKey?{...bounds,width:bounds.width+x,height:bounds.height+y}:{...bounds,left:bounds.left+x,top:bounds.top+y});
    remember();
  });
  dialog.addEventListener('toggle',remember,true);

  // Setup dialogs make outside content inert. Keep Help in their interactive
  // subtree, then return it to the page when they close or replace themselves.
  function followModal() {
    const modal=dialog.open?[...document.querySelectorAll('dialog:modal')].at(-1):null;
    const parent=modal||document.body;
    if(dialog.parentElement!==parent)parent.append(dialog);
  }
  new MutationObserver(followModal).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
  function fitViewport() {
    finishGesture();
    place(bounds);
    if(dialog.open)remember();
  }
  window.addEventListener('resize',fitViewport);
  window.visualViewport?.addEventListener('resize',fitViewport);
  window.visualViewport?.addEventListener('scroll',fitViewport);
  window.addEventListener('pagehide',remember);
  place(bounds);
  if(saved.open){
    openHelp(false);
    if(Number.isFinite(saved.scrollTop))body.scrollTop=saved.scrollTop;
    remember();
  }
}
