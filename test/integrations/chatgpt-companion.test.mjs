import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { RequestOwners } from '../../src/integrations/chatgpt-browser/request-owners.mjs';
import { observeBoundTab, trustedPopup } from '../../desktop/chatgpt-companion/background.mjs';
import { companionManifest, OBSERVATION_MAX_AGE_MS } from '../../services/chatgpt-bridge/config.mjs';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-companion-'));
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
const secret = 'test-only-pair-key';
const extensionId = 'a'.repeat(32);
const browserId = 'existing-profile';
const conversationId = crypto.randomUUID();
const otherConversation = crypto.randomUUID();
const config = { workspacePath: workspace, threadId: 'proof-thread' };
const secrets = { withSecret: async (_, callback) => callback(secret) };
const snapshot = { accountReady: true, models: [{ id: 'observed-model', label: 'Observed model', available: true }], selectedModel: 'observed-model', requestIds: ['native-owned'] };

async function paired(extraConfig = {}, delivery) {
  const bridge = await createCompanionBridge({ config: { ...config, ...extraConfig }, secrets, delivery });
  await bridge.pair({ extensionId, version: 1, browserId });
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}`, title: 'Same title' }, { id: 2, url: `https://chatgpt.com/c/${otherConversation}`, title: 'Same title' }, { id: 3, url: 'https://unrelated.invalid/', title: 'Private unrelated tab' }] });
  return bridge;
}

test('two identical tab titles bind only the explicitly selected existing conversation', async () => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 2, conversationId: otherConversation, ...config });
    assert.equal(binding.workspacePath, fs.realpathSync(workspace));
    assert.deepEqual((await bridge.listTabs()).filter(tab => tab.bound).map(tab => tab.id), [2]);
    assert.equal((await bridge.listTabs()).length, 2);
    assert.equal(bridge.view().status, 'observing');
    assert.equal(bridge.view().accountReady, false);
  } finally { await bridge.close(); }
});

test('host renewal keeps the selected conversation and requires fresh observation with a new epoch', async () => {
  const bridge = await paired();
  try {
    const original = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const poll = await bridge.poll(); await bridge.observe({ binding: original, nonce: poll.nonce, snapshot: { ...snapshot, conversationId } });
    await assert.rejects(bridge.renewBinding({ ...original, threadId: 'foreign-thread' }), /binding|owner/i);
    const renewed = await bridge.renewBinding(original);
    assert.notEqual(renewed.epoch, original.epoch); assert.notEqual(renewed.leaseId, original.leaseId);
    assert.equal(renewed.tabId, original.tabId); assert.equal(renewed.conversationId, original.conversationId);
    assert.equal(bridge.view().status, 'observing');
    assert.equal(await bridge.observe({ binding: original, nonce: poll.nonce, snapshot: { ...snapshot, conversationId } }), false);
  } finally { await bridge.close(); }
});

test('Observe on the same selected chat preserves in-flight custody and imports its original reply', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) }), delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const priming = await bridge.poll(); await bridge.observe({ binding, nonce: priming.nonce, snapshot: { ...snapshot, conversationId } });
    const runtime = new ChatGptRuntime({ bridge, store, delivery });
    delivery.onEvent = event => runtime.deliveryEvent(event);
    const sending = runtime.send({ threadId: config.threadId, text: 'original answer during repeated Observe' }); void sending.catch(() => {});
    let operation;
    for (let attempt = 0; attempt < 20 && !operation; attempt++) { await new Promise(resolve => setImmediate(resolve)); operation = (await store.list(binding))[0]; }
    await bridge.poll(); await delivery.authorize(operation.id, binding, { baselineUserIds: [] });
    const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    await delivery.receipt(operation.id, binding, receipt);
    const polling = await bridge.poll();
    assert.deepEqual(await bridge.bind({ ...binding }), binding, 'Observe must retain the original lease and epoch');
    assert.equal(await bridge.observe({ binding, nonce: polling.nonce, snapshot: { ...snapshot, conversationId, delivery: { operationId: operation.id, receipt,
      answer: { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'original answer retained' } } } }), true);
    assert.equal((await sending).text, 'original answer retained');
    assert.equal((await store.list(binding)).length, 1, 'Observe grants no replacement Send');
  } finally { await bridge.close(); }
});

test('changing the selected chat refuses unresolved Send and Stop custody, then permits a settled replacement', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) }), delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const replacement = { browserId, tabId: 2, conversationId: otherConversation, ...config };
    const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'keep original selected chat' };
    await bridge.enqueue(operation);
    for (const advance of [async () => {}, () => store.claim(operation.id, binding),
      () => delivery.authorize(operation.id, binding, { baselineUserIds: [] })]) {
      await advance();
      await assert.rejects(bridge.bind(replacement), /Resume|Stop|unresolved/i);
      assert.deepEqual(bridge.view().binding, binding);
    }
    const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    await delivery.receipt(operation.id, binding, receipt); await delivery.block(binding, 'quota');
    await assert.rejects(bridge.bind(replacement), /Resume|Stop|unresolved/i);
    await delivery.stop(binding);
    await assert.rejects(bridge.bind(replacement), /Stop|confirm/i);
    const stop = await store.stopCommand(binding); await store.authorizeStop(stop.id, binding, receipt);
    await delivery.observeStop(stop.id, binding, { receipt, confirmed: true });
    const next = await bridge.bind(replacement);
    assert.equal(next.conversationId, otherConversation); assert.notEqual(next.epoch, binding.epoch);
    assert.equal((await store.get(operation.id)).outcome, 'stopped');
  } finally { await bridge.close(); }
});

test('temporarily navigating away retains unresolved custody and cannot bypass replacement refusal', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) }), delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const priming = await bridge.poll(); await bridge.observe({ binding, nonce: priming.nonce, snapshot: { ...snapshot, conversationId } });
    const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'retain reply while navigating' };
    await bridge.enqueue(operation); await bridge.poll(); await delivery.authorize(operation.id, binding, { baselineUserIds: [] });
    const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    await delivery.receipt(operation.id, binding, receipt);
    await bridge.reportTabs({ browserId, tabs: [{ id: 2, url: `https://chatgpt.com/c/${otherConversation}` }] });
    assert.deepEqual(bridge.view().binding, binding, 'lost tab visibility cannot erase an accepted Send');
    assert.notEqual(bridge.view().status, 'ready');
    assert.equal((await bridge.poll()).binding, null, 'an unavailable selected page receives no commands');
    await assert.rejects(bridge.bind({ browserId, tabId: 2, conversationId: otherConversation, ...config }), /Resume|Stop|unresolved/i);
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'native-owned' }), /unavailable/i);
    await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
    assert.deepEqual(await bridge.bind({ ...binding }), binding);
    const polling = await bridge.poll(); assert.equal(polling.readback.id, operation.id);
    assert.equal(await bridge.observe({ binding, nonce: polling.nonce, snapshot: { ...snapshot, conversationId, delivery: { operationId: operation.id, receipt,
      answer: { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'original reply after navigation' } } } }), true);
    assert.equal((await store.get(operation.id)).outcome, 'completed');
    assert.equal((await store.list(binding)).length, 1);
  } finally { await bridge.close(); }
});

test('binding replacement and Send admission serialize so a concurrent question cannot be stranded', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) }), delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const priming = await bridge.poll(); await bridge.observe({ binding, nonce: priming.nonce, snapshot: { ...snapshot, conversationId } });
    const runtime = new ChatGptRuntime({ bridge, store, delivery });
    let entered, release;
    const checking = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { release = resolve; });
    const original = store.stopCommand.bind(store);
    store.stopCommand = async owner => { entered(); await paused; return original(owner); };
    const replacement = bridge.bind({ browserId, tabId: 2, conversationId: otherConversation, ...config }); void replacement.catch(() => {});
    await checking;
    const sending = runtime.send({ threadId: config.threadId, text: 'do not strand this concurrent question' }); void sending.catch(() => {});
    for (let attempt = 0; attempt < 20 && !runtime.pending.size; attempt++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.pending.size, 1);
    release(); await replacement;
    assert.equal((await store.list(binding)).length, 0, 'a losing admission cannot persist on the old selection');
    await assert.rejects(sending, /binding|connection|selection/i);
    assert.equal(runtime.pending.size, 0);
  } finally { await bridge.close(); }
});

test('restored paired custody reuses its owned loopback address and cannot authorize before a fresh observation', async () => {
  let saved;
  const store = { load: async () => saved, save: async state => { saved = structuredClone(state); } };
  let bridge = await createCompanionBridge({ config, secrets, store });
  await bridge.pair({ extensionId, version: 1, browserId });
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const original = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
  const address = bridge.address; await bridge.close();
  bridge = await createCompanionBridge({ config, secrets, store });
  try {
    assert.equal(bridge.address, address); assert.deepEqual(bridge.view().binding, original);
    assert.equal(bridge.view().status, 'observing');
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: original.leaseId, requestId: 'old-native' }), /unavailable/);
    await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
    const poll = await bridge.poll();
    assert.equal(await bridge.observe({ binding: original, nonce: poll.nonce, snapshot: { ...snapshot, conversationId } }), true);
    assert.equal(bridge.view().status, 'ready');
  } finally { await bridge.close(); }
});

test('forged, wrong-tab, stale-nonce and navigated observations cannot authorize ownership', async () => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const command = await bridge.poll();
    assert.equal(await bridge.observe({ binding: { ...binding, tabId: 2 }, nonce: command.nonce, snapshot }), false);
    assert.equal(await bridge.observe({ binding, nonce: 'forged', snapshot }), false);
    assert.equal(bridge.view().status, 'observing');
    assert.equal(await bridge.observe({ binding, nonce: command.nonce, snapshot: { ...snapshot, conversationId } }), true);
    assert.equal(bridge.view().status, 'ready');
    const next = await bridge.poll();
    assert.equal(await bridge.observe({ binding, nonce: next.nonce, snapshot: { ...snapshot, conversationId, requestIds: ['native-owned', 'new-native-owned'] } }), true);
    const owner = await bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'new-native-owned' });
    assert.equal(owner.tabId, 1);
    await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${otherConversation}` }] });
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'native-owned' }), /owner|binding|disconnect/i);
  } finally { await bridge.close(); }
});

test('incompatible pairing and explicit disconnect remain stopped on reconnect', async () => {
  const bridge = await paired();
  try {
    await assert.rejects(bridge.pair({ extensionId, version: 999, browserId }), /version/i);
    await bridge.disconnect();
    await assert.rejects(bridge.pair({ extensionId, version: 1, browserId }), /disconnect/i);
    assert.equal(bridge.view().status, 'disconnected');
  } finally { await bridge.close(); }
});

test('an exactly owned follow-up waits for a fresh same-binding observation instead of failing during a transient refresh gap', async t => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    for (const requestIds of [[], ['owned-follow-up']]) {
      const poll = await bridge.poll(); await bridge.observe({ binding, nonce: poll.nonce, snapshot: { ...snapshot, conversationId, requestIds } });
    }
    let now = Date.now(); t.mock.method(Date, 'now', () => now); now += OBSERVATION_MAX_AGE_MS + 1;
    assert.equal(bridge.view().status, 'observing');
    let settled = false;
    const waiting = bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'owned-follow-up' });
    void waiting.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false, 'stale page evidence waits; it never authorizes an action');
    const poll = await bridge.poll(); await bridge.observe({ binding, nonce: poll.nonce, snapshot: { ...snapshot, conversationId, requestIds: ['owned-follow-up'] } });
    assert.deepEqual(await waiting, binding); assert.equal(bridge.view().status, 'ready');
  } finally { await bridge.close(); }
});

test('disconnect cancels a follow-up waiting for fresh page evidence without authorizing it', async t => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    for (const requestIds of [[], ['owned-disconnect']]) {
      const poll = await bridge.poll(); await bridge.observe({ binding, nonce: poll.nonce, snapshot: { ...snapshot, conversationId, requestIds } });
    }
    const now = Date.now() + OBSERVATION_MAX_AGE_MS + 1; t.mock.method(Date, 'now', () => now);
    const waiting = bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'owned-disconnect' }); void waiting.catch(() => {});
    await new Promise(resolve => setImmediate(resolve)); await bridge.disconnect();
    await assert.rejects(waiting, /disconnect|binding|unavailable/i);
  } finally { await bridge.close(); }
});

test('an unavailable page observation is reported without asserting the user is logged out or admitting tools', async () => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const command = await bridge.poll();
    assert.equal(await bridge.observe({ binding, nonce: command.nonce, snapshot: {
      conversationId, accountReady: false, models: [], selectedModel: null, requestIds: [], observationReason: 'composer-unavailable',
    } }), true);
    assert.equal(bridge.view().status, 'page-unavailable');
    assert.equal(bridge.view().observationReason, 'composer-unavailable');
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'unproven' }), /unavailable/i);
  } finally { await bridge.close(); }
});

test('a visible observed quota blocks native ownership without changing account, model or conversation', async () => {
  const bridge = await paired({ modelMode: 'current' });
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const poll = await bridge.poll();
    await bridge.observe({ binding, nonce: poll.nonce, snapshot: { ...snapshot, conversationId, blockedReason: 'quota' } });
    assert.equal(bridge.view().status, 'blocked'); assert.equal(bridge.view().blockedReason, 'quota');
    assert.deepEqual(bridge.view().binding, binding);
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'native-owned' }), /unavailable/);
    assert.deepEqual((await bridge.listTabs()).filter(tab => tab.bound).map(tab => tab.id), [1]);
  } finally { await bridge.close(); }
});

test('current-model mode needs fresh page and exact request ownership while leaving the model name unknown', async () => {
  const bridge = await paired({ modelMode: 'current' });
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const observe = async requestIds => {
      const command = await bridge.poll();
      return bridge.observe({ binding, nonce: command.nonce, snapshot: {
        conversationId, accountReady: true, models: [], selectedModel: null, requestIds, observationReason: 'model-picker-unavailable',
      } });
    };
    assert.equal(await observe(['historical']), true);
    assert.equal(bridge.view().status, 'ready');
    assert.equal(bridge.view().modelMode, 'current');
    assert.equal(bridge.view().selectedModel, null);
    assert.deepEqual(bridge.view().models, []);
    assert.equal(await observe(['historical', 'new-current-request']), true);
    assert.equal((await bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'new-current-request' })).conversationId, conversationId);
    await bridge.disconnect();
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'new-current-request' }), /unavailable/i);
  } finally { await bridge.close(); }
});

test('an explicit model selection still refuses missing account model evidence', async () => {
  const bridge = await paired({ modelMode: 'explicit' });
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const command = await bridge.poll();
    await bridge.observe({ binding, nonce: command.nonce, snapshot: { conversationId, accountReady: true, models: [], selectedModel: null, requestIds: [] } });
    assert.equal(bridge.view().status, 'model-unavailable');
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'unproven' }), /unavailable/i);
  } finally { await bridge.close(); }
});

test('real external HTTP bridge rejects hostile origins and unauthorized page requests', async () => {
  const bridge = await createCompanionBridge({ config, secrets });
  try {
    const body = JSON.stringify({ extensionId, version: 1, browserId });
    assert.equal((await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, Origin: 'https://chatgpt.com' }, body })).status, 403);
    const response = await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, Origin: `chrome-extension://${extensionId}` }, body });
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(await response.json()).includes(secret), false);
  } finally { await bridge.close(); }
});

test('exact request join refuses unknown requests, changed lease and conflicting conversation evidence', async () => {
  const owners = new RequestOwners({ timeoutMs: 1 });
  const binding = { leaseId: 'current-lease', tabId: 1, conversationId, epoch: 'current-epoch' };
  owners.bind(binding); owners.observe(binding, ['request-one']);
  assert.equal((await owners.resolve({ leaseId: binding.leaseId, requestId: 'request-one/hop' })).conversationId, conversationId);
  await assert.rejects(owners.resolve({ leaseId: 'old-lease', requestId: 'request-one' }), /owner|lease/i);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'missing' }), /owner/i);
  owners.observe({ ...binding, conversationId: otherConversation }, ['request-one']);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'request-one' }), /ambiguous|conflict/i);
});

test('actual HTTP command authorization spends its durable Send once and exact observed receipts settle it', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) });
  const delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, Origin: `chrome-extension://${extensionId}` };
  const post = async (route, body) => {
    const result = await fetch(bridge.address + route, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(result.status, 200); return result.json();
  };
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const input = { id: crypto.randomUUID(), binding, kind: 'send', text: 'unique HTTP question' };
    await bridge.enqueue(input);
    assert.equal((await bridge.poll()).operation, null, 'no fresh page evidence, no command');
    const priming = await bridge.poll();
    await bridge.observe({ binding, nonce: priming.nonce, snapshot: { ...snapshot, conversationId } });
    const offered = await (await fetch(bridge.address + '/poll', { headers })).json();
    assert.equal(offered.operation.id, input.id);
    assert.equal((await post('/authorize', { binding, operationId: input.id, witness: { baselineUserIds: [] } })).allowed, true);
    assert.equal((await post('/authorize', { binding, operationId: input.id, witness: { baselineUserIds: [] } })).allowed, false);
    const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    await post('/receipt', { binding, operationId: input.id, receipt });
    const next = await bridge.poll();
    await bridge.observe({ binding, nonce: next.nonce, snapshot: { ...snapshot, conversationId, delivery: { operationId: input.id, receipt,
      answer: { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'unique HTTP answer' } } } });
    assert.equal((await store.get(input.id)).outcome, 'completed');
    assert.equal((await bridge.poll()).operation, null);
  } finally { await bridge.close(); }
});

test('the bridge offers one owned Stop and then observation only until its native terminal acknowledgement', async () => {
  const store = new BrowserOperationStore({ directory: path.join(workspace, crypto.randomUUID()) }), delivery = new BrowserDelivery({ store });
  const bridge = await paired({ modelMode: 'current' }, delivery);
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const priming = await bridge.poll(); await bridge.observe({ binding, nonce: priming.nonce, snapshot: { ...snapshot, conversationId } });
    const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'owned stopped question' };
    await bridge.enqueue(operation); await bridge.poll(); await delivery.authorize(operation.id, binding, { baselineUserIds: [] });
    const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
    await delivery.receipt(operation.id, binding, receipt); await delivery.stop(binding);
    const command = await bridge.poll();
    assert.ok(command.stopOperation, 'the paired actor needs an owned Stop command, independent of normal Send');
    const authorized = await bridge.authorize({ kind: 'stop', operationId: command.stopOperation.id, binding, witness: receipt });
    assert.equal(authorized.allowed, true);
    assert.equal((await bridge.authorize({ kind: 'stop', operationId: command.stopOperation.id, binding, witness: receipt })).allowed, false);
    const observed = await bridge.poll(); assert.equal(observed.stopOperation, null); assert.equal(observed.stopReadback.phase, 'dispatched');
    await bridge.acknowledge({ kind: 'stop', operationId: command.stopOperation.id, binding, receipt, confirmed: true });
    assert.equal((await store.stopCommand(binding)).phase, 'confirmed');
    assert.equal((await bridge.poll()).operation, null);
  } finally { await bridge.close(); }
});

test('only the actual extension popup can control pairing; web/content-script messages are refused', () => {
  const runtime = { id: extensionId, getURL: file => `chrome-extension://${extensionId}/${file}` };
  const sender = { id: extensionId, url: runtime.getURL('popup.html') };
  assert.equal(trustedPopup(sender, runtime), true);
  assert.equal(trustedPopup({ ...sender, tab: { id: 1 } }, runtime), false);
  assert.equal(trustedPopup({ ...sender, url: `https://chatgpt.com/c/${conversationId}` }, runtime), false);
  const manifest = JSON.parse(fs.readFileSync(new URL('../../desktop/chatgpt-companion/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, companionManifest);
  assert.equal(manifest.permissions.includes('debugger'), false);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.equal(manifest.content_scripts, undefined);
});

test('extension reads exactly the selected tab and discards navigation during the read', async () => {
  const calls = []; let currentUrl = `https://chatgpt.com/c/${conversationId}`;
  const binding = { tabId: 2, conversationId };
  const chromeApi = { tabs: { get: async id => { calls.push(id); return { url: currentUrl }; } }, scripting: { executeScript: async request => {
    calls.push(request.target.tabId);
    if (request.func) { currentUrl = `https://chatgpt.com/c/${otherConversation}`; return [{ result: { privateUnrelatedText: 'must be discarded' } }]; }
    return [];
  } } };
  assert.equal(await observeBoundTab(chromeApi, binding), null);
  assert.deepEqual(calls, [2, 2, 2, 2]);
});

test('the bound page receives only opaque ownership scope, never host workspace or thread context', async () => {
  const binding = { leaseId: 'current-lease', epoch: 'current-epoch', tabId: 1, conversationId, workspacePath: workspace, threadId: 'private-host-thread' };
  let injected;
  const chromeApi = { tabs: { get: async () => ({ url: `https://chatgpt.com/c/${conversationId}` }) }, scripting: { executeScript: async request => {
    if (request.func) { injected = request.args; return [{ result: { conversationId } }]; }
    assert.deepEqual(request.files, ['upstream/readers.js', 'upstream/request-origins.js', 'upstream/delivery.js']); return [];
  } } };
  await observeBoundTab(chromeApi, binding);
  assert.deepEqual(injected[2], { leaseId: binding.leaseId, epoch: binding.epoch, tabId: binding.tabId, conversationId });
  assert.equal(JSON.stringify(injected).includes(workspace), false);
  assert.equal(JSON.stringify(injected).includes(binding.threadId), false);
});

test('repeating Connect with the same pairing URL preserves the paired browser and conversation', async () => {
  const bridge = await createCompanionBridge({ config, secrets });
  const originalChrome = globalThis.chrome;
  const storage = {}; let listener;
  const runtime = { id: extensionId, getURL: file => `chrome-extension://${extensionId}/${file}`,
    onMessage: { addListener: callback => { listener = callback; } } };
  globalThis.chrome = { runtime, storage: { session: {
    get: async key => ({ [key]: storage[key] }),
    set: async values => { Object.assign(storage, values); },
    remove: async key => { delete storage[key]; },
  } }, tabs: {
    query: async () => [{ id: 4, url: `https://chatgpt.com/c/${conversationId}`, title: 'Existing conversation' }],
    get: async () => ({ id: 4, url: `https://chatgpt.com/c/${conversationId}` }),
  }, scripting: { executeScript: async () => [] } };
  const send = message => new Promise(resolve => {
    assert.equal(listener(message, { id: extensionId, url: runtime.getURL('popup.html') }, resolve), true);
  });
  try {
    await import(new URL(`../../desktop/chatgpt-companion/background.mjs?rpc-fixture=${crypto.randomUUID()}`, import.meta.url));
    const url = `${bridge.address}/#${secret}`;
    assert.equal((await send({ type: 'connect', url })).value?.connected, true);
    const firstBrowser = (await bridge.listTabs())[0].browserId;
    const binding = await bridge.bind({ ...config, browserId: firstBrowser, tabId: 4, conversationId });
    const repeated = await send({ type: 'connect', url });
    assert.equal(repeated.error, undefined, 'a repeated owner connection must not return HTTP 409');
    assert.equal(repeated.value?.connected, true);
    assert.equal((await bridge.listTabs())[0].browserId, firstBrowser);
    assert.deepEqual(bridge.view().binding, binding);
  } finally {
    // Bind's awaited observation drains the worker before its global Chrome fixture is removed.
    if (listener && Object.keys(storage).length) await send({ type: 'bind', tabId: 4 });
    if (listener) await send({ type: 'disconnect' });
    await bridge.close();
    await new Promise(resolve => setImmediate(resolve));
    if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
  }
});
