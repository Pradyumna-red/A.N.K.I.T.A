/* Focused MIT fork of CoS extension/usage.js; provenance: vendor/chat-on-steroids.
 * Passive clones only: no requests, request headers, credentials, prompt retention or actions.
 */
var AnkitaRequestOrigins = (() => {
  'use strict';
  const VERSION = 1; // Observer implementation version; reinjection must not stack wrappers/readers.
  const prior = globalThis.AnkitaRequestOrigins;
  if (prior?.version === VERSION && prior.refresh?.() === true) return prior;
  prior?.dispose?.();
  const FRAME_CHARS = 512 * 1024; // Characters/SSE frame or retained partial frame, upstream bound.
  const RESPONSE_BYTES = 4 * 1024 * 1024; // Bytes/response clone: never consume unbounded generation.
  const SOCKET_CHARS = 2 * 1024 * 1024; // Characters/socket event, upstream bound.
  const LISTEN_MS = 15 * 60_000; // Milliseconds/stream clone or socket chain, upstream deadline.
  const MAX_READERS = 2; // Concurrent HTTP clones, upstream bound.
  const MAX_ORIGINS = 64; // Opaque request identities/selected binding, upstream replay window.
  const MAX_STREAM_IDS = 16; // Request identities/one response; no transcript retained.
  const MAX_SOCKET_ROWS = 32; // Envelopes/socket event, upstream bound.
  const MAX_SOCKET_FRAMES = 16; // SSE frames/socket item, upstream bound.
  const MAX_SOCKET_STREAMS = 8; // Format states/socket, upstream bound.
  const MAX_SOCKETS = 8; // Active listener records/page; disposal cannot retain arbitrary sockets.
  const MAX_SEEN_ITEMS = 128; // Opaque stream-item dedupe keys/chain, upstream bound.
  const OPAQUE_CHARS = 200; // Characters/socket turn/item identity, upstream bound.
  const MAX_CHANNEL = 1023; // Native delta channel number, upstream format bound.
  const MAX_DELTA_PATH = 1024; // Characters/native delta path, upstream format bound.
  const CONVERSATION = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const REQUEST = /^(?:wfr_[a-zA-Z0-9_-]{1,96}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;
  const CONVERSATION_FIELD = /(?:^|[,{\s])"conversation_id"\s*:\s*"([0-9a-f-]{36})"/gi;
  const RESPONSE_PATH = /^\/backend-api\/(?:conversation|f\/conversation(?:\/resume)?)$/; // Native responses already fetched by the page; never called by ANKITA.
  const EVENT_STREAM = 'text/event-stream';
  const METHOD_POST = 'POST'; const METHOD_GET = 'GET';
  const DELTA = 'delta'; const ENCODING = 'delta_encoding'; const V1 = 'v1';
  const ADD = 'add'; const REPLACE = 'replace';
  const OPERATIONS = [ADD, REPLACE, 'append', 'patch', 'remove', 'truncate']; // Native delta enum vocabulary.
  const BINDING_FIELDS = ['leaseId', 'epoch', 'tabId', 'conversationId']; // Only opaque scope; no workspace/thread context retained in the page.
  const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= OPAQUE_CHARS;
  const same = (a, b) => Boolean(a && b && BINDING_FIELDS.every(key => a[key] === b[key]));
  const origins = new Map(), readers = new Map(), sockets = new Map(), inspected = new WeakSet();
  let active = true, owner = null, config = null, refreshedAt = null, fetchWrapper = null, socketWrapper = null;
  let downstreamFetch = null, downstreamSocket = null;
  function routeMatches() {
    return config && location.origin === config.chatgptOrigin &&
      location.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] === owner?.conversationId;
  }
  function current(captured) {
    const age = Date.now() - refreshedAt;
    return active && same(captured, owner) && routeMatches() && age >= 0 && age <= config.observationMaxAgeMs;
  }
  function reset() {
    for (const [reader, timer] of readers) { clearTimeout(timer); void reader.cancel().catch(() => {}); }
    readers.clear();
    origins.clear();
    for (const record of sockets.values()) record.streams.clear();
  }
  function publish(origin, captured) {
    if (!current(captured) || origin?.conversationId !== captured.conversationId) return;
    for (const id of origin.requestIds) {
      if (origins.has(id)) continue;
      if (origins.size >= MAX_ORIGINS) origins.delete(origins.keys().next().value);
      origins.set(id, true);
    }
  }
  function readOrigin(frame, stream) {
    if (!frame || frame.length > FRAME_CHARS || stream.conflict) { stream.header = null; return; }
    const lines = frame.split(/\r?\n/);
    const type = lines.filter(line => line.startsWith('event:')).at(-1)?.slice('event:'.length).trim() || 'message';
    let event;
    try { event = JSON.parse(lines.filter(line => line.startsWith('data:')).map(line => line.slice('data:'.length).trimStart()).join('\n')); }
    catch { if (type === DELTA || type === ENCODING) stream.header = null; if (type === ENCODING) stream.encoding = false; return; }
    if (type === ENCODING) { stream.encoding = event === V1; stream.header = stream.encoding ? { c: 0, p: '', o: ADD } : null; return; }
    let body;
    if (type === DELTA && stream.encoding === false) return;
    if (type === DELTA && !stream.header && event?.p === '' && event?.o === ADD) body = event.v;
    else if (type === DELTA) {
      if (!stream.header || !event || typeof event !== 'object' || Array.isArray(event)) { stream.header = null; return; }
      const field = key => Object.prototype.hasOwnProperty.call(event, key) ? event[key] : stream.header[key];
      const c = field('c'), p = field('p'), o = field('o');
      if (!Number.isInteger(c) || c < 0 || c > MAX_CHANNEL || typeof p !== 'string' || p.length > MAX_DELTA_PATH || !OPERATIONS.includes(o)) { stream.header = null; return; }
      stream.header = { c, p, o };
      if (c !== 0 || p !== '' || (o !== ADD && o !== REPLACE)) return;
      body = event.v;
    } else body = event?.o === ADD && (event.p === '' || event.p === undefined) &&
      event.v && typeof event.v === 'object' && !Array.isArray(event.v) ? event.v : event;
    const conversations = new Set();
    CONVERSATION_FIELD.lastIndex = 0;
    for (let match; (match = CONVERSATION_FIELD.exec(frame));) if (CONVERSATION.test(match[1])) conversations.add(match[1]);
    // Native /f/conversation names the conversation in its handoff and the request in
    // a subsequent input_message. Remember that join only inside this response/chain.
    // A contradiction permanently poisons the response rather than learning a new owner.
    if (conversations.size > 1) { stream.conflict = true; return; }
    if (conversations.size === 1) {
      const seen = conversations.values().next().value;
      if (stream.conversationId && stream.conversationId !== seen) { stream.conflict = true; return; }
      if (body?.conversation_id !== seen) return;
      stream.conversationId = seen;
    }
    if (!stream.conversationId) return;
    const requestIds = [...new Set([body?.metadata?.request_id, body?.message?.metadata?.request_id,
      body?.input_message?.metadata?.request_id].filter(id => typeof id === 'string' && REQUEST.test(id)))];
    return requestIds.length ? { conversationId: stream.conversationId, requestIds } : null;
  }
  async function inspectResponse(response, captured) {
    if (!current(captured)) return;
    let url;
    try { url = new URL(response.url); } catch { return; }
    if (url.origin !== config.chatgptOrigin || !RESPONSE_PATH.test(url.pathname) || !response.ok ||
        !response.headers.get('content-type')?.includes(EVENT_STREAM) || readers.size >= MAX_READERS) return;
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    const timer = setTimeout(() => void reader.cancel().catch(() => {}), LISTEN_MS);
    readers.set(reader, timer);
    const decoder = new TextDecoder(), emitted = new Set(), stream = {};
    let bytes = 0, buffer = '';
    const scan = frame => {
      const origin = readOrigin(frame, stream);
      if (!origin) return;
      const fresh = origin.requestIds.filter(id => !emitted.has(id)).slice(0, MAX_STREAM_IDS - emitted.size);
      for (const id of fresh) emitted.add(id);
      publish({ conversationId: origin.conversationId, requestIds: fresh }, captured);
    };
    try {
      while (current(captured)) {
        const { done, value } = await reader.read();
        if (!current(captured)) return;
        if (done) break;
        bytes += value.byteLength; if (bytes > RESPONSE_BYTES) return;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const lf = buffer.indexOf('\n\n'), crlf = buffer.indexOf('\r\n\r\n');
          const split = lf < 0 ? crlf : crlf < 0 ? lf : Math.min(lf, crlf);
          if (split < 0) break;
          const width = buffer.startsWith('\r\n\r\n', split) ? 4 : 2;
          scan(buffer.slice(0, split)); buffer = buffer.slice(split + width);
          if (emitted.size >= MAX_STREAM_IDS) return;
        }
        if (buffer.length > FRAME_CHARS) return;
      }
      if (current(captured)) scan(buffer + decoder.decode());
    } catch { /* Unknown stream evidence abstains; the DOM/Fiber reader remains available. */ }
    finally { clearTimeout(timer); readers.delete(reader); void reader.cancel().catch(() => {}); }
  }
  function inspectSocket(event, record) {
    if (!current(record.owner)) { record.streams.clear(); return; }
    if (typeof event.data !== 'string' || event.data.length > SOCKET_CHARS) { record.streams.clear(); return; }
    let rows;
    try { rows = JSON.parse(event.data); } catch { record.streams.clear(); return; }
    if (!Array.isArray(rows) || rows.length > MAX_SOCKET_ROWS) { record.streams.clear(); return; }
    for (const row of rows) {
      const payload = row?.payload?.payload;
      if (row?.type !== 'message' || row.payload?.type !== 'conversation-turn-stream' ||
          payload?.conversation_id !== record.owner.conversationId) continue;
      const key = opaque(payload.turn_id) ? payload.turn_id : null;
      if (payload.type === 'done') { if (key) record.streams.delete(key); continue; }
      if (payload.type !== 'stream-item') continue;
      if (typeof payload.encoded_item !== 'string' || payload.encoded_item.length > FRAME_CHARS) { if (key) record.streams.delete(key); continue; }
      const frames = payload.encoded_item.split(/\r?\n\r?\n/);
      if (frames.length > MAX_SOCKET_FRAMES) { if (key) record.streams.delete(key); continue; }
      let stream = {};
      if (key && opaque(payload.stream_item_id) && (payload.parent_stream_item_id === null || opaque(payload.parent_stream_item_id))) {
        const now = Date.now(); let retained = record.streams.get(key);
        if (!retained || now < retained.at || now - retained.at > LISTEN_MS) {
          if (!record.streams.has(key) && record.streams.size >= MAX_SOCKET_STREAMS) record.streams.delete(record.streams.keys().next().value);
          retained = { at: now, header: null, last: null, seen: new Set() }; record.streams.set(key, retained);
        }
        if (retained.seen.has(payload.stream_item_id)) continue;
        if (payload.parent_stream_item_id !== retained.last) retained.header = null;
        retained.last = payload.stream_item_id;
        if (retained.seen.size >= MAX_SEEN_ITEMS) retained.seen.delete(retained.seen.values().next().value);
        retained.seen.add(payload.stream_item_id); stream = retained;
      } else if (key) record.streams.delete(key);
      for (const frame of frames) if (frame.trim()) publish(readOrigin(frame, stream), record.owner);
    }
  }
  function removeSocket(socket) {
    const record = sockets.get(socket); if (!record) return;
    socket.removeEventListener('message', record.message); socket.removeEventListener('close', record.close);
    record.streams.clear(); sockets.delete(socket);
  }
  function refresh() {
    if (!active) return false;
    if (typeof globalThis.fetch === 'function' && globalThis.fetch !== fetchWrapper) {
      const downstream = globalThis.fetch; downstreamFetch = downstream;
      fetchWrapper = function (...args) {
        const captured = current(owner) ? owner : null;
        const method = String(args[1]?.method || args[0]?.method || METHOD_GET).toUpperCase();
        const result = downstream.apply(this, args);
        if (captured && method === METHOD_POST) void result.then(response => {
          if (!current(captured) || inspected.has(response)) return;
          inspected.add(response); void inspectResponse(response, captured).catch(() => {});
        }).catch(() => {});
        return result;
      };
      globalThis.fetch = fetchWrapper;
    }
    if (typeof globalThis.WebSocket === 'function' && globalThis.WebSocket !== socketWrapper) {
      const downstream = globalThis.WebSocket; downstreamSocket = downstream;
      socketWrapper = new Proxy(downstream, { construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        try {
          const url = new URL(socket.url), native = new URL(config.chatgptOrigin);
          if (current(owner) && url.protocol === 'wss:' && (url.hostname === native.hostname || url.hostname.endsWith('.' + native.hostname))) {
            if (sockets.size >= MAX_SOCKETS) removeSocket(sockets.keys().next().value);
            const record = { owner, streams: new Map() };
            record.message = event => inspectSocket(event, record); record.close = () => removeSocket(socket);
            sockets.set(socket, record); socket.addEventListener('message', record.message); socket.addEventListener('close', record.close);
          }
        } catch { /* Foreign/unsupported sockets remain untouched. */ }
        return socket;
      } });
      globalThis.WebSocket = socketWrapper;
    }
    return true;
  }
  function bind(binding, wire) {
    if (!active || !opaque(binding?.leaseId) || !opaque(binding?.epoch) || !Number.isSafeInteger(binding?.tabId) || !CONVERSATION.test(binding?.conversationId ?? '')) return false;
    if (!same(owner, binding)) { reset(); owner = Object.fromEntries(BINDING_FIELDS.map(key => [key, binding[key]])); }
    config = wire; refreshedAt = Date.now();
    if (!routeMatches()) { reset(); owner = null; return false; }
    return refresh();
  }
  const hide = () => { reset(); owner = null; };
  globalThis.addEventListener?.('pagehide', hide);
  return { version: VERSION, bind, refresh,
    requestIds(binding) { if (!current(binding)) { reset(); return []; } return [...origins.keys()]; },
    dispose() {
      active = false; reset(); owner = null;
      for (const socket of [...sockets.keys()]) removeSocket(socket);
      globalThis.removeEventListener?.('pagehide', hide);
      if (globalThis.fetch === fetchWrapper) globalThis.fetch = downstreamFetch;
      if (globalThis.WebSocket === socketWrapper) globalThis.WebSocket = downstreamSocket;
    },
  };
})();
