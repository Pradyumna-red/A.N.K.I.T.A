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
