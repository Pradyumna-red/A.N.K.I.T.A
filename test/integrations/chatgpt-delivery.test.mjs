import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';

const binding = { leaseId: 'owned-lease', epoch: 'owned-epoch', tabId: 1, conversationId: crypto.randomUUID(),
  browserId: 'owned-browser', threadId: 'owned-thread', workspacePath: 'host-built-workspace' };
const userMessageId = crypto.randomUUID(), turnId = crypto.randomUUID(), assistantMessageId = crypto.randomUUID();
const receipt = { conversationId: binding.conversationId, userMessageId, turnId };
const answer = { ...receipt, assistantMessageId, role: 'assistant', channel: 'final', end_turn: true,
  status: 'finished_successfully', text: 'An actual final answer' };
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-browser-delivery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new BrowserOperationStore({ directory }); const events = [];
  const delivery = new BrowserDelivery({ store, onEvent: event => events.push(event) });
  const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'Unique question' };
  await delivery.enqueue(operation);
  return { directory, delivery, store, events, operation };
}

test('one durable offer and authorization precede Send; polling and duplicate authorization never send again', async t => {
  const { delivery, store, operation } = await fixture(t);
  assert.equal((await delivery.poll(binding)).id, operation.id);
  assert.equal((await store.get(operation.id)).outcome, 'claimed');
  assert.equal(await delivery.poll(binding), null);
  assert.equal(await delivery.authorize(operation.id, binding), true);
  assert.equal((await store.get(operation.id)).outcome, 'dispatched');
  assert.equal(await delivery.authorize(operation.id, binding), false);
});

test('native user receipt owns its exact turn; commentary, silence, unfinished and unrelated finals cannot complete it', async t => {
  const { delivery, store, operation } = await fixture(t);
  await delivery.poll(binding); await delivery.authorize(operation.id, binding);
  await delivery.receipt(operation.id, binding, receipt);
  for (const final of [{ ...answer, channel: 'commentary' }, { ...answer, end_turn: false },
    { ...answer, status: 'in_progress' }, { ...answer, turnId: 'unrelated-turn' }, { ...answer, userMessageId: 'other-user' },
    { ...answer, conversationId: crypto.randomUUID() }, { text: 'quiet for a while' }]) {
    assert.equal(await delivery.observe(operation.id, binding, final), false);
  }
  assert.equal((await store.get(operation.id)).outcome, 'accepted');
  assert.equal(await delivery.observe(operation.id, binding, answer), true);
  assert.equal((await store.get(operation.id)).outcome, 'completed');
});

test('duplicate final evidence emits completion once and request ID reuse cannot assign a different operation', async t => {
  const { delivery, events, operation } = await fixture(t);
  await delivery.poll(binding); await delivery.authorize(operation.id, binding); await delivery.receipt(operation.id, binding, receipt);
  await delivery.observe(operation.id, binding, answer); await delivery.observe(operation.id, binding, answer);
  assert.equal(events.filter(event => event.type === 'completed').length, 1);
  const other = { id: crypto.randomUUID(), binding, kind: 'send', text: 'Second question' };
  await delivery.enqueue(other); await delivery.poll(binding); await delivery.authorize(other.id, binding);
  await assert.rejects(delivery.receipt(other.id, binding, receipt), /already|owner|receipt/i);
});

test('restart after dispatch or an accepted ACK offers no replay, while exact receipts may reconcile uncertain delivery', async t => {
  const { directory, delivery, operation } = await fixture(t);
  await delivery.poll(binding); await delivery.authorize(operation.id, binding);
  const restarted = new BrowserDelivery({ store: new BrowserOperationStore({ directory }) });
  await restarted.recover(binding);
  assert.equal(await restarted.poll(binding), null);
  assert.equal((await restarted.readback(binding)).id, operation.id, 'recovery may offer observation without Send authority');
  await restarted.receipt(operation.id, binding, receipt);
  assert.equal(await restarted.observe(operation.id, binding, answer), true);
});
