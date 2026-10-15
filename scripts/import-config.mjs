import {readFile} from 'node:fs/promises';
import {RigConfigStore,migrateConfig} from '../lib/rig-config.mjs';
const source=process.argv[2];
if(!source) { console.error('Usage: npm run import-config -- /path/to/old/.camerascope/webapp-config.json');process.exitCode=1; }
else {
  try {
    const store=new RigConfigStore();
    // Refuse to replace an existing local configuration without an explicit flag.
    try { await readFile(store.file);if(!process.argv.includes('--replace'))throw new Error('Configuration already exists. Back it up and use --replace to overwrite it.'); }
    catch(error) { if(error.code!=='ENOENT')throw error; }
    await store.write(migrateConfig(JSON.parse(await readFile(source,'utf8'))));
    console.log(`Imported CameraScope configuration to ${store.file}. The source file was not changed. Restart the redesign if it is running.`);
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
