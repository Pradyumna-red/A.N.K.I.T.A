import assert from 'node:assert/strict';
import test from 'node:test';
import { computerOverlayWindow } from '../../scripts/lib/computer-menu-evidence.mjs';

test('native menu evidence belongs to the launched driver rather than another connected overlay', () => {
  const other = { pid: 11, class_name: 'Cua.AgentCursorOverlay', z: 0, topmost: true };
  const candidate = { pid: 22, class_name: 'Cua.AgentCursorOverlay', z: 7, topmost: false };
  assert.equal(computerOverlayWindow([other, candidate], candidate.pid), candidate);
  assert.equal(computerOverlayWindow([other], candidate.pid), undefined);
});
