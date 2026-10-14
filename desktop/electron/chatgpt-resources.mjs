import fs from 'node:fs';
import path from 'node:path';
import { NATIVE_TUNNEL_RESOURCE_DIRECTORY } from '../../src/integrations/chatgpt-browser/native-tunnel.mjs';

const COMPANION_DIRECTORY = 'chatgpt-companion'; // Chrome needs ordinary files outside an Electron ASAR.
const DESKTOP_DIRECTORY = 'desktop'; // Development resources live beside the renderer/electron folders.
const REQUIRED_COMPANION_FILES = Object.freeze(['manifest.json', 'wire.mjs', 'background.mjs', 'commands.mjs', 'content.mjs', 'popup.html', 'popup.mjs',
  'upstream/readers.js', 'upstream/request-origins.js', 'upstream/delivery.js']); // Complete executable extension entry graph.
export function chatgptResourcePaths({ packageRoot, resourcesPath, isPackaged = false } = {}) {
  if (!path.isAbsolute(packageRoot ?? '') || (isPackaged && !path.isAbsolute(resourcesPath ?? ''))) throw new Error('Discover absolute ChatGPT resource paths from the desktop runtime');
  const root = isPackaged ? resourcesPath : path.join(packageRoot, DESKTOP_DIRECTORY);
  return { resourceRoot: packageRoot, companionPath: path.join(root, COMPANION_DIRECTORY), nativeResourceRoot: path.join(root, NATIVE_TUNNEL_RESOURCE_DIRECTORY) };
}
export function verifyCompanionResources(directory) {
  if (REQUIRED_COMPANION_FILES.some(file => !fs.existsSync(path.join(directory, file)))) throw new Error('The bundled ChatGPT companion is missing required resources');
  return true;
}
