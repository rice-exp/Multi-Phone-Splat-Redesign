# Retired interface prototype

These modules and geometry design notes preserve the earlier simulated workflow as historical implementation reference. They are outside `public/`, are not served by `dev-server.mjs`, and are not imported by any active website module. There is no demo route.

Generated cameras, staged warnings, capture timers, synthetic geometry and the procedural point viewer must not be used as observed rig data. The current interface uses the rig API, actual image sources and saved capture manifests; unavailable integrations stay unavailable.

The `test/prototype-*.test.js` files retain checks of the archived state models. Fixtures used by automated tests are separate from production configuration.
