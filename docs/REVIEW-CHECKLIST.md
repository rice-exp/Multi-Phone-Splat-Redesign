# UI review route

Run `npm test` and `npm start`. Review in a desktop browser and at phone width; use real touch hardware to check pinch gestures. All data are simulated.

- [ ] Eight cameras start selected. Deselect all blocks Continue/capture; Select all restores the set.
- [ ] Camera 07 starts amber. Help explains the issue, impact, next action and raw details. A readiness check resolves selected issues.
- [ ] Discard a settings edit: saved values stay intact. Apply affects selected cameras only and requires a fresh check.
- [ ] While typing, background participant updates preserve form drafts.
- [ ] Calibration/COLMAP selection follows into capture and reconstruction.
- [ ] Participant page shows preparing, recording/countdown, and done in order, with all stages always visible.
- [ ] Stop capture: display says stopped, not complete. Refresh during work: it becomes interrupted. Earlier takes survive both.
- [ ] Enable the transfer-failure example. Retry preserves take identity and resolves only that take’s issue.
- [ ] Scrub frames: every camera uses the same index. Missing transfers are distinct from dropped frames.
- [ ] Reconstruction continues across page changes. Cancellation preserves earlier results.
- [ ] Test drag, zoom, WASD, arrows, Shift-drag, reset, playback and timeline. Scrubbing preserves viewpoint.
- [ ] Saved takes/results retain their own input snapshots.
- [ ] Search/filter the log. Scroll up as events arrive: position stays fixed and a new-event button appears. Inspect exported JSON.
- [ ] Stop/restart the server: participant clears stale cues, then reconnects.
- [ ] At mobile width, every action is reachable without horizontal page overflow.

Physical wireless capture, phone timing, image quality, calibration accuracy and trained splat quality require separate validation after backend integration.


## Live Prepare rig integration

- Follow [Prepare rig setup and lab acceptance checks](PREPARE-RIG.md).
- Default `/` has no generated cameras. The original prototype is at `/?demo=1`.
- Automated checks cover UDP timeout/malformed replies, partial settings failure, readback mismatch, stale status, invalid sync reports, selections, and request guards.
- Browser checks used a local fixture with one responding and one unavailable phone at desktop (1280 px) and phone (390 px) widths. Settings review, per-phone results, failure dialog, form persistence, preview embedding, and no horizontal overflow were checked.
- The reviewed CloneCameraScope Python CLI successfully collected 30 clock samples from a loopback test endpoint through the new server API. This is a software integration check, not a physical clock-accuracy measurement.
- Real phone settings, MediaMTX playback and wireless capture timing still need validation on the lab rig.
