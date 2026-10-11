import assert from 'node:assert/strict';
import test from 'node:test';
import { runDriverBuild } from '../../scripts/lib/computer-driver-build.mjs';

test('driver source validation retains the leading Git porcelain status column', async () => {
  const status = ' M managed.rs\n?? policy.rs\n'; // Test-only Git wire fixture: column one is intentionally blank.
  const result = await runDriverBuild(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(status)})`], process.cwd(), { capture: true });
  const files = result.output.split('\n').map(line => line.slice(3));
  assert.deepEqual(files, ['managed.rs', 'policy.rs']);
});
