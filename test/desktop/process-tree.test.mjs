import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { terminateProcessTree } from '../../desktop/scripts/process-tree.mjs';

const CHILD_SCRIPT = 'setInterval(() => {}, 1000)'; // Real long-lived descendant, no Electron or user profile.
const PARENT_SCRIPT = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', ${JSON.stringify(CHILD_SCRIPT)}], { stdio: 'ignore', windowsHide: true });
process.stdout.write('CHILD:' + child.pid + '\\n');
setInterval(() => {}, 1000);
`;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pid) {
  for (let attempt = 0; attempt < 60; attempt++) { if (!alive(pid)) return true; await delay(100); }
  return false;
}

test('stopping a dev host also stops the processes it spawned', async t => {
  const parent = spawn(process.execPath, ['-e', PARENT_SCRIPT], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
    detached: process.platform !== 'win32' }); // Mirrors dev-server's owned process group on POSIX.
  t.after(() => terminateProcessTree(parent));
  const [report] = await once(parent.stdout, 'data');
  const childPid = Number(String(report).match(/CHILD:(\d+)/)?.[1]);
  assert.ok(childPid > 0, 'fixture reported its descendant');
  assert.equal(alive(parent.pid), true);
  assert.equal(alive(childPid), true);

  await terminateProcessTree(parent);
  assert.notEqual(parent.exitCode ?? parent.signalCode, null, 'the dev host is gone before close resolves');
  assert.equal(await gone(childPid), true, 'the descendant must not survive and keep the bridge port');
  await terminateProcessTree(parent); // Repeated shutdown, including Electron's exit path, stays harmless.
});
