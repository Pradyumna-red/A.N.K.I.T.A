import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DesktopEngine } from '../../desktop/electron/engine.mjs';
import { DesktopSettingsStore, applyDesktopSettings } from '../../desktop/electron/settings.mjs';
import { CHATGPT_BROWSER_PROVIDER } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { DesktopChatGptBrowser } from '../../desktop/electron/chatgpt-browser.mjs';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { McpClient } from '../../src/integrations/mcp-client.mjs';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { SecureStore } from '../../desktop/electron/secure-store.mjs';

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-desktop-chatgpt-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const events = [], calls = { api: 0, browser: 0, agents: 0 };
  const browser = { kind: CHATGPT_BROWSER_PROVIDER, init: async () => {}, listModels: () => [], view: () => ({ status: 'ready', selectedModel: null }),
    send: async input => { calls.browser++; assert.equal(input.text, 'unique desktop question'); return { outcome: 'completed', text: 'unique browser answer' }; },
    cancel: async () => true, close: async () => {} };
  const engine = new DesktopEngine({ teammateFile: path.join(directory, 'teammates.json'), settingsFile: path.join(directory, 'settings.json'),
    channelsFile: path.join(directory, 'channels.json'), sessionsDir: path.join(directory, 'sessions'), projectsFile: path.join(directory, 'projects.json'),
    composioFile: path.join(directory, 'composio.json'), composioGrantsFile: path.join(directory, 'grants.json'), credentialFile: path.join(directory, 'vault.json'),
    browserFile: path.join(directory, 'browser.json'), config: { provider: CHATGPT_BROWSER_PROVIDER, apiBase: '', apiKey: '', model: '', tools: true },
    bootstrap: async () => { calls.api++; throw new Error('Browser mode must not bootstrap an API client'); },
    AgentClass: class { constructor() { calls.agents++; throw new Error('Browser mode must not construct an API Agent'); } },
    chatgptFactory: () => browser, mcp: { connectedIds: [], reconcile: async () => {}, closeAll: async () => {} },
    emit: event => events.push(event), ...overrides });
  t.after(() => engine.close());
  return { engine, browser, directory, events, calls };
}

test('keyless desktop browser provider uses runtime Send with no API bootstrap or Agent and one turn end', async t => {
  const { engine, calls, events } = fixture(t);
  await engine.init(); assert.equal(calls.api, 0);
  const teammate = engine.createTeammate({ name: 'Browser teammate' });
  await engine.send(teammate.id, 'unique desktop question'); await engine.waitForTurn(teammate.id);
  assert.deepEqual(calls, { api: 0, browser: 1, agents: 0 });
  assert.equal(events.filter(event => event.type === 'turn-end').length, 1);
  assert.equal(events.filter(event => event.type === 'assistant-delta').map(event => event.text).join(''), 'unique browser answer');
  assert.equal(engine.loadThread(teammate.id).at(-1).content, 'unique browser answer');
  assert.deepEqual(engine.listModels(), [], 'unknown current model must not create a fabricated catalog');
});

test('desktop settings select browser mode without retaining an old API endpoint or key', t => {
  const { directory } = fixture(t);
  const store = new DesktopSettingsStore(path.join(directory, 'provider-settings.json'));
  store.update({ provider: CHATGPT_BROWSER_PROVIDER });
  const config = applyDesktopSettings({ provider: 'custom', apiBase: 'https://old-api.invalid/v1', apiKey: 'old-secret', model: 'old-model' }, store.data);
  assert.equal(config.provider, CHATGPT_BROWSER_PROVIDER); assert.equal(config.apiBase, ''); assert.equal(config.apiKey, '');
});

test('provider changes wait for an unsettled browser reply and browser usage does not invent token counts', async t => {
  let release;
  const { engine, browser, events } = fixture(t);
  browser.send = async () => new Promise(resolve => { release = resolve; });
  await engine.init(); const teammate = engine.createTeammate({ name: 'Held browser reply' });
  await engine.send(teammate.id, 'held question');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(engine.saveDesktopSettings({ provider: 'custom' }), /active|finish|reply/i);
  release({ outcome: 'completed', text: 'held answer' }); await engine.waitForTurn(teammate.id);
  assert.equal(events.some(event => event.type === 'usage' && (event.prompt_tokens !== undefined || event.completion_tokens !== undefined || event.estimated_cost !== undefined)), false);
});

test('API provider still constructs its Agent and preserves existing delta and turn events', async t => {
  let sends = 0;
  class ApiAgent {
    constructor(options) { Object.assign(this, options); this.messages = []; this.state = {}; this.cwd = process.cwd(); }
    async send(text, callbacks) {
      sends++; this.messages.push({ role: 'user', content: text }); callbacks.onMessageStart(); callbacks.onDelta('API answer'); callbacks.onMessageEnd();
      this.messages.push({ role: 'assistant', content: 'API answer' }); return 'API answer';
    }
    cancel() { return false; }
  }
  const { engine, events, calls } = fixture(t, { config: { provider: 'custom', apiBase: 'https://fixture-api.invalid/v1', apiKey: 'fixture-key', tools: true },
    bootstrap: async () => ({ client: {}, model: 'fixture-api-model', models: [{ id: 'fixture-api-model', tools: true }], provider: { name: 'custom' } }), AgentClass: ApiAgent });
  await engine.init(); const teammate = engine.createTeammate({ name: 'API teammate' });
  await engine.send(teammate.id, 'API question'); await engine.waitForTurn(teammate.id);
  assert.equal(sends, 1); assert.equal(calls.browser, 0);
  assert.equal(events.filter(event => event.type === 'assistant-delta').map(event => event.text).join(''), 'API answer');
  assert.equal(events.filter(event => event.type === 'turn-end').length, 1);
});

test('explicit browser resume imports its exact saved receipt once without sending a question or constructing an Agent', async t => {
  const { engine, browser, calls, events } = fixture(t);
  await engine.init(); const teammate = engine.createTeammate({ name: 'Resume teammate' });
  const operation = { id: 'saved-owned-operation', text: 'saved question', outcome: 'completed', completion: { text: 'saved native answer' } };
  let resumed = 0, consumed = 0;
  browser.operation = async () => operation;
  browser.resume = async input => { resumed++; assert.equal(input.operationId, operation.id); return { outcome: 'completed', operationId: operation.id, text: operation.completion.text }; };
  browser.consume = async () => consumed++;
  await engine.resumeBrowser(teammate.id, operation.id); await engine.waitForTurn(teammate.id);
  await engine.resumeBrowser(teammate.id, operation.id); await engine.waitForTurn(teammate.id);
  const history = engine.loadThread(teammate.id);
  assert.equal(history.filter(row => row.role === 'user' && row.content === operation.text).length, 1);
  assert.equal(history.filter(row => row.role === 'assistant' && row.content === operation.completion.text).length, 1);
  assert.equal(resumed, 1); assert.equal(consumed, 2);
  assert.deepEqual(calls, { api: 0, browser: 0, agents: 0 });
  assert.equal(events.filter(event => event.type === 'turn-end').length, 1);
});

test('runtime forwards only an owned public reply and settles from the durable final receipt', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-runtime-progress-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binding = { leaseId: 'runtime-lease', epoch: 'runtime-epoch', tabId: 1, browserId: 'runtime-browser', conversationId: crypto.randomUUID(), threadId: 'runtime-thread', workspacePath: directory };
  const store = new BrowserOperationStore({ directory }); let runtime;
  const delivery = new BrowserDelivery({ store, onEvent: event => runtime.deliveryEvent(event) });
  runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [], selectedModel: null }) } });
  const progress = [];
  const sending = runtime.send({ threadId: binding.threadId, text: 'unique runtime question', onProgress: answer => progress.push(answer.text) });
  await new Promise(resolve => setImmediate(resolve));
  const operation = await delivery.poll(binding); await delivery.authorize(operation.id, binding, { baselineUserIds: [] });
  const receipt = { conversationId: binding.conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
  await delivery.receipt(operation.id, binding, receipt);
  const answer = { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: false, status: 'in_progress', text: 'public partial' };
  await delivery.progress(operation.id, binding, { ...answer, channel: 'analysis', text: 'private analysis' });
  await delivery.progress(operation.id, binding, { ...answer, userMessageId: 'foreign user' });
  await delivery.progress(operation.id, binding, answer);
  assert.deepEqual(progress, ['public partial']);
  await delivery.observe(operation.id, binding, { ...answer, text: 'public final', end_turn: true, status: 'finished_successfully' });
  assert.equal((await sending).text, 'public final');
  assert.equal((await store.get(operation.id)).outcome, 'completed');
});

test('desktop native ToolHost retains the bound workspace and publishes real tool cards without an API Agent', async t => {
  const { engine, events, calls } = fixture(t);
  await engine.init(); const teammate = engine.createTeammate({ name: 'Native tool teammate' });
  const context = engine.browserContext(teammate.id);
  engine.config.autoApprove = true;
  const host = engine.toolHostForBrowser({ ...context, leaseId: 'native-test-lease' });
  const result = await host.execute({ id: 'native-write', name: 'write_file', arguments: { path: 'native.txt', content: 'bound native bytes', cwd: os.tmpdir() } }, { surface: 'core' });
  assert.equal(result.isError, false);
  assert.equal(fs.readFileSync(path.join(context.workspacePath, 'native.txt'), 'utf8'), 'bound native bytes');
  assert.equal(calls.agents, 0); assert.equal(calls.api, 0);
  assert.equal(events.filter(event => event.type === 'tool-call' && event.callId === 'native-write').length, 1);
  assert.equal(events.filter(event => event.type === 'tool-result' && event.callId === 'native-write').length, 1);
  assert.ok(engine.loadThread(teammate.id).some(message => message.role === 'tool' && message.name === 'write_file'));
});

test('Always allow applies to later native hosts for that teammate without granting another teammate approval', async t => {
  const { engine, events } = fixture(t);
  await engine.init(); engine.config.autoApprove = false;
  const teammate = engine.createTeammate({ name: 'Always browser teammate' });
  const owner = engine.browserContext(teammate.id);
  const first = engine.toolHostForBrowser({ ...owner, leaseId: 'first-approval-lease' }).execute({ id: 'first-approved-write', name: 'write_file', arguments: { path: 'first-allowed.txt', content: 'first approved bytes' } }, { surface: 'core' });
  for (let attempt = 0; attempt < 20 && !engine.listApprovals().length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.listApprovals().length, 1);
  assert.equal(engine.respondApproval(engine.listApprovals()[0].requestId, 'always'), true);
  assert.equal((await first).isError, false);
  let completed;
  const second = engine.toolHostForBrowser({ ...owner, leaseId: 'renewed-approval-lease' }).execute({ id: 'later-native-write', name: 'write_file', arguments: { path: 'later-allowed.txt', content: 'later automatic bytes' } }, { surface: 'core' }).then(result => (completed = result));
  for (let attempt = 0; attempt < 20 && !completed && !engine.listApprovals().length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.listApprovals().length, 0, 'Always must apply beyond the currently approved call and old lease');
  assert.equal((await second).isError, false);
  assert.equal(fs.readFileSync(path.join(owner.workspacePath, 'later-allowed.txt'), 'utf8'), 'later automatic bytes');
  const other = engine.createTeammate({ name: 'Separate approval teammate' });
  const otherContext = engine.browserContext(other.id);
  const separate = engine.toolHostForBrowser({ ...otherContext, leaseId: 'separate-approval-lease' }).execute({ id: 'separate-native-write', name: 'write_file', arguments: { path: 'other-denied.txt', content: 'never written' } }, { surface: 'core' });
  for (let attempt = 0; attempt < 20 && !engine.listApprovals().length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.listApprovals().length, 1);
  engine.respondApproval(engine.listApprovals()[0].requestId, 'no');
  assert.equal((await separate).isError, true);
  assert.equal(fs.existsSync(path.join(otherContext.workspacePath, 'other-denied.txt')), false);
  assert.equal(events.filter(event => event.type === 'approval-request').length, 2);
  assert.equal(engine.config.autoApprove, false, 'a teammate grant is not a global policy change');
});

test('clearing a browser conversation removes cached messages and its old checklist from later tool results', async t => {
  const { engine } = fixture(t);
  await engine.init(); const teammate = engine.createTeammate({ name: 'Clear browser teammate' });
  await engine.send(teammate.id, 'unique desktop question'); await engine.waitForTurn(teammate.id);
  const owner = { ...engine.browserContext(teammate.id), leaseId: 'clear-native-lease' };
  const host = engine.toolHostForBrowser(owner);
  assert.equal((await host.execute({ id: 'old-checklist-call', name: 'write_todos', arguments: { todos: [{ id: 'old-checklist', content: 'Old private checklist', status: 'pending' }] } }, { surface: 'core' })).isError, false);
  assert.ok(engine.loadThread(teammate.id).some(row => row.role === 'assistant' && row.content === 'unique browser answer'));
  engine.clearThread(teammate.id);
  assert.deepEqual(engine.loadThread(teammate.id), [], 'Clear must remove both saved and live browser history');
  const later = await host.execute({ id: 'later-directory-call', name: 'list_dir', arguments: { path: '.' } }, { surface: 'core' });
  assert.equal(later.isError, false);
  assert.equal(engine.loadThread(teammate.id).some(row => row.name === 'write_todos'), false, 'a later native result must not restore the cleared checklist');
  assert.equal(engine.loadThread(teammate.id).some(row => row.content === 'unique browser answer'), false);
});

test('bound desktop native gateway performs real write/edit/readback and command with exact ownership and no API client', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-desktop-native-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const state = { activatedTools: new Set() }, threadId = 'fixture-thread', conversationId = crypto.randomUUID(), browserId = 'fixture-browser';
  const secrets = new Map(); let helperStarts = 0;
  const secureStore = { saveSecret: async (name, value) => secrets.set(name, value), listSecrets: async () => [...secrets.keys()].map(name => ({ name })),
    withSecret: async (name, use) => secrets.has(name) ? use(secrets.get(name)) : null };
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), secureStore,
    nativeArtifact: { binary: fileURLToPath(import.meta.url), sha256: 'a'.repeat(64) }, nativeTunnelFactory: options => ({
      view: () => ({ surface: options.surface, status: 'connecting' }), start: async ({ apiKey }) => { helperStarts++; assert.equal(apiKey, 'fixture-restricted-key'); }, close: async () => {} }),
    getContext: id => ({ threadId: id, workspacePath: directory }), toolHostForBinding: binding => new ToolHost({ context: {
      cwd: binding.workspacePath, workspacePath: binding.workspacePath, threadId: binding.threadId, state,
      config: { autoApprove: true }, allowedTools: new Set(['read_file', 'write_file', 'edit_file', 'run_command', 'job_status', 'job_wait']) } }) });
  t.after(() => manager.close());
  await manager.start({ threadId });
  await manager.bridge.pair({ version: 1, extensionId: 'a'.repeat(32), browserId });
  await manager.bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const binding = await manager.bridge.bind({ browserId, tabId: 1, conversationId, threadId, workspacePath: directory });
  for (const requestIds of [[], ['fixture-native-request']]) {
    const command = await manager.bridge.poll();
    await manager.bridge.observe({ binding, nonce: command.nonce, snapshot: { conversationId, accountReady: true, models: [], selectedModel: null, requestIds } });
  }
  await manager.startNativeTools({ surface: 'core', tunnelId: 'tunnel_' + 'a'.repeat(32), apiKey: 'fixture-restricted-key' });
  assert.equal(helperStarts, 1);
  assert.equal(JSON.stringify(manager.view()).includes('fixture-restricted-key'), false);
  const gateway = await manager.startNativeGateway();
  const client = new McpClient({ transport: 'http', url: gateway.url, headers: { 'x-request-id': 'fixture-native-request/hop' } });
  t.after(() => client.close());
  await client.connect();
  assert.equal((await client.callTool('write_file', { path: 'native.txt', content: 'before native edit' })).isError, false);
  assert.equal((await client.callTool('edit_file', { path: 'native.txt', old_string: 'before', new_string: 'after' })).isError, false);
  assert.match((await client.callTool('read_file', { path: 'native.txt' })).raw.content[0].text, /after native edit/);
  const marker = 'native-command-' + crypto.randomUUID();
  const quote = text => process.platform === 'win32' ? "'" + text.replaceAll("'", "''") + "'" : "'" + text.replaceAll("'", "'\\''") + "'";
  const command = (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' -e ' + quote(`process.stdout.write(${JSON.stringify(marker)})`);
  const executed = await client.callTool('run_command', { command, yield_ms: 10000 });
  assert.equal(executed.isError, false);
  const job = [...state.jobs.values()].at(-1);
  if (!job.done) await new Promise((resolve, reject) => { job.child.once('close', resolve); job.child.once('error', reject); });
  assert.equal(job.done, true); assert.equal(job.code, 0); assert.ok(job.out.toString().includes(marker));
  const stale = await manager.bridge.disconnect(); assert.equal(stale.status, 'disconnected');
  await assert.rejects(client.callTool('write_file', { path: 'late.txt', content: 'never' }));
  assert.equal(fs.existsSync(path.join(directory, 'late.txt')), false);
  console.log('NATIVE_LOCAL_ACTION_PROOF', JSON.stringify({ realHttpMcp: true, exactOwnership: true, writeEditReadback: true, commandDone: job.done, exitCode: job.code, hostedChatGpt: false }));
});

test('disconnect during secure native setup cannot start a late helper or revive its connection', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-setup-stop-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let entered, release, starts = 0;
  const saving = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const secureStore = { listSecrets: async () => [], saveSecret: async () => { entered(); await gate; }, withSecret: async (_, use) => use('private-key') };
  const threadId = 'setup-thread', conversationId = crypto.randomUUID(), browserId = 'setup-browser';
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), secureStore,
    nativeArtifact: { binary: fileURLToPath(import.meta.url), sha256: 'a'.repeat(64) },
    toolHostForBinding: () => ({ specs: () => [], cancel: async () => {} }), getContext: id => ({ threadId: id, workspacePath: directory }),
    nativeTunnelFactory: () => ({ view: () => ({ status: 'connecting' }), start: async () => { starts++; }, close: async () => {} }) });
  t.after(() => manager.close());
  await manager.start({ threadId });
  await manager.bridge.pair({ version: 1, extensionId: 'a'.repeat(32), browserId });
  await manager.bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const binding = await manager.bridge.bind({ browserId, tabId: 1, conversationId, threadId, workspacePath: directory });
  const command = await manager.bridge.poll();
  await manager.bridge.observe({ binding, nonce: command.nonce, snapshot: { conversationId, accountReady: true, models: [], selectedModel: null, requestIds: [] } });
  const starting = manager.startNativeTools({ surface: 'core', tunnelId: 'tunnel_' + 'a'.repeat(32), apiKey: 'private-key' });
  void starting.catch(() => {});
  await saving; await manager.close(); release();
  await assert.rejects(starting, /changed|connection|setup/i);
  assert.equal(starts, 0);
});

test('native shutdown still closes owned transports when a local cancellation reports an error', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-close-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let helpersClosed = 0, gatewaysClosed = 0;
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), getContext: () => ({}) });
  manager.nativeHosts.set('failed-native', { cancel: async () => { throw new Error('Owned job termination unconfirmed'); } });
  manager.nativeTunnels.set('core', { close: async () => { helpersClosed++; } });
  manager.gateway = { close: async () => { gatewaysClosed++; } };
  await assert.rejects(manager.closeNative(), /termination unconfirmed/);
  assert.equal(helpersClosed, 1); assert.equal(gatewaysClosed, 1);
});

test('a stopped browser binding cannot enable a late native helper even while its selected page remains ready', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-stopped-native-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'publisher-fixture.exe'); fs.writeFileSync(binary, 'fixture');
  let starts = 0;
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)),
    getContext: threadId => ({ threadId, workspacePath: directory }), nativeArtifact: { binary }, toolHostForBinding: () => ({ specs: () => [], cancel: async () => {} }),
    secureStore: { listSecrets: async () => [], saveSecret: async () => {}, withSecret: async (_, use) => use('fixture-key') },
    nativeTunnelFactory: () => ({ start: async () => { starts++; }, close: async () => {}, view: () => ({ status: 'connected' }) }) });
  await manager.init(); await manager.start({ threadId: 'stopped-owner' }); t.after(() => manager.close());
  const browserId = 'stopped-browser', conversationId = crypto.randomUUID();
  await manager.bridge.pair({ version: 1, extensionId: 'a'.repeat(32), browserId });
  await manager.bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const binding = await manager.bridge.bind({ browserId, tabId: 1, conversationId, threadId: 'stopped-owner', workspacePath: directory });
  const poll = await manager.bridge.poll(); await manager.bridge.observe({ binding, nonce: poll.nonce, snapshot: { conversationId, accountReady: true, models: [], selectedModel: null, requestIds: [] } });
  await manager.cancel(binding.threadId);
  await assert.rejects(manager.startNativeTools({ surface: 'core', tunnelId: 'tunnel_' + 'a'.repeat(32), apiKey: 'fixture-key' }), /stop|cancel/i);
  assert.equal(starts, 0);
});

test('native setup refuses a tunnel already assigned to another active surface before saving a key or starting a helper', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-collision-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let saved = 0, starts = 0;
  const binary = path.join(directory, 'fixture-native.exe'); fs.writeFileSync(binary, 'fixture');
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), getContext: () => ({}), nativeArtifact: { binary },
    nativeTunnelFactory: () => { starts++; }, secureStore: { listSecrets: async () => [], saveSecret: async () => { saved++; }, withSecret: async () => {} } });
  const tunnelId = 'tunnel_' + 'a'.repeat(32);
  await manager.nativeSettings.run(state => { state.tunnels.core = { tunnelId, desired: true }; }, true);
  await assert.rejects(manager.startNativeTools({ surface: 'desktop', tunnelId, apiKey: 'fixture-key' }), /different tunnel|another.*surface/i);
  assert.equal(starts, 0); assert.equal(saved, 0);
});

test('concurrent native setup reserves its tunnel before any credential or gateway await', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-reservation-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'fixture-native.exe'); fs.writeFileSync(binary, 'fixture');
  let entered, release, saved = 0;
  const reached = new Promise(resolve => { entered = resolve; }), blocked = new Promise(resolve => { release = resolve; });
  const manager = new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), getContext: () => ({}), nativeArtifact: { binary },
    secureStore: { listSecrets: async () => [], saveSecret: async () => { saved++; }, withSecret: async () => {} } });
  manager.startNativeGateway = async () => { entered(); await blocked; throw new Error('Fixture gateway closed'); };
  const tunnelId = 'tunnel_' + 'b'.repeat(32);
  const first = manager.startNativeTools({ surface: 'core', tunnelId, apiKey: 'fixture-key' });
  void first.catch(() => {}); await reached;
  // Timeout bounds a broken implementation that lets the competing setup enter the blocked gateway.
  const competing = manager.startNativeTools({ surface: 'desktop', tunnelId, apiKey: 'other-key' });
  void competing.catch(() => {});
  const timeout = setTimeout(release, 100);
  try { await assert.rejects(competing, /different tunnel|another.*surface/i); }
  finally { clearTimeout(timeout); release(); }
  await assert.rejects(first, /Fixture gateway closed/); assert.equal(saved, 0);
});

test('encrypted desktop pairing restores the same companion with observation only and explicit disconnect stays disconnected', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-browser-restart-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = randomBytes(32), vaultFile = path.join(directory, 'vault.json');
  const secureStore = new SecureStore({ file: vaultFile, safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async () => { throw new Error('fixture encryption configured below'); },
    decryptStringAsync: async () => { throw new Error('fixture encryption configured below'); },
  } });
  secureStore.safeStorage.encryptStringAsync = async text => {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv), bytes = Buffer.concat([cipher.update(text), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
  };
  secureStore.safeStorage.decryptStringAsync = async bytes => {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
    return { result: Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString() };
  };
  const threadId = 'encrypted-restart-thread', browserId = 'encrypted-restart-browser', conversationId = crypto.randomUUID();
  let launches = 0;
  const make = () => new DesktopChatGptBrowser({ directory, resourceRoot: fileURLToPath(new URL('../../', import.meta.url)), secureStore,
    nativeTunnelFactory: () => { launches++; throw new Error('Restart must not start an action transport'); }, getContext: id => ({ threadId: id, workspacePath: directory }) });
  let manager = make(); await manager.init(); const setup = await manager.start({ threadId });
  await manager.bridge.pair({ version: 1, extensionId: 'a'.repeat(32), browserId });
  await manager.bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const binding = await manager.bridge.bind({ browserId, tabId: 1, conversationId, threadId, workspacePath: directory });
  await manager.close();
  assert.equal(fs.existsSync(vaultFile), true);
  const disk = fs.readFileSync(vaultFile, 'utf8');
  assert.equal(disk.includes(setup.pairingUrl.split('#')[1]), false); assert.equal(disk.includes(conversationId), false); assert.equal(disk.includes(browserId), false);
  manager = make(); await manager.init();
  assert.equal(manager.bridge.address, setup.pairingUrl.split('/#')[0]); assert.deepEqual(manager.bridge.view().binding, binding);
  assert.equal(manager.view().status, 'observing'); assert.equal(launches, 0);
  await manager.disconnect();
  manager = make(); await manager.init(); assert.equal(manager.bridge, null); assert.equal(launches, 0); await manager.close();
});
