import { spawnSync } from 'node:child_process';

export const TREE_STOP_GRACE_MS = 5000; // Milliseconds; cooperative shutdown window before a forced stop.

function waitForClose(child, ms) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve(true);
    let timer;
    const onClose = () => { clearTimeout(timer); resolve(true); };
    timer = setTimeout(() => { child.removeListener('close', onClose); resolve(false); }, ms);
    child.once('close', onClose);
  });
}

/**
 * Stops a spawned app and every process it owns. Chromium children outlive a
 * parent-only kill on Windows, so the whole task tree is terminated there; on
 * POSIX the child is spawned as a process-group leader and the group is signalled.
 */
export async function terminateProcessTree(child, { graceMs = TREE_STOP_GRACE_MS } = {}) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    if (result.error || result.status !== 0) child.kill();
    await waitForClose(child, graceMs);
    return;
  }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  if (await waitForClose(child, graceMs)) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  await waitForClose(child, graceMs);
}
