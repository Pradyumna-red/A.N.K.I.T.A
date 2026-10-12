import fs from 'node:fs';
import { companionManifest, browserWire } from '../services/chatgpt-bridge/config.mjs';

const directory = new URL('../desktop/chatgpt-companion/', import.meta.url);
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(new URL('manifest.json', directory), JSON.stringify(companionManifest, null, 2) + '\n');
fs.writeFileSync(new URL('wire.mjs', directory), '// Generated from services/chatgpt-bridge/config.mjs; regenerate with scripts/build-chatgpt-companion.mjs.\nexport const wire = Object.freeze(' + JSON.stringify(browserWire, null, 2) + ');\n');
console.log('Generated companion manifest and shared browser wire config.');
