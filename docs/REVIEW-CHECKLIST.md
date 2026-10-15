# UI review route

Run `npm test` and `npm start`. Review the simulation at `/?demo=1` in a desktop browser and at phone width; use real touch hardware to check pinch gestures. The checklist below describes that simulation; the default page connects to real configured devices.

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
- Default `/` reads the local inventory and never invents phone responses or video. The original prototype is at `/?demo=1`.
- Automated checks cover persistent configuration/import, invalid edits, port conflicts, owned gateway lifecycle, UDP replies, partial failures, readback, route identity, stale status, sync reports, selections and request guards.
- Standalone browser QA used two mock UDP phones and the bundled real MediaMTX runtime with no old HTTP backend. Verify Connection setup saves defaults and names, and Start/Stop gateway controls affect only the owned process.
- Confirm configuration persists after restart, invalid edits preserve the last file, and route changes do not mislabel old incoming video.
- Earlier player QA decoded synthetic H.264 video. Physical phone settings, MediaMTX playback, clock accuracy and wireless capture timing still need lab validation.
