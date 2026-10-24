import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';

test('one owned opening adopts its real chat from its dispatched question without replacing or replaying the operation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-opening-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const openingId = crypto.randomUUID(), browserId = crypto.randomUUID(), conversationId = crypto.randomUUID();
  const config = { workspacePath: directory, threadId: 'owner', modelMode: 'current', openingId };
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  let saved;
  const bridge = await createCompanionBridge({ config, managedBrowserId: browserId, secrets: { withSecret() {} },
    store: { save: async value => { saved = structuredClone(value); } }, delivery });
  t.after(() => bridge.close());
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/#ankita-opening=${openingId}` }] });
  assert.equal((await bridge.listTabs()).length, 1, 'a locally owned blank page is a usable opening, not an invented server conversation');
  const binding = await bridge.bind({ ...config, browserId, tabId: 1, conversationId: null, openingId });
  const initial = await bridge.poll();
  assert.equal(await bridge.observe({ binding, nonce: initial.nonce, snapshot: { conversationId: null, models: [], requestIds: [], accountReady: true, nativeAppTagsReady: true } }), true);
  const runtime = new ChatGptRuntime({ bridge, delivery, store }); delivery.onEvent = event => runtime.deliveryEvent(event);
  let queued;
  const queuedPromise = new Promise(resolve => { queued = resolve; });
  const sending = runtime.send({ threadId: config.threadId, text: 'first unique question', onQueued: queued }); void sending.catch(() => {});
  const operation = await queuedPromise, originalHash = operation.argumentsHash;
  await bridge.poll();
  assert.equal((await bridge.authorize({ binding, operationId: operation.id, witness: { baselineUserIds: [] } })).allowed, true);
  const poll = await bridge.poll();
  const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
  assert.equal(await bridge.observe({ binding, nonce: poll.nonce, snapshot: { conversationId, models: [], requestIds: ['first-native-request'], accountReady: true,
    delivery: { operationId: operation.id, receipt, answer: { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final',
      end_turn: true, status: 'finished_successfully', text: 'first public answer' } } } }), true);
  assert.equal((await sending).text, 'first public answer');
  assert.equal(bridge.view().binding.conversationId, conversationId);
  assert.equal(saved.binding.conversationId, conversationId, 'real identity is persisted before accepting its user receipt');
  assert.equal((await store.get(operation.id)).argumentsHash, originalHash, 'opening adoption does not rewrite immutable Send arguments');
  assert.equal((await store.list(bridge.view().binding)).length, 1);
  assert.equal((await bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'first-native-request' })).conversationId, conversationId);
});

test('Stop before an opening acknowledgement still admits its exact receipt so remote Stop can find the real chat', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-opening-stop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const openingId = crypto.randomUUID(), browserId = crypto.randomUUID(), conversationId = crypto.randomUUID();
  const config = { workspacePath: directory, threadId: 'owner', modelMode: 'current', openingId };
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  const bridge = await createCompanionBridge({ config, managedBrowserId: browserId, secrets: { withSecret() {} }, delivery });
  t.after(() => bridge.close());
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/#ankita-opening=${openingId}` }] });
  const binding = await bridge.bind({ ...config, browserId, tabId: 1, openingId, conversationId: null });
  const polling = await bridge.poll();
  await bridge.observe({ binding, nonce: polling.nonce, snapshot: { conversationId: null, models: [], requestIds: [], accountReady: true } });
  const operation = await bridge.enqueue({ id: crypto.randomUUID(), kind: 'send', binding, text: 'stop this exact opening' });
  await bridge.poll(); await bridge.authorize({ binding, operationId: operation.id, witness: { baselineUserIds: [] } });
  await delivery.stop(binding);
  const receipt = { conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
  assert.equal((await bridge.acknowledge({ binding, operationId: operation.id, receipt })).accepted, false, 'stopped work must not become active again');
  assert.equal(bridge.view().binding.conversationId, conversationId, 'receipt may identify the chat for Stop only');
  assert.equal(await store.isStopped(bridge.view().binding), true);
});

test('restart before an opening receipt remains uncertain and cannot adopt an unrelated chat or offer another Send', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-opening-crash-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const openingId = crypto.randomUUID(), browserId = crypto.randomUUID();
  const config = { workspacePath: directory, threadId: 'owner', modelMode: 'current', openingId };
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  let saved;
  const custody = { load: async () => saved, save: async value => { saved = structuredClone(value); } };
  let bridge = await createCompanionBridge({ config, managedBrowserId: browserId, secrets: { withSecret() {} }, store: custody, delivery });
  t.after(() => bridge.close());
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/#ankita-opening=${openingId}` }] });
  const binding = await bridge.bind({ ...config, browserId, tabId: 1, openingId, conversationId: null });
  const initial = await bridge.poll(); await bridge.observe({ binding, nonce: initial.nonce, snapshot: { conversationId: null, models: [], requestIds: [], accountReady: true } });
  const operation = await bridge.enqueue({ id: crypto.randomUUID(), kind: 'send', binding, text: 'one opening before crash' });
  await bridge.poll(); await bridge.authorize({ binding, operationId: operation.id, witness: { baselineUserIds: [] } });
  await bridge.close();
  bridge = await createCompanionBridge({ config, managedBrowserId: browserId, secrets: { withSecret() {} }, store: custody, delivery });
  const recovered = await bridge.poll();
  assert.equal(recovered.operation, null); assert.equal(recovered.readback.outcome, 'uncertain');
  assert.equal(await bridge.observe({ binding, nonce: recovered.nonce, snapshot: { conversationId: crypto.randomUUID(), models: [], requestIds: [], accountReady: true } }), false);
  assert.equal(bridge.view().binding.conversationId, null);
  assert.equal((await store.get(operation.id)).outcome, 'uncertain');
});
