# Architecture and backend handoff

## Current implementation

Native ES modules and plain HTML/CSS follow the original browser/Node structure without a package installation step. `entry.js` uses `workflow.js` to load `rig-app.js` at `/`, `calibration-app.js` at `/calibration`, and `frame-review.js` at `/frames`. Capture, reconstruction and splat-review routes show unavailable states until their backends are connected. Old demo URLs resolve to these current routes; no active module imports the archived simulation. New rig configuration has no phones or computer destination address; saved configurations are preserved. `RigService` lives on the server. Connection setup accepts a validated phone inventory, LAN destination and camera defaults; command endpoints take only configured phone IDs. Executable paths remain local server configuration.

Prepare rig reads `RigConfigStore` and its owned `MediaGateway` directly, queries CameraScope over UDP, applies selected settings/stream controls with readback, and invokes the independently installed CLI for clock checks. No old webapp HTTP endpoints are used. See [setup and exact limits](PREPARE-RIG.md). Status responses contain phones, timestamps, independent preview/response/color/clock observations, errors, and the server event log. UI polling preserves active video elements and form inputs.

| Endpoint | Contract |
| --- | --- |
| `GET /api/rig/status` | Refresh/read device observations; concurrent reads share work, successful snapshots cached for four seconds. |
| `POST /api/rig/refresh` | Force fresh inventory/status read. |
| `GET /api/rig/config` | Read public local configuration, excluding executable paths. |
| `POST /api/rig/config` | Validate/persist phone inventory, PC destination and camera defaults; restart an owned gateway if routes changed, without sending phone commands. |
| `POST /api/rig/gateway-start` / `gateway-stop` | Manage only the redesign's gateway child process. |
| `POST /api/rig/settings` | `{ids, settings:{iso,exposureMs,frameRate,awbMode}}`; validated, selected phones only, per-phone results. |
| `POST /api/rig/sync` | `{ids}`; one successful CLI result required per selected host. |
| `POST /api/rig/preview-start` | `{ids}`; configure selected phones with trusted gateway route ports and `pcIp`, enable streaming and start a stopped pipeline. Verify state independently. |
| `POST /api/rig/preview-stop` | `{ids}`; disable streaming on selected phones without sending `capture:false`. Verify state independently. |

`live-preview.js` creates receive-only video peers and gathers ICE before posting SDP to `http://LAB-COMPUTER:8889/cam-N/whep`. It uses no external STUN servers or media permissions. The WHEP session Location is restricted to the gateway origin and route before cleanup DELETE. Failed connections and missing frames reconnect with a capped exponential delay; phone commands are never automatically retried. Decoded/displayed frame progress drives the Live label; gateway readiness and successful negotiation alone do not. Peers, timers and gateway sessions are released on route loss, retry, removed inventory and page exit. The operator's reachable hostname is used for the local gateway.

Rig writes require same-origin JSON plus `X-Rig-Request: 1`, reject oversized input, and serialize operations. Local configuration writes use a temporary file plus rename; invalid input leaves the previous configuration intact. The importer preserves old serials, CLI paths and capture options; the runtime never contacts the old server. Gateway startup checks occupied ports, generates the original H.264/RTP route conventions, and manages only its child process. API health and matching routes are required for gateway readiness. Phone state must also confirm the expected destination/ports before an incoming stream can be attributed to a camera. A local workflow provider is currently idle because capture is not integrated; future capture jobs must own it. H.264 recording blocks phone mutations. There is no distributed lock with other controllers. Timed-out commands are not automatically retried.

`settings-readback.js` shares field comparisons between the server and camera cards. Results contain `verification.status` (`confirmed`, `partial`, `mismatch`, `unavailable`) and each field's expected/reported value and check. `ok:true` with `partial` means the command was acknowledged and all core numeric values matched; missing optional flags remain unknown and `requestedStateConfirmed:false`. Only `confirmed` permits full requested-state confirmation. Missing ISO/exposure/frame interval or any reported mismatch returns `ok:false`. Both successful and mismatched attempts retain their requested target, so camera cards compare against the latest attempted settings instead of silently falling back to saved startup defaults. Future capture readiness must require the verification level it actually needs, not `ok` alone.

The participant display has no connected capture authority yet:

| Endpoint | Contract |
| --- | --- |
| `POST /api/participant/state` | Returns 501 `CAPTURE_NOT_CONNECTED`; browser-generated capture cues are rejected. |
| `GET /api/participant/events` | SSE sends `{available:false, phase:null, sessionName:null, remaining:null, updatedAt:null}`. Heartbeats indicate server connectivity only. |
| `GET /api/demo-status` | Returns 410; the preview interface has been removed. |

All participant stages remain inactive. `participant-state.js` also rejects old simulated data, invalid phases, missing timestamps and stale status. Future integration must publish authoritative job state from the server and continuously update timestamps; a connected browser or running camera pipeline is not evidence of an active take.

Color calibration uses real rig/device video or uploaded chart photos. Reference chart values are measurement targets, not generated input images. Local image-only presets marked as samples are excluded; leader presets already require a real rig source. Old simulated capture history and geometry profiles are never loaded by active modules.

## Existing review and future integration contracts

Saved Frame review is independently usable before capture integration. `FrameReview` reads the original `frame-manifest.json` format from the configured output folder and provides read-only `/api/review/sessions`, `/session`, `/frame`, and `/image` routes. Sequence IDs are preserved, image paths are manifest-bound and confined to the session, and old manifest revisions are rejected after changes. `frame-review-model.js` distinguishes capture drops, transfer failures, and ambiguous legacy records, and computes timestamp differences using integer nanoseconds. The browser aborts superseded loads and removes prior images while fetching a new frame. See [the file contract and limits](FRAME-REVIEW.md).

The following capture, geometry, reconstruction and splat-review rules describe future integration requirements, not implemented jobs.

- **Readiness:** connection, sync, and configuration are separate flags. Selection/settings changes invalidate readiness. Empty selections and overlapping work are blocked.
- **Settings:** edit a separate draft. Apply updates selected cameras only; Discard changes nothing. Background display updates never replace active form inputs.
- **Calibration:** profiles record camera IDs. Reconstruction requires coverage of the captured camera set. Real validation must also compare lenses, intrinsics, resolution/crop, focus, device identity, and rig-layout version.
- **Capture:** preparing → sync → capturing → transferring → complete/warning. Selected devices and settings are locked during work. Cancel preserves previous completed takes.
- **Transfer:** saved on phone and transferred to workspace are distinct counters. Retry targets a take ID; it does not create a new capture or label a transfer failure as a dropped sensor frame.
- **Frames:** compare the same sequence index across cameras. Compute timing from `actualLeaderNs`, not arrival time. Raw span includes deliberate phase stagger; it is not a pass/fail sync score.
- **Reconstruction:** each run must snapshot its take, model, geometry and calibration. Validate input requirements against the actual training implementation; archived prototype thresholds are not validated scientific limits.
- **Splat review:** load actual trained output and preserve the viewpoint across temporal changes. No generated mannequin or sample scene is displayed.

Events have `{id, time, level, message, stage, cameraId, code, resolved, detail?, impact?, takeId?}`. Show observed facts, impact, suggested checks, and raw details separately. A timeout alone does not prove a specific root cause. Real integration should add operation IDs, sequence numbers and durable server storage. Keep user wording separate from command output.

## Integration order

1. Identify the rig’s deployed revision and record actual API response samples. Reviewed commit `85ad82f` differs from the old `main`.
2. Define a `RigService` interface for status/events, previews, settings/readback, readiness/sync, capture/cancel, transfer/retry, calibration, datasets, reconstruction and results. Keep synthetic fixtures confined to automated tests. Never put shell commands in browser handlers.
3. Connect **read-only status and previews** first. Map stable device IDs to cards, preserve the original MediaMTX/WebRTC lifecycle, and distinguish connecting/paused/disconnected streams.
4. Connect settings/readiness. Require acknowledgments from every selected phone and report partial acceptance. A visual preview is not sensor readback.
5. Connect capture and transfer under server-owned operation IDs and locks. Add timeouts, cancellation, and persisted transfer manifests. Restore previews in a `finally` path even if preparation or synchronization fails.
6. Connect the original CameraScope/Python/calibration/COLMAP/3DGS/4DGS services. Validate inputs before expensive jobs and emit structured progress/errors.
7. Load actual output into a splat renderer while retaining orbit, zoom, pan, keyboard, reset, and temporal playback controls.
8. Validate the physical wireless network: discovery, CameraScope support, bandwidth, sleep/reconnect, capture loss, retry and display lag. Replace USB/ADB-dependent operations only after verifying their wireless equivalents. Charging can stay wired.

Before deployment, add authentication, authenticated private-network transport, one active operator/operation lock, durable jobs/logs, and server restart recovery.

## Retired prototype

`archive/prototype/` keeps the former workflow source and geometry notes outside the web root. Its generated cameras, geometry profiles, capture timestamps, reconstruction timers and point mannequin cannot appear in the running app. Old browser storage can remain in place for historical reference, but the current routes do not read it. Automated tests use explicit fixture inventories rather than production defaults.
