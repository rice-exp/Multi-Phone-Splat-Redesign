# Frame review: saved CameraScope captures

Frame review reads actual transferred images and the original application's `frame-manifest.json`. It runs in the standalone redesign: no original webapp, phones, Python, or live preview streams are required to inspect saved captures. Capture and transfer themselves are still separate integration work.

## Start on the lab computer

Use the `feature/frame-review` implementation, based on `Camerascope-features` at `2ffe22f`, which includes standalone CameraScope controls and the merged calibration workspace.

1. Find the **capture output folder** on the lab computer. It contains a `frames` directory. Do not select an individual session or the `frames` directory itself.
2. Open PowerShell in the redesign repository. Point it at that output folder and start the server:

   ```powershell
   $env:RIG_CAPTURE_ROOT = "C:\path\to\captures\multi-phone-splat"
   npm start
   ```

   Replace the example with the lab's actual path. On macOS/Linux:

   ```sh
   RIG_CAPTURE_ROOT="/path/to/captures/multi-phone-splat" npm start
   ```

3. Open **http://localhost:4317/frames**, or click **Frame review** in the real Prepare rig sidebar.
4. Choose a session. Use the slider, position input, previous/next buttons, or left/right arrow keys to compare cameras at the same sequence index.
5. Use **Next recorded issue** to jump to a manifest entry with a capture drop, failed transfer, or missing/unknown camera record. Use **Only unavailable images** to filter the current frame, including files missing on disk.
6. Open an image for enlargement/zoom, or **Details** for source timestamps, offsets, and recovery instructions. Display rotation and zoom never edit the files.
7. After a transfer retry or external file correction, use **Reload session**. **Refresh sessions** rescans the folder for new captures.

Without `RIG_CAPTURE_ROOT`, review uses `outputRoot` in `.camerascope/rig-config.json`, resolved relative to the redesign repository. The default is `captures/multi-phone-splat`. An imported relative path now resolves under the redesign, not under the old repository; set an absolute path to review the old captures in place. The selected root is visible under **Capture folder and setup**.

For review-only use, optional `$env:RIG_GATEWAY_AUTOSTART = "0"` before startup prevents launching MediaMTX. The review page makes no rig/phone API requests. Do not run overlapping preview gateways from both apps.

Expected directory structure:

```text
CAPTURE_OUTPUT/
  frames/
    SESSION_ID/
      frame-manifest.json
      frame-000000-leader-TIMESTAMP/
        cam-1-000000.jpg
        cam-2-000000.jpg
      frame-000001-leader-TIMESTAMP/
        ...
```

The folders and filenames come from the manifest. JPEG, PNG, and WebP images can be displayed. Other formats are identified as unsupported without pretending that they were dropped. Sessions containing a manifest are listed even when images are missing or the JSON is malformed, so failures remain inspectable. This includes calibration sessions if they are stored in the same `frames` directory; identify the intended take by session name.

## What the indicators mean

| Indicator | Meaning |
| --- | --- |
| Recorded transfers | Manifest entries with a filename and no reported capture/transfer failure. Files are checked on disk when each frame opens. |
| Capture drops | Explicit `captureDropped:true`; retrying transfer cannot recover an unsaved frame. |
| Transfer failures | Explicit `transferFailed:true`, separate from capture drops. Retry transfer in the application that owns that capture. |
| Unknown / no record | Ambiguous legacy `dropped` entries or cameras absent from an individual frame's records. |
| File missing on computer | The manifest claims a transferred file, but it is absent or empty now. |
| Image load failed | A file was found, but the browser could not load/decode it. Check the file and server, then reload. |
| Timing spread | Latest minus earliest valid `actualLeaderNs` at this sequence index; unavailable with fewer than two timestamps. |
| Group offset | Camera timestamp minus `groupedLeaderNs`; unavailable when either timestamp is missing/unusable. |

Timestamp strings are subtracted using integer nanoseconds before conversion to milliseconds. Unsafe numeric timestamps are not presented as precise measurements. Timing may include planned phase staggering; no pass/fail synchronization threshold is invented. Images can be reviewed without timing metadata.

**Position** is one-based within the loaded manifest. **Sequence index** is the original zero-based identifier and can have gaps. Missing expected indices are noted when the manifest provides `metrics.frameCount`. Camera visibility filters affect only the display, not session counts or timing calculations.

Playback is an inspection aid at 1, 2, or 5 frames/second. It waits for displayed images and may run more slowly. It stops at the end, on load errors, when a dialog opens, or when the browser tab is hidden. It is not a real-time capture recording. **Export review summary** downloads the manifest-derived totals, timeline, current frame, and visible camera IDs as JSON; it does not approve a take, copy images, or trigger reconstruction.

## API and safeguards

| Endpoint | Result |
| --- | --- |
| `GET /api/review/sessions` | Configured root and available manifest-bearing session directories. |
| `GET /api/review/session?session=ID` | Cameras, sequence timeline, recorded issue counts, timing, manifest revision. |
| `GET /api/review/frame?session=ID&index=N&revision=REV` | Current disk availability, authorized image URLs, per-camera recovery details. |
| `GET /api/review/image?session=ID&index=N&camera=ID&revision=REV` | A manifest-listed supported image only. |

All operations are read-only. Paths are confined to the configured session; traversal, symbolic links inside sessions, arbitrary images, and cross-origin browser access are rejected. Session metadata is cached by file modification/change time and size, with at most four entries. A changed manifest rejects an old revision rather than silently serving a different frame. Limits: 64 MB manifest, 50,000 positions, 64 cameras, one million camera records. File availability is checked again for image requests.

The existing development server has no login system. Keep it on the trusted lab network. Browser requests cannot change the capture root; it is a local server setting.

## Validation and lab acceptance

Automated tests cover the original manifest shape (including singleton PowerShell JSON), sequence gaps, partial transfers, missing files, timestamp precision, malformed manifests, revision changes, path boundaries, and HTTP/image delivery. Browser checks use generated, explicitly labelled QA images, not physical rig captures.

Before a research session, open a real transferred take, compare at least two source images against the displayed sequence/camera IDs, inspect an existing failed transfer if available, and confirm the reported timestamps against the manifest. Test a copy of a session when deliberately removing or corrupting files. No physical-phone capture or reconstruction validation is claimed here.
