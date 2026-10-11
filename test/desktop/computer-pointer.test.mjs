import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopComputerUse } from '../../desktop/electron/computer-use.mjs';
import { McpStore } from '../../src/integrations/mcp-store.mjs';
import { Agent } from '../../src/core/agent.mjs';
import { McpManager } from '../../src/integrations/mcp-manager.mjs';
import { fileURLToPath } from 'node:url';

// Emulates only the external driver boundary; controller, disk preference and lifecycle remain real.
function pointerService(t, { failedToggle = false, failedEnd = false, delayedState = false, holdHidden = false, endGate } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-pointer-'));
  let connected = false, enabled = false, active = false;
  let pendingVisibility;
  const observedSessions = [];
  let session = 'fixture-implicit-session';
  const advertised = ['start_session', 'end_session', 'set_agent_cursor_enabled', 'get_agent_cursor_state'];
  const client = { tools: advertised.map(name => ({ name })), callTool: async (name, args = {}) => {
    if (name === 'start_session') { session = args.session || session; active = true; return { raw: { structuredContent: { session, active: true } } }; }
    if (name === 'get_agent_cursor_state') {
      observedSessions.push(args.session);
      // An older permissive boundary can treat null as its default session; it is never proof for our owned cursor.
      if (args.session === null) return { raw: { structuredContent: { session: 'default', enabled: false, active: true } } };
    }
    assert.equal(args.session, session, 'cursor controls stay with the transport-owned session');
    if (name === 'set_agent_cursor_enabled') {
      if (failedToggle) return { isError: true, text: 'cursor unavailable' };
      if (holdHidden && !args.enabled) { /* Emulate overlay visibility still waiting on its UI thread. */ }
      else if (delayedState && enabled !== args.enabled) pendingVisibility = args.enabled;
      else enabled = args.enabled;
      return { raw: { structuredContent: { session, enabled: args.enabled, active } } };
    }
    if (name === 'end_session') {
      if (failedEnd) return { isError: true, text: 'cursor cleanup failed' };
      await endGate;
      active = false; enabled = false;
    }
    const result = { raw: { structuredContent: { session, enabled, active } } };
    if (name === 'get_agent_cursor_state' && pendingVisibility !== undefined) { enabled = pendingVisibility; pendingVisibility = undefined; }
    return result;
  } };
  const mcp = { servers: new Map(), has: () => connected,
    connect: async () => { connected = true; mcp.servers.set('ankita-computer', { client, tools: [] }); },
    disconnect: async () => { connected = false; mcp.servers.clear(); },
    callToolResult: async (name, args, options) => client.callTool(name.split('__').at(-1), args, options) };
  const service = new DesktopComputerUse({ mcp, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: '/fixture/driver', args: ['mcp'], version: 'fixture' }) });
  t.after(async () => { await service.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { service, driverState: () => ({ enabled, active }), observedSessions };
}

test('Connect enables the driver arrow by default; Stop ends its owned cursor session', async t => {
  const { service, driverState } = pointerService(t);
  const connected = await service.connect();
  assert.equal(connected.pointerEnabled, true);
  assert.equal(connected.pointerSupported, true);
  assert.deepEqual(driverState(), { enabled: true, active: true });
  await service.stop();
  assert.deepEqual(driverState(), { enabled: false, active: false });
});

test('each desktop connection reserves its own cursor session instead of sharing the driver default', async t => {
  const first = pointerService(t), second = pointerService(t);
  await first.service.connect(); await second.service.connect();
  assert.notEqual(first.service.pointerSession, second.service.pointerSession);
});

test('pointer settings wait for observed visibility instead of only the driver acknowledgment', async t => {
  const { service, driverState } = pointerService(t, { delayedState: true });
  await service.connect();
  assert.equal(driverState().enabled, true);
  await service.setPointer({ enabled: false });
  assert.equal(driverState().enabled, false);
});

test('Stop cancels pending visibility confirmation without polling another session', async t => {
  let release;
  const endGate = new Promise(resolve => { release = resolve; });
  const { service, observedSessions } = pointerService(t, { holdHidden: true, endGate });
  await service.connect();
  const toggle = service.setPointer({ enabled: false }).then(() => 'confirmed', () => 'cancelled');
  while (observedSessions.length < 2) await new Promise(resolve => setImmediate(resolve));
  const stopping = service.stop();
  try {
    assert.equal(await toggle, 'cancelled');
    assert.ok(observedSessions.every(session => typeof session === 'string' && session));
  } finally { release(); await stopping; }
});

test('Stop can cancel Connect immediately before driver discovery finishes', async t => {
  const { service } = pointerService(t);
  const connecting = service.connect().then(() => 'connected', () => 'cancelled');
  await service.stop();
  assert.equal(await connecting, 'cancelled');
  assert.equal((await service.overview()).connected, false);
});

test('hiding the arrow keeps input connected and survives Stop, reconnect and a new controller', async t => {
  const { service, driverState } = pointerService(t);
  await service.connect(); await service.setPointer({ enabled: false });
  assert.equal((await service.overview()).connected, true);
  assert.deepEqual(driverState(), { enabled: false, active: true });
  await service.stop(); await service.connect();
  assert.equal((await service.overview()).pointerEnabled, false);
  assert.deepEqual(driverState(), { enabled: false, active: true });
  const next = new DesktopComputerUse({ mcpFile: service.mcpFile, mcp: { has: () => false }, platform: 'linux' });
  assert.equal((await next.overview()).pointerEnabled, false);
  await service.setPointer({ enabled: true });
  assert.equal(new McpStore(service.mcpFile).load().find('ankita-computer').computerPointerEnabled, true);
  assert.equal(driverState().enabled, true);
});

test('a cursor setup failure tears down the connection instead of claiming the arrow is enabled', async t => {
  const { service, driverState } = pointerService(t, { failedToggle: true });
  await assert.rejects(service.connect(), /cursor unavailable/);
  assert.equal((await service.overview()).connected, false);
  assert.equal(driverState().active, false);
});

test('pointer payloads require a boolean and a connected cursor session', async t => {
  const { service } = pointerService(t);
  await assert.rejects(service.setPointer({ enabled: true }), /Connect Computer Use/);
  await service.connect();
  await assert.rejects(service.setPointer({ enabled: 'false' }), /boolean/);
  assert.equal((await service.overview()).pointerEnabled, true);
});

test('native task calls stay in the pointer session even when the model invents another label', async () => {
  const calls = [];
  const record = { computerPointerSession: 'transport-owned' };
  const mcp = { findTool: () => ({ record, tool: { inputSchema: { properties: { session: { type: 'string' } } } } }),
    needsApproval: () => false, callToolResult: async (name, args) => { calls.push({ name, args }); return { text: 'Done' }; } };
  const agent = Object.create(Agent.prototype);
  Object.assign(agent, { config: { desktopComputerUseDirect: true }, mcp, client: {}, messages: [] });
  await agent.runMcpToolCall({ id: 'native', function: { name: 'mcp__ankita-computer__click', arguments: '{"session":"model-picked","element_token":"fresh:0"}' } });
  assert.equal(calls[0].args.session, 'transport-owned');
  assert.equal(calls[0].args.element_token, 'fresh:0');
  await agent.runMcpToolCall({ id: 'other', function: { name: 'mcp__another-service__click', arguments: '{"session":"model-picked"}' } });
  assert.equal(calls[1].args.session, 'model-picked');
});

test('pointer binding does not add an unsupported session argument to strict driver schemas', async () => {
  let dispatched;
  const mcp = { findTool: () => ({ record: { computerPointerSession: 'transport-owned' }, tool: { inputSchema: { properties: {} } } }),
    needsApproval: () => false, callToolResult: async (_, args) => { dispatched = args; return { text: 'Done' }; } };
  const agent = Object.create(Agent.prototype);
  Object.assign(agent, { config: { desktopComputerUseDirect: true }, mcp, client: {}, messages: [] });
  await agent.runMcpToolCall({ id: 'native', function: { name: 'mcp__ankita-computer__check_permissions', arguments: '{}' } });
  assert.deepEqual(dispatched, {});
});

test('cursor cleanup failure cannot skip desktop shutdown of jobs, channels and other connections', async t => {
  const { DesktopEngine } = await import('../../desktop/electron/engine.mjs');
  const { service } = pointerService(t, { failedEnd: true });
  await service.connect();
  const completed = [];
  const engine = { computerUse: service, scheduler: { stop: async () => completed.push('scheduler') },
    mcp: { closeAll: async () => completed.push('other connections') }, browserManager: { close: async () => {} },
    channels: { stopAll: async () => completed.push('channels') }, credentialRequests: { cancelAll: () => {} },
    agents: new Map(), approvals: { cancelAll: () => {} }, projectFileWatcher: null, turns: new Map() };
  await assert.doesNotReject(DesktopEngine.prototype.close.call(engine));
  assert.equal((await service.overview()).connected, false);
  assert.deepEqual(completed, ['scheduler', 'channels', 'other connections']);
});

test('a generic MCP reconnect reapplies the hidden preference to its new cursor session', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-pointer-reload-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))], version: 'fixture' }) });
  t.after(async () => { await service.close(); await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.connect(); await service.setPointer({ enabled: false });
  const originalSession = service.pointerSession;
  await manager.disconnect('ankita-computer');
  await manager.connect(new McpStore(service.mcpFile).load().find('ankita-computer'));
  const record = manager.servers.get('ankita-computer');
  assert.ok(record.computerPointerSession);
  assert.notEqual(record.computerPointerSession, originalSession);
  const state = await record.client.callTool('get_agent_cursor_state', { session: record.computerPointerSession });
  assert.equal(state.raw.structuredContent.enabled, false);
  assert.equal((await service.overview()).pointerEnabled, false);
});

test('Stop during cursor setup waits for teardown without surfacing a transport-close race', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-pointer-cancel-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))], version: 'fixture' }) });
  // The controller's discovered manifest does not carry env, so scope the dropped-reply switch to this child launch.
  const connect = manager.connect.bind(manager);
  manager.connect = options => connect({ ...options, env: { ANKITA_TEST_BLOCK_POINTER_ENABLE: '1' } });
  t.after(async () => { await service.close(); await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  const pending = service.connect();
  const rejected = assert.rejects(pending, /abort|closed|cancel/i);
  while (!service.pointerSession) await new Promise(resolve => setImmediate(resolve));
  await assert.doesNotReject(service.stop()); await rejected;
  assert.equal(manager.has('ankita-computer'), false);
  assert.equal(manager._clients.size, 0);
  assert.equal(service.connecting, null);
});

test('Stop cancels a generic reload before its transport becomes connected', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-pointer-reload-stop-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))], version: 'fixture' }) });
  t.after(async () => { await service.close(); await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.connect();
  const saved = new McpStore(service.mcpFile).load().find('ankita-computer');
  await manager.disconnect('ankita-computer');
  const reload = manager.connect(saved);
  const outcome = reload.then(() => 'connected', () => 'cancelled');
  assert.equal(manager.has('ankita-computer'), false);
  await service.stop();
  assert.equal(await outcome, 'cancelled');
  assert.equal(manager.has('ankita-computer'), false);
  assert.equal(manager._clients.size, 0);
  assert.equal(service.pointerSession, null);
  assert.equal(new McpStore(service.mcpFile).load().find('ankita-computer').enabled, false);
});

test('overlapping Stop requests share cleanup instead of closing each other\'s transport', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-pointer-double-stop-'));
  const manager = new McpManager();
  const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json'), platform: 'win32',
    discover: async () => ({ command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))], version: 'fixture' }) });
  const connect = manager.connect.bind(manager);
  manager.connect = options => connect({ ...options, env: { ANKITA_TEST_DELAY_POINTER_END: '1' } });
  t.after(async () => { await service.close(); await manager.closeAll(); fs.rmSync(directory, { recursive: true, force: true }); });
  await service.connect();
  const first = service.stop(), second = service.stop();
  const outcomes = await Promise.allSettled([first, second]);
  assert.deepEqual(outcomes.map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(first, second);
  assert.equal(manager.has('ankita-computer'), false);
  assert.equal(manager._clients.size, 0);
});

test('a preparing transport exposes no tools and concurrent Connect waits for its setup', async t => {
  const manager = new McpManager();
  let release, entered = false;
  const gate = new Promise(resolve => { release = resolve; });
  manager.setConnectionSetup('fixture', async () => { entered = true; await gate; });
  t.after(async () => { release(); await manager.closeAll(); });
  const options = { id: 'fixture', command: process.execPath, args: [fileURLToPath(new URL('../../scripts/fixtures/computer-mcp.mjs', import.meta.url))] };
  const first = manager.connect(options);
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  const exposed = manager.has('fixture');
  const tools = manager.specs();
  let secondReady = false;
  const second = manager.connect(options).then(record => { secondReady = true; return record; });
  await new Promise(resolve => setImmediate(resolve));
  const prematurelyReady = secondReady;
  release();
  assert.equal(await first, await second);
  assert.equal(exposed, false);
  assert.deepEqual(tools, []);
  assert.equal(prematurelyReady, false);
});
