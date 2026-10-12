/* Focused MIT CoS DOM/input receipt fork; provenance: vendor/chat-on-steroids.
 * Only a host-dispatched operation can click one exact native Send control.
 */
var AnkitaBrowserDelivery = (() => {
  const VERSION = 2; // Adapter revision; the durable host dispatch prevents replay across upgrades; watch restores only observation custody.
  const prior = globalThis.AnkitaBrowserDelivery;
  if (prior?.version === VERSION) return prior;
  const SCOPE = ['leaseId', 'epoch', 'tabId', 'conversationId']; // Opaque page ownership only.
  const SEND = 'button[data-testid="send-button"], button[aria-label^="Send" i], button[type="submit"]';
  const STOP = 'button[data-testid="stop-button"], button[data-testid="composer-stop-button"], button[aria-label="Stop streaming"], button[aria-label="Stop generating"], button[aria-label="Stop answering"]';
  const PRIMARY = 'button[class*="size-token-button-composer"][class*="bg-composer-primary"]';
  const STOP_SQUARE = /^\s*M4\.5 5\.75/; // Native locale-free icon from upstream, not an arbitrary screen coordinate.
  const TURN_ID_ATTRIBUTE = 'data-turn-id'; const TURN_KEY_ATTRIBUTE = 'data-turn-key';
  const FALLBACK_TURN = /^fallback-turn-\d+$/; // Upstream rejects virtualized position keys as native identities.
  const MAX_ICON_PATHS = 2; // Native arrow has at most two paths; microphone has four and cannot be Send.
  const same = (a, b) => Boolean(a && b && SCOPE.every(key => a[key] === b[key]));
  const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const opaque = (value, config) => typeof value === 'string' && value.length > 0 && value.length <= config.maxIdChars;
  const visible = (node, config) => Boolean(node?.isConnected && node.getClientRects().length && !node.closest(config.hidden) &&
    getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
  const route = (scope, config) => location.origin === config.chatgptOrigin && location.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] === scope?.conversationId;
  let state = null;
  const draft = box => typeof box.value === 'string' ? box.value : box.innerText ?? box.textContent ?? '';
  function controls(selector, box, config) {
    const form = box?.closest('form');
    return form ? [...form.querySelectorAll(selector)].filter(node => visible(node, config) && node.closest('form') === form) : [];
  }
  function stopSquare(button) {
    if (button.hasAttribute('data-state')) return false;
    const paths = button.querySelectorAll('svg path'); return paths.length === 1 && STOP_SQUARE.test(paths[0].getAttribute('d') ?? '');
  }
  function busy(box, config) { return controls(STOP, box, config).length > 0 || controls(PRIMARY, box, config).some(stopSquare); }
  function sendControl(box, config) {
    const labelled = controls(SEND, box, config);
    const choices = labelled.length ? labelled : controls(PRIMARY, box, config).filter(button => {
      const paths = button.querySelectorAll('svg path');
      return compact(draft(box)) && !busy(box, config) && !button.hasAttribute('data-state') && !stopSquare(button) && paths.length >= 1 && paths.length <= MAX_ICON_PATHS;
    });
    const button = choices.length === 1 ? choices[0] : null;
    return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' ? button : null;
  }
  function nativeRows(scope, config) {
    const readers = globalThis[config.readerGlobal], rows = new Map();
    for (const section of [...document.querySelectorAll(config.turns)].slice(-config.maxTurns)) {
      if (!visible(section, config)) continue;
      const fiber = readers.fiberOf(section), evidence = readers.conversationEvidenceOf(fiber);
      if (evidence.conflict || evidence.conversationId !== scope.conversationId) continue;
      const explicit = section.getAttribute(TURN_ID_ATTRIBUTE) || section.closest(`[${TURN_KEY_ATTRIBUTE}]`)?.getAttribute(TURN_KEY_ATTRIBUTE);
      const messages = (readers.shellTurnMessages(fiber, explicit, config.maxFinalTextChars) ?? readers.turnMessagesOf(fiber, config.maxFinalTextChars) ?? []).slice(-config.maxRequests);
      const users = messages.filter(message => message?.author?.role === 'user' && opaque(message.id, config));
      const group = users.length === 1 && opaque(explicit, config) && !FALLBACK_TURN.test(explicit) ? explicit : null;
      let currentUser = null;
      for (const message of messages) {
        if (!opaque(message?.id, config)) continue;
        if (message.author?.role === 'user') currentUser = message.id;
        if (!currentUser) continue;
        const turnId = group ?? currentUser;
        const prior = rows.get(message.id);
        if (prior && (prior.turnId !== turnId || prior.userMessageId !== currentUser)) { rows.set(message.id, null); continue; }
        // Copy authored prose only for user/public final messages. Analysis and commentary have no text projection.
        const role = message.author?.role, isPublic = role === 'user' || (role === 'assistant' && message.channel === 'final');
        const parts = isPublic && ['text', 'multimodal_text'].includes(message.content?.content_type) ? message.content.parts : null;
        const text = Array.isArray(parts) && parts.every(part => typeof part === 'string') ? parts.join('\n') : null;
        rows.set(message.id, { id: message.id, role, turnId, userMessageId: currentUser, channel: message.channel,
          end_turn: message.end_turn, status: message.status, text });
      }
    }
    return [...rows.values()].filter(Boolean).slice(-config.maxRequests);
  }
  function insertPrompt(box, value, readers) {
    if (compact(draft(box))) return false; // Preserve any human draft, even when it matches this new operation's words.
    box.focus();
    if (box.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (!setter) return false; setter.call(box, value); box.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      const selection = document.getSelection();
      if (!selection) return false; selection.selectAllChildren(box);
      if (document.activeElement !== box || !selection.rangeCount || !box.contains(selection.anchorNode) || !box.contains(selection.focusNode) || readers.composer() !== box) return false;
      const paragraph = document.createElement('p');
      const host = box.matches('[data-composer-markdown]') && box.closest('form[data-chatgpt-composer]') ? document.createElement('span') : paragraph;
      if (host !== paragraph) { host.setAttribute('data-prompt-literal-paste', ''); paragraph.append(host); }
      value.split('\n').forEach((line, index) => { if (index) host.append(document.createElement('br')); host.append(document.createTextNode(line)); });
      if (!document.execCommand('insertHTML', false, paragraph.innerHTML)) return false;
    }
    return box.isConnected && readers.composer() === box && compact(draft(box)) === compact(value);
  }
  function prepare(operation, config) {
    try {
      const scope = operation.scope;
      if (!route(scope, config) || !opaque(operation.id, config) || typeof operation.text !== 'string' || operation.text.length > config.maxOperationTextChars) return { ready: false, reason: 'scope-changed' };
      if (state?.operationId === operation.id && same(state.scope, scope)) return { ready: !state.attempted && compact(draft(state.box)) === compact(operation.text) &&
        Boolean(sendControl(state.box, config)) && !busy(state.box, config), baselineUserIds: [...state.baseline], reason: state.attempted ? 'already-dispatched' : 'control-pending' };
      const readers = globalThis[config.readerGlobal], box = readers?.composer();
      if (!box || !visible(box, config) || box.getAttribute('aria-disabled') === 'true' || busy(box, config)) return { ready: false, reason: 'page-busy' };
      if (operation.modelId) return { ready: false, reason: 'explicit-model-selection-required' }; // Current-model delivery only until evaluated model switching is implemented.
      const baseline = new Set(nativeRows(scope, config).filter(row => row.role === 'user').map(row => row.id));
      if (!insertPrompt(box, operation.text, readers)) return { ready: false, reason: 'draft-unavailable' };
      state = { operationId: operation.id, scope: { ...scope }, text: operation.text, box, baseline, attempted: false };
      return { ready: Boolean(sendControl(box, config)), baselineUserIds: [...baseline], reason: 'control-pending' };
    } catch { return { ready: false, reason: 'prepare-failed' }; }
  }
  function send(operation, config) {
    try {
      if (!state || state.operationId !== operation.id || state.attempted || !same(state.scope, operation.scope) || !route(state.scope, config)) return { dispatched: false };
      const readers = globalThis[config.readerGlobal], box = readers.composer(), button = sendControl(box, config);
      if (box !== state.box || !visible(box, config) || !button || busy(box, config) || compact(draft(box)) !== compact(state.text)) return { dispatched: false };
      state.attempted = true; button.click(); // Spend page custody before native code can synchronously navigate or redraw.
      return { dispatched: true };
    } catch { return { dispatched: false }; }
  }
  function snapshot(scope, config) {
    if (!state?.attempted || !same(state.scope, scope) || !route(scope, config)) return null;
    try {
      const rows = nativeRows(scope, config);
      const users = rows.filter(row => row.role === 'user' && (state.receipt ? row.id === state.receipt.userMessageId :
        !state.baseline.has(row.id) && compact(row.text) === compact(state.text)));
      if (users.length !== 1) return null;
      const user = users[0], receipt = { conversationId: scope.conversationId, userMessageId: user.id, turnId: user.turnId };
      const publicAnswers = rows.filter(row => row.userMessageId === user.id && row.turnId === user.turnId && row.role === 'assistant' && row.channel === 'final');
      const latest = publicAnswers.at(-1);
      const progress = latest && typeof latest.text === 'string' && latest.text.trim() && latest.text.length <= config.maxFinalTextChars ?
        { ...receipt, assistantMessageId: latest.id, role: latest.role, channel: latest.channel, text: latest.text } : null;
      const answer = latest && latest.end_turn === true && latest.status === 'finished_successfully' && typeof latest.text === 'string' &&
        latest.text.trim() && latest.text.length <= config.maxFinalTextChars ? { ...receipt, assistantMessageId: latest.id, role: latest.role,
        channel: latest.channel, end_turn: latest.end_turn, status: latest.status, text: latest.text } : null;
      return { operationId: state.operationId, receipt, answer, progress: answer ? null : progress }; // A final carries its text once within the bounded observation body.
    } catch { return null; }
  }
  function watch(operation, config) {
    if (!route(operation.scope, config) || !['dispatched', 'accepted', 'uncertain'].includes(operation.outcome) ||
        !opaque(operation.id, config) || (!operation.receipt && !Array.isArray(operation.baselineUserIds))) return false;
    if (state?.operationId === operation.id && same(state.scope, operation.scope)) return true;
    state = { operationId: operation.id, scope: operation.scope, text: operation.text, baseline: new Set(operation.baselineUserIds ?? []),
      receipt: operation.receipt, attempted: true, box: null };
    return true; // Observation custody only: this state can never grant a second Send.
  }
  return { version: VERSION, prepare, send, snapshot, watch };
})();
