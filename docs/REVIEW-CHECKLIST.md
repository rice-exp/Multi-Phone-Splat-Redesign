# Website review checklist

Run `npm test` and `npm start`. Check desktop and phone-width layouts. Use a separate test configuration for automated fixtures; never substitute generated devices or images for lab observations.

- [ ] Fresh setup shows zero configured phones, no destination IP and no camera warnings or activity invented by the UI.
- [ ] Existing saved phone inventory, identities, installation paths and settings survive restart.
- [ ] Connection setup accepts actual phone addresses. Only responding phones count as responding, and only advancing video frames display Live.
- [ ] Settings review and clock checks act only on selected phones. Missing, stale or partial readback remains visibly unknown or incomplete.
- [ ] Activity log contains server observations/command outcomes and useful recovery details, with no staged Camera 07 warning.
- [ ] Old `?demo=1` and workflow hash bookmarks open current pages. Old browser-stored demo history does not appear.
- [ ] Calibration starts without an image or invented camera name. Real rig/device sources and uploaded photos remain available; no sample-photo controls or synthetic presets appear.
- [ ] Color correction is explicitly limited to Calibration previews and exported images; it is not represented as a phone setting or captured-file transformation.
- [ ] Empty Frame review shows no saved captures. With actual manifests, every camera uses the same sequence index, and capture drops stay distinct from transfer failures.
- [ ] Capture, reconstruction and splat review show unavailable states without timers, generated results or success messages.
- [ ] Participant stages stay inactive while capture status is unavailable. Connection loss and stale/invalid state cannot illuminate a stage.
- [ ] Every action is reachable at mobile width without horizontal page overflow.

Follow [Prepare rig lab acceptance checks](PREPARE-RIG.md#lab-acceptance-checks) and [Frame review lab checks](FRAME-REVIEW.md). Automated HTTP/UDP and image fixtures validate behavior; physical phone timing, network behavior and color accuracy still require the lab rig.
