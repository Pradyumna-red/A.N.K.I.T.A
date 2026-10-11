import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManager } from '../../src/integrations/mcp-manager.mjs';
import { DesktopComputerUse } from '../../desktop/electron/computer-use.mjs';
import { COMPUTER_MCP_ID } from '../../src/integrations/computer-use.mjs';

const WAITING_FIXTURE_ARGS = ['-e', 'process.stdin.resume(); setInterval(() => {}, 1000)']; // Test-only child that stays in initialization until cancelled.

test('startup cancellation waits for child teardown before forgetting the client', async () => {
  const manager = new McpManager(); const controller = new AbortController();
  const pending = manager.connect({ id: 'cancel-fixture', command: process.execPath,
    args: WAITING_FIXTURE_ARGS, signal: controller.signal });
  const rejection = assert.rejects(pending, /closed|abort|cancel/i);
  const [client] = manager._clients;
  // Control teardown completion deterministically, without assuming scheduler timings.
  let entered, release; const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const terminate = client.terminateProcess;
  client.terminateProcess = async child => { entered(); await gate; return terminate(child); };
  while (!client.child) await new Promise(resolve => setImmediate(resolve));
  controller.abort(); await began;
  await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(manager._clients.has(client), true, 'a closing child stays owned until teardown completes'); }
  finally { release(); await rejection; await client.close(); }
  assert.equal(client.child, null); assert.equal(manager._clients.size, 0);
  await manager.closeAll();
});

test('Computer Use Stop waits until its initializing child is actually gone', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-stop-fixture-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: WAITING_FIXTURE_ARGS, version: 'fixture' }) });
  const pending = service.connect(), rejection = assert.rejects(pending, /closed|abort|cancel/i);
  while (!manager._clients.size) await new Promise(resolve => setImmediate(resolve));
  const [client] = manager._clients;
  let entered, release; const began = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; }), terminate = client.terminateProcess;
  client.terminateProcess = async child => { entered(); await gate; return terminate(child); };
  while (!client.child) await new Promise(resolve => setImmediate(resolve));
  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await began; await new Promise(resolve => setImmediate(resolve));
  try { assert.equal(stopped, false, 'Stop may not report completion while its child is terminating'); }
  finally {
    release(); await stopping; await rejection; await service.close(); await manager.closeAll();
    assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(client.child, null); assert.equal(manager._clients.size, 0); assert.equal(service.connecting, null);
});

test('Computer Use Stop ends its MCP driver while the launched app stays open', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-preserve-app-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))], version: 'fixture' }) });
  let appPid;
  t.after(async () => { await service.close(); await manager.closeAll(); if (appPid) { try { process.kill(appPid); } catch {} } fs.rmSync(directory, { recursive: true, force: true }); });
  await service.connect();
  const launched = await manager.callToolResult(`mcp__${COMPUTER_MCP_ID}__launch_app`, {});
  appPid = launched.raw.structuredContent.pid;
  const driver = manager.servers.get(COMPUTER_MCP_ID).client;
  await service.stop();
  assert.equal(driver.child, null);
  assert.equal(manager.has(COMPUTER_MCP_ID), false);
  assert.doesNotThrow(() => process.kill(appPid, 0), 'the user app must survive driver teardown');
});
