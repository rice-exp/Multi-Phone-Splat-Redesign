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
