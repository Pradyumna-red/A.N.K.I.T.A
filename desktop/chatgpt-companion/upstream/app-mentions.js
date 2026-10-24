/* Focused MIT adaptation of CoS usage.js inspectSystemHints and chatgpt-dom.js
 * addAppMention (2.1.45). Passive app metadata only; never makes an API request.
 */
var AnkitaAppMentions = (() => {
  'use strict';
  const VERSION = 4; // Adapter revision; host-proven connector IDs can bridge a same-chat catalogue gap.
  const prior = globalThis.AnkitaAppMentions;
  if (prior?.version === VERSION && prior.active) { prior.refresh(); return prior; }
  prior?.dispose?.();
  const HINTS_PATH = '/backend-api/system_hints'; // Page-owned app catalogue response observed by upstream.
  const MAX_BYTES = 1024 * 1024; // Bytes/response clone, matching upstream's bounded metadata read.
  const READ_MS = 10_000; // Milliseconds/metadata clone; cancellation does not touch the page's response.
  const MAX_HINTS = 2000; // Entries/response; bounded native catalogue, matching upstream.
  const MAX_NAMES = 256; // Retained public app names/page; no conversation text or credentials.
  const MAX_NAME_CHARS = 80; // Characters/native display name, matching addAppMention upstream.
  const MAX_READERS = 2; // Concurrent passive catalogue reads/page.
  const APP_ID = /^(?:plugin|connector):(asdk_app_[A-Za-z0-9_-]{1,160})$/;
  const APP_PATH = /^app:\/\/asdk_app_[A-Za-z0-9_-]{1,160}$/;
  const CHIP = '[data-prompt-link-href^="app://"], [app-mention-path]';
  const NOT_PROMPT = 'style,script,noscript,template'; // CoS editorText excludes these actual elements, retaining literal markup typed as text.
  let active = true, observed = false, complete = false;
  const names = new Map(), remembered = new Map(), readers = new Set(), responses = new WeakSet();
  let ownedFetch, restoreFetch;
  async function inspect(response) {
    if (!active || readers.size >= MAX_READERS) return;
    let url;
    try { url = new URL(response.url); } catch { return; }
    if (url.origin !== location.origin || url.pathname !== HINTS_PATH || !response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
    if (responses.has(response)) return;
    responses.add(response); // Observe each response once, including requests started before a hook refresh.
    const reader = response.clone().body?.getReader();
    if (!reader) return;
    readers.add(reader);
    const timer = setTimeout(() => void reader.cancel().catch(() => {}), READ_MS);
    try {
      let text = '', bytes = 0; const decoder = new TextDecoder();
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > MAX_BYTES || !active) return;
        text += decoder.decode(chunk.value, { stream: true });
      }
      const hints = JSON.parse(text + decoder.decode())?.system_hints;
      if (!Array.isArray(hints) || !active) return;
      const full = url.searchParams.get('mode') === 'plugins';
      if (complete && !full) return; // A partial list cannot revoke or replace an authoritative list.
      const next = full ? new Map() : new Map([...names].map(([name, ids]) => [name, new Set(ids)]));
      for (const hint of hints.slice(0, MAX_HINTS)) {
        const id = APP_ID.exec(hint?.system_hint)?.[1];
        const name = typeof hint?.name === 'string' ? hint.name.trim() : '';
        if (!id || !name || name.length > MAX_NAME_CHARS || /[\u0000-\u001f\u007f]/.test(name)) continue;
        if (!next.has(name)) { if (next.size >= MAX_NAMES) return; next.set(name, new Set()); }
        next.get(name).add(`app://${id}`);
      }
      names.clear(); for (const [name, ids] of next) names.set(name, ids);
      observed = true; complete ||= full;
    } catch { /* Missing or unreadable metadata never chooses an app by guesswork. */ }
    finally { clearTimeout(timer); readers.delete(reader); void reader.cancel().catch(() => {}); }
  }
  function refresh() {
    if (!active || globalThis.fetch === ownedFetch || typeof globalThis.fetch !== 'function') return;
    const delegate = globalThis.fetch;
    const wrapper = function (...args) {
      return Reflect.apply(delegate, this, args).then(response => {
        if (active) void inspect(response);
        return response;
      });
    };
    restoreFetch = delegate; ownedFetch = wrapper; globalThis.fetch = wrapper;
  }
  refresh();
  document.addEventListener('DOMContentLoaded', refresh, { once: true });
  function resolve(requested = []) {
    if (!requested.length) return { ready: true, appMentions: [] };
    const appMentions = [];
    for (const name of requested) {
      const known = remembered.get(name);
      if (known) {
        if (complete && ![...names.values()].some(paths => paths.has(known))) return { ready: false, reason: 'app-not-found' };
        appMentions.push({ name, path: known }); continue;
      }
      if (!observed) return { ready: false, reason: 'apps-unobserved' };
      const paths = names.get(name);
      if (!paths?.size) return { ready: false, reason: 'app-not-found' };
      if (paths.size !== 1) return { ready: false, reason: 'app-name-ambiguous' };
      appMentions.push({ name, path: [...paths][0] });
    }
    return { ready: true, appMentions };
  }
  function remember(apps = []) {
    remembered.clear();
    for (const app of apps) if (typeof app?.name === 'string' && app.name.length <= MAX_NAME_CHARS && APP_PATH.test(app.path)) remembered.set(app.name, app.path);
  }
  function plainText(box) {
    if (!box || box.matches?.(NOT_PROMPT)) return '';
    const clone = box.cloneNode(true);
    for (const presentation of clone.querySelectorAll(NOT_PROMPT)) presentation.remove();
    for (const chip of clone.querySelectorAll(CHIP)) chip.remove();
    const read = node => node.nodeType === Node.TEXT_NODE ? node.textContent : node.nodeName === 'BR' ? '\n' : [...node.childNodes].map(read).join('') + (/^(P|DIV)$/.test(node.nodeName) ? '\n' : '');
    return [...clone.childNodes].map(read).join('');
  }
  const unchanged = (box, expected) => plainText(box).replace(/\s+/g, '') === expected.replace(/\s+/g, '');
  const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const nextTask = () => new Promise(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  async function add(box, mentions, stillCurrent) {
    const expected = plainText(box), before = new Set(box.querySelectorAll(CHIP));
    const own = () => [...box.querySelectorAll(CHIP)].filter(node => !before.has(node));
    try {
      for (const mention of mentions) {
        if (!stillCurrent() || !APP_PATH.test(mention.path) || !mention.name || mention.name.length > MAX_NAME_CHARS || !slug(mention.name)) throw new Error();
        const token = document.createElement('span');
        token.setAttribute('app-mention-name', slug(mention.name));
        token.setAttribute('app-mention-display-name', mention.name);
        token.setAttribute('app-mention-path', mention.path);
        token.setAttribute('data-prompt-link-href', mention.path);
        token.setAttribute('data-prompt-link-label', `$${slug(mention.name)}`);
        token.textContent = mention.name;
        box.focus(); const selection = document.getSelection();
        if (!selection || document.activeElement !== box) throw new Error();
        selection.selectAllChildren(box); selection.collapseToEnd();
        if (!document.execCommand('insertHTML', false, ` ${token.outerHTML}`)) throw new Error();
        await nextTask(); // Let the editor adopt its native tag before considering Send.
        if (!stillCurrent() || !unchanged(box, expected) || !own().some(node => node.getAttribute('app-mention-path') === mention.path)) throw new Error();
      }
      return { ready: true, cleanup: () => { for (const node of own()) node.remove(); } };
    } catch {
      for (const node of own()) node.remove();
      return { ready: false, reason: 'app-tag-unconfirmed' };
    }
  }
  function withoutLinks(value, mentions = []) {
    let text = String(value ?? '').trimEnd();
    for (const mention of [...mentions].reverse()) {
      const link = `[$${slug(mention.name)}](${mention.path})`;
      if (text.endsWith(link)) text = text.slice(0, -link.length).trimEnd();
    }
    return text;
  }
  function dispose() {
    active = false; names.clear(); remembered.clear();
    document.removeEventListener('DOMContentLoaded', refresh);
    for (const reader of readers) void reader.cancel().catch(() => {});
    if (globalThis.fetch === ownedFetch) globalThis.fetch = restoreFetch;
  }
  return { version: VERSION, get active() { return active; }, refresh, resolve, remember, add, plainText, withoutLinks, dispose };
})();
