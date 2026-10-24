import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { discoverCompanion } from '../../desktop/chatgpt-companion/discovery.mjs';

const NATIVE_TIMEOUT_MS = 30_000; // Milliseconds per isolated native fixture step; not production retry policy.
test('actual Electron opens a blank owned chat and returns its first exact reply without pairing', { timeout: NATIVE_TIMEOUT_MS }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-owned-native-'));
  const env = { ...process.env, ANKITA_WINDOW_FIXTURE: directory, CONFIG_DIR: path.join(directory, 'config') };
  delete env.ELECTRON_RUN_AS_NODE;
  const application = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
    args: [fileURLToPath(new URL('../fixtures/chatgpt-window-entry.mjs', import.meta.url))], env, timeout: NATIVE_TIMEOUT_MS });
  t.after(async () => { await application.evaluate(async () => { await globalThis.fixture?.manager?.close(); }); await application.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  console.log('OWNED_NATIVE_PHASE', await application.evaluate(() => globalThis.fixture.phase));
  const state = await application.evaluate(async () => (await globalThis.fixture.ready).state);
  console.log('OWNED_NATIVE_READY', JSON.stringify(state));
  assert.equal(state.status, 'ready'); assert.equal(state.conversationId, null, 'opening is not a fabricated server chat');
  const expected = await application.evaluate(() => globalThis.fixture.final);
  const firstOperation = await application.evaluate(async () => {
    let queued;const ready=new Promise(resolve=>{queued=resolve;});
    globalThis.fixture.firstReply=globalThis.fixture.manager.send({ threadId: 'native-owner', text: 'Native owned first question', includeTools: false, onQueued: queued })
      .catch(error=>({error:error.message}));
    return (await ready).id;
  });
  const firstDeadline = Date.now() + NATIVE_TIMEOUT_MS;
  while (!await application.evaluate(async (_electron,id)=>(await globalThis.fixture.manager.runtime.store.get(id)).blockedReason==='transport',firstOperation)) {
    if(Date.now()>firstDeadline)throw new Error('First-use fixture did not observe its transient stream notice');
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  await application.evaluate(async () => {
    const manager=globalThis.fixture.manager;
    await manager.ownedWindow.api.scripting.executeScript({target:{tabId:manager.ownedTabId},func:()=>window.finishFirstReply()});
  });
  const result = await application.evaluate(async () => globalThis.fixture.firstReply);
  console.log('OWNED_FIRST_USE_STREAM_RECOVERY',JSON.stringify({firstSetup:true,restart:false,finalMatched:result.text===expected,error:result.error??null}));
  assert.equal(result.text, expected);
  const proof = await application.evaluate(async () => {
    const manager = globalThis.fixture.manager, tab = manager.ownedTabId;
    const [{ result: sends }] = await manager.ownedWindow.api.scripting.executeScript({ target: { tabId: tab }, func: () => window.sends });
    const [{ result: expectedId }] = await manager.ownedWindow.api.scripting.executeScript({ target: { tabId: tab }, func: () => window.fixtureConversationId });
    return { sends, conversationId: manager.view().conversationId, expectedId, internalOnly: manager.bridge.address === null };
  });
  assert.deepEqual(proof, { sends: 1, conversationId: proof.expectedId, expectedId: proof.expectedId, internalOnly: true });
  await application.evaluate(async (_electron, id) => globalThis.fixture.manager.consume(id), result.operationId);
  const switched = await application.evaluate(async () => {
    const manager = globalThis.fixture.manager, first = manager.view().conversationId;
    const later = await manager.send({ threadId: 'native-owner', text: 'Native owned later question', includeTools: false }); await manager.consume(later.operationId);
    const second = await manager.send({ threadId: 'second-owner', text: 'Other teammate first question', includeTools: false }); await manager.consume(second.operationId);
    const other = manager.view().conversationId;
    await manager.start({ threadId: 'native-owner', mode: 'builtin' });
    const tabId = manager.ownedTabId;
    const [{ result: sends }] = await manager.ownedWindow.api.scripting.executeScript({ target: { tabId }, func: () => window.sends });
    await manager.close();
    const reopened = globalThis.fixture.manager = globalThis.fixture.makeManager();
    await reopened.init(); const noStartupLaunch = reopened.ownedWindow === undefined;
    await reopened.start({ threadId: 'native-owner', mode: 'builtin' });
    const [{ result: replayed }] = await reopened.ownedWindow.api.scripting.executeScript({ target: { tabId: reopened.ownedTabId }, func: () => window.sends });
    return { first, other, restored: reopened.view().conversationId, logicalIdPreserved: reopened.ownedTabId === tabId, sends, replayed, noStartupLaunch };
  });
  assert.notEqual(switched.first, switched.other); assert.equal(switched.restored, switched.first);
  assert.equal(switched.sends, 2); assert.equal(switched.replayed, 0); assert.equal(switched.logicalIdPreserved, true); assert.equal(switched.noStartupLaunch, true);
  const stopped = await application.evaluate(async () => {
    const manager = globalThis.fixture.manager;
    let queued; const ready = new Promise(resolve => { queued = resolve; });
    const sending = manager.send({ threadId: 'native-owner', text: 'Native owned stop question', includeTools: false, onQueued: queued });
    const cancelled = sending.catch(error => error.message); const operation = await ready;
    const deadline = Date.now() + 10_000;
    while (!(await manager.runtime.store.get(operation.id)).receipt || manager.bridge.view().blockedReason !== 'transport') {
      if (Date.now() >= deadline) throw new Error('Fixture transport-paused user receipt was not observed');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await manager.cancel('native-owner'); await manager.pumpOwned();
    const confirmed = await manager.runtime.waitForStop(manager.bridge.view().binding);
    const [{ result: clicks }] = await manager.ownedWindow.api.scripting.executeScript({ target: { tabId: manager.ownedTabId }, func: () => window.stopClicks });
    return { confirmed, clicks, message: await cancelled, transportPaused: true };
  });
  assert.equal(stopped.confirmed, true); assert.equal(stopped.clicks, 1); assert.match(stopped.message, /cancel/i);
  console.log('OWNED_TRANSPORT_PAUSED_STOP',JSON.stringify(stopped));
  await application.evaluate(() => globalThis.fixture.manager.startSignInTransfer());
  const address = await application.evaluate(() => globalThis.fixture.manager.signInBridge.address);
  const session = await discoverCompanion({ ports: [Number(new URL(address).port)], browserId: 'native-sign-in-fixture', extensionId: 'd'.repeat(32) });
  const headers = { Authorization: 'Bearer ' + session.key, Origin: 'chrome-extension://' + 'd'.repeat(32), 'Content-Type': 'application/json' };
  const status = await (await fetch(address + '/status', { headers })).json();
  assert.ok(status.signInOffer?.id);
  const transferred = await fetch(address + '/sign-in', { method: 'POST', headers, body: JSON.stringify({ id: status.signInOffer.id, cookies: [{
    name: '__Secure-next-auth.session-token', value: 'fixture-session-only', domain: '.chatgpt.com', path: '/', secure: true, httpOnly: true,
    hostOnly: false, sameSite: 'lax', expirationDate: Date.now() / 1000 + 60,
  }] }) });
  assert.equal(transferred.status, 200); assert.equal((await transferred.json()).imported, true);
  assert.equal(await application.evaluate(async () => {
    const manager = globalThis.fixture.manager;
    return (await manager.ownedWindow.sessionForTab(manager.ownedTabId).cookies.get({ url: 'https://chatgpt.com/' }))
      .some(cookie => cookie.name === '__Secure-next-auth.session-token' && cookie.httpOnly && cookie.secure && cookie.value === 'fixture-session-only');
  }), true);
  assert.equal(fs.readFileSync(path.join(directory, 'chatgpt-browser', 'native-connections.json'), 'utf8').includes('fixture-session-only'), false);
  console.log('OWNED_NATIVE_CHAT', JSON.stringify({ sends: proof.sends, firstReplyMatched: true, laterReplyMatched: true, teammatesIsolated: true, restoredWithoutReplay: true, nativeStopClicks: stopped.clicks, internalOnly: true, realElectron: true, hostedChatGpt: false }));
  console.log('OWNED_SIGN_IN_TRANSFER', JSON.stringify({ actualElectronJar: true, authenticatedHttp: true, sessionOnly: true, appSettingsContainCookie: false, hostedAccount: false }));
});
