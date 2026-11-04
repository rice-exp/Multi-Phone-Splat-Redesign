# Calibration workspace preview

Open `http://127.0.0.1:4317/?demo=1#calibration`. The real Prepare rig navigation also links to this explicitly labeled preview. It uses the existing demo's selected cameras, not live device inventory. It needs no original lab backend.

This implementation follows the [Notion Calibration section](https://app.notion.com/p/Calibration-3e41981a601d8045bf99e4f30f3d3b1e), including ChArUco sessions, six solver stages, and separate AprilTag pose sessions. Board defaults are examples from the reference UI; they must be checked against the physical board. AprilTag family and size fields are proposed UI inputs whose backend contract still needs verification.

## Try the screens

1. ChArUco capture: set a session name, board geometry, dictionary, pose count, and interval. Start a sample batch. Pause it, add another pose, or finish early and transfer the accumulated sample observations. A session records its original board and camera identities. Adding poses requires the same camera selection and clears that session's solver progress.
2. Solve calibration: choose a transferred session. Run all six sample stages or step through one at a time. Only the final stage creates a sample intrinsic profile. Use it for the demo capture workflow or open AprilTag poses.
3. AprilTag poses: select a solved profile and confirm the selected cameras/facing match it. Run a sample update. Each result references the original profile; it does not overwrite it.
4. Color calibration: choose a leader from the live rig previews, then Capture leader & apply to all. One chart frame produces a shared correction for every Calibration preview. Save named run presets with the reference frame, restore them later and fine-tune before applying manual adjustments to all views. Device-camera/upload/sample tests and manual chart alignment remain available. See [Color calibration](COLOR-CALIBRATION.md) for the image-processing and backend boundary.

## State and integration boundary

`public/js/calibration-model.js` owns validation, session transitions, and timed simulation. `public/js/calibration-ui.js` renders the three screens. `app.js` handles interaction and saves this workspace within the existing demo browser storage. Reloading interrupts an active job and preserves completed observations and stages. Existing sample profiles remain immutable when more observations are added.

The three geometry screens contain no real images, numerical geometry results, generated solver files, or hardware calls. Stage duration is illustrative and does not estimate hardware performance. In the real workflow, finishing restores previews; ChArUco keeps previews paused between poses and synchronizes clocks at arming, with phase alignment per pose. Actual image inspection, quality metrics, persistent server jobs, byte-for-byte intrinsic copying, and solver errors need backend integration.

The documented output contract is `analysis/calibration-k1-filtered/` containing `intrinsics.json`, `extrinsics-camera-frame.json`, and `calibration-summary.json`. Names in the UI describe that future contract; no synthetic numerical matrices are exported.

The demo geometry checks and 100-pose limit are interface constraints, not scientific calibration acceptance thresholds. A profile becomes usable in the demo after all six sample stages, but is never labeled as validated calibration.
