import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';

const binding = { leaseId: 'owned-lease', epoch: 'owned-epoch', tabId: 1, conversationId: crypto.randomUUID(),
  browserId: 'owned-browser', threadId: 'owned-thread', workspacePath: 'host-built-workspace' };
const operation = () => ({ id: crypto.randomUUID(), binding, kind: 'send', text: 'Unique user-authored question' });
const receipt = { conversationId: binding.conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-browser-operations-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new BrowserOperationStore({ directory }) };
}

test('queue, claim and dispatch are durable and restart reports uncertain without a second send', async t => {
  const { directory, store } = fixture(t); const input = operation();
  await store.queue(input); await store.claim(input.id, binding); await store.dispatch(input.id, binding);
  const restored = new BrowserOperationStore({ directory });
  const recovered = await restored.recover(binding);
  assert.equal(recovered[0].outcome, 'uncertain');
  assert.equal(await restored.claim(input.id, binding), null);
  assert.equal(await restored.dispatch(input.id, binding), false);
  assert.equal((await store.get(input.id)).outcome, 'uncertain');
});

test('same queued identity is idempotent and changed payload or host binding is rejected', async t => {
  const { store } = fixture(t); const input = operation();
  await store.queue(input); await store.queue(input);
  await assert.rejects(store.queue({ ...input, text: 'different side effect' }), /changed|identity/i);
  await assert.rejects(store.claim(input.id, { ...binding, workspacePath: 'forged workspace' }), /binding|owner/i);
  assert.equal((await store.get(input.id)).outcome, 'queued');
});

test('app names are immutable and dispatch requires the matching native app witness', async t => {
  const { store } = fixture(t); const input = { ...operation(), appNames: ['ANKITA Core'] };
  await store.queue(input);
  await assert.rejects(store.queue({ ...input, appNames: ['Different app'] }), /changed|identity/i);
  await store.claim(input.id, binding);
  await assert.rejects(store.dispatch(input.id, binding), /app|mention/i);
  await assert.rejects(store.dispatch(input.id, binding, { baselineUserIds: [], appMentions: [{ name: 'Different app', path: 'app://asdk_app_wrong' }] }), /app|mention/i);
  assert.equal((await store.get(input.id)).outcome, 'claimed');
  const appMentions = [{ name: 'ANKITA Core', path: 'app://asdk_app_core_fixture' }];
  await store.dispatch(input.id, binding, { baselineUserIds: [], appMentions });
  assert.deepEqual((await store.get(input.id)).appMentions, appMentions);
});

test('concurrent store instances can claim one operation only once', async t => {
  const { directory, store } = fixture(t); const input = operation();
  await store.queue(input);
  const other = new BrowserOperationStore({ directory });
  const claims = await Promise.all([store.claim(input.id, binding), other.claim(input.id, binding)]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal((await other.get(input.id)).outcome, 'claimed');
});

test('an accepted native message survives a lost acknowledgement and exact duplicate receipts do not change its owner', async t => {
  const { directory, store } = fixture(t); const input = operation();
  await store.queue(input); await store.claim(input.id, binding); await store.dispatch(input.id, binding);
  await store.accept(input.id, binding, receipt); await store.accept(input.id, binding, receipt);
  const restored = new BrowserOperationStore({ directory });
  assert.equal((await restored.recover(binding))[0].outcome, 'accepted');
  assert.equal(await restored.dispatch(input.id, binding), false);
  await assert.rejects(restored.accept(input.id, binding, { ...receipt, userMessageId: 'another-user' }), /receipt|changed/i);
});

test('Stop commits epoch cancellation before a late dispatch or receipt and never revives work', async t => {
  const { directory, store } = fixture(t); const input = operation();
  await store.queue(input); await store.claim(input.id, binding);
  await store.stop(binding);
  const restored = new BrowserOperationStore({ directory });
  assert.equal(await restored.dispatch(input.id, binding), false);
  assert.equal(await restored.accept(input.id, binding, receipt), false);
  assert.equal((await restored.get(input.id)).outcome, 'stopped');
  await assert.rejects(restored.queue(operation()), /stopped|cancelled/i);
});

test('corrupt or unsupported on-disk state fails closed instead of forgetting dispatched work', async t => {
  const { directory, store } = fixture(t); const input = operation();
  await store.queue(input);
  fs.writeFileSync(store.file, '{bad JSON');
  await assert.rejects(new BrowserOperationStore({ directory }).get(input.id), /JSON|state|corrupt/i);
  fs.writeFileSync(store.file, JSON.stringify({ version: 999, operations: [], stoppedEpochs: [] }));
  await assert.rejects(new BrowserOperationStore({ directory }).queue(operation()), /version|state/i);
});
