import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DesktopComputerUse } from '../desktop/electron/computer-use.mjs';
import { McpManager } from '../src/integrations/mcp-manager.mjs';
import { Agent } from '../src/core/agent.mjs';
import { COMPUTER_MCP_ID } from '../src/integrations/computer-use.mjs';

// Temporary policy file: verification never enables desktop control in the user's real config.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-computer-live-'));
const manager = new McpManager();
const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json') });
const timings = {};
async function timed(name, fn) { const at = performance.now(); const value = await fn(); timings[name] = Math.round(performance.now() - at); return value; }
try {
  const overview = await timed('connect_ms', () => service.connect());
  const record = manager.servers.get(COMPUTER_MCP_ID);
  assert.ok(record.tools.some(tool => tool.name === 'get_window_state'));
  assert.equal(record.tools.some(tool => tool.name.startsWith('browser_') || tool.name === 'install_ffmpeg'), false);
  await timed('health_ms', () => service.check());
  const observation = await timed('desktop_read_ms', () => manager.callToolResult(`mcp__${COMPUTER_MCP_ID}__get_accessibility_tree`));
  assert.equal(observation.isError, false);
  const screenshot = await timed('desktop_capture_ms', () => manager.callToolResult(`mcp__${COMPUTER_MCP_ID}__get_desktop_state`));
  assert.equal(screenshot.isError, false);
  assert.ok(screenshot.raw.content.some(part => part.type === 'image'));
  const agent = Object.create(Agent.prototype);
  Object.assign(agent, { config: {}, client: {}, model: '', mcp: manager, messages: [{ role: 'user', content: 'Read the current desktop' }], mcpImagesThisTurn: 0 });
  const call = { id: 'live-capture', function: { name: `mcp__${COMPUTER_MCP_ID}__get_desktop_state`, arguments: '{}' } };
  await timed('agent_capture_ms', () => agent.runMcpToolCall(call));
  assert.ok(agent.messages[0].content.some(part => part.type === 'image_url'));
  const driverPid = record.client.child?.pid;
  await timed('stop_ms', () => service.stop());
  assert.equal(manager.has(COMPUTER_MCP_ID), false);
  assert.equal(record.client.closed, true);
  console.log(JSON.stringify({ ok: true, driverVersion: overview.version, nativeTools: record.tools.length, imageDelivered: true, driverPid, stopped: true, timings }, null, 2));
} finally {
  await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true });
}
