# Calibration workspace

Open `/calibration` for color calibration from a real rig preview, this device’s camera, or an uploaded chart photo. See [Color calibration](COLOR-CALIBRATION.md) for chart selection, leader correction, source validation and saved presets.

Geometry acquisition, ChArUco solving and AprilTag pose updates are not connected to a backend yet. The old synthetic sessions, matrices and solver progress have been removed from the running website. Historical source and design notes remain under `archive/prototype/`; they are not served by the app.

Old `/?demo=1#calibration` bookmarks open the current color workspace and ignore simulated geometry data in browser storage.
