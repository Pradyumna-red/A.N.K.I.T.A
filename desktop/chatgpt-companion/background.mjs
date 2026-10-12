import { wire } from './wire.mjs';
import { readSelectedPage } from './content.mjs';
import { executeBoundSend } from './commands.mjs';

const POPUP_FILE = 'popup.html';
const READERS_FILE = 'upstream/readers.js';
const ORIGINS_FILE = 'upstream/request-origins.js'; // Passive native request identity observer, injected only in the bound tab.
const DELIVERY_FILE = 'upstream/delivery.js'; // Native Send custody; inactive unless the host offers a durable operation.
const MAIN_WORLD = 'MAIN';
const AUTH_PREFIX = wire.bearerPrefix;
const JSON_TYPE = wire.jsonContentType;
const METHOD_GET = 'GET'; const METHOD_POST = 'POST';
const SESSION_KEY = wire.storageKey;
let timer, tickPromise;
const conversation = url => { try { const parsed = new URL(url); return parsed.origin === wire.chatgptOrigin ? parsed.pathname.match(new RegExp(wire.conversationPattern, 'i'))?.[1] ?? null : null; } catch { return null; } };
export async function observeBoundTab(chromeApi, binding, readback) {
  const before = await chromeApi.tabs.get(binding.tabId);
  if (conversation(before.url) !== binding.conversationId) return null;
  await chromeApi.scripting.executeScript({ target: { tabId: binding.tabId }, world: MAIN_WORLD, files: [READERS_FILE, ORIGINS_FILE, DELIVERY_FILE] });
  const { leaseId, epoch, tabId, conversationId } = binding; // Page receives opaque scope only; workspace/thread ownership stays in the host.
  const projected = readback ? { id: readback.id, text: readback.text, outcome: readback.outcome, baselineUserIds: readback.baselineUserIds,
    receipt: readback.receipt, scope: { leaseId, epoch, tabId, conversationId } } : null;
  const readings = await chromeApi.scripting.executeScript({ target: { tabId: binding.tabId }, world: MAIN_WORLD, func: readSelectedPage, args: [binding.conversationId, wire, { leaseId, epoch, tabId, conversationId }, projected] });
  const after = await chromeApi.tabs.get(binding.tabId);
  if (conversation(after.url) !== binding.conversationId || readings.length !== 1) return null;
  return readings[0].result;
}
async function session() { return (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] ?? null; }
async function request(current, route, input) {
  const response = await fetch(current.address + route, { method: input === undefined ? METHOD_GET : METHOD_POST,
    headers: { Authorization: AUTH_PREFIX + current.key, 'Content-Type': JSON_TYPE }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  if (!response.ok) throw new Error(`Companion request refused (${response.status})`);
  return response.json();
}
async function tabs(current) {
  const found = await chrome.tabs.query({ url: wire.chatgptMatch });
  return request(current, wire.routes.tabs, { browserId: current.browserId,
    tabs: found.slice(0, wire.maxTabs).map(tab => ({ id: tab.id, url: tab.url, title: tab.title })) });
}
async function readTick() {
  clearTimeout(timer);
  const current = await session();
  if (!current) return;
  try {
    await tabs(current);
    const command = await request(current, wire.routes.poll);
    if (command.binding) {
      const snapshot = await observeBoundTab(chrome, command.binding, command.readback);
      if (snapshot) await request(current, wire.routes.observe, { binding: command.binding, nonce: command.nonce, snapshot });
      if (snapshot && command.operation) {
        const outcome = await executeBoundSend(chrome, command.operation, {
        authorize: async (operationId, witness) => (await request(current, wire.routes.authorize, { binding: command.binding, operationId, witness })).allowed,
        acknowledge: receipt => request(current, wire.routes.receipt, { binding: command.binding, operationId: command.operation.id, receipt }),
        });
        if (!outcome.dispatched) await request(current, wire.routes.receipt, { binding: command.binding, operationId: command.operation.id, failure: true });
      }
    }
  } catch { /* Connection errors never switch a tab, relaunch Chrome or execute a Send. */ }
}
function tick() {
  clearTimeout(timer);
  tickPromise ??= readTick().finally(async () => {
    tickPromise = null;
    if (await session()) timer = setTimeout(tick, wire.pollMs);
  });
  return tickPromise;
}
export function trustedPopup(sender, runtime) {
  return sender?.id === runtime.id && !sender.tab && sender.url === runtime.getURL(POPUP_FILE);
}
async function action(message) {
  if (message.type === 'connect') {
    const url = new URL(message.url);
    if (url.protocol !== wire.localProtocol || url.hostname !== wire.loopbackHost || !url.port || url.username || url.password || url.pathname !== '/' || url.search || !url.hash.slice(1)) throw new Error('Use the local pairing URL printed by ANKITA');
    const existing = await session();
    const address = url.origin, key = url.hash.slice(1);
    // Repeating the owner's Connect reuses this session identity; it must not claim a second browser.
    const current = existing?.address === address && existing?.key === key ? existing : { address, key, browserId: crypto.randomUUID() };
    await request(current, wire.routes.pair, { version: wire.version, extensionId: chrome.runtime.id, browserId: current.browserId });
    await chrome.storage.session.set({ [SESSION_KEY]: current });
    await tabs(current); void tick(); return { connected: true };
  }
  const current = await session();
  if (!current) return { status: 'pairing-required', tabs: [] };
  if (message.type === 'status') return { ...await request(current, wire.routes.status), tabs: await tabs(current) };
  if (message.type === 'bind') {
    const available = await tabs(current); const selected = available.find(tab => tab.id === message.tabId);
    if (!selected) throw new Error('Select an existing ChatGPT conversation');
    const binding = await request(current, wire.routes.bind, { browserId: current.browserId, tabId: selected.id, conversationId: selected.conversationId });
    await tick(); return { binding };
  }
  if (message.type === 'disconnect') {
    await chrome.storage.session.remove(SESSION_KEY); clearTimeout(timer);
    return request(current, wire.routes.disconnect, {});
  }
  throw new Error('Unknown popup action');
}
if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!trustedPopup(sender, chrome.runtime)) { respond({ error: 'Only the companion popup may request a connection' }); return false; }
    action(message).then(value => respond({ value }), error => respond({ error: error.message })); return true;
  });
  void tick();
}
