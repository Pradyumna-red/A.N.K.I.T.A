import http from 'node:http';
import fs from 'node:fs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { localhostHostValidation } from '@modelcontextprotocol/node';
import { RequestOwners, sameBinding } from '../../src/integrations/chatgpt-browser/request-owners.mjs';
import { JSON_CONTENT_TYPE, HTTP_STATUS, LOCAL_HTTP_PROTOCOL, BEARER_PREFIX, BROWSER_BINDING_FIELDS, BROWSER_BLOCK_REASONS } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { COMPANION_VERSION, BRIDGE_HOST, BRIDGE_PORT, BRIDGE_MAX_BODY_BYTES, BRIDGE_SECRET_NAME, OBSERVATION_MAX_AGE_MS,
  MAX_TABS, MAX_MODELS, MAX_REQUEST_IDS, MAX_ID_CHARS, ROUTES, EXTENSION_ID_PATTERN, PAGE_UNAVAILABLE_STATUS, BRIDGE_READY_STATUS, BRIDGE_OBSERVING_STATUS,
  MODEL_MODES, OBSERVATION_REASONS, conversationFromUrl } from './config.mjs';

const POST = 'POST'; const GET = 'GET'; const EXTENSION_ORIGIN_PREFIX = 'chrome-extension://';
const AUTH_PREFIX = BEARER_PREFIX; const NO_CACHE = 'no-store';
const OWNER_BINDING_UNAVAILABLE_MESSAGE = 'Request owner browser binding is unavailable'; // Shared refusal for absent/blocked page authority; a transient freshness gap waits instead.
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
export async function createCompanionBridge({ config, secrets, store, onObservation, delivery } = {}) {
  if (!config?.workspacePath || !config?.threadId || !secrets?.withSecret) throw new TypeError('Bridge requires explicit workspace, thread and protected secret provider');
  const modelMode = config.modelMode ?? MODEL_MODES.explicit;
  const workspacePath = fs.realpathSync(config.workspacePath);
  if (!fs.statSync(workspacePath).isDirectory()) throw new Error('Proof workspace is not a directory');
  const owners = new RequestOwners(); const validateHost = localhostHostValidation();
  const restored = await store?.load?.();
  let pairing = restored?.pairing ?? null, tabs = [], binding = restored?.binding ? Object.freeze({ ...restored.binding }) : null, nonce = null, observation = null, observedAt = null;
  let selectedTabUnavailable = false; // Current tab inventory can revoke page authority without discarding unsettled Send custody.
  let disconnected = restored?.desired === false;
  let port = BRIDGE_PORT;
  if (restored?.address) {
    const address = new URL(restored.address);
    if (address.protocol !== LOCAL_HTTP_PROTOCOL || address.hostname !== BRIDGE_HOST || address.pathname !== '/' || address.hash || address.search || address.username || address.password || !address.port) throw new Error('Invalid restored bridge address');
    port = Number(address.port);
  }
  if (pairing && (!EXTENSION_ID_PATTERN.test(pairing.extensionId) || !opaque(pairing.browserId))) throw new Error('Invalid restored companion identity');
  if (binding) {
    if (!pairing || binding.browserId !== pairing.browserId || binding.threadId !== config.threadId || binding.workspacePath !== workspacePath ||
        !Number.isSafeInteger(binding.tabId) || BROWSER_BINDING_FIELDS.filter(key => key !== 'tabId' && key !== 'workspacePath').some(key => !opaque(binding[key]))) throw new Error('Invalid restored browser binding');
    owners.bind(binding); await delivery?.recover(binding);
  }
  const persist = () => store?.save?.({ desired: !disconnected, pairing, binding, address: bridge.address });
  let bindingAdmissions = Promise.resolve();
  const admitBinding = action => {
    // Selection changes and durable Send admission share custody even across asynchronous journal reads.
    const task = bindingAdmissions.catch(() => {}).then(action);
    bindingAdmissions = task; return task;
  };
  const replaceBinding = async input => {
    binding = Object.freeze({ leaseId: randomUUID(), epoch: randomUUID(), browserId: pairing.browserId, tabId: input.tabId,
      conversationId: input.conversationId, threadId: config.threadId, workspacePath });
    observation = null; observedAt = null; nonce = null; owners.bind(binding);
    selectedTabUnavailable = false;
    await persist(); return { ...binding };
  };
  const requireSettledBinding = async () => {
    const current = binding;
    if (current && delivery && !await delivery.canReplaceBinding(current))
      throw statusError('Resume the unresolved reply or confirm Stop before changing the selected chat', HTTP_STATUS.conflict);
    if (!sameBinding(current, binding) && current !== binding) throw statusError('Selected browser binding changed', HTTP_STATUS.conflict);
  };
  const active = new Set(); let closing = false;
  const view = () => {
    const fresh = observedAt !== null && Date.now() - observedAt <= OBSERVATION_MAX_AGE_MS;
    const accountReady = fresh && observation?.accountReady === true;
    const matches = observation?.models?.filter(model => model.id === observation.selectedModel && model.available &&
      (!observation.selectedEffort || model.effort === observation.selectedEffort)) ?? [];
    const selected = matches.length === 1 ? matches[0] : null;
    return { status: disconnected || closing ? 'disconnected' : !pairing ? 'pairing-required' : !binding || selectedTabUnavailable ? 'select-tab' : !fresh ? BRIDGE_OBSERVING_STATUS : observation?.blockedReason ? 'blocked' : !accountReady ? PAGE_UNAVAILABLE_STATUS : !selected && modelMode !== MODEL_MODES.current ? 'model-unavailable' : BRIDGE_READY_STATUS,
      binding: binding && { ...binding }, accountReady: Boolean(accountReady), selectedModel: fresh ? observation?.selectedModel ?? null : null,
      models: fresh ? observation?.models ?? [] : [], modelMode, blockedReason: fresh ? observation?.blockedReason ?? null : null, observationReason: fresh ? observation?.observationReason ?? null : null, observedAt };
  };
  const bridge = {
    address: null, view,
    async pair(input) {
      if (disconnected || closing) throw statusError('Explicitly disconnected; host must authorize a new connection', HTTP_STATUS.conflict);
      if (input?.version !== COMPANION_VERSION) throw statusError('Companion version mismatch', HTTP_STATUS.conflict);
      if (!EXTENSION_ID_PATTERN.test(input.extensionId) || !opaque(input.browserId)) throw statusError('Invalid companion identity');
      if (pairing && (pairing.extensionId !== input.extensionId || pairing.browserId !== input.browserId)) throw statusError('Another companion already owns this bridge', HTTP_STATUS.conflict);
      pairing = { extensionId: input.extensionId, browserId: input.browserId };
      await persist();
      return { version: COMPANION_VERSION, status: view().status };
    },
    async reportTabs(input) {
      return admitBinding(async () => {
      if (!pairing || input.browserId !== pairing.browserId || disconnected) throw statusError('Wrong paired browser', HTTP_STATUS.forbidden);
      if (!Array.isArray(input.tabs) || input.tabs.length > MAX_TABS) throw statusError('Invalid tab list');
      tabs = input.tabs.map(tab => ({ id: tab.id, conversationId: conversationFromUrl(tab.url), title: typeof tab.title === 'string' ? tab.title.slice(0, MAX_ID_CHARS) : '' }))
        .filter(tab => Number.isSafeInteger(tab.id) && tab.conversationId);
      if (binding && !tabs.some(tab => tab.id === binding.tabId && tab.conversationId === binding.conversationId)) {
        if (delivery && !await delivery.canReplaceBinding(binding)) {
          selectedTabUnavailable = true; nonce = null; observedAt = null;
          owners.observe(binding, []); // Wake waiters to revoke freshness; retain exact ownership for return to this same page.
          await delivery.block(binding, 'transport');
        } else { owners.clear(); binding = null; nonce = null; observation = null; observedAt = null; }
        await persist();
      } else selectedTabUnavailable = false;
      return { status: view().status };
      });
    },
    async listTabs() { return tabs.map(tab => ({ ...tab, browserId: pairing.browserId, bound: binding?.tabId === tab.id })); },
    async bind(input) {
      return admitBinding(async () => {
      if (!pairing || disconnected || input.browserId !== pairing.browserId) throw statusError('Browser is not paired', HTTP_STATUS.forbidden);
      if (input.threadId !== config.threadId || fs.realpathSync(input.workspacePath) !== workspacePath) throw statusError('Host workspace/thread cannot be replaced', HTTP_STATUS.forbidden);
      if (!tabs.some(tab => tab.id === input.tabId && tab.conversationId === input.conversationId)) throw statusError('Selected tab does not own the conversation', HTTP_STATUS.forbidden);
      // Repeating Observe on the same selection preserves its pending reply and exact native owners.
      if (binding?.tabId === input.tabId && binding.conversationId === input.conversationId) return { ...binding };
      await requireSettledBinding();
      return replaceBinding(input);
      });
    },
    async renewBinding(owner) {
      return admitBinding(async () => {
      if (!sameBinding(owner, binding) || view().status !== BRIDGE_READY_STATUS) throw new Error('Fresh selected browser binding is required for renewal');
      await requireSettledBinding();
      return replaceBinding(binding); // Host-only: an explicit new Send after settled Stop starts fresh custody.
      });
    },
    async poll() {
      if (!pairing || !binding || disconnected || selectedTabUnavailable) return { binding: null };
      const current = binding;
      const operation = delivery && view().status === BRIDGE_READY_STATUS ? await delivery.poll(current) : null;
      const readback = delivery ? await delivery.readback(current) : null;
      const stopOperation = delivery ? await delivery.pollStop(current) : null;
      const stopReadback = delivery ? await delivery.stopReadback(current) : null;
      if (!sameBinding(current, binding) || disconnected) return { binding: null };
      nonce = randomUUID(); return { binding: { ...binding }, nonce, operation, readback, stopOperation, stopReadback };
    },
    async observe(input) {
      if (disconnected || selectedTabUnavailable || !sameBinding(input?.binding, binding) || !nonce || input.nonce !== nonce || input.snapshot?.conversationId !== binding.conversationId) return false;
      const value = input.snapshot; nonce = null;
      if (!Array.isArray(value.models) || value.models.length > MAX_MODELS || !Array.isArray(value.requestIds) || value.requestIds.length > MAX_REQUEST_IDS) return false;
      const models = value.models.map(model => ({ id: opaque(model.id) ? model.id : null, label: opaque(model.label) ? model.label : null,
        available: model.available === true, ...(opaque(model.effort) ? { effort: model.effort } : {}) }));
      if (models.some(model => !model.id || !model.label)) return false;
      const firstObservation = !observation;
      observation = { accountReady: value.accountReady === true, selectedModel: opaque(value.selectedModel) ? value.selectedModel : null,
        selectedEffort: opaque(value.selectedEffort) ? value.selectedEffort : null, models,
        requestIdCount: value.requestIds.length,
        requestEvidence: { observerReady: value.requestEvidence?.observerReady === true,
          streamIds: Number.isSafeInteger(value.requestEvidence?.streamIds) && value.requestEvidence.streamIds >= 0 && value.requestEvidence.streamIds <= MAX_REQUEST_IDS ? value.requestEvidence.streamIds : 0,
          domIds: Number.isSafeInteger(value.requestEvidence?.domIds) && value.requestEvidence.domIds >= 0 && value.requestEvidence.domIds <= MAX_REQUEST_IDS ? value.requestEvidence.domIds : 0 },
        observationReason: Object.values(OBSERVATION_REASONS).includes(value.observationReason) ? value.observationReason : null,
        blockedReason: BROWSER_BLOCK_REASONS.includes(value.blockedReason) ? value.blockedReason : null };
      observedAt = Date.now();
      if (firstObservation) owners.prime(value.requestIds); else owners.observe(binding, value.requestIds); // Wake exact-owner waiters only after freshness/blocked state has been updated.
      await onObservation?.({ binding: { ...binding }, ...observation, modelMode, observedAt });
      if (observation.blockedReason) { await delivery?.block(binding, observation.blockedReason); return true; }
      if (delivery && value.delivery) {
        await delivery.receipt(value.delivery.operationId, binding, value.delivery.receipt);
        if (value.delivery.progress) await delivery.progress(value.delivery.operationId, binding, value.delivery.progress);
        if (value.delivery.answer) await delivery.observe(value.delivery.operationId, binding, value.delivery.answer);
      }
      return true;
    },
    async authorize(input) {
      if (!delivery || disconnected || !sameBinding(input?.binding, binding) || view().status !== BRIDGE_READY_STATUS) return { allowed: false };
      if (input.kind === 'stop') return { allowed: await delivery.authorizeStop(input.operationId, binding, input.witness) };
      if (!Array.isArray(input.witness?.baselineUserIds)) return { allowed: false };
      return { allowed: await delivery.authorize(input.operationId, binding, input.witness) };
    },
    async acknowledge(input) {
      if (!delivery || disconnected || !sameBinding(input?.binding, binding)) throw statusError('Browser receipt binding is unavailable', HTTP_STATUS.forbidden);
      if (input.kind === 'stop') return { accepted: await delivery.observeStop(input.operationId, binding, { receipt: input.receipt, confirmed: input.confirmed }) };
      if (input.failure === true) return { failed: Boolean(await delivery.fail(input.operationId, binding)) };
      return { accepted: await delivery.receipt(input.operationId, binding, input.receipt) };
    },
    async resolveRequestOwner(input) {
      const original = binding, status = view().status;
      if (!observation || ![BRIDGE_READY_STATUS, BRIDGE_OBSERVING_STATUS].includes(status)) throw new Error(OWNER_BINDING_UNAVAILABLE_MESSAGE);
      return owners.resolve({ ...input, ready: owner => {
        if (!sameBinding(original, binding) || !sameBinding(owner, binding)) throw new Error('Request owner browser binding changed');
        const current = view().status;
        if (current === BRIDGE_OBSERVING_STATUS) return false; // The existing bounded owner wait can absorb a refresh gap; stale evidence never admits execution.
        if (current !== BRIDGE_READY_STATUS) throw new Error(OWNER_BINDING_UNAVAILABLE_MESSAGE);
        return true;
      } });
    },
    async disconnect() {
      return admitBinding(async () => {
      disconnected = true; owners.clear(); binding = null; nonce = null; observation = null; observedAt = null;
      await persist(); return { status: 'disconnected' };
      });
    },
    async enqueue(operation) {
      return admitBinding(async () => {
      if (disconnected || closing || selectedTabUnavailable || !sameBinding(operation?.binding, binding)) throw new Error('Operation does not own the current browser binding');
      if (operation.kind === 'send' && delivery) return delivery.enqueue(operation);
      if (operation.kind !== 'models') throw new Error('Only bound read-only model observations are enabled at this milestone');
      return { id: randomUUID() };
      });
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
    if (route === ROUTES.authorize && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.authorize(input));
    if (route === ROUTES.receipt && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.acknowledge(input));
    if (route === ROUTES.disconnect && req.method === POST) return reply(res, HTTP_STATUS.ok, await bridge.disconnect());
    throw statusError('Unknown companion route', HTTP_STATUS.notFound);
  }
  const server = http.createServer((req, res) => {
    const task = handle(req, res).catch(error => { if (!res.headersSent) reply(res, error.status ?? HTTP_STATUS.badRequest, { error: error.message }); else res.end(); });
    active.add(task); task.finally(() => active.delete(task));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, BRIDGE_HOST, resolve); });
  bridge.address = `${LOCAL_HTTP_PROTOCOL}//${BRIDGE_HOST}:${server.address().port}`;
  try { await persist(); } catch (error) { await bridge.close(); throw error; }
  return bridge;
}
