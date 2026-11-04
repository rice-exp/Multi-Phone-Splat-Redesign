# Bundled MediaMTX runtime

The Windows executable is MediaMTX **v1.18.2**, copied without modification from
`rice-exp-lab/Multi-Phone-Splat` at commit
`8060792c88aacde00488910d80b69367d695b3f1`, `tools/mediamtx/mediamtx.exe`.
Its MIT license is preserved in `LICENSE`.

SHA-256: `d1465085c3c9bd211fd40fb863acfd8eef988ea6ea9e36422472659f82ed4aa9`.

The redesign creates `.camerascope/mediamtx.generated.yml` from its saved phone
inventory and starts/stops its own child process. It does not use the original
app's configuration file or gateway process. Never run two gateways on the same
ports. The control API listens on loopback port 9997; browser WebRTC uses port
8889 and ICE on TCP/UDP 8189. Camera RTP video ports start at UDP 5004, incrementing
by two; metadata destination ports start at 6004, incrementing by two.

On Linux/macOS, install the matching MediaMTX release for your platform from the
[official project](https://github.com/bluenviron/mediamtx/releases/tag/v1.18.2)
and set `MEDIAMTX_EXECUTABLE` to its local executable path before starting the
redesign. Executable paths are server configuration, never browser input.
