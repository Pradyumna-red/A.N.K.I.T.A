import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron, chromium } from 'playwright';
import { DesktopSettingsStore } from '../desktop/electron/settings.mjs';
import { CHATGPT_BROWSER_PROVIDER, CHATGPT_CONNECTION_ACTIONS } from '../desktop/shared/chatgpt-browser.mjs';
import { browserWire, ROUTES, COMPANION_VERSION } from '../services/chatgpt-bridge/config.mjs';
import { readSelectedPage } from '../desktop/chatgpt-companion/content.mjs';
import { executeBoundSend, executeBoundStop } from '../desktop/chatgpt-companion/commands.mjs';
import { CREDENTIAL_STORE_FILENAME } from '../src/integrations/browser-credentials.mjs';

// Actual Electron + isolated native-DOM browser fixture. No account/profile/permission UI is used.
const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url))); // Canonical launch argument without a Windows trailing separator.
const TIMEOUT_MS = 30_000; // Milliseconds/owned desktop fixture; expiry cannot prove a reply.
const POLL_MS = 50; // Milliseconds/fixture transport pump, not production polling or a Send retry.
const executableArgument = process.argv.indexOf('--executable');
const packagedExecutable = executableArgument < 0 ? null : fs.realpathSync(process.argv[executableArgument + 1]); // Caller selects its owned packaged artifact, never a user app.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-chatgpt-desktop-'));
const configDir = path.join(directory, 'config'); fs.mkdirSync(configDir);
const question = 'Unique desktop browser question ' + randomUUID();
const expected = 'Unique desktop browser answer ' + randomUUID();
const conversationId = randomUUID(), userId = randomUUID(), answerId = randomUUID(), turnId = randomUUID();
const browserId = randomUUID(), extensionId = 'a'.repeat(32);
const fixtureOrigin = 'http://ankita-desktop-fixture.local';
new DesktopSettingsStore(path.join(configDir, 'desktop-settings.json')).update({ provider: CHATGPT_BROWSER_PROVIDER, profileSetupDone: true });
fs.writeFileSync(path.join(configDir, 'mcp.json'), JSON.stringify({ servers: [] }));
fs.writeFileSync(path.join(configDir, 'config.env'), 'PROVIDER=chatgpt-browser\nMEMORY_CONSOLIDATION=0\n');
let application, browser;
try {
  const env = { ...process.env, CONFIG_DIR: configDir, PROVIDER: CHATGPT_BROWSER_PROVIDER, API_BASE: '', API_KEY: '', MODEL: '',
    TOOL_PROVIDER: '', TOOL_MODEL: '', TOOL_API_BASE: '', TOOL_API_KEY: '', GROQ_API_KEY: '', KILO_API_KEY: '', COMPOSIO_API_KEY: '' };
  delete env.ELECTRON_RUN_AS_NODE; delete env.ANKITA_DESKTOP_DEV_URL;
  const launch = () => _electron.launch({ executablePath: packagedExecutable ?? createRequire(import.meta.url)('electron'),
    args: [...(packagedExecutable ? [] : [ROOT]), `--user-data-dir=${path.join(directory, 'user-data')}`], cwd: configDir, env, timeout: TIMEOUT_MS });
  application = await launch();
  let desktop = await application.firstWindow(); desktop.setDefaultTimeout(TIMEOUT_MS);
  const errors = []; desktop.on('pageerror', error => errors.push(error.message));
  await desktop.waitForFunction(() => Boolean(window.ankita));
  const initialized = await desktop.evaluate(() => window.ankita.invoke('initialize'));
  assert.equal(initialized.settings.provider, CHATGPT_BROWSER_PROVIDER); assert.deepEqual(initialized.models, []);
  const owner = initialized.teammates[0]; assert.ok(owner);
  const setup = await desktop.evaluate(({ action, threadId }) => window.ankita.invoke(action, { threadId }), { action: CHATGPT_CONNECTION_ACTIONS.start, threadId: owner.id });
  const local = new URL(setup.pairingUrl);
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${local.hash.slice(1)}`, Origin: `chrome-extension://${extensionId}` };
  const post = async (route, input) => {
    const response = await fetch(local.origin + route, { method: 'POST', headers, body: JSON.stringify(input) });
    assert.equal(response.status, 200); return response.json();
  };
  await post(ROUTES.pair, { extensionId, browserId, version: COMPANION_VERSION });
  await post(ROUTES.tabs, { browserId, tabs: [{ id: 1, url: `${browserWire.chatgptOrigin}/c/${conversationId}`, title: 'Owned fixture conversation' }] });
  const binding = await post(ROUTES.bind, { browserId, tabId: 1, conversationId });
  browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  await page.route(`${fixtureOrigin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<form><div id="prompt-textarea" contenteditable="true"></div><input type="file" multiple><div data-composer-attachments></div><button type="button" data-testid="send-button">Send</button></form>' }));
  await page.goto(`${fixtureOrigin}/c/${conversationId}`);
  for (const file of ['readers.js', 'request-origins.js', 'delivery.js']) await page.addScriptTag({ path: path.join(ROOT, 'desktop/chatgpt-companion/upstream', file) });
  await page.evaluate(({ conversationId, userId, answerId, turnId, expected }) => {
    window.sentCount = 0;
    window.stopCount = 0; window.uploadCount = 0;
    document.querySelector('input[type="file"]').onchange = event => {
      window.uploadCount++; const host = document.querySelector('[data-composer-attachments]');
      for (const file of event.target.files) { const tile = document.createElement('button'); tile.type = 'button'; tile.setAttribute('aria-label', 'Remove file: ' + file.name); host.append(tile); }
    };
    document.querySelector('[data-testid="send-button"]').onclick = () => {
      window.sentCount++;
      const ids = window.nextNativeIds ?? { userId, answerId, turnId, expected };
      const user = { id: ids.userId, author: { role: 'user' }, content: { content_type: 'text', parts: [document.querySelector('#prompt-textarea').innerText] } };
      const answer = { id: ids.answerId, author: { role: 'assistant' }, channel: 'final', end_turn: false, status: 'in_progress', content: { content_type: 'text', parts: ['Public partial'] } };
      const section = document.createElement('section'); section.dataset.testid = 'conversation-turn-fixture'; section.dataset.turnId = ids.turnId;
      section.textContent = user.content.parts[0]; section.__reactFiber$fixture = { memoizedProps: { conversationId, turn: { messages: [user, answer] } } };
      document.querySelector('form').before(section); document.querySelector('#prompt-textarea').textContent = '';
      document.querySelector('[data-composer-attachments]').replaceChildren(); document.querySelector('input[type="file"]').value = '';
      const finish = () => { answer.content.parts = [ids.expected]; answer.end_turn = true; answer.status = 'finished_successfully'; document.querySelector('[data-testid="stop-button"]')?.remove(); };
      window.finishOwnedTurn = finish;
      if (!window.holdNext) setTimeout(finish, 150);
      else { const stop = document.createElement('button'); stop.type = 'button'; stop.dataset.testid = 'stop-button'; stop.textContent = 'Stop'; stop.onclick = () => { window.stopCount++; finish(); }; document.querySelector('form').append(stop); }
    };
  }, { conversationId, userId, answerId, turnId, expected });
  const config = { ...browserWire, chatgptOrigin: fixtureOrigin };
  const read = readback => page.evaluate(({ source, binding, config, readback }) => (0, eval)(`(${source})`)(binding.conversationId, config, binding, readback), { source: readSelectedPage.toString(), binding, config, readback });
  const observe = async command => {
    const projected = command.readback ? { ...command.readback, binding: undefined,
      scope: { leaseId: binding.leaseId, epoch: binding.epoch, tabId: binding.tabId, conversationId } } : null;
    await post(ROUTES.observe, { binding, nonce: command.nonce, snapshot: await read(projected) });
  };
  const poll = async () => (await fetch(local.origin + ROUTES.poll, { headers })).json();
  await observe(await poll());
  await desktop.evaluate(() => {
    window.fixtureEvents = []; window.ankita.onEvent(event => window.fixtureEvents.push(event));
  });
  await desktop.evaluate(({ id, text }) => window.ankita.invoke('send', { id, text }), { id: owner.id, text: question });
  const chromeApi = { tabs: { get: async () => ({ url: `${browserWire.chatgptOrigin}/c/${conversationId}` }) }, scripting: { executeScript: async request =>
    [{ result: await page.evaluate(({ source, args }) => (0, eval)(`(${source})`)(...args), { source: request.func.toString(), args: request.args }) }] } };
  const pump = async () => {
    const command = await poll(); await observe(command);
    if (command.operation) await executeBoundSend(chromeApi, command.operation, { config,
      authorize: async (operationId, witness) => (await post(ROUTES.authorize, { binding, operationId, witness })).allowed,
      acknowledge: receipt => post(ROUTES.receipt, { binding, operationId: command.operation.id, receipt }) });
    const stop = command.stopOperation ?? command.stopReadback;
    if (stop) await executeBoundStop(chromeApi, stop, { config,
      authorize: async (operationId, witness) => (await post(ROUTES.authorize, { kind: 'stop', binding, operationId, witness })).allowed,
      acknowledge: receipt => post(ROUTES.receipt, { kind: 'stop', binding, operationId: stop.id, receipt, confirmed: true }) });
    return command;
  };
  const until = async predicate => {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) { const command = await pump(); if (await predicate(command)) return command; await new Promise(resolve => setTimeout(resolve, POLL_MS)); }
    throw new Error('Lifecycle fixture did not reach its exact receipt');
  };
  const deadline = Date.now() + TIMEOUT_MS;
  let completed = false;
  while (Date.now() < deadline) {
    const command = await poll(); await observe(command);
    if (command.operation) await executeBoundSend(chromeApi, command.operation, { config,
      authorize: async (operationId, witness) => (await post(ROUTES.authorize, { binding, operationId, witness })).allowed,
      acknowledge: receipt => post(ROUTES.receipt, { binding, operationId: command.operation.id, receipt }) });
    completed = await desktop.evaluate(id => window.fixtureEvents.some(event => event.threadId === id && event.type === 'turn-end'), owner.id);
    if (completed) break;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  assert.equal(completed, true, 'owned native reply did not complete');
  assert.equal(await page.evaluate(() => window.sentCount), 1);
  const transcript = await desktop.evaluate(id => window.ankita.invoke('loadThread', { id }), owner.id);
  assert.equal(transcript.at(-1).content, expected);
  const events = await desktop.evaluate(() => window.fixtureEvents);
  assert.equal(events.filter(event => event.type === 'turn-end').length, 1);
  assert.equal(events.some(event => event.type === 'usage'), false);
  assert.deepEqual(errors, []);
  const vault = fs.readFileSync(path.join(configDir, CREDENTIAL_STORE_FILENAME), 'utf8');
  assert.equal(vault.includes(local.hash.slice(1)), false); assert.equal(vault.includes(conversationId), false);
  const resumedAnswer = 'Owned resumed attachment answer ' + randomUUID();
  await page.evaluate(ids => { window.nextNativeIds = ids; window.holdNext = true; }, { userId: randomUUID(), answerId: randomUUID(), turnId: randomUUID(), expected: resumedAnswer });
  await desktop.evaluate(({ id, text, data }) => window.ankita.invoke('send', { id, text, attachments: [{ name: 'owned-proof.txt', data }] }),
    { id: owner.id, text: 'Read this unique fixture attachment.', data: Buffer.from('Harmless native upload fixture ' + randomUUID()).toString('base64') });
  const accepted = await until(command => command.readback?.receipt);
  assert.ok(accepted.readback.uploadReceipt?.length === 1); assert.equal(await page.evaluate(() => window.uploadCount), 1);
  const operationId = accepted.readback.id;
  // Sudden exit of this owned test app reproduces crash recovery; the independent browser stays open.
  const exited = new Promise(resolve => application.once('close', resolve));
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {}); await exited;
  await page.evaluate(() => window.finishOwnedTurn());
  application = await launch(); desktop = await application.firstWindow(); desktop.on('pageerror', error => errors.push(error.message));
  await desktop.waitForFunction(() => Boolean(window.ankita)); await desktop.evaluate(() => window.ankita.invoke('initialize'));
  const restored = await desktop.evaluate(action => window.ankita.invoke(action), CHATGPT_CONNECTION_ACTIONS.overview);
  assert.equal(restored.conversationId, conversationId); assert.equal(restored.threadId, owner.id);
  assert.equal(restored.nativeTools.every(item => item.status === 'setup-required'), true);
  await until(async () => (await desktop.evaluate(action => window.ankita.invoke(action), CHATGPT_CONNECTION_ACTIONS.overview)).status === 'ready');
  assert.equal(await page.evaluate(() => window.sentCount), 2, 'restart only reads the accepted original turn');
  await desktop.evaluate(({ action, threadId, operationId }) => window.ankita.invoke(action, { threadId, operationId }), { action: CHATGPT_CONNECTION_ACTIONS.resume, threadId: owner.id, operationId });
  await desktop.waitForFunction(async ({ action, id }) => !(await window.ankita.invoke(action)).recoverable?.some(row => row.id === id), { action: CHATGPT_CONNECTION_ACTIONS.overview, id: operationId });
  const resumedHistory = await desktop.evaluate(id => window.ankita.invoke('loadThread', { id }), owner.id);
  assert.equal(resumedHistory.filter(row => row.content === resumedAnswer).length, 1);
  await page.evaluate(ids => { window.nextNativeIds = ids; window.holdNext = true; }, { userId: randomUUID(), answerId: randomUUID(), turnId: randomUUID(), expected: 'Owned stopped reply' });
  await desktop.evaluate(id => window.ankita.invoke('send', { id, text: 'Unique owned Stop check.' }), owner.id);
  await until(command => command.readback?.receipt);
  await desktop.evaluate(id => window.ankita.invoke('cancel', { id }), owner.id);
  await until(async () => (await desktop.evaluate(action => window.ankita.invoke(action), CHATGPT_CONNECTION_ACTIONS.overview)).remoteStop === 'confirmed');
  assert.equal(await page.evaluate(() => window.stopCount), 1); assert.equal(page.isClosed(), false);
  assert.equal(await page.evaluate(() => window.sentCount), 3); assert.deepEqual(errors, []);
  await desktop.getByRole('button', { name: 'Open settings', exact: true }).click();
  await desktop.getByRole('button', { name: 'Providers', exact: true }).click();
  await desktop.getByRole('heading', { name: 'Your ChatGPT conversation' }).waitFor();
  await desktop.locator('.chatgpt-connection').scrollIntoViewIfNeeded();
  const screenshot = path.join(ROOT, '.commandcode/chatgpt-connection-desktop.png'); await desktop.screenshot({ path: screenshot });
  console.log(JSON.stringify({ actualElectron: true, provider: CHATGPT_BROWSER_PROVIDER, apiCredentials: false,
    browser: 'isolated-native-DOM-fixture', sends: 1, acceptedUserRead: true, finalReceiptRead: true, desktopReplyMatched: true,
    savedHistoryMatched: true, turnEnds: 1, inventedUsage: false, rendererErrors: errors, hostedChatGpt: false,
    packagedApplication: Boolean(packagedExecutable), attachmentAccepted: true, actualOsEncryptedPairing: true,
    samePairingRestored: true, crashResumeWithoutReplay: true, resumedReplyImportedOnce: true, nativeHelpersLaunchedOnRestart: 0,
    ownedStopClicks: 1, nativeStopConfirmed: true, userBrowserSurvived: true, lifecycleSends: 3 }));
} finally {
  await browser?.close(); await application?.close();
  const target = fs.realpathSync(directory), base = fs.realpathSync(os.tmpdir());
  if (target.startsWith(base + path.sep) && path.basename(target).startsWith('ankita-chatgpt-desktop-')) fs.rmSync(target, { recursive: true, force: true });
}
