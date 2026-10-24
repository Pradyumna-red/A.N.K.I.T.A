import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { killTree } from '../../tools/shared/_job-tree.mjs';
import { waitForExit } from '../../tools/shared/_jobs.mjs';

const binding = { leaseId: 'stop-lease', epoch: 'stop-epoch', tabId: 1, browserId: 'stop-browser',
  conversationId: crypto.randomUUID(), threadId: 'stop-thread', workspacePath: 'host-owned-fixture' };
const receipt = { conversationId: binding.conversationId, userMessageId: crypto.randomUUID(), turnId: crypto.randomUUID() };
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-stop-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'owned unique stop question' };
  await delivery.enqueue(operation);
  return { store, delivery, operation };
}

test('explicit Read reply observes through a transport notice without reopening tools, while other blocks still refuse', async t => {
  const {store,delivery,operation}=await fixture(t);
  await store.claim(operation.id,binding);await store.dispatch(operation.id,binding,{baselineUserIds:[]});await delivery.receipt(operation.id,binding,receipt);
  await delivery.block(binding,'transport');
  let reason='quota',helpers=0;
  const runtime=new ChatGptRuntime({store,delivery,bridge:{view:()=>({status:'blocked',blockedReason:reason,binding,models:[]})},onReadyBinding:async()=>{helpers++;}});
  delivery.onEvent=event=>runtime.deliveryEvent(event);
  await assert.rejects(runtime.resume({threadId:binding.threadId,operationId:operation.id}),/connect/i);
  reason='transport';
  const resumed=runtime.resume({threadId:binding.threadId,operationId:operation.id});void resumed.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(runtime.pending.size,1);
  await delivery.receipt(operation.id,binding,receipt);
  await delivery.observe(operation.id,binding,{...receipt,assistantMessageId:crypto.randomUUID(),role:'assistant',channel:'final',end_turn:true,status:'finished_successfully',text:'read the same completed answer'});
  assert.equal((await resumed).text,'read the same completed answer');
  assert.equal(helpers,0);assert.equal((await store.list(binding)).length,1);
});

test('Stop before Send durably fences the epoch and grants no remote control over a human generation', async t => {
  const { store, delivery, operation } = await fixture(t);
  await delivery.stop(binding);
  assert.equal((await store.get(operation.id)).outcome, 'stopped');
  assert.equal(await store.stopCommand(binding), null);
  assert.equal(await delivery.poll(binding), null);
  await assert.rejects(delivery.enqueue({ ...operation, id: crypto.randomUUID() }), /stopped/);
});

test('Stop during generation owns one native control grant, survives restart and rejects late finals', async t => {
  const { store, delivery, operation } = await fixture(t);
  await delivery.poll(binding); await delivery.authorize(operation.id, binding, { baselineUserIds: [] });
  await delivery.receipt(operation.id, binding, receipt);
  await delivery.stop(binding);
  const command = await store.stopCommand(binding);
  assert.equal(command.target.id, operation.id);
  assert.equal(await store.authorizeStop(command.id, binding, { ...receipt, userMessageId: 'foreign' }), false);
  assert.equal(await store.authorizeStop(command.id, binding, receipt), true);
  assert.equal(await store.authorizeStop(command.id, binding, receipt), false);
  const restored = new BrowserOperationStore({ directory: store.directory });
  assert.equal((await restored.stopCommand(binding)).phase, 'dispatched', 'restart grants observation only after one Stop authorization');
  await restored.settleStop(command.id, binding, { receipt, confirmed: true });
  assert.equal((await restored.stopCommand(binding)).phase, 'confirmed');
  assert.equal(await delivery.observe(operation.id, binding, { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'late reply' }), false);
});

test('runtime cancellation fences first, cancels only owned tools and leaves the browser open', async t => {
  const { store, delivery } = await fixture(t);
  // The fixture's first queued operation is unrelated to this runtime request; do not dispatch it.
  let toolsStopped = 0, browserClosed = 0;
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }), close: () => browserClosed++ },
    onCancel: async owner => { toolsStopped++; assert.equal(owner.threadId, binding.threadId); assert.equal(await store.isStopped(binding), true); } });
  const sending = runtime.send({ threadId: binding.threadId, text: 'runtime cancellation question' }); void sending.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  await runtime.cancel(binding.threadId); await assert.rejects(sending, /cancel/i);
  assert.equal(toolsStopped, 1); assert.equal(browserClosed, 0);
});

test('runtime retains remote Stop status after the cancelled Send settles and requires confirmation before a new Send', async t => {
  const { store, delivery } = await fixture(t);
  let renewals = 0;
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }),
    renewBinding: async () => { renewals++; } } });
  delivery.onEvent = event => runtime.deliveryEvent(event);
  const sending = runtime.send({ threadId: binding.threadId, text: 'owned runtime Stop question' }); void sending.catch(() => {});
  await new Promise(resolve => setImmediate(resolve));
  const operation = (await store.list(binding)).find(row => row.text === 'owned runtime Stop question');
  await store.claim(operation.id, binding); await store.dispatch(operation.id, binding, { baselineUserIds: [] }); await delivery.receipt(operation.id, binding, receipt);
  await runtime.cancel(binding.threadId); await assert.rejects(sending, /cancel/i);
  assert.equal(runtime.view().remoteStop, 'pending');
  await assert.rejects(runtime.send({ threadId: binding.threadId, text: 'next explicit question' }), /Stop.*confirm|confirm.*Stop/i);
  assert.equal(renewals, 0);
  const stop = await store.stopCommand(binding);
  await store.authorizeStop(stop.id, binding, receipt); await delivery.observeStop(stop.id, binding, { receipt, confirmed: true });
  assert.equal(runtime.view().remoteStop, 'confirmed');
  assert.equal(await runtime.waitForStop(binding, 1), true);
});

test('explicit Send after a local-only Stop creates fresh custody without replaying stopped operations', async t => {
  const { store, delivery } = await fixture(t);
  await store.stop(binding);
  let current = binding, renewals = 0;
  const fresh = { ...binding, leaseId: crypto.randomUUID(), epoch: crypto.randomUUID() };
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding: current, models: [] }),
    renewBinding: async owner => { assert.deepEqual(owner, binding); current = fresh; renewals++; return fresh; } } });
  const sending = runtime.send({ threadId: binding.threadId, text: 'next explicit question' }); void sending.catch(() => {});
  for (let attempt = 0; attempt < 20 && !(await store.list(fresh)).length; attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(renewals, 1); assert.equal((await store.list(fresh)).length, 1);
  assert.equal((await store.list(binding))[0].outcome, 'stopped');
  await runtime.cancel(binding.threadId); await assert.rejects(sending, /cancel/i);
});

test('restart holds unsent work and explicit resume reads an accepted reply without granting another Send', async t => {
  const { store, delivery, operation } = await fixture(t);
  await store.claim(operation.id, binding); await store.dispatch(operation.id, binding, { baselineUserIds: [] }); await delivery.receipt(operation.id, binding, receipt);
  await store.queue({ ...operation, id: crypto.randomUUID(), text: 'unsent queued question' });
  await store.recover(binding);
  assert.equal((await store.list(binding)).find(row => row.text === 'unsent queued question').outcome, 'rejected');
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }) } });
  delivery.onEvent = event => runtime.deliveryEvent(event);
  await assert.rejects(runtime.send({ threadId: binding.threadId, text: 'new explicit question' }), /resume|unresolved/i);
  const resumed = runtime.resume({ threadId: binding.threadId, operationId: operation.id });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await delivery.poll(binding), null);
  await delivery.observe(operation.id, binding, { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'recovered public final' });
  assert.equal((await resumed).text, 'recovered public final');
  assert.equal((await store.get(operation.id)).dispatchedAt, operation.dispatchedAt ?? (await store.get(operation.id)).dispatchedAt);
  assert.equal((await store.list(binding)).filter(row => row.text === 'new explicit question').length, 0);
});

test('a live lost reply exposes Resume and later observation-only completion updates it without a new Send', async t => {
  const { store, delivery } = await fixture(t);
  const notices = [];
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }) }, onEvent: event => notices.push(event) });
  delivery.onEvent = event => runtime.deliveryEvent(event);
  const sending = runtime.send({ threadId: binding.threadId, text: 'lost live reply question' }); void sending.catch(() => {});
  let operation;
  for (let attempt = 0; attempt < 20 && !operation; attempt++) { await new Promise(resolve => setImmediate(resolve)); operation = (await store.list(binding)).find(row => row.text === 'lost live reply question'); }
  await store.claim(operation.id, binding); await store.dispatch(operation.id, binding, { baselineUserIds: [] });
  await delivery.fail(operation.id, binding); await assert.rejects(sending, /could not be confirmed/);
  assert.deepEqual(runtime.recoverable, [{ id: operation.id, outcome: 'uncertain' }], 'the active app must offer recovery without a restart');
  await assert.rejects(runtime.send({ threadId: binding.threadId, text: 'do not send this' }), /Resume/);
  const count = (await store.list(binding)).length;
  await delivery.receipt(operation.id, binding, receipt);
  await delivery.observe(operation.id, binding, { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'observed recovered answer' });
  assert.deepEqual(runtime.recoverable, [{ id: operation.id, outcome: 'completed' }], 'a final observed without an active caller must refresh the Resume row');
  assert.equal((await runtime.resume({ threadId: binding.threadId, operationId: operation.id })).text, 'observed recovered answer');
  assert.equal((await store.list(binding)).length, count);
  assert.ok(notices.some(event => event.type === 'completed'));
});

test('resolving a provider block can reaccept the exact prior user receipt and complete it without replay', async t => {
  const { store, delivery, operation } = await fixture(t);
  await store.claim(operation.id, binding); await store.dispatch(operation.id, binding, { baselineUserIds: [] }); await delivery.receipt(operation.id, binding, receipt);
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }) } });
  delivery.onEvent = event => runtime.deliveryEvent(event);
  await delivery.block(binding, 'quota');
  assert.equal((await store.get(operation.id)).outcome, 'uncertain');
  assert.deepEqual(runtime.recoverable, [{ id: operation.id, outcome: 'uncertain' }]);
  assert.equal(await delivery.receipt(operation.id, binding, receipt), true, 'the exact same accepted user can leave uncertainty once observed again');
  assert.equal((await store.get(operation.id)).outcome, 'accepted');
  const resumed = runtime.resume({ threadId: binding.threadId, operationId: operation.id });
  await new Promise(resolve => setImmediate(resolve));
  await delivery.observe(operation.id, binding, { ...receipt, assistantMessageId: crypto.randomUUID(), role: 'assistant', channel: 'final', end_turn: true, status: 'finished_successfully', text: 'same owned answer after block' });
  assert.equal((await resumed).text, 'same owned answer after block');
  assert.equal((await store.list(binding)).length, 1);
});

test('Stop during connection preparation cannot renew or enqueue a late message', async t => {
  const { store, delivery } = await fixture(t);
  let entered, release;
  const starting = new Promise(resolve => { entered = resolve; });
  const runtime = new ChatGptRuntime({ store, delivery, bridge: { view: () => ({ status: 'ready', binding, models: [] }) },
    onReadyBinding: async () => { entered(); await new Promise(resolve => { release = resolve; }); } });
  const sending = runtime.send({ threadId: binding.threadId, text: 'late prepared question' }); void sending.catch(() => {});
  await starting;
  await assert.rejects(runtime.send({ threadId: binding.threadId, text: 'concurrent question' }), /already replying/);
  await runtime.cancel(binding.threadId); release();
  await assert.rejects(sending, /cancel|stop|changed/i);
  assert.equal((await store.list(binding)).some(row => row.text === 'late prepared question'), false);
});

test('real page Stop targets only the owned latest native user and never clicks twice or stops a newer human turn', async t => {
  const { store, delivery, operation } = await fixture(t);
  await delivery.poll(binding); await delivery.authorize(operation.id, binding, { baselineUserIds: [] }); await delivery.receipt(operation.id, binding, receipt); await delivery.stop(binding);
  const stop = await store.stopCommand(binding);
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(), origin = 'http://ankita-stop-fixture.local';
  await page.route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body: '<section data-testid="conversation-turn-fixture"></section><form><div id="prompt-textarea" contenteditable="true"></div><button type="button" data-testid="stop-button">Stop</button></form>' }));
  await page.goto(origin + '/c/' + binding.conversationId);
  for (const file of ['readers.js', 'delivery.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/' + file, import.meta.url)) });
  await page.evaluate(({ binding, receipt, text }) => {
    window.stopClicks = 0;
    const section = document.querySelector('section'); section.dataset.turnId = receipt.turnId;
    section.textContent = text; section.__reactFiber$fixture = { memoizedProps: { conversationId: binding.conversationId,
      turn: { messages: [{ id: receipt.userMessageId, author: { role: 'user' }, content: { content_type: 'text', parts: [text] } }] } } };
    document.querySelector('[data-testid="stop-button"]').onclick = event => { window.stopClicks++; event.currentTarget.remove(); };
    window.newHumanTurn = () => section.__reactFiber$fixture.memoizedProps.turn.messages.push({ id: 'new-human-user', author: { role: 'user' }, content: { content_type: 'text', parts: ['human question'] } });
  }, { binding, receipt, text: operation.text });
  const config = { ...browserWire, chatgptOrigin: origin }, scope = { leaseId: binding.leaseId, epoch: binding.epoch, tabId: binding.tabId, conversationId: binding.conversationId };
  const projected = { id: stop.id, phase: stop.phase, scope, target: { id: operation.id, text: operation.text, baselineUserIds: [], receipt, scope, outcome: 'uncertain' } };
  const prepare = () => page.evaluate(({ projected, config }) => window[config.deliveryGlobal].prepareStop(projected, config), { projected, config });
  assert.equal((await prepare()).ready, true);
  await page.evaluate(() => window.newHumanTurn()); assert.equal((await prepare()).ready, false);
  await page.evaluate(() => document.querySelector('section').__reactFiber$fixture.memoizedProps.turn.messages.pop());
  assert.equal(await store.authorizeStop(stop.id, binding, (await prepare()).receipt), true);
  const clicked = await page.evaluate(({ projected, config }) => window[config.deliveryGlobal].stop(projected, config), { projected, config });
  assert.equal(clicked.confirmed, false, 'a disappearing Stop control is not a native terminal receipt');
  await page.evaluate(() => document.querySelector('section').__reactFiber$fixture.memoizedProps.turn.messages.push({
    id: 'native-stopped-final', author: { role: 'assistant' }, channel: 'final', end_turn: true, status: 'finished_successfully',
    content: { content_type: 'text', parts: ['partial public reply ended by Stop'] },
  }));
  assert.equal((await prepare()).finished, true);
  await page.evaluate(({ projected, config }) => window[config.deliveryGlobal].stop(projected, config), { projected, config });
  assert.equal(await page.evaluate(() => window.stopClicks), 1);
  assert.equal(page.isClosed(), false);
});

test('native ToolHost Stop terminates its real background command and waits for its final job state', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-stop-command-'));
  const state = { activatedTools: new Set() };
  const host = new ToolHost({ context: { cwd: directory, workspacePath: directory, state, config: { autoApprove: true }, allowedTools: new Set(['run_command']) } });
  t.after(async () => { for (const job of state.jobs?.values() ?? []) if (!job.done) await killTree(job.child); fs.rmSync(directory, { recursive: true, force: true }); });
  const quote = value => process.platform === 'win32' ? "'" + value.replaceAll("'", "''") + "'" : "'" + value.replaceAll("'", "'\\''") + "'";
  const command = (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' -e ' + quote("process.stdout.write('owned command started'); setInterval(() => {}, 1000)");
  await host.execute({ id: 'owned-long-command', name: 'run_command', arguments: { command, background: true } }, { surface: 'core' });
  const job = [...state.jobs.values()][0];
  assert.ok(job && !job.done);
  await host.cancel(); await waitForExit(job, 1000);
  assert.equal(job.done, true, 'Stop must await owned command termination, even after run_command returned its job ID');
  assert.equal(job.stopped, true);
});
