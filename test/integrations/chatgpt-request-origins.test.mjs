import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';
import { readSelectedPage } from '../../desktop/chatgpt-companion/content.mjs';

const sourcePath = new URL('../../desktop/chatgpt-companion/upstream/request-origins.js', import.meta.url);
const conversationId = crypto.randomUUID();
const otherConversation = crypto.randomUUID();
const requestId = 'wfr_test-current-request';
const binding = { leaseId: 'lease-fixture', epoch: 'epoch-fixture', tabId: 1, conversationId };
const sse = (body, event = 'message') => `event: ${event}\ndata: ${JSON.stringify(body)}\n\n`;
const handoff = sse({ conversation_id: conversationId, turn_topic_id: 'opaque-turn' });
const input = sse({ input_message: { metadata: { request_id: requestId }, content: { parts: ['private prompt'] } } });

function page(t, downstream) {
  const location = { origin: browserWire.chatgptOrigin, pathname: `/c/${conversationId}` };
  const document = { querySelectorAll: () => [], readyState: 'complete' };
  class Socket extends EventTarget { constructor(url) { super(); this.url = url; } }
  const context = vm.createContext({ location, document, fetch: downstream, WebSocket: Socket, URL,
    TextDecoder, setTimeout, clearTimeout, Date, addEventListener() {}, removeEventListener() {} });
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  context.AnkitaRequestOrigins.bind(binding, browserWire);
  t.after(() => context.AnkitaRequestOrigins.dispose());
  const ids = () => JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds(binding)));
  return { context, ids, location, Socket };
}
function response(text, { url = `${browserWire.chatgptOrigin}/backend-api/f/conversation`, type = 'text/event-stream', ok = true } = {}) {
  const result = new Response(text, { headers: { 'Content-Type': type } });
  Object.defineProperties(result, { url: { value: url }, ok: { value: ok } });
  return result;
}
async function settle(predicate) {
  for (let count = 0; count < 50; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('bounded stream observation did not settle');
}
const emitSocket = (socket, payload) => socket.dispatchEvent(new MessageEvent('message', {
  data: JSON.stringify([{ type: 'message', payload: { type: 'conversation-turn-stream', payload } }]),
}));

test('exact conversation handoff joins the later input_message request ID before React and preserves the page response', async t => {
  const expected = response(handoff + input);
  const { context, ids } = page(t, () => Promise.resolve(expected));
  const original = context.fetch('/backend-api/f/conversation', { method: 'POST', headers: { Authorization: 'private credential' }, body: 'private prompt' });
  assert.equal(await original, expected);
  assert.equal(await expected.text(), handoff + input, 'the observer must consume only its clone');
  await settle(() => ids().length > 0);
  assert.deepEqual(ids(), [requestId]);
  assert.equal(JSON.stringify(context.AnkitaRequestOrigins.requestIds(binding)).includes('private'), false);
});
test('an opening retains passive first-turn request metadata until its exact user receipt confirms the real chat', async t => {
  const tool = { author: { role: 'tool', name: 'api_tool.call_tool' }, metadata: { request_id: requestId,
    invoked_resource: { resource_uri: '/asdk_app_owned/link_owned/read_file', app_name: 'ANKITA Proof' } } };
  const { context, location } = page(t, () => Promise.resolve(response(handoff + input + sse({ message: tool }))));
  const opening = { ...binding, conversationId: null, openingId: crypto.randomUUID() };
  location.pathname = '/'; location.hash = '#ankita-opening=' + opening.openingId;
  context.URLSearchParams = URLSearchParams;
  context.AnkitaBrowserDelivery = { openingActive: () => true }; // Fixture's exact authored Send is active; no browser action is mocked here.
  assert.equal(context.AnkitaRequestOrigins.bind(opening, browserWire), true);
  await context.fetch('/backend-api/f/conversation', { method: 'POST' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds(opening))), [], 'pending metadata cannot grant a native tool request before chat adoption');
  location.pathname = '/c/' + conversationId; location.hash = '';
  const adopted = { ...opening, conversationId };
  assert.equal(context.AnkitaRequestOrigins.bind(adopted, browserWire), true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds(adopted))), [requestId]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.appSightings(adopted))), [
    { requestId, appId: 'asdk_app_owned', appName: 'ANKITA Proof', toolName: 'read_file' },
  ]);
});

test('root delta messages inherit only validated v1 headers and ignore text and nested request-like fields', async t => {
  const body = { conversation_id: conversationId, message: { metadata: { request_id: requestId } } };
  const frames = handoff + sse('v1', 'delta_encoding') + sse({ v: body }, 'delta') +
    sse({ v: { input_message: { metadata: { request_id: 'wfr_second' } } } }, 'delta') +
    sse({ content: { parts: ['{"metadata":{"request_id":"wfr_in_text"}}'] }, arguments: { metadata: { request_id: 'wfr_nested' } } });
  const { context, ids } = page(t, () => Promise.resolve(response(frames)));
  await context.fetch('/backend-api/f/conversation', { method: 'POST' });
  await settle(() => ids().length === 2);
  assert.deepEqual(ids(), [requestId, 'wfr_second']);
});

test('foreign origins, history, GETs, non-streams and conflicting conversation responses cannot establish a request owner', async t => {
  const cases = [
    [response(handoff + input, { url: 'https://other.invalid/backend-api/f/conversation' }), 'POST'],
    [response(handoff + input, { url: `${browserWire.chatgptOrigin}/backend-api/conversation/${conversationId}` }), 'POST'],
    [response(handoff + input), 'GET'],
    [response(handoff + input, { type: 'application/json' }), 'POST'],
    [response(handoff + sse({ conversation_id: otherConversation }) + input + handoff + input), 'POST'],
    [response(sse({ unrelated: { conversation_id: conversationId }, metadata: { request_id: requestId } })), 'POST'],
    [response(sse({ input_message: { metadata: { request_id: requestId } } })), 'POST'],
  ];
  let next;
  const { context, ids } = page(t, () => Promise.resolve(next));
  for (const [result, method] of cases) { next = result; await context.fetch('/backend-api/f/conversation', { method }); }
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(ids(), []);
});

test('a response started under an old binding or changed page cannot enter the new binding', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const { context, ids, location } = page(t, () => pending);
  const fetching = context.fetch('/backend-api/f/conversation', { method: 'POST' });
  context.AnkitaRequestOrigins.bind({ ...binding, epoch: 'rebound' }, browserWire);
  release(response(handoff + input)); await fetching;
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(ids(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds({ ...binding, epoch: 'rebound' }))), []);
  location.pathname = `/c/${otherConversation}`;
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds({ ...binding, epoch: 'rebound' }))), []);
});

test('WebSocket handoff joins exact consecutive items and refuses gaps or another conversation envelope', t => {
  const { context, ids } = page(t, () => Promise.reject(new Error('must not fetch')));
  const socket = new context.WebSocket('wss://chatgpt.com/live');
  const row = { conversation_id: conversationId, turn_id: 'turn-one', type: 'stream-item', stream_item_id: 'first', parent_stream_item_id: null,
    encoded_item: handoff + sse('v1', 'delta_encoding') };
  emitSocket(socket, row);
  emitSocket(socket, { ...row, stream_item_id: 'second', parent_stream_item_id: 'first', encoded_item: sse({ v: { input_message: { metadata: { request_id: requestId } } } }, 'delta') });
  assert.deepEqual(ids(), [requestId]);
  emitSocket(socket, { ...row, stream_item_id: 'gap', parent_stream_item_id: 'missing', encoded_item: sse({ v: { input_message: { metadata: { request_id: 'wfr_gap' } } } }, 'delta') });
  emitSocket(socket, { ...row, conversation_id: otherConversation, stream_item_id: 'foreign', encoded_item: handoff + input });
  assert.deepEqual(ids(), [requestId]);
});

test('active readers are bounded, reinjection preserves one observer, and disposal restores transports', async t => {
  let cancelled = 0;
  const readers = [];
  const downstream = () => {
    const reader = { read: () => new Promise(() => {}), cancel: async () => { cancelled++; } };
    readers.push(reader);
    return Promise.resolve({ ok: true, url: `${browserWire.chatgptOrigin}/backend-api/f/conversation`,
      headers: { get: () => 'text/event-stream' }, clone: () => ({ body: { getReader: () => reader } }) });
  };
  const { context } = page(t, downstream);
  const installed = context.fetch;
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context);
  assert.equal(context.fetch, installed);
  await Promise.all([1, 2, 3].map(() => context.fetch('/backend-api/f/conversation', { method: 'POST' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readers.length, 3);
  context.AnkitaRequestOrigins.dispose();
  assert.equal(cancelled, 2, 'only two response clones may be read');
  assert.equal(context.fetch, downstream);
});

test('oversized frames, invalid deltas and split responses cannot lend ownership to later messages', async t => {
  let next;
  const { context, ids } = page(t, () => Promise.resolve(next));
  const cases = [
    sse({ conversation_id: conversationId, metadata: { request_id: requestId }, text: 'x'.repeat(512 * 1024) }),
    handoff + sse('v2', 'delta_encoding') + sse({ p: '', o: 'add', v: { metadata: { request_id: requestId } } }, 'delta'),
    handoff + sse('v1', 'delta_encoding') + sse({ c: 1, p: '', o: 'add', v: { metadata: { request_id: requestId } } }, 'delta'),
    handoff + sse('v1', 'delta_encoding') + sse({ p: '/content/parts', o: 'add', v: { metadata: { request_id: requestId } } }, 'delta'),
    handoff,
    input,
  ];
  for (const frames of cases) { next = response(frames); await context.fetch('/backend-api/f/conversation', { method: 'POST' }); await new Promise(resolve => setTimeout(resolve, 15)); }
  assert.deepEqual(ids(), []);
});

test('a cancelled old response cannot regain its binding and an unrelated socket remains unobserved', t => {
  const { context, ids } = page(t, () => Promise.reject(new Error('must not fetch')));
  const foreign = new context.WebSocket('wss://other.invalid/live');
  emitSocket(foreign, { conversation_id: conversationId, type: 'stream-item', encoded_item: handoff + input });
  const native = new context.WebSocket('wss://chatgpt.com/live');
  context.AnkitaRequestOrigins.bind({ ...binding, epoch: 'replacement' }, browserWire);
  emitSocket(native, { conversation_id: conversationId, type: 'stream-item', encoded_item: handoff + input });
  assert.deepEqual(ids(), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.AnkitaRequestOrigins.requestIds({ ...binding, epoch: 'replacement' }))), []);
});

test('selected-page projection includes only current stream IDs even with unavailable model picker and no React turn', t => {
  const { context, ids } = page(t, () => Promise.reject(new Error('must not fetch')));
  const socket = new context.WebSocket('wss://chatgpt.com/live');
  emitSocket(socket, { conversation_id: conversationId, type: 'stream-item', encoded_item: handoff + input });
  assert.deepEqual(ids(), [requestId]);
  context.AnkitaPageReaders = { composer: () => ({ closest: () => null }) };
  const read = vm.runInContext(`(${readSelectedPage.toString()})`, context);
  const actual = JSON.parse(JSON.stringify(read(conversationId, browserWire, binding)));
  assert.equal(actual.accountReady, true);
  assert.deepEqual(actual.requestIds, [requestId]);
  assert.equal(actual.selectedModel, null);
});
