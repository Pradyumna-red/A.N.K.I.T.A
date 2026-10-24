import { wire } from './wire.mjs';
import { readSelectedPage } from './content.mjs';
import { executeBoundSend, executeBoundStop } from './commands.mjs';
import { discoverCompanion } from './discovery.mjs';
import { readChromeSignIn, SIGN_IN_ERRORS } from './sign-in.mjs';

const POPUP_FILE = 'popup.html';
const READERS_FILE = 'upstream/readers.js';
const ORIGINS_FILE = 'upstream/request-origins.js'; // Passive native request identity observer, injected only in the bound tab.
const DELIVERY_FILE = 'upstream/delivery.js'; // Native Send custody; inactive unless the host offers a durable operation.
const APP_MENTIONS_FILE = 'upstream/app-mentions.js'; // Passive metadata observer; selected names become native app tags only during an authorized Send.
const APP_OBSERVER_ID = 'ankita-selected-app-catalogue'; // One document-start observer, restricted to the chosen conversation route.
const MAIN_WORLD = 'MAIN';
const AUTH_PREFIX = wire.bearerPrefix;
const JSON_TYPE = wire.jsonContentType;
const METHOD_GET = 'GET'; const METHOD_POST = 'POST';
const SESSION_KEY = wire.storageKey;
const IDENTITY_KEY = SESSION_KEY + 'Identity'; // Stable browser ID/address, without a pairing secret, survives extension reload.
const WAKE_ALARM = 'ankita-companion-wake'; // Browser-owned wake survives MV3 worker suspension; timer polling alone cannot reconnect after idle.
const WAKE_INTERVAL_MINUTES = 0.5; // Minutes/Chrome's minimum periodic MV3 alarm cadence; active work still uses pollMs.
let discoveryIssue = null;
let connectionEpoch = 0; // Popup Connect/Disconnect invalidate older asynchronous provisioning responses.
async function ensureTarget(current, targetUrl) {
  const desired = new URL(targetUrl);
  if (desired.origin !== wire.chatgptOrigin) throw new Error('ANKITA requested an unsupported ChatGPT page');
  const openingId = new URLSearchParams(desired.hash.slice(1)).get(wire.openingFragmentKey);
  const conversationId = conversation(targetUrl);
  if (!conversationId && !openingId) throw new Error('ANKITA opening identity is missing');
  let selected = (await chrome.tabs.query({ url: wire.chatgptMatch })).find(tab => conversationId ? conversation(tab.url) === conversationId : tab.url === targetUrl);
  if (!selected && current.targetUrl === targetUrl && current.targetTabId) selected = await chrome.tabs.get(current.targetTabId).catch(() => null);
  if (!selected) {
    if (chrome.scripting.registerContentScripts) {
      await chrome.scripting.unregisterContentScripts({ ids: [APP_OBSERVER_ID] }).catch(() => {});
      await chrome.scripting.registerContentScripts([{ id: APP_OBSERVER_ID, matches: [desired.origin + desired.pathname + (desired.pathname === '/' ? '' : '*')],
        js: wire.pageAdapterFiles, world: MAIN_WORLD, runAt: 'document_start', persistAcrossSessions: false }]);
      observedPath = null;
    }
    const window = await chrome.windows.create({ url: targetUrl, ...wire.windowBounds, focused: false, type: 'popup' });
    selected = window.tabs?.[0];
    if (!selected?.id) throw new Error('Chrome did not return the owned ChatGPT tab');
    current.targetUrl = targetUrl; current.targetTabId = selected.id;
    await chrome.storage.session.set({ [SESSION_KEY]: current });
  }
  const available = await tabs(current), tab = available.find(tab => tab.id === selected.id);
  if (!tab) return; // The same opening is still navigating; observing it later cannot create a duplicate window.
  if (conversationId ? tab.conversationId !== conversationId : tab.conversationId !== null || tab.openingId !== openingId) return;
  await request(current, wire.routes.bind, { browserId: current.browserId, tabId: tab.id, conversationId: tab.conversationId,
    ...(tab.openingId ? { openingId: tab.openingId } : {}) });
}
async function automaticallyConnect() {
  const epoch = connectionEpoch;
  const saved = (await chrome.storage.local.get(IDENTITY_KEY))[IDENTITY_KEY] ?? { browserId: crypto.randomUUID() };
  if (saved.stopped) return null;
  const current = await discoverCompanion({ ...saved, extensionId: chrome.runtime.id });
  if (epoch !== connectionEpoch) return null;
  if (current) {
    await chrome.storage.local.set({ [IDENTITY_KEY]: { browserId: current.browserId, preferredAddress: current.address, preferredHostId: current.hostId } });
    if (epoch !== connectionEpoch) return null;
    await chrome.storage.session.set({ [SESSION_KEY]: current }); discoveryIssue = null;
    if (epoch !== connectionEpoch) { await chrome.storage.session.remove(SESSION_KEY); return null; }
  }
  return current;
}
let timer, tickPromise;
let observedPath = null;
const conversation = url => { try { const parsed = new URL(url); return parsed.origin === wire.chatgptOrigin ? parsed.pathname.match(new RegExp(wire.conversationPattern, 'i'))?.[1] ?? null : null; } catch { return null; } };
export async function observeBoundTab(chromeApi, binding, readback, config = wire, appIdentities = []) {
  const before = await chromeApi.tabs.get(binding.tabId);
  if (conversation(before.url) !== binding.conversationId && !(binding.conversationId === null && binding.openingId)) return null;
  if (chromeApi.scripting.registerContentScripts) {
      const selected = new URL(before.url), match = selected.origin + selected.pathname + (selected.pathname === '/' ? '' : '*');
    if (observedPath !== match) {
      const scripts = await chromeApi.scripting.getRegisteredContentScripts({ ids: [APP_OBSERVER_ID] });
      if (scripts.length) await chromeApi.scripting.unregisterContentScripts({ ids: [APP_OBSERVER_ID] });
      await chromeApi.scripting.registerContentScripts([{ id: APP_OBSERVER_ID, matches: [match], js: [APP_MENTIONS_FILE], world: MAIN_WORLD, runAt: 'document_start', persistAcrossSessions: false }]);
      observedPath = match;
    }
  }
  await chromeApi.scripting.executeScript({ target: { tabId: binding.tabId }, world: MAIN_WORLD, files: config.pageAdapterFiles ?? [READERS_FILE, ORIGINS_FILE, APP_MENTIONS_FILE, DELIVERY_FILE] });
  const { leaseId, epoch, tabId, conversationId } = binding; // Page receives opaque scope only; workspace/thread ownership stays in the host.
  const scope = { leaseId, epoch, tabId, conversationId, ...(binding.openingId ? { openingId: binding.openingId } : {}) };
  const projected = readback ? { id: readback.id, text: readback.text, outcome: readback.outcome, baselineUserIds: readback.baselineUserIds,
    receipt: readback.receipt, appMentions: readback.appMentions, scope } : null;
  const readings = await chromeApi.scripting.executeScript({ target: { tabId: binding.tabId }, world: MAIN_WORLD, func: readSelectedPage, args: [binding.conversationId, config, scope, projected, appIdentities] });
  const after = await chromeApi.tabs.get(binding.tabId);
  if (conversation(after.url) !== binding.conversationId && !(binding.conversationId === null && binding.openingId && readings[0]?.result?.delivery?.receipt?.conversationId === conversation(after.url))) return null;
  if (readings.length !== 1) return null;
  return readings[0].result;
}
/** Same Send/receipt/Stop contract for the extension and the app-owned browser. */
export async function pumpBoundBrowser(api, bridge, config = wire, offered) {
  const command = offered ?? await bridge.poll(); // A poll can claim a Send; pass that same offer through, never poll past it.
  if (!command.binding) return;
  const binding = command.binding;
  let observedConversation = binding.conversationId;
  const observe = async reading => {
    const snapshot = await observeBoundTab(api, binding, reading.readback, config, reading.appIdentities);
    if (!snapshot) return false;
    const accepted = await bridge.observe({ binding, nonce: reading.nonce, snapshot });
    if (accepted) observedConversation = snapshot.conversationId;
    return accepted;
  };
  if (!await observe(command)) return;
  if (command.operation) {
    const outcome = await executeBoundSend(api, command.operation, { config,
      authorize: async (operationId, witness) => {
        const fresh = await bridge.poll();
        if (fresh.binding?.epoch !== binding.epoch || !await observe(fresh)) return false;
        return (await bridge.authorize({ binding, operationId, witness })).allowed;
      },
      acknowledge: receipt => bridge.acknowledge({ binding, operationId: command.operation.id, receipt }),
    });
    if (!outcome.dispatched) await bridge.acknowledge({ binding, operationId: command.operation.id, failure: true, reason: outcome.reason });
  }
  const stop = command.stopOperation ?? command.stopReadback;
  if (stop) await executeBoundStop(api, { ...stop, binding: { ...stop.binding, conversationId: observedConversation } }, { config,
    authorize: async (operationId, witness) => (await bridge.authorize({ kind: 'stop', binding, operationId, witness })).allowed,
    acknowledge: receipt => bridge.acknowledge({ kind: 'stop', binding, operationId: stop.id, receipt, confirmed: true }),
  });
}
async function session() { return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? null; }
async function request(current, route, input) {
  const response = await fetch(current.address + route, { method: input === undefined ? METHOD_GET : METHOD_POST,
    headers: { Authorization: AUTH_PREFIX + current.key, 'Content-Type': JSON_TYPE }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  if (!response.ok) throw Object.assign(new Error(`Companion request refused (${response.status})`), { status: response.status });
  return response.json();
}
async function tabs(current) {
  const found = await chrome.tabs.query({ url: wire.chatgptMatch });
  return request(current, wire.routes.tabs, { browserId: current.browserId,
    tabs: found.slice(0, wire.maxTabs).map(tab => ({ id: tab.id, url: tab.url, title: tab.title })) });
}
async function readTick() {
  clearTimeout(timer);
  let current;
  try {
    current = await session() ?? await automaticallyConnect();
    if (!current) return;
    await tabs(current);
    const status = await request(current, wire.routes.poll);
    if (status.targetUrl) await ensureTarget(current, status.targetUrl);
    if (Number.isSafeInteger(status.showTabId)) {
      const tab = await chrome.tabs.update(status.showTabId, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await pumpBoundBrowser(chrome, {
      poll: () => request(current, wire.routes.poll), observe: input => request(current, wire.routes.observe, input).then(value => value.accepted),
      authorize: input => request(current, wire.routes.authorize, input), acknowledge: input => request(current, wire.routes.receipt, input),
    }, wire, status.binding ? status : undefined);
  } catch (error) {
    discoveryIssue = error.message;
    if (error.status === 401 || error instanceof TypeError) await chrome.storage.session.remove(SESSION_KEY); // A stale token/address can rediscover; explicit host Disconnect remains latched on the server.
  }
}
function tick() {
  clearTimeout(timer);
  tickPromise ??= readTick().finally(async () => {
    tickPromise = null;
    const epoch = connectionEpoch;
    const identity = (await chrome.storage.local.get(IDENTITY_KEY))[IDENTITY_KEY];
    if (identity?.stopped || epoch !== connectionEpoch) return;
    if (chrome.alarms) {
      const existing = await chrome.alarms.get(WAKE_ALARM);
      if (epoch !== connectionEpoch) return;
      if (!existing) {
        await chrome.alarms.create(WAKE_ALARM, { delayInMinutes: WAKE_INTERVAL_MINUTES, periodInMinutes: WAKE_INTERVAL_MINUTES });
        if (epoch !== connectionEpoch) {
          const current = (await chrome.storage.local.get(IDENTITY_KEY))[IDENTITY_KEY];
          if (current?.stopped) await chrome.alarms.clear(WAKE_ALARM);
          return;
        }
      }
    }
    timer = setTimeout(tick, wire.pollMs);
  });
  return tickPromise;
}
export function trustedPopup(sender, runtime) {
  return sender?.id === runtime.id && !sender.tab && sender.url === runtime.getURL(POPUP_FILE);
}
async function action(message) {
  if (message.type === 'disconnect') {
    connectionEpoch++; clearTimeout(timer);
    const identity = (await chrome.storage.local.get(IDENTITY_KEY))[IDENTITY_KEY] ?? { browserId: crypto.randomUUID() };
    await chrome.storage.local.set({ [IDENTITY_KEY]: { ...identity, stopped: true } });
    await chrome.alarms?.clear(WAKE_ALARM);
    const current = await session(); await chrome.storage.session.remove(SESSION_KEY);
    if (chrome.scripting?.unregisterContentScripts) await chrome.scripting.unregisterContentScripts({ ids: [APP_OBSERVER_ID] }).catch(() => {});
    observedPath = null;
    return current ? request(current, wire.routes.disconnect, {}) : { status: 'disconnected' };
  }
  if (message.type === 'connect') {
    const epoch = ++connectionEpoch;
    if (!message.url?.trim()) {
      const identity = (await chrome.storage.local.get(IDENTITY_KEY))[IDENTITY_KEY] ?? { browserId: crypto.randomUUID() };
      await chrome.storage.local.set({ [IDENTITY_KEY]: { ...identity, stopped: false } });
      const current = await automaticallyConnect();
      if (!current) throw new Error(wire.chromeSetupMessage);
      await tabs(current); void tick(); return { connected: true };
    }
    const url = new URL(message.url);
    if (url.protocol !== wire.localProtocol || url.hostname !== wire.loopbackHost || !url.port || url.username || url.password || url.pathname !== '/' || url.search || !url.hash.slice(1)) throw new Error('Use the local pairing URL printed by ANKITA');
    const existing = await session();
    const address = url.origin, key = url.hash.slice(1);
    // Repeating the owner's Connect reuses this session identity; it must not claim a second browser.
    const current = existing?.address === address && existing?.key === key ? existing : { address, key, browserId: crypto.randomUUID() };
    await request(current, wire.routes.pair, { version: wire.version, extensionId: chrome.runtime.id, browserId: current.browserId });
    if (epoch !== connectionEpoch) return { connected: false };
    await chrome.storage.session.set({ [SESSION_KEY]: current });
    await tabs(current); void tick(); return { connected: true };
  }
  const current = await session();
  if (!current) { void tick(); return { status: 'pairing-required', tabs: [], discoveryIssue }; }
  if (message.type === 'sign-in-transfer') {
    const epoch = connectionEpoch;
    try {
      const status = await request(current, wire.routes.status);
      if (!status.signInOffer || status.signInOffer.id !== message.id) throw new Error(SIGN_IN_ERRORS.expired);
      const cookies = await readChromeSignIn(chrome, message.tabId, wire.chatgptOrigin);
      if (epoch !== connectionEpoch) throw new Error(SIGN_IN_ERRORS.expired);
      return await request(current, wire.routes.signIn, { id: message.id, cookies });
    } catch (error) { throw new Error(Object.values(SIGN_IN_ERRORS).includes(error.message) ? error.message : SIGN_IN_ERRORS.failed); }
  }
  if (message.type === 'status') return { ...await request(current, wire.routes.status), tabs: await tabs(current) };
  if (message.type === 'bind') {
    const available = await tabs(current); const selected = available.find(tab => tab.id === message.tabId);
    if (!selected) throw new Error('Select an existing ChatGPT conversation');
    const binding = await request(current, wire.routes.bind, { browserId: current.browserId, tabId: selected.id, conversationId: selected.conversationId, ...(selected.openingId ? { openingId: selected.openingId } : {}) });
    await tick(); return { binding };
  }
  throw new Error('Unknown popup action');
}
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.alarms?.onAlarm.addListener(alarm => { if (alarm?.name === WAKE_ALARM) void tick(); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trustedPopup(sender, chrome.runtime)) { respond({ error: 'Only the companion popup may request a connection' }); return false; }
    action(message).then(value => respond({ value }), error => respond({ error: error.message })); return true;
  });
  void tick();
}
