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
import { executeBoundSend, executeBoundStop } from '../../desktop/chatgpt-companion/commands.mjs';

const conversationId = crypto.randomUUID(), userMessageId = crypto.randomUUID(), turnId = crypto.randomUUID();
const binding = { leaseId: 'browser-fixture-lease', epoch: 'browser-fixture-epoch', tabId: 1, conversationId,
  browserId: 'browser-fixture', threadId: 'host-fixture', workspacePath: 'host-only' };
const fixtureOrigin = 'http://ankita-fixture.local';
const config = { ...browserWire, chatgptOrigin: fixtureOrigin };
const installedApps = [{ name: 'ANKITA Core', system_hint: 'plugin:asdk_app_fixture_core' }, { name: 'ANKITA Desktop', system_hint: 'connector:asdk_app_fixture_desktop' }]; // Test-only native app catalogue.
async function fixture(t, { busy = false, draft = '', loseAck = false, shell = false, search = false, delayedControl = false, appNames = [], apps = installedApps, opening = false,
  question = 'unique browser question', storageEscapePasses = 0, storedQuestion } = {}) {
  const ownerBinding = opening ? { ...binding, conversationId: null, openingId: crypto.randomUUID() } : binding;
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route(`${fixtureOrigin}/**`, route => route.request().url().includes('/backend-api/system_hints') ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ system_hints: apps }) }) : route.fulfill({ contentType: 'text/html', body:
    `<form><div contenteditable="true" id="prompt-textarea">${draft}</div><button type="button" data-testid="send-button">Send</button>${busy ? '<button type="button" data-testid="stop-button">Stop</button>' : ''}</form>` }));
  await page.goto(opening ? `${fixtureOrigin}/#${config.openingFragmentKey}=${ownerBinding.openingId}` : `${fixtureOrigin}/c/${conversationId}`);
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/readers.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/app-mentions.js', import.meta.url)) });
  await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/delivery.js', import.meta.url)) });
  await page.evaluate(() => fetch('/backend-api/system_hints?mode=plugins'));
  await page.waitForFunction(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).reason !== 'apps-unobserved');
  await page.evaluate(({ conversationId, userMessageId, turnId, assistantMessageId, shell, search, delayedControl, opening, storageEscapePasses, storedQuestion }) => {
    window.sentCount = 0;
    if (delayedControl) {
      const button = document.querySelector('[data-testid="send-button"]'); button.disabled = true;
      document.querySelector('#prompt-textarea').addEventListener('input', () => setTimeout(() => { button.disabled = false; }, 80));
    }
    document.querySelector('[data-testid="send-button"]').onclick = () => {
      window.sentCount++;
      if (opening) history.replaceState(null, '', '/c/' + conversationId);
      const box = document.querySelector('#prompt-textarea');
      const tags = [...box.querySelectorAll('[app-mention-path]')];
      window.sentMentions = tags.map(node => node.getAttribute('app-mention-display-name'));
      const text = window.AnkitaAppMentions.plainText(box).trimEnd() + tags.map(node => ` [${node.getAttribute('data-prompt-link-label')}](${node.getAttribute('app-mention-path')})`).join('');
      let storedText = text;
      // Measured native storage behavior: a literal backslash is serialized as two backslashes.
      for (let pass = 0; pass < storageEscapePasses; pass++) storedText = storedText.replaceAll('\\', '\\\\');
      const user = { id: userMessageId, author: { role: 'user' }, content: { content_type: 'text', parts: [storedQuestion ?? storedText] } };
      const interim = { id: assistantMessageId, author: { role: 'assistant' }, channel: 'commentary', content: { content_type: 'text', parts: ['interim commentary'] }, end_turn: false, status: 'in_progress' };
      const section = document.createElement('section'); section.dataset.testid = 'conversation-turn-fixture'; section.dataset.turnId = turnId;
      section.textContent = user.content.parts[0]; section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: { messages: [user, interim] } } };
      if (shell || search) {
        const entry = { id: turnId, turn: { status: 'running', items: [
          { type: 'user-message', messageId: userMessageId, serverMessageId: userMessageId, message: user.content.parts[0] },
          { type: 'chatgpt-reasoning-group', items: [{ type: 'assistant-message', phase: 'final_answer', content: 'private nested working text', completed: true }] },
          { type: 'assistant-message', messageId: assistantMessageId, phase: 'final_answer', completed: false, content: 'partial public answer' },
        ] } };
        section.__reactFiber$fixture = { memoizedProps: { conversationId, entry } };
        if (search) {
          delete section.dataset.testid; delete section.dataset.turnId;
          section.dataset.chatgptSearchUnitKey = `${turnId}:user`;
          section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: entry.turn } };
        }
      }
      document.querySelector('form').before(section); document.querySelector('#prompt-textarea').textContent = '';
      window.finishFixture = () => {
        interim.channel = 'final'; interim.end_turn = true; interim.status = 'finished_successfully'; interim.content.parts = ['unique final answer'];
        const entry = section.__reactFiber$fixture.memoizedProps.entry;
        if (entry) { entry.turn.status = 'complete'; entry.turn.items.at(-1).completed = true; entry.turn.items.at(-1).content = 'unique shell final answer'; }
        const searchTurn = section.__reactFiber$fixture.memoizedProps.turn;
        if (searchTurn?.items) {
          searchTurn.status = 'complete';
          const answer = searchTurn.items.at(-1); answer.completed = true; answer.content = '::chatgpt-content-reference{index=0}';
          answer.contentReferences = [{ type: 'dil', source_message_id: assistantMessageId,
            model_dil_v2: { fallbackMarkdown: 'unique search\\-unit final answer' } }];
        }
      };
    };
  }, { conversationId, userMessageId, turnId, assistantMessageId: crypto.randomUUID(), shell, search, delayedControl, opening, storageEscapePasses, storedQuestion });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-browser-send-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  const operation = { id: crypto.randomUUID(), binding: ownerBinding, kind: 'send', text: question, ...(appNames.length ? { appNames } : {}) };
  await delivery.enqueue(operation); const offered = await delivery.poll(ownerBinding);
  const chromeApi = { tabs: { get: async () => ({ url: page.url() }) }, scripting: { executeScript: async request => {
    const result = await page.evaluate(({ source, args }) => (0, eval)(`(${source})`)(...args), { source: request.func.toString(), args: request.args });
    return [{ result }];
  } } };
  const authorize = async (id, witness) => delivery.authorize(id, ownerBinding, witness);
  const acknowledge = async receipt => { if (loseAck) throw new Error('lost acknowledgement'); return delivery.receipt(operation.id, { ...ownerBinding, conversationId: receipt.conversationId }, receipt); };
  const run = () => executeBoundSend(chromeApi, offered, { config, authorize, acknowledge });
  const snapshot = () => page.evaluate(({ binding, config }) => window[config.deliveryGlobal].snapshot(binding, config), { binding: ownerBinding, config });
  return { page, run, snapshot, delivery, store, operation, directory, chromeApi };
}

test('app-owned receipts accept one native storage-escape pass and preserve literal backslashes', async t => {
  const question = 'Print C:\\temp\\check and \\"quoted\\" literally';
  for (const storageEscapePasses of [0, 1, 2]) {
    const { page, run, snapshot, store, operation } = await fixture(t, { question, storageEscapePasses, appNames: ['ANKITA Core'] });
    assert.equal((await run()).dispatched, true);
    const observed = await snapshot();
    assert.equal(Boolean(observed?.receipt), storageEscapePasses < 2, 'one measured storage pass is allowed; repeated decoding must not guess a different question');
    assert.equal((await store.get(operation.id)).text, question, 'authored operation text remains immutable');
    if (observed?.receipt) {
      await page.evaluate(() => window.finishFixture());
      assert.equal((await snapshot())?.answer.text, 'unique final answer', 'the exact new question can import its completed reply');
    }
    await run();
    assert.equal(await page.evaluate(() => window.sentCount), 1, 'read-back cannot repeat Send');
  }
});

test('native storage punctuation, hard breaks and leading spaces reconcile only the exact authored question', async t => {
  const cases = [
    { question: 'Keep **this** and [link] literal', storedQuestion: 'Keep \\*\\*this\\*\\* and \\[link\\] literal', accepted: true },
    { question: 'First\nSecond', storedQuestion: 'First' + '\\' + '\nSecond', accepted: true },
    { question: 'Head\n indented', storedQuestion: 'Head\n&#x20;indented', accepted: true },
    { question: 'Keep &#x20; literal', storedQuestion: 'Keep &#x20; literal', accepted: true },
    { question: 'Read C:\\temp\\one', storedQuestion: 'Read C:\\\\temp\\\\two', accepted: false },
  ];
  for (const sample of cases) {
    const { page, run, snapshot, store, operation } = await fixture(t, sample);
    assert.equal((await run()).dispatched, true);
    assert.equal(Boolean((await snapshot())?.receipt), sample.accepted, sample.question);
    assert.equal((await store.get(operation.id)).text, sample.question);
    if (sample.accepted) {
      await page.evaluate(() => window.finishFixture());
      assert.equal((await snapshot())?.answer.text, 'unique final answer');
    }
    await run();
    assert.equal(await page.evaluate(() => window.sentCount), 1);
  }
});

test('an owned blank page clicks once and observes its first real conversation from the exact new question', async t => {
  const { page, run, snapshot } = await fixture(t, { opening: true });
  assert.equal((await run()).dispatched, true);
  assert.equal((await snapshot())?.receipt.conversationId, conversationId);
  await run(); assert.equal(await page.evaluate(() => window.sentCount), 1);
});

test('a tagged Send with lost ACK can reload and stop its owned generation once', async t => {
  const { page, run, delivery, store, operation, chromeApi } = await fixture(t, { appNames: ['ANKITA Core'], loseAck: true });
  await run();
  const persisted = await page.evaluate(() => {
    const section = document.querySelector('section');
    return { turnId: section.dataset.turnId, messages: section.__reactFiber$fixture.memoizedProps.turn.messages };
  });
  assert.equal((await store.get(operation.id)).receipt, undefined, 'simulate a lost host acknowledgement');
  await page.reload();
  for (const file of ['readers.js', 'app-mentions.js', 'delivery.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/' + file, import.meta.url)) });
  await page.evaluate(({ persisted, conversationId }) => {
    const section = document.createElement('section'); section.dataset.testid = 'conversation-turn-fixture'; section.dataset.turnId = persisted.turnId;
    section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: { messages: persisted.messages } } };
    document.querySelector('form').before(section);
    const stop = document.createElement('button'); stop.type = 'button'; stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop';
    window.stopClicks = 0;
    stop.onclick = () => {
      window.stopClicks++; stop.remove();
      const final = persisted.messages.at(-1); final.channel = 'final'; final.end_turn = true; final.status = 'finished_successfully';
    };
    document.querySelector('form').append(stop);
  }, { persisted, conversationId });
  await delivery.stop(binding);
  const command = await store.stopCommand(binding);
  const options = { config, authorize: (id, receipt) => store.authorizeStop(id, binding, receipt), acknowledge: receipt => delivery.observeStop(command.id, binding, { receipt, confirmed: true }) };
  await executeBoundStop(chromeApi, command, options);
  assert.equal(await page.evaluate(() => window.stopClicks), 1);
  await executeBoundStop(chromeApi, await store.stopCommand(binding), options);
  assert.equal(await page.evaluate(() => window.stopClicks), 1);
  assert.equal((await store.stopCommand(binding)).phase, 'confirmed');
});

test('connected apps are native tags before the one Send and their inline links do not break the exact receipt', async t => {
  const appNames = ['ANKITA Core', 'ANKITA Desktop'];
  const { page, run, snapshot, store, operation } = await fixture(t, { appNames });
  assert.equal((await run()).dispatched, true);
  const observed = await snapshot();
  assert.equal(observed?.receipt.userMessageId, userMessageId);
  assert.deepEqual(await page.evaluate(() => window.sentMentions ?? []), appNames);
  assert.deepEqual((await store.get(operation.id)).appNames, appNames, 'the approved app selection survives the durable operation ledger');
  await run();
  assert.equal(await page.evaluate(() => window.sentCount), 1);
});

test('missing and duplicate app names refuse before Send without editing a human draft or choosing another app', async t => {
  for (const options of [
    { appNames: ['Missing ANKITA'], reason: 'app-not-found' },
    { appNames: ['ANKITA Core'], apps: [...installedApps, { name: 'ANKITA Core', system_hint: 'plugin:asdk_app_other_install' }], reason: 'app-name-ambiguous' },
    { appNames: ['ANKITA Core'], draft: 'Keep my draft', reason: 'draft-unavailable' },
  ]) {
    const { page, run } = await fixture(t, options);
    const result = await run();
    assert.equal(result.dispatched, false);
    assert.equal(result.reason, options.reason);
    assert.equal(await page.evaluate(() => window.sentCount), 0);
    assert.equal(await page.locator('#prompt-textarea').innerText(), options.draft ?? '');
  }
});

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

test('native search-unit Send reads its own widget answer into the durable final after one click', async t => {
  const { page, run, snapshot, delivery, operation, store } = await fixture(t, { search: true });
  assert.equal((await run()).dispatched, true);
  const initial = await snapshot();
  assert.equal(initial.receipt.userMessageId, userMessageId);
  assert.equal(initial.answer, null);
  await page.evaluate(() => window.finishFixture());
  const final = await snapshot();
  assert.equal(final.answer.text, 'unique search-unit final answer');
  assert.equal(JSON.stringify(final).includes('private nested'), false);
  assert.equal(await delivery.observe(operation.id, binding, final.answer), true);
  assert.equal((await store.get(operation.id)).completion.text, final.answer.text);
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
