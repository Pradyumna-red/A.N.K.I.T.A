import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';

const FIXTURE_MS = 15_000; // Milliseconds/real extension fixture phase; not production timeout or a Send retry.
const SAMPLE_MS = 50; // Milliseconds/read-only test sampling.
async function waitFor(predicate, timeoutMs = FIXTURE_MS) {
  const until = Date.now() + timeoutMs;
  while (!await predicate()) { if (Date.now() >= until) throw new Error('Real companion did not reach the expected fixture state'); await new Promise(resolve => setTimeout(resolve, SAMPLE_MS)); }
}
test('real MV3 companion discovers ANKITA and delivers a first chat without a pairing link', { timeout: FIXTURE_MS * 6 }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-external-native-'));
  const openingId = crypto.randomUUID(), conversationId = crypto.randomUUID(), userId = crypto.randomUUID(), turnId = crypto.randomUUID();
  const expected = 'Real companion final ' + crypto.randomUUID();
  const store = new BrowserOperationStore({ directory }), delivery = new BrowserDelivery({ store });
  const key = crypto.randomUUID();
  let context, connected;
  t.after(async () => { await context?.close(); await connected?.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  connected = await createCompanionBridge({ config: { workspacePath: directory, threadId: 'owner', modelMode: 'current', autoConnect: true, discoveryPorts: [0],
    openingId, targetUrl: `https://chatgpt.com/#ankita-opening=${openingId}` }, secrets: { withSecret: async (_, use) => use(key) }, delivery });
  const extension = path.join(directory, 'companion');
  fs.cpSync(fileURLToPath(new URL('../../desktop/chatgpt-companion', import.meta.url)), extension, { recursive: true });
  fs.writeFileSync(path.join(extension, 'wire.mjs'), 'export const wire = ' + JSON.stringify({ ...browserWire,
    discoveryPorts: [Number(new URL(connected.address).port)] }) + ';\n'); // Fixture-owned ephemeral port: never discover a user's running ANKITA or compete with its handoff.
  context = await chromium.launchPersistentContext(path.join(directory, 'browser'), { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const fulfill = route => route.fulfill({ contentType: 'text/html', body: `<form><div id="prompt-textarea" contenteditable="true"></div><button type="button" data-testid="send-button">Send</button></form><script>
    window.sends=0; document.querySelector('button').onclick=()=>{window.sends++;
      const text=document.querySelector('#prompt-textarea').innerText;history.replaceState(null,'','/c/'+${JSON.stringify(conversationId)});
      const section=document.createElement('section');section.dataset.testid='conversation-turn-fixture';section.dataset.turnId=${JSON.stringify(turnId)};
      section.textContent=text;section.__reactFiber$fixture={memoizedProps:{conversationId:${JSON.stringify(conversationId)},turn:{messages:[
        {id:${JSON.stringify(userId)},author:{role:'user'},content:{content_type:'text',parts:[text]}},
        {id:'native-final',author:{role:'assistant'},channel:'final',end_turn:true,status:'finished_successfully',content:{content_type:'text',parts:[${JSON.stringify(expected)}]}}
      ]}}};document.querySelector('form').before(section);document.querySelector('#prompt-textarea').textContent='';};</script>` });
  await context.route('https://chatgpt.com/**', fulfill);
  await waitFor(() => context.pages().some(page => page.url().startsWith('https://chatgpt.com/')));
  const owned = context.pages().find(page => page.url().startsWith('https://chatgpt.com/'));
  // Extension-created popups can navigate before Playwright attaches its route.
  // Install the local fixture on that exact existing page; no real account is used.
  await owned.route('https://chatgpt.com/**', fulfill); await owned.reload();
  try { await waitFor(() => connected.view().status === 'ready'); }
  catch (error) { console.log('EXTERNAL_NATIVE_SETUP', JSON.stringify({ status: connected.view().status, reason: connected.view().observationReason, workers: context.serviceWorkers().length,
    pages: await Promise.all(context.pages().map(async page => ({ origin: new URL(page.url()).origin, dom: await page.evaluate(() => ({
      editor: Boolean(document.querySelector('#prompt-textarea')), reader: typeof window.AnkitaPageReaders, visible: document.visibilityState,
      composer: Boolean(window.AnkitaPageReaders?.composer()), opening: location.hash.includes('ankita-opening') })) }))) })); throw error; }
  const runtime = new ChatGptRuntime({ bridge: connected, delivery, store }); delivery.onEvent = event => runtime.deliveryEvent(event);
  const sending = runtime.send({ threadId: 'owner', text: 'Real extension first question' }); void sending.catch(() => {});
  let result; void sending.then(value => { result = value; });
  await waitFor(() => result);
  assert.equal(result.text, expected);
  const page = context.pages().find(page => page.url().includes(conversationId)); assert.ok(page);
  assert.equal(await page.evaluate(() => window.sends), 1);
  console.log('EXTERNAL_NATIVE_CHAT', JSON.stringify({ realExtension: true, automaticConnection: true, sends: 1, firstReplyMatched: true, hostedChatGpt: false }));
  const worker = context.serviceWorkers()[0];
  assert.ok(worker, 'the real MV3 worker owns the browser connection');
  const alarm = await worker.evaluate(async () => (await chrome.alarms.getAll())[0]);
  assert.ok(alarm?.periodInMinutes, 'the browser must own a persistent wake alarm');
  const debugging = await context.newCDPSession(page);
  const versions = new Map();
  debugging.on('ServiceWorker.workerVersionUpdated', event => { for (const version of event.versions) versions.set(version.versionId, version); });
  await debugging.send('ServiceWorker.enable');
  await waitFor(() => [...versions.values()].some(version => version.scriptURL === worker.url()));
  const workerVersion = [...versions.values()].find(version => version.scriptURL === worker.url());
  const stoppedAt = Date.now();
  await debugging.send('ServiceWorker.stopWorker', { versionId: workerVersion.versionId });
  await waitFor(() => versions.get(workerVersion.versionId)?.runningStatus === 'stopped');
  await waitFor(() => versions.get(workerVersion.versionId)?.runningStatus === 'running' && connected.view().status === 'ready' && connected.view().observedAt > stoppedAt, FIXTURE_MS * 4);
  assert.equal(await page.evaluate(() => window.sends), 1, 'waking may observe the settled operation, never resend it');
  console.log('EXTERNAL_NATIVE_WAKE', JSON.stringify({ realExtension: true, workerStopped: true, alarmRevivedWorker: true, sends: 1, hostedChatGpt: false }));
  await debugging.detach();
});
