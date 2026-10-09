# Architecture and backend handoff

## Current implementation

Native ES modules and plain HTML/CSS follow the original browser/Node structure without a package installation step. `model.js` holds testable state operations, `views.js` markup, `app.js` events/demo jobs, and `viewer.js` rendering/input listeners. After design approval, split the app controller into service, capture, log, and history modules before adding substantial hardware logic.

Only the participant display currently communicates between devices:

| Endpoint | Contract |
| --- | --- |
| `POST /api/participant/state` | Same-origin JSON: `phase`, `sessionName`, `remaining`. Phases: idle, preparing, capturing, done, cancelled, interrupted. Returns connected display count. |
| `GET /api/participant/events` | SSE with latest state, `simulation: true`, and `updatedAt`. Sends current state immediately on connection. |
| `GET /api/demo-status` | Simulation mode and connected display count. |

The operator relays status every second. EventSource reconnects automatically; the display clears its active cue on connection loss. Active preparation/capture status becomes stale after five seconds without an operator update. Server state resets on restart. Browser storage preserves completed operator takes/results. Only one operator is supported.

## Data contracts to preserve

- **Readiness:** connection, sync, and configuration are separate flags. Selection/settings changes invalidate readiness. Empty selections and overlapping work are blocked.
- **Settings:** edit a separate draft. Apply updates selected cameras only; Discard changes nothing. Background display updates never replace active form inputs.
- **Calibration:** profiles record camera IDs. Reconstruction requires coverage of the captured camera set. Real validation must also compare lenses, intrinsics, resolution/crop, focus, device identity, and rig-layout version.
- **Capture:** preparing → sync → capturing → transferring → complete/warning. Selected devices and settings are locked during work. Cancel preserves previous completed takes.
- **Transfer:** saved on phone and transferred to workspace are distinct counters. Retry targets a take ID; it does not create a new capture or label a transfer failure as a dropped sensor frame.
- **Frames:** compare the same sequence index across cameras. Compute timing from `actualLeaderNs`, not arrival time. Raw span includes deliberate phase stagger; it is not a pass/fail sync score.
- **Reconstruction:** each run snapshots its take, model, geometry and calibration. A 4D run needs multiple frames. The three-camera minimum is a prototype UI guard, not a validated scientific threshold.
- **Review:** frame changes preserve viewpoint. Replace the sample renderer behind `mountViewer` when real output is available.

Events have `{id, time, level, message, stage, cameraId, code, resolved, detail?, impact?, takeId?}`. Show observed facts, impact, suggested checks, and raw details separately. A timeout alone does not prove a specific root cause. Real integration should add operation IDs, sequence numbers and durable server storage. Keep user wording separate from command output.

## Integration order

1. Identify the rig’s deployed revision and record actual API response samples. Reviewed commit `85ad82f` differs from the old `main`.
2. Define a `RigService` interface for status/events, previews, settings/readback, readiness/sync, capture/cancel, transfer/retry, calibration, datasets, reconstruction and results. Keep a demo service for UI regression reviews. Never put shell commands in browser handlers.
3. Connect **read-only status and previews** first. Map stable device IDs to cards, preserve the original MediaMTX/WebRTC lifecycle, and distinguish connecting/paused/disconnected streams.
4. Connect settings/readiness. Require acknowledgments from every selected phone and report partial acceptance. A visual preview is not sensor readback.
5. Connect capture and transfer under server-owned operation IDs and locks. Add timeouts, cancellation, and persisted transfer manifests. Restore previews in a `finally` path even if preparation or synchronization fails.
6. Connect the original CameraScope/Python/calibration/COLMAP/3DGS/4DGS services. Validate inputs before expensive jobs and emit structured progress/errors.
7. Load actual output into a splat renderer while retaining orbit, zoom, pan, keyboard, reset, and temporal playback controls.
8. Validate the physical wireless network: discovery, CameraScope support, bandwidth, sleep/reconnect, capture loss, retry and display lag. Replace USB/ADB-dependent operations only after verifying their wireless equivalents. Charging can stay wired.

Before deployment, add authentication, authenticated private-network transport, one active operator/operation lock, durable jobs/logs, and server restart recovery.

## Intentional limits

Camera views are generated SVGs; color preview uses CSS filters; calibration profiles contain no measured matrices. Capture timestamps are generated, reconstruction is a timer, and the viewer is a point mannequin rather than Gaussian output. History holds 30 takes and 500 events in per-browser storage with finite quota. Exports contain summaries, not media or importable project backups. Popup policy and physical monitor positioning still require initial display setup. These limits are explicitly visible in the interface.
