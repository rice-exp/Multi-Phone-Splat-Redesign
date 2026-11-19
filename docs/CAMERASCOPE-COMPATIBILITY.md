# CameraScope app compatibility

Prepare rig supports the older CloneCameraScope command format and the
`kp-camerascope-test` branch of `rice-exp-lab/CameraScope`. Phones with either
version can share an inventory. No version selector or Android rebuild is needed
for this webapp update.

## What changed

- Both versions use JSON commands and replies over UDP port 5010. Status requests
  now retry twice, using the same socket and the original three-second deadline.
  Writes, captures and automatic color measurement are never repeated by the
  transport. Asynchronous events and replies for another command are ignored.
- The newer app advertises `streamCodec` in `getState`. When starting its preview,
  the webapp sends `streamCodec: "avc"` and `streamEncoder: ""` in the same `set`
  command as the destination. This chooses H.264 and automatic encoder selection.
  The existing MediaMTX gateway accepts H.264 RTP payload type 96; the branch also
  offers other codecs/packet formats which this gateway does not accept.
- Older phones receive only the original stream fields. Stream resolution,
  bitrate, exposure, white balance, lens and analysis settings are preserved.
- A stream write gets up to six seconds for an acknowledgement, then up to four
  bounded state checks for startup. A lost acknowledgement does not cause a
  second start command. Success requires independent readback of the stream,
  camera pipeline, destination and ports. Newer apps must also report active AVC.
  This confirms app state; the card's **Live** label separately verifies that the
  browser is displaying advancing frames.
- Prepare rig can retain advancing video after a missed status reply for at most
  20 seconds from the last verified route. It requires new gateway bytes and the
  same phone ID, IP, route, ports and computer destination. **Not responding** and
  **Video arriving · status retrying** distinguish control trouble from video.
  Settings, color operations and clock checks still require current replies.
- Unsupported codecs and encoder failures appear on the camera card, in **Details**
  and in the activity log, with recovery steps.

The new app also has a TCP command server on port 5011, bound to phone loopback
for ADB forwarding. It is **not a wireless TCP fallback**. This integration keeps
using the wireless UDP server supported by both builds.

## Run a mixed-version lab check

1. Update the redesign checkout to the branch/commit containing this change.
   Stop the running redesign server with Ctrl+C, then run `npm start` in that folder.
   Open `http://localhost:4317/` and refresh the page.
2. Keep the old webapp and other CameraScope controllers stopped. Connect the lab
   computer and phones to the same private network. On each phone, open CameraScope
   and enable its UDP command server on 5010.
3. In **Connection setup**, verify the computer's LAN IP and every phone IP.
   Make sure the local preview gateway is running.
4. Begin with one older phone and one phone running `kp-camerascope-test`.
   Select them and click **Start selected previews**. Wait for both **Live** labels
   and check that the images match the physical phones.
5. Open **Details** on the newer phone: its requested and active codecs should
   both be `avc`. A codec mismatch should tell you to start the selected preview;
   an encoder failure should include the error returned by CameraScope.
6. Add remaining phones one at a time. Observe at least a minute after each addition.
   Record which phone/app version fails, its error code, and whether video still
   arrives. A green pipeline status alone is not proof of browser video.
7. Close CameraScope on one phone, then reopen it. The phone must lose its current
   control status; a stopped video must lose **Live**. Other phones should keep
   running. Refresh status and start the affected preview again if necessary.
8. Stop one selected stream. Confirm its video stops while the other phones keep
   streaming. Repeat with the other app version.
9. Test **Copy leader settings to followers** with both versions selected. Confirm
   the existing per-phone readback results and inspect actual image color.

## Source and verification

Compared the locally available CloneCameraScope snapshot (`1c17f73`) with
[`CameraScope/kp-camerascope-test`, commit `05bfcaa`](https://github.com/rice-exp-lab/CameraScope/tree/05bfcaa).
Relevant source contracts: `UdpCommandServer.kt`, `TcpCommandServer.kt`,
`CameraScopeViewModel.kt` (`applyCommandSettings`, `applyStreamConfig`, `stateJson`,
`startStreaming`) and `UdpStreamer.kt`.

Run `npm test`. Regression checks cover old/new stream fields, mixed inventories,
delayed encoder startup, dropped acknowledgements, rejected commands, active-codec
verification, route identity/expiry, and six concurrent simulated UDP phones with
packet loss. These tests do not establish a physical phone count or Wi-Fi capacity.
The lab checklist above is still required to verify the installed APKs and network.
