import fs from 'node:fs';
import { registerSkillRoot } from '../../src/skills/roots.mjs';

const BARRIER_TIMEOUT_MS = 15_000; // Test-only safety bound for a controlled cross-process interleaving.
const BARRIER_POLL_MS = 5; // Test-only pause between checks of the parent's release file.
const [registry, root, release, mode] = process.argv.slice(2);
const read = fs.readFileSync;
const sleeper = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
let held = false;
// Retain the actual filesystem snapshot while the other real process completes its installation.
fs.readFileSync = function (file, ...args) {
  const bytes = read.call(fs, file, ...args);
  if (mode === 'hold' && file === registry && !held) {
    held = true;
    process.send('snapshot');
    const deadline = Date.now() + BARRIER_TIMEOUT_MS;
    while (!fs.existsSync(release)) {
      if (Date.now() >= deadline) throw new Error('Test registration barrier timed out');
      Atomics.wait(sleeper, 0, 0, BARRIER_POLL_MS);
    }
  }
  return bytes;
};
try { registerSkillRoot(root, registry); }
finally { fs.readFileSync = read; process.disconnect(); }
