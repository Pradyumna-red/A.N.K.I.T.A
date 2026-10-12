import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';
import { executeBoundSend } from '../../desktop/chatgpt-companion/commands.mjs';

const conversationId = crypto.randomUUID(), userMessageId = crypto.randomUUID(), turnId = crypto.randomUUID();
const binding = { leaseId: 'browser-fixture-lease', epoch: 'browser-fixture-epoch', tabId: 1, conversationId,
  browserId: 'browser-fixture', threadId: 'host-fixture', workspacePath: 'host-only' };
const fixtureOrigin = 'http://ankita-fixture.local';
const config = { ...browserWire, chatgptOrigin: fixtureOrigin };
async function fixture(t, { busy = false, draft = '', loseAck = false, shell = false, delayedControl = false } = {}) {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route(`${fixtureOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body:
    `<form><div contenteditable="true" id="prompt-textarea">${draft}</div><button type="button" data-testid="send-button">Send</button>${busy ? '<button type="button" data-testid="stop-button">Stop</button>' : ''}</form>` }));
  await page.goto(`${fixtureOrigin}/c/${conversationId}`);
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/readers.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/delivery.js', import.meta.url)) });
  await page.evaluate(({ conversationId, userMessageId, turnId, assistantMessageId, shell, delayedControl }) => {
    window.sentCount = 0;
    if (delayedControl) {
      const button = document.querySelector('[data-testid="send-button"]'); button.disabled = true;
      document.querySelector('#prompt-textarea').addEventListener('input', () => setTimeout(() => { button.disabled = false; }, 80));
    }
    document.querySelector('[data-testid="send-button"]').onclick = () => {
      window.sentCount++;
      const user = { id: userMessageId, author: { role: 'user' }, content: { content_type: 'text', parts: [document.querySelector('#prompt-textarea').innerText] } };
      const interim = { id: assistantMessageId, author: { role: 'assistant' }, channel: 'commentary', content: { content_type: 'text', parts: ['interim commentary'] }, end_turn: false, status: 'in_progress' };
      const section = document.createElement('section'); section.dataset.testid = 'conversation-turn-fixture'; section.dataset.turnId = turnId;
      section.textContent = user.content.parts[0]; section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: { messages: [user, interim] } } };
      if (shell) {
        const entry = { id: turnId, turn: { status: 'running', items: [
          { type: 'user-message', messageId: userMessageId, serverMessageId: userMessageId, message: user.content.parts[0] },
          { type: 'chatgpt-reasoning-group', items: [{ type: 'assistant-message', phase: 'final_answer', content: 'private nested working text', completed: true }] },
          { type: 'assistant-message', messageId: assistantMessageId, phase: 'final_answer', completed: false, content: 'partial public answer' },
        ] } };
        section.__reactFiber$fixture = { memoizedProps: { conversationId, entry } };
      }
      document.querySelector('form').before(section); document.querySelector('#prompt-textarea').textContent = '';
      window.finishFixture = () => {
        interim.channel = 'final'; interim.end_turn = true; interim.status = 'finished_successfully'; interim.content.parts = ['unique final answer'];
        const entry = section.__reactFiber$fixture.memoizedProps.entry;
        if (entry) { entry.turn.status = 'complete'; entry.turn.items.at(-1).completed = true; entry.turn.items.at(-1).content = 'unique shell final answer'; }
      };
    };
  }, { conversationId, userMessageId, turnId, assistantMessageId: crypto.randomUUID(), shell, delayedControl });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-browser-send-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  const operation = { id: crypto.randomUUID(), binding, kind: 'send', text: 'unique browser question' };
  await delivery.enqueue(operation); const offered = await delivery.poll(binding);
  const chromeApi = { tabs: { get: async () => ({ url: `${browserWire.chatgptOrigin}/c/${conversationId}` }) }, scripting: { executeScript: async request => {
    const result = await page.evaluate(({ source, args }) => (0, eval)(`(${source})`)(...args), { source: request.func.toString(), args: request.args });
    return [{ result }];
  } } };
  const authorize = async (id, witness) => delivery.authorize(id, binding, witness);
  const acknowledge = async receipt => { if (loseAck) throw new Error('lost acknowledgement'); return delivery.receipt(operation.id, binding, receipt); };
  const run = () => executeBoundSend(chromeApi, offered, { config, authorize, acknowledge });
  const snapshot = () => page.evaluate(({ binding, config }) => window[config.deliveryGlobal].snapshot(binding, config), { binding, config });
  return { page, run, snapshot, delivery, store, operation, directory };
}

test('real browser sends once, reads the native accepted user, and requires an exact terminal final', async t => {
  const { page, run, snapshot, store, operation, delivery } = await fixture(t);
  const dispatched = await run();
  assert.equal(dispatched.dispatched, true, JSON.stringify(dispatched));
  const observed = await snapshot();
  assert.ok(observed, 'native user receipt should appear after the one Send click');
  assert.deepEqual(observed.receipt, { conversationId, userMessageId, turnId });
  assert.equal(observed.answer, null, 'commentary is not an answer');
  await delivery.receipt(operation.id, binding, observed.receipt);
  await page.evaluate(() => window.finishFixture());
  const final = await snapshot();
  assert.equal(await delivery.observe(operation.id, binding, final.answer), true);
  assert.equal((await store.get(operation.id)).completion.text, 'unique final answer');
  await run(); assert.equal(await page.evaluate(() => window.sentCount), 1);
});

test('an existing human draft or busy generation refuses Send without replacing the draft', async t => {
  for (const options of [{ draft: 'human draft' }, { busy: true }]) {
    const { page, run } = await fixture(t, options);
    await run(); assert.equal(await page.evaluate(() => window.sentCount), 0);
    assert.equal(await page.locator('#prompt-textarea').innerText(), options.draft ?? '');
  }
});

test('native typed shell and delayed React control readiness deliver one exact final without private working text', async t => {
  const { page, run, snapshot, delivery, operation, store } = await fixture(t, { shell: true, delayedControl: true });
  assert.equal((await run()).dispatched, true);
  const observed = await snapshot();
  assert.equal(observed.receipt.userMessageId, userMessageId);
  assert.equal(observed.answer, null);
  await page.evaluate(() => window.finishFixture());
  const final = await snapshot();
  assert.equal(JSON.stringify(final).includes('private nested'), false);
  await delivery.observe(operation.id, binding, final.answer);
  assert.equal((await store.get(operation.id)).completion.text, 'unique shell final answer');
  assert.equal(await page.evaluate(() => window.sentCount), 1);
});

test('lost acknowledgement and restart cannot click again; the exact native row can reconcile the spent operation', async t => {
  const { page, run, snapshot, store, operation, directory } = await fixture(t, { loseAck: true });
  await run();
  const restored = new BrowserDelivery({ store: new BrowserOperationStore({ directory }) }); await restored.recover(binding);
  assert.equal(await restored.poll(binding), null);
  await run(); assert.equal(await page.evaluate(() => window.sentCount), 1);
  const observed = await snapshot(); await restored.receipt(operation.id, binding, observed.receipt);
  assert.equal((await store.get(operation.id)).outcome, 'accepted');
});

test('a reloaded page resumes exact receipt observation while receiving no permission to repeat Send', async t => {
  const { page, run, store, operation, delivery } = await fixture(t);
  await run();
  const persisted = await page.evaluate(() => {
    const section = document.querySelector('section');
    return { turnId: section.dataset.turnId, messages: section.__reactFiber$fixture.memoizedProps.turn.messages };
  });
  assert.equal((await store.get(operation.id)).outcome, 'accepted');
  await page.reload();
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/readers.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/delivery.js', import.meta.url)) });
  await page.evaluate(({ persisted, conversationId }) => {
    const section = document.createElement('section'); section.dataset.testid = 'conversation-turn-fixture'; section.dataset.turnId = persisted.turnId;
    section.textContent = 'persisted native question'; section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: { messages: persisted.messages } } };
    document.querySelector('form').before(section);
    const final = persisted.messages.at(-1); final.channel = 'final'; final.end_turn = true; final.status = 'finished_successfully'; final.content.parts = ['final after reload'];
  }, { persisted, conversationId });
  const readback = await delivery.readback(binding);
  const observed = await page.evaluate(({ operation, config }) => {
    window[config.deliveryGlobal].watch(operation, config);
    return window[config.deliveryGlobal].snapshot(operation.scope, config);
  }, { operation: { ...readback, binding: undefined, scope: { leaseId: binding.leaseId, epoch: binding.epoch, tabId: binding.tabId, conversationId } }, config });
  assert.equal(await delivery.observe(operation.id, binding, observed.answer), true);
  assert.equal((await store.get(operation.id)).completion.text, 'final after reload');
  assert.equal(await delivery.authorize(operation.id, binding), false);
  assert.equal(await page.locator('section').count(), 1);
});
