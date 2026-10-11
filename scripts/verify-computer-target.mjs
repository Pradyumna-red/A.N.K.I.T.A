import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { McpManager } from '../src/integrations/mcp-manager.mjs';
import { DesktopComputerUse } from '../desktop/electron/computer-use.mjs';
import { Agent } from '../src/core/agent.mjs';
import { COMPUTER_MCP_ID, COMPUTER_DIRECT_CONFIG, COMPUTER_CURSOR_TOOLS, computerObservationMetadata } from '../src/integrations/computer-use.mjs';

const TARGET_TIMEOUT_MS = 20_000; // Milliseconds; bounded fixture startup / independent state readback.
const TEST_NOTE = 'ANKITA native desktop round trip'; // Test-only value, entered only in the disposable fixture.
const require = createRequire(import.meta.url);
const env = { ...process.env, ANKITA_COMPUTER_TEST_TITLE: `ANKITA verification ${randomUUID()}` };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [fileURLToPath(new URL('./fixtures/computer-use-target.cjs', import.meta.url))], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
let lines = '', diagnostic = ''; const pending = [];
child.stderr.on('data', data => { diagnostic = (diagnostic + String(data)).slice(-2000); });
child.stdout.on('data', data => {
  lines += String(data);
  while (lines.includes('\n')) {
    const end = lines.indexOf('\n'), line = lines.slice(0, end); lines = lines.slice(end + 1);
    try { const value = JSON.parse(line); const waiter = pending.find(entry => entry.matches(value)); if (waiter) { clearTimeout(waiter.timer); pending.splice(pending.indexOf(waiter), 1); waiter.resolve(value); } } catch {}
  }
});
function waitFor(matches, phase) { return new Promise((resolve, reject) => {
  const entry = { matches, resolve, timer: setTimeout(() => reject(new Error(`Fixture ${phase} timed out: ${diagnostic}`)), TARGET_TIMEOUT_MS) }; pending.push(entry);
}); }
const ready = waitFor(value => value.ready, 'startup');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-computer-target-'));
const manager = new McpManager();
const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json') });
const timings = {};
async function call(name, args = {}) {
  const start = performance.now(); const result = await manager.callToolResult(`mcp__${COMPUTER_MCP_ID}__${name}`, args);
  timings[name] = Math.round(performance.now() - start);
  if (result.isError) throw new Error(result.text);
  if (name === 'get_window_state') {
    const metadata = computerObservationMetadata(result);
    assert.ok(result.raw.structuredContent.elements.some(element => element.element_token && metadata.includes(element.element_token)), 'fresh provider control tokens must reach model-readable metadata');
  }
  console.log(JSON.stringify({ completed: name, duration_ms: timings[name] }));
  return result.raw.structuredContent || JSON.parse(result.text);
}
try {
  const app = await ready;
  await service.connect();
  const windows = await call('list_windows');
  const entries = Array.isArray(windows) ? windows : windows.windows;
  assert.ok(Array.isArray(entries), 'driver window collection must be present');
  const matches = entries.filter(window => window.pid === app.pid || window.title === app.title);
  assert.equal(matches.length, 1, 'only the controlled fixture may be targeted');
  const target = { pid: app.pid, window_id: matches[0].window_id ?? matches[0].id };
  assert.ok(Number.isInteger(target.window_id));
  let snapshot = await call('get_window_state', { ...target, include_screenshot: false });
  const fields = snapshot.elements.filter(element => element.label === 'Verification note' && element.role === 'Edit');
  assert.equal(fields.length, 1);
  const field = fields[0];
  assert.ok(field, 'field must come from a current accessibility snapshot');
  await call('set_value', { ...target, element_token: field.element_token, value: TEST_NOTE });
  snapshot = await call('get_window_state', { ...target, include_screenshot: false });
  const buttons = snapshot.elements.filter(element => element.label === 'Confirm action' && element.role === 'Button');
  assert.equal(buttons.length, 1); const button = buttons[0];
  assert.ok(button);
  let approvals = 0;
  const agent = Object.create(Agent.prototype);
  Object.assign(agent, { mcp: manager, config: { [COMPUTER_DIRECT_CONFIG]: true }, client: {}, messages: [], confirm: () => { approvals++; return false; } });
  const started = performance.now();
  const clicked = await agent.runMcpToolCall({ id: 'fixture-click', function: { name: `mcp__${COMPUTER_MCP_ID}__click`,
    arguments: JSON.stringify({ ...target, element_token: button.element_token, session: 'model-picked-fixture-session' }) } });
  timings.click = Math.round(performance.now() - started);
  assert.doesNotMatch(clicked, /^Error|denied permission/i);
  assert.equal(approvals, 0);
  const cursor = await manager.servers.get(COMPUTER_MCP_ID).client.callTool(COMPUTER_CURSOR_TOOLS.state, { session: service.pointerSession });
  assert.equal(cursor.isError, false);
  assert.equal(cursor.raw.structuredContent.enabled, true);
  assert.ok(cursor.raw.structuredContent.visual_state.frame > 0, 'real native action advances the built-in cursor animation');
  await call('get_window_state', { ...target, include_screenshot: false });
  const readback = waitFor(value => value.appOwnedState, 'readback'); child.stdin.write('read\n');
  const { appOwnedState } = await readback;
  assert.equal(appOwnedState.note, TEST_NOTE); assert.equal(appOwnedState.status, 'Action confirmed');
  await service.stop();
  console.log(JSON.stringify({ ok: true, modelIdentifiersDelivered: true, pointerEnabled: true, cursorAnimationFrame: cursor.raw.structuredContent.visual_state.frame, approvals,
    independentReadback: appOwnedState, stopped: !manager.has(COMPUTER_MCP_ID), timings }, null, 2));
} finally {
  for (const entry of pending) clearTimeout(entry.timer);
  await manager.closeAll(); child.kill(); fs.rmSync(directory, { recursive: true, force: true });
}
