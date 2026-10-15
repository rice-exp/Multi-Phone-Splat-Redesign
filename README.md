# Rice Experiential Pixels Lab — Multi-Phone-Splat Redesign

A guided interface for a multi-phone 4D capture rig. **Prepare rig now runs independently of the old webapp.** It owns persistent CameraScope configuration and the bundled MediaMTX gateway, checks each phone over UDP, starts/stops selected wireless streams, displays live H.264 video, applies selected settings, and checks clock offsets using the independent CameraScope CLI. The Android app is unchanged.

The default page contains real connection controls. **Calibration, capture, transfers, reconstruction, and live participant capture status are not integrated yet.** The complete previous UI prototype is preserved separately at `/?demo=1`; its devices and results remain simulated.

For lab setup, supported commands, and the required hardware checks, read [Prepare rig setup](docs/PREPARE-RIG.md).

![Standalone connection setup with mock phones and the real local gateway](docs/screenshots/standalone-setup-qa.jpg)

## Run it on your computer

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/). Restart your terminal after installation.
2. In GitHub Desktop, choose **File → Clone repository → URL**, paste this repository’s URL, and choose a folder.
3. Select the `Camerascope-features` branch for the wireless live-view integration.
4. Choose **Repository → Open in Terminal** in GitHub Desktop.
5. Run:

   ```sh
   npm start
   ```

6. Open **http://127.0.0.1:4317**. In **Connection setup**, verify phone IPs and the computer destination IP. The bundled Windows MediaMTX gateway starts automatically; the old webapp/server should be stopped. Keep CameraScope open on the phones, select cameras here, and click **Start selected previews**. Leave this terminal running. Press **Ctrl+C** to stop the server and its gateway.

The local configuration is saved in `.camerascope/rig-config.json` and excluded from Git. To preserve an old lab installation, run `npm run import-config -- "PATH-TO-OLD/.camerascope/webapp-config.json"` before first startup. If a local configuration already exists, back it up and add `--replace`. The migration copies the old file once and never contacts the old server. See [standalone setup](docs/PREPARE-RIG.md) for clock CLI paths, other platforms and port-conflict recovery.

Each camera card distinguishes phone response, gateway availability, and browser playback. **Live** appears only after displayed frames advance; stalled video loses the green label and reconnects automatically. **Retry** reconnects the browser without sending a phone command. **Enlarge** expands the view. **Stop selected streams** disables wireless video without stopping the phone’s camera pipeline. Stream changes can restart that pipeline; finish takes/recordings first. Preview controls use UDP only and need no USB/ADB or Python.

There are no packages to install; `npm install` is unnecessary. `node dev-server.mjs` is equivalent to `npm start`. Do not open `index.html` directly: JavaScript modules and the participant relay need the server. Reload the browser after editing a file; this prototype has no build step or automatic reload.

## Try the complete workflow

Open **http://127.0.0.1:4317/?demo=1** for this **simulation-only** workflow. Demo actions do not call the rig endpoints.

1. **Prepare rig:** all eight sample cameras start selected. Camera 07 has an amber sync warning. Open its help popup or run **Check readiness**. Try selecting none, then all again.
2. **Camera settings:** adjust exposure, ISO, white balance, and contrast. Compare current and draft views. **Discard** leaves saved values intact; **Apply** updates selected demo cameras and requires another readiness check. The preview approximates the look, not a phone sensor’s actual output.
3. **Calibration:** use the sample rig profile, create a sample profile, or choose COLMAP for geometry later. Board acquisition and solving are not connected.
4. **Capture:** enter a session name, frame count, and requested frame rate; check readiness after edits. Start capture. Preview cards explicitly pause during acquisition. Enable the failure example to try recovering a missing transfer without recapturing.
5. **Frame review:** scrub the common sequence index across cameras. Missing transfers stay distinct from dropped frames. Original capture-report calculations run against generated sample timestamps.
6. **Reconstruction:** choose 3DGS or 4DGS and compatible geometry. An eight-second simulated run creates a saved demo result.
7. **Splat review:** drag to orbit, scroll/pinch to zoom, Shift-drag to pan. Click the canvas and use WASD to move or arrows to orbit. Playback/scrubbing preserves the viewpoint. This is a procedural point scene, not a trained Gaussian splat.

**Activity log** provides severity/camera filters, search, explanations, raw details, resolved states, and JSON export. Scrolling up pauses following new events. **Take history** reopens completed takes; reconstruction results retain their inputs. Settings, up to 30 takes, results, and the last 500 events persist in this browser. They are not shared or backed up to GitHub. **Export session summary** saves a JSON copy, not a media archive.

## Participant display in the UI demo

The display keeps **Preparing → In progress → Done** visible together, with only the current stage illuminated. It shows the countdown, reconnects automatically, and warns if active operator status becomes stale.

- On the same computer, click **Open display**. A named popup is reused. Automatic opening at capture start is enabled by default when no display is connected; allow popups for the local app if blocked.
- For a separate tablet/display, put both devices on the same private Wi-Fi network, then start:

  ```sh
  npm start -- --host=0.0.0.0
  ```

- Find the computer’s local IPv4 address in network settings. Open `http://COMPUTER-LAN-IP:4317/participant.html` on the display once. Substitute the actual address (often starting `192.168.`); `127.0.0.1` and `0.0.0.0` are not addresses to use from another device. A host firewall may require allowing Node on the private network.
- Keep the display page open; it follows later takes automatically. Browsers cannot silently position a window on another physical monitor. Display placement/kiosk setup is a one-time deployment step.

Use one operator browser at a time. The development server has no authentication or TLS; keep it on a trusted private network, not the internet. Prepare rig sends real wireless commands, with an operation lock inside this server. Keep the old gateway stopped because its ports overlap; commands from other controllers cannot be locked here. Image transfer remains future integration work. Charging cables are independent.

## How three teammates can work independently

After this feature is reviewed and merged, each teammate clones the repo on their own computer:

1. In GitHub Desktop, switch to **main**, then **Fetch origin / Pull origin**.
2. Choose **Branch → New branch**. Use names such as `ui/camera-cards`, `ui/error-help`, or `ui/viewer-controls`.
3. Open the folder in your editor, run `npm start`, and edit your assigned files. Reload the browser to see changes.
4. Run `npm test`, then click through the affected screens on desktop and at phone width.
5. Review **Changes** in GitHub Desktop, commit with a short description, and **Publish branch / Push origin**.
6. Open a pull request into `main`, describing the visible change and what you tested. Include a screenshot. Have a teammate review before merging.
7. Update each person’s `main` before the next task. Avoid sharing one branch or editing the same file simultaneously.

Suggested ownership: one person handles setup/calibration, one handles capture/errors/participant display, and one handles frame/reconstruction/viewer design. Coordinate edits to shared state and CSS. See [architecture and integration](docs/ARCHITECTURE.md) and the [review checklist](docs/REVIEW-CHECKLIST.md).

## Code map

| File | Purpose |
| --- | --- |
| `lib/rig-service.mjs` | Standalone CameraScope UDP checks, selected settings/streams and CLI clock checks |
| `lib/rig-config.mjs` | Validated, persistent local phone inventory and CameraScope configuration |
| `lib/gateway.mjs` | Owned MediaMTX process, generated RTP routes, readiness and port-conflict checks |
| `scripts/import-config.mjs` | One-time migration of the old saved configuration |
| `tools/mediamtx/` | Existing Windows MediaMTX runtime, license and provenance |
| `public/js/rig-app.js` | Real Prepare rig interface, status polling, previews, settings review and error dialogs |
| `public/js/live-preview.js` | Receive-only WHEP player, decoded-frame status, reconnect and session cleanup |
| `public/js/rig-model.js` | Status expiry, selection and white balance comparison |
| `public/js/entry.js` | Separates the default real interface from the explicit UI demo |
| `public/js/views.js` | Guided pages, camera cards, settings and error dialogs |
| `public/styles.css` | Shared design, responsive layout, participant display |
| `public/js/model.js` | State, selection, readiness guards, take snapshots and recovery |
| `public/js/app.js` | UI events, demo jobs, log/history, persistence, display relay |
| `public/js/preview.js` | Generated camera illustrations and settings approximation |
| `public/js/viewer.js` | Sample point scene and keyboard/mouse/touch navigation |
| `public/js/participant.js` | Three-stage screen and reconnect/stale handling |
| `public/js/capture-metrics.js` | Timing/count calculations ported from the original project |
| `dev-server.mjs` | Static server, rig API and simulation-only participant relay |
| `test/` | State, timing, and relay tests using Node’s built-in test runner |

Run **`npm test`** before opening a pull request. GitHub Actions runs the same checks. No camera or GPU is required.

## Relationship to the original project

This redesign follows [rice-exp-lab/Multi-Phone-Splat](https://github.com/rice-exp-lab/Multi-Phone-Splat). The reviewed local source was commit `85ad82f41d2dcfd2187cd974993c6737b99aaf49` on `codex/calibration-splat-cleanup`, ahead of that repository’s saved `main`. The revision deployed on the physical rig remains unconfirmed.

Pure calculations from `lib/camerascope-capture.js` were ported: saved/dropped counts, intervals accounting for missing sequence indices, and cross-camera timing from `actualLeaderNs`. Wireless preview integration was checked against original `main` at `8060792` and the UDP state/settings/stream contract in [CloneCameraScope](https://github.com/rice-exp/CloneCameraScope) at `1c17f73`. Browser playback follows [MediaMTX’s WebRTC/WHEP interface](https://mediamtx.org/docs/read/web-browsers). Verify the deployed revision and run the [lab acceptance checks](docs/PREPARE-RIG.md#lab-acceptance-checks) before relying on this integration for a session.
