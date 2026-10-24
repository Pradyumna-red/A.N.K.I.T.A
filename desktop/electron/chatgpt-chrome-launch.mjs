import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { CHATGPT_ORIGIN, CHATGPT_WINDOW_BOUNDS } from '../../services/chatgpt-bridge/config.mjs';

const PROBE_MS = 5000; // Milliseconds/OS process-name probe; a failed probe cannot authorize a duplicate launch.
const MAX_PROBE_BYTES = 1024 * 1024; // Bytes/process names; arguments, cookies and profile contents are never inspected.
const WIN_PARTS = ['Google', 'Chrome', 'Application', 'chrome.exe']; // Standard Chrome installation candidates under discovered OS roots, verified before launch.
const MAC_BUNDLE = ['Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome']; // Standard macOS bundle path components; not assumed installed.
const LINUX_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']; // Selected Chromium family only; resolve from PATH and verify executable files.
const command = promisify(execFile);
export async function chromeRunning(platform = process.platform) {
  try {
    const result = platform === 'win32'
      ? await command('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: PROBE_MS, maxBuffer: MAX_PROBE_BYTES })
      : await command('ps', ['-A', '-o', 'comm='], { timeout: PROBE_MS, maxBuffer: MAX_PROBE_BYTES });
    if (platform === 'win32') return /^"chrome\.exe"/im.test(result.stdout);
    return result.stdout.split('\n').some(value => /^(?:google-chrome(?:-stable)?|chromium(?:-browser)?|Google Chrome)$/i.test(path.posix.basename(value.trim())));
  } catch { return null; }
}
function candidates(platform, env) {
  if (platform === 'win32') return [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean).map(root => path.win32.join(root, ...WIN_PARTS));
  if (platform === 'darwin') return [path.posix.join('/Applications', ...MAC_BUNDLE), path.posix.join(os.homedir(), 'Applications', ...MAC_BUNDLE)];
  if (platform === 'linux') return (env.PATH ?? '').split(path.posix.delimiter).filter(Boolean).flatMap(root => LINUX_NAMES.map(name => path.posix.join(root, name)));
  return [];
}
async function launch(file, args) {
  const child = spawn(file, args, { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
}
/** Focused adaptation of CoS browser-startup.ts/browser.ts: process absence owns OS launch. */
export async function openChromeIfAbsent(url, { platform = process.platform, env = process.env, running = chromeRunning, signal,
  usable = file => { try { if (!fs.statSync(file).isFile()) return false; if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } }, launch: start = launch } = {}) {
  if (new URL(url).origin !== CHATGPT_ORIGIN) throw new Error('Chrome must open the owned ChatGPT page');
  signal?.throwIfAborted();
  const present = await running(platform);
  signal?.throwIfAborted();
  if (present === true) return false;
  if (present !== false) throw new Error('Could not check whether Chrome is running. Open Chrome, then connect again.');
  const file = candidates(platform, env).find(usable);
  if (!file) throw new Error('Chrome was not found. Use In ANKITA, or install Chrome with the ANKITA companion.');
  await start(file, ['--new-window', `--window-size=${CHATGPT_WINDOW_BOUNDS.width},${CHATGPT_WINDOW_BOUNDS.height}`, url]);
  return true;
}
