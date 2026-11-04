# Rice Experiential Pixels Lab — Multi-Phone-Splat Redesign

A guided interface for a multi-phone 4D capture rig. **Prepare rig now runs independently of the old webapp.** It owns persistent CameraScope configuration and the bundled MediaMTX gateway, checks each phone over UDP, starts/stops selected wireless streams, displays live H.264 video, applies selected settings, and checks clock offsets using the independent CameraScope CLI. The Android app is unchanged.

The website displays configured devices, observed device status, real camera or uploaded images, and saved capture manifests. **Frame review reads saved CameraScope captures at `/frames`.** Color calibration processes actual image pixels at `/calibration`. Geometry acquisition/solving, capture, transfers, reconstruction, a trained-splat viewer, and participant capture status are not integrated yet; their screens report that limitation without generated results. The preview interface has been retired.

For lab setup, supported commands, and the required hardware checks, read [Prepare rig setup](docs/PREPARE-RIG.md).

## Run it on your computer

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/). Restart your terminal after installation.
2. In GitHub Desktop, choose **File → Clone repository → URL**, paste this repository’s URL, and choose a folder.
3. Select the `feature/frame-review` branch for saved-frame review and the latest merged CameraScope/calibration work.
4. Choose **Repository → Open in Terminal** in GitHub Desktop.
5. Run:

   ```sh
   npm start
   ```

6. Open **http://127.0.0.1:4317**. A fresh installation has **no phones or destination address configured**. In **Connection setup**, add your actual phone IPs and computer destination IP, then save and start the gateway. An existing configured rig starts its gateway automatically; the old webapp/server should be stopped. Keep CameraScope open on the phones, select cameras here, and click **Start selected previews**. Leave this terminal running. Press **Ctrl+C** to stop the server and its gateway.

The local configuration is saved in `.camerascope/rig-config.json` and excluded from Git. To preserve an old lab installation, run `npm run import-config -- "PATH-TO-OLD/.camerascope/webapp-config.json"` before first startup. If a local configuration already exists, back it up and add `--replace`. The migration copies the old file once and never contacts the old server. See [standalone setup](docs/PREPARE-RIG.md) for clock CLI paths, other platforms and port-conflict recovery.

Each camera card distinguishes phone response, gateway availability, and browser playback. **Live** appears only after displayed frames advance; stalled video loses the green label and reconnects automatically. **Retry** reconnects the browser without sending a phone command. **Enlarge** expands the view. **Stop selected streams** disables wireless video without stopping the phone’s camera pipeline. Stream changes can restart that pipeline; finish takes/recordings first. Preview controls use UDP only and need no USB/ADB or Python.

There are no packages to install; `npm install` is unnecessary. `node dev-server.mjs` is equivalent to `npm start`. Do not open `index.html` directly: JavaScript modules and APIs need the server. Reload the browser after editing a file; the app has no build step or automatic reload.

Use **Dark mode** in the upper right to change the interface theme. The app starts with your system preference, then remembers your choice across pages and tabs in this browser. Camera images and calibration pixels are unaffected. The Rice crest is bundled locally; the link below the lab title opens `https://pixels.rice.edu/` in a new tab.

## Review saved captures

Open **http://localhost:4317/frames**, or select **Frame review** from Prepare rig. Choose a transferred capture session, scrub a common sequence index across cameras, enlarge images, inspect timing, and identify capture drops separately from transfer failures or missing local files. Playback, display filters, image rotation, and JSON review exports are available. These actions do not modify capture files or command phones.

Review reads `outputRoot/frames/SESSION/frame-manifest.json`. To open captures from the old installation without copying them, set `RIG_CAPTURE_ROOT` to its **output folder containing `frames`** before starting the redesign. See the [Frame review setup and lab checks](docs/FRAME-REVIEW.md) for exact commands and supported formats. The original app does not need to run. No sample images appear in the real review when a capture folder is empty.

## Available screens

| Screen | Address | Current behavior |
| --- | --- | --- |
| Prepare rig | `/` | Configured phones, UDP status, settings readback, clock checks and live previews |
| Calibration | `/calibration` | Color correction measured from a camera frame or uploaded chart photo |
| Capture | `/capture` | Unavailable until capture and transfer jobs are integrated |
| Frame review | `/frames` | Read-only review of saved CameraScope captures |
| Reconstruction | `/reconstruction` | Unavailable until training jobs are integrated |
| Splat review | `/splats` | Unavailable until actual splat loading is integrated |
| Participant | `/participant.html` | Inactive; capture status is not connected yet |

Old `?demo=1` and workflow hash bookmarks open the corresponding current screen. They cannot restore sample cameras, warnings, takes, timers or splats from browser storage. Synthetic color profiles are also excluded. The former interface is kept only as source reference under `archive/prototype/`, outside the web server's public directory.

## Participant display

**Preparing → In progress → Done** remain visible together, with all stages inactive until real capture status is available. There is no simulated countdown or completion cue. Server connectivity alone does not mean a capture is running.

On the same computer, open `http://localhost:4317/participant.html`. For a separate display on the same private network, start `npm start -- --host=0.0.0.0`, then open `http://COMPUTER-LAN-IP:4317/participant.html`, substituting the computer's actual IPv4 address. Display placement is a one-time setup; browsers cannot silently move a window to another monitor.

Use one operator at a time. This local server has no authentication or TLS; keep it on a trusted private network. Prepare rig sends real commands. Its operation lock does not control other applications, and the old gateway must be stopped because its ports overlap. To use the original capture application, stop this server and gateway first; point Frame review at the resulting saved captures when returning to the redesign.

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

The Calibration tab also includes [leader color calibration](docs/COLOR-CALIBRATION.md): choose a leader from live camera previews, capture one chart frame, detect the chart automatically, and share the resulting correction across all Calibration previews. Named run presets save the reference frame and adjustments for later reuse and manual refinement. Device-camera input, uploads and manual alignment remain available. No sample image generator is exposed. It does not apply color settings to phones or process full-resolution capture files.

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
| `public/js/entry.js`, `workflow.js` | Current routes, shared navigation and migration of old bookmarks |
| `public/js/calibration-app.js`, `color-workbench.js` | Color calibration from actual images and live sources |
| `public/js/pending-workflow.js` | Honest unavailable states for features awaiting backend integration |
| `lib/frame-review.mjs` | Read-only CameraScope manifests, session inventory, safe image delivery and disk checks |
| `public/js/frame-review.js` | Saved-capture selection, timeline, comparison, issue details and review exports |
| `public/js/frame-review-model.js` | Capture/transfer distinctions and precise timestamp differences |
| `public/styles.css` | Shared design, responsive layout, participant display |
| `archive/prototype/` | Retired simulation source; not served or imported by the website |
| `public/js/participant.js` | Three-stage screen and reconnect/stale handling |
| `public/js/capture-metrics.js` | Timing/count calculations ported from the original project |
| `dev-server.mjs` | Static server, rig/review APIs and unavailable participant-status feed |
| `test/` | Rig, color, frame review, route and participant-state tests; archived prototype tests remain separate |

Run **`npm test`** before opening a pull request. GitHub Actions runs the same checks. No camera or GPU is required.

## Relationship to the original project

This redesign follows [rice-exp-lab/Multi-Phone-Splat](https://github.com/rice-exp-lab/Multi-Phone-Splat). The reviewed local source was commit `85ad82f41d2dcfd2187cd974993c6737b99aaf49` on `codex/calibration-splat-cleanup`, ahead of that repository’s saved `main`. The revision deployed on the physical rig remains unconfirmed.

Pure calculations from `lib/camerascope-capture.js` were ported: saved/dropped counts, intervals accounting for missing sequence indices, and cross-camera timing from `actualLeaderNs`. Wireless preview integration was checked against original `main` at `8060792` and the UDP state/settings/stream contract in [CloneCameraScope](https://github.com/rice-exp/CloneCameraScope) at `1c17f73`. Browser playback follows [MediaMTX’s WebRTC/WHEP interface](https://mediamtx.org/docs/read/web-browsers). Verify the deployed revision and run the [lab acceptance checks](docs/PREPARE-RIG.md#lab-acceptance-checks) before relying on this integration for a session.
