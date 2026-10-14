// Real device state and demo state have separate entry points and storage.
await import(new URLSearchParams(location.search).get('demo') === '1' ? './app.js' : './rig-app.js');
