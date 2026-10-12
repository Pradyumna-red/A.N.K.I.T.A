import http from 'node:http';
import fs from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { localhostHostValidation } from '@modelcontextprotocol/node';
import { RequestOwners, sameBinding } from '../../src/integrations/chatgpt-browser/request-owners.mjs';
import { JSON_CONTENT_TYPE, HTTP_STATUS, LOCAL_HTTP_PROTOCOL, BEARER_PREFIX } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { COMPANION_VERSION, BRIDGE_HOST, BRIDGE_PORT, BRIDGE_MAX_BODY_BYTES, BRIDGE_SECRET_NAME, OBSERVATION_MAX_AGE_MS,
  MAX_TABS, MAX_MODELS, MAX_REQUEST_IDS, MAX_ID_CHARS, ROUTES, EXTENSION_ID_PATTERN, conversationFromUrl } from './config.mjs';

const POST = 'POST'; const GET = 'GET'; const EXTENSION_ORIGIN_PREFIX = 'chrome-extension://';
const AUTH_PREFIX = BEARER_PREFIX; const NO_CACHE = 'no-store';
const statusError = (message, status = HTTP_STATUS.badRequest) => Object.assign(new Error(message), { status });
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
const equals = (a, b) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
const reply = (res, status, value) => { res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': NO_CACHE }); res.end(JSON.stringify(value)); };
async function body(req) {
  const chunks = []; let size = 0;
  if (Number(req.headers['content-length']) > BRIDGE_MAX_BODY_BYTES) throw statusError('Body too large', HTTP_STATUS.payloadTooLarge);
  for await (const chunk of req) { size += chunk.length; if (size > BRIDGE_MAX_BODY_BYTES) throw statusError('Body too large', HTTP_STATUS.payloadTooLarge); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw statusError('Invalid JSON'); }
}

/** External browser transport only. Host context/secret admission never comes from page messages. */
export async function createCompanionBridge({ config, secrets, store, onObservation } = {}) {
  if (!config?.workspacePath || !config?.threadId || !secrets?.withSecret) throw new TypeError('Bridge requires explicit workspace, thread and protected secret provider');
  const workspacePath = fs.realpathSync(config.workspacePath);
  if (!fs.statSync(workspacePath).isDirectory()) throw new Error('Proof workspace is not a directory');
  const owners = new RequestOwners(); const validateHost = localhostHostValidation();
  let pairing = null, tabs = [], binding = null, nonce = null, observation = null, observedAt = null;
  let disconnected = (await store?.load?.())?.desired === false;
  const active = new Set(); let closing = false;
  const view = () => {
    const fresh = observedAt !== null && Date.now() - observedAt <= OBSERVATION_MAX_AGE_MS;
    const accountReady = fresh && observation?.accountReady === true;
    const matches = observation?.models?.filter(model => model.id === observation.selectedModel && model.available &&
      (!observation.selectedEffort || model.effort === observation.selectedEffort)) ?? [];
    const selected = matches.length === 1 ? matches[0] : null;
    return { status: disconnected || closing ? 'disconnected' : !pairing ? 'pairing-required' : !binding ? 'select-tab' : !fresh ? 'observing' : !accountReady ? 'logged-out' : !selected ? 'model-unavailable' : 'ready',
      binding: binding && { ...binding }, accountReady: Boolean(accountReady), selectedModel: fresh ? observation?.selectedModel ?? null : null,
      models: fresh ? observation?.models ?? [] : [], observedAt };
  };
  const bridge = {
    address: null, view,
    async pair(input) {
      if (disconnected || closing) throw statusError('Explicitly disconnected; host must authorize a new connection', HTTP_STATUS.conflict);
      if (input?.version !== COMPANION_VERSION) throw statusError('Companion version mismatch', HTTP_STATUS.conflict);
      if (!EXTENSION_ID_PATTERN.test(input.extensionId) || !opaque(input.browserId)) throw statusError('Invalid companion identity');
      if (pairing && (pairing.extensionId !== input.extensionId || pairing.browserId !== input.browserId)) throw statusError('Another companion already owns this bridge', HTTP_STATUS.conflict);
      pairing = { extensionId: input.extensionId, browserId: input.browserId };
      return { version: COMPANION_VERSION, status: view().status };
    },
    async reportTabs(input) {
      if (!pairing || input.browserId !== pairing.browserId || disconnected) throw statusError('Wrong paired browser', HTTP_STATUS.forbidden);
      if (!Array.isArray(input.tabs) || input.tabs.length > MAX_TABS) throw statusError('Invalid tab list');
      tabs = input.tabs.map(tab => ({ id: tab.id, conversationId: conversationFromUrl(tab.url), title: typeof tab.title === 'string' ? tab.title.slice(0, MAX_ID_CHARS) : '' }))
        .filter(tab => Number.isSafeInteger(tab.id) && tab.conversationId);
      if (binding && !tabs.some(tab => tab.id === binding.tabId && tab.conversationId === binding.conversationId)) {
        owners.clear(); binding = null; nonce = null; observation = null; observedAt = null;
      }
      return { status: view().status };
    },
    async listTabs() { return tabs.map(tab => ({ ...tab, browserId: pairing.browserId, bound: binding?.tabId === tab.id })); },
    async bind(input) {
      if (!pairing || disconnected || input.browserId !== pairing.browserId) throw statusError('Browser is not paired', HTTP_STATUS.forbidden);
      if (input.threadId !== config.threadId || fs.realpathSync(input.workspacePath) !== workspacePath) throw statusError('Host workspace/thread cannot be replaced', HTTP_STATUS.forbidden);
      if (!tabs.some(tab => tab.id === input.tabId && tab.conversationId === input.conversationId)) throw statusError('Selected tab does not own the conversation', HTTP_STATUS.forbidden);
      binding = Object.freeze({ leaseId: randomUUID(), epoch: randomUUID(), browserId: pairing.browserId, tabId: input.tabId,
        conversationId: input.conversationId, threadId: config.threadId, workspacePath });
      observation = null; observedAt = null; nonce = null; owners.bind(binding);
      await store?.save?.({ desired: true, binding });
      return { ...binding };
    },
    async poll() {
      if (!pairing || !binding || disconnected) return { binding: null };
      nonce = randomUUID(); return { binding: { ...binding }, nonce };
    },
    async observe(input) {
      if (disconnected || !sameBinding(input?.binding, binding) || !nonce || input.nonce !== nonce || input.snapshot?.conversationId !== binding.conversationId) return false;
      const value = input.snapshot; nonce = null;
      if (!Array.isArray(value.models) || value.models.length > MAX_MODELS || !Array.isArray(value.requestIds) || value.requestIds.length > MAX_REQUEST_IDS) return false;
      const models = value.models.map(model => ({ id: opaque(model.id) ? model.id : null, label: opaque(model.label) ? model.label : null,
        available: model.available === true, ...(opaque(model.effort) ? { effort: model.effort } : {}) }));
      if (models.some(model => !model.id || !model.label)) return false;
      if (!observation) owners.prime(value.requestIds); else owners.observe(binding, value.requestIds);
      observation = { accountReady: value.accountReady === true, selectedModel: opaque(value.selectedModel) ? value.selectedModel : null,
        selectedEffort: opaque(value.selectedEffort) ? value.selectedEffort : null, models };
      observedAt = Date.now();
      onObservation?.({ binding: { ...binding }, ...observation, observedAt });
      return true;
    },
    async resolveRequestOwner(input) {
      if (view().status !== 'ready') throw new Error('Request owner browser binding is unavailable');
      return owners.resolve(input);
    },
    async disconnect() {
      disconnected = true; owners.clear(); binding = null; nonce = null; observation = null; observedAt = null;
      await store?.save?.({ desired: false }); return { status: 'disconnected' };
    },
    async enqueue(operation) {
      if (operation?.kind !== 'models' || !sameBinding(operation.binding, binding)) throw new Error('Only bound read-only model observations are enabled at this milestone');
      return { id: randomUUID() };
    },
    async close() { closing = true; owners.clear(); await Promise.allSettled([...active]); await new Promise(resolve => server.close(resolve)); },
  };
  async function handle(req, res) {
    if (!validateHost(req, res)) return;
    if (closing) throw statusError('Bridge is closing', HTTP_STATUS.unavailable);
    const route = new URL(req.url, bridge.address).pathname;
    const token = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith(AUTH_PREFIX) ? req.headers.authorization.slice(AUTH_PREFIX.length) : '';
    const authorized = await secrets.withSecret(BRIDGE_SECRET_NAME, secret => typeof secret === 'string' && token && equals(token, secret));
    if (!authorized) throw statusError('Companion authorization required', HTTP_STATUS.unauthorized);
    const input = req.method === POST ? await body(req) : {};
    const extensionId = pairing?.extensionId ?? input.extensionId;
    const origin = req.headers.origin;
    if (origin && (!EXTENSION_ID_PATTERN.test(extensionId) || origin !== EXTENSION_ORIGIN_PREFIX + extensionId)) throw statusError('Origin is not the paired extension', HTTP_STATUS.forbidden);
    if (route === ROUTES.pair && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.pair(input));
    if (!pairing || disconnected) throw statusError('Companion is disconnected or unpaired', HTTP_STATUS.conflict);
    if (route === ROUTES.status && req.method === GET) return reply(res, HTTP_STATUS.ok, view());
    if (route === ROUTES.tabs && req.method === POST) { await bridge.reportTabs(input); return reply(res, HTTP_STATUS.ok, await bridge.listTabs()); }
    if (route === ROUTES.bind && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.bind({ ...input, threadId: config.threadId, workspacePath }));
    if (route === ROUTES.poll && req.method === GET) return reply(res, HTTP_STATUS.ok, await bridge.poll());
    if (route === ROUTES.observe && req.method === POST) return reply(res, HTTP_STATUS.ok, { accepted: await bridge.observe(input) });
    if (route === ROUTES.disconnect && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.disconnect());
    throw statusError('Unknown companion route', HTTP_STATUS.notFound);
  }
  const server = http.createServer((req, res) => {
    const task = handle(req, res).catch(error => { if (!res.headersSent) reply(res, error.status ?? HTTP_STATUS.badRequest, { error: error.message }); else res.end(); });
    active.add(task); task.finally(() => active.delete(task));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(BRIDGE_PORT, BRIDGE_HOST, resolve); });
  bridge.address = `${LOCAL_HTTP_PROTOCOL}//${BRIDGE_HOST}:${server.address().port}`;
  return bridge;
}
