/* Focused MIT CoS DOM/input receipt fork; provenance: vendor/chat-on-steroids.
 * Only a host-dispatched operation can click one exact native Send control.
 */
var AnkitaBrowserDelivery = (() => {
  const VERSION = 5; // Adapter revision; host dispatch remains spent across attachment-reader upgrades.
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
  const UPLOAD_BUSY = '[aria-busy="true"],[role="progressbar"],[data-inline-file-uploading]'; // Native processing state, never inferred from a filename alone.
  const FILE_INPUT = 'input[type="file"]'; const FILE_ACTIONS = 'button[aria-label]';
  const REMOVE_FILE = /^Remove file(?: \d+)?: (.+)$/; // Legacy native remove label; modern tile shapes are locale independent.
  const NATIVE_NOTICE = '[role="alert"]';
  const NOTICE_EXCLUSIONS = '.markdown,[data-message-author-role],nav,aside,[role="menu"],.clf-stream,.clf-stage,.clf-composer,.clf-boot'; // Quotes, conversation prose and co-installed surfaces are not provider notices.
  const MAX_NOTICE_CHARS = 500; // Characters/semantic native notice; no transcript collection.
  const BLOCK_PATTERNS = Object.freeze({ quota: /^(?:you(?:'ve| have) reached|too many requests|usage limit|rate limit|message limit)/i,
    authorization: /^(?:sign in|log in|authentication required|session expired|authorization failed)/i,
    refusal: /^(?:this request (?:was|is) (?:blocked|refused)|cannot fulfill this request|cannot comply with this request)/i,
    'model-unavailable': /^(?:this model is (?:unavailable|not available)|model unavailable)/i,
    transport: /^(?:a network error occurred|error in message stream|there was an error generating (?:a|the) response|stream cache expired|resume stream unavailable)/i }); // English notices fail closed; unknown/localized variants remain unconfirmed.
  const same = (a, b) => Boolean(a && b && SCOPE.every(key => a[key] === b[key]));
  const compact = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const opaque = (value, config) => typeof value === 'string' && value.length > 0 && value.length <= config.maxIdChars;
  const visible = (node, config) => Boolean(node?.isConnected && node.getClientRects().length && !node.closest(config.hidden) &&
    getComputedStyle(node).display !== 'none' && getComputedStyle(node).visibility !== 'hidden');
  const route = (scope, config) => location.origin === config.chatgptOrigin && location.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] === scope?.conversationId;
  function blocked(scope, config) {
    if (!route(scope, config)) return null;
    const reasons = new Set();
    for (const notice of document.querySelectorAll(NATIVE_NOTICE)) {
      if (!visible(notice, config) || notice.closest(NOTICE_EXCLUSIONS)) continue;
      const text = compact(notice.innerText ?? notice.textContent);
      if (!text || text.length > MAX_NOTICE_CHARS) continue;
      for (const reason of config.blockedReasons ?? []) if (BLOCK_PATTERNS[reason]?.test(text)) reasons.add(reason);
    }
    return reasons.size === 1 ? [...reasons][0] : null;
  }
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
        const text = Array.isArray(parts) ? parts.filter(part => typeof part === 'string').join('\n') : null;
        rows.set(message.id, { id: message.id, role, turnId, userMessageId: currentUser, channel: message.channel,
          end_turn: message.end_turn, status: message.status, text });
      }
    }
    return [...rows.values()].filter(Boolean).slice(-config.maxRequests);
  }
  function composerFileName(button) {
    const attachmentHost = button.closest('[data-composer-attachments]'), parent = button.parentElement;
    if (attachmentHost && parent && parent !== attachmentHost) {
      const actions = [...parent.querySelectorAll('button')];
      if (actions.length === 2 && actions[1] === button) {
        const name = actions[0].getAttribute('aria-label'), removal = button.getAttribute('aria-label') || '';
        if (name && removal !== name && removal.endsWith(` ${name}`) && [...parent.querySelectorAll('span')].some(node => !node.children.length && node.textContent === name)) return name;
      }
    }
    const tile = button.closest('[data-composer-attachments] [role="button"][aria-label]');
    if (tile && tile !== button && tile.querySelectorAll('button').length === 1 && [...tile.querySelectorAll('img[alt]')].some(image => image.alt === tile.getAttribute('aria-label'))) return tile.getAttribute('aria-label');
    const group = button.closest('[role="group"][aria-label]');
    if (group?.querySelector('[data-default-action="true"] button') && [...group.querySelectorAll('button')].filter(node => !node.closest('[data-default-action="true"]')).length === 1) return group.getAttribute('aria-label');
    return REMOVE_FILE.exec(button.getAttribute('aria-label') || '')?.[1];
  }
  const attachmentTiles = box => [...(box?.closest('form')?.querySelectorAll(FILE_ACTIONS) ?? [])].filter(composerFileName);
  const uploadBusy = box => Boolean(box?.closest('form')?.querySelector(UPLOAD_BUSY));
  function upload(operation, config, owner) {
    const files = operation.attachments ?? [];
    if (!files.length) return Promise.resolve(true);
    const form = owner.box.closest('form');
    if (!Array.isArray(files) || files.length > config.maxAttachments || attachmentTiles(owner.box).length || uploadBusy(owner.box)) return Promise.resolve(false);
    const inputs = [...form.querySelectorAll(FILE_INPUT)].filter(node => !node.disabled && !node.accept);
    if (inputs.length !== 1 || (!inputs[0].multiple && files.length > 1)) return Promise.resolve(false);
    const transfer = new DataTransfer(), priorTiles = new Set(form.querySelectorAll(FILE_ACTIONS));
    const stillCurrent = () => state === owner && !owner.attempted && route(owner.scope, config) && globalThis[config.readerGlobal]?.composer() === owner.box && compact(draft(owner.box)) === compact(owner.text);
    try {
      for (const file of files) {
        if (typeof file.name !== 'string' || !file.name || file.name.length > config.maxIdChars || typeof file.data !== 'string' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > config.maxAttachmentBytes) return Promise.resolve(false);
        const raw = atob(file.data);
        if (raw.length !== file.size) return Promise.resolve(false);
        transfer.items.add(new File([Uint8Array.from(raw, character => character.charCodeAt(0))], file.name, { type: file.mimeType }));
      }
    } catch { return Promise.resolve(false); }
    return new Promise(resolve => {
      let timer, observer, ownedTiles = null, finished = false;
      const finish = ok => { if (finished) return; finished = true; observer?.disconnect(); clearTimeout(timer); resolve(ok); };
      const check = () => {
        if (!stillCurrent()) return finish(false);
        const tiles = attachmentTiles(owner.box).filter(button => !priorTiles.has(button));
        if (tiles.length > files.length) return finish(false);
        if (!ownedTiles) {
          const unmatched = [...tiles];
          if (files.every(file => { const index = unmatched.findIndex(button => composerFileName(button) === file.name); if (index < 0) return false; unmatched.splice(index, 1); return true; })) ownedTiles = tiles;
        }
        if (!ownedTiles) return;
        if (tiles.length !== ownedTiles.length || tiles.some(button => !ownedTiles.includes(button))) return finish(false);
        if (!uploadBusy(owner.box) && sendControl(owner.box, config) && !busy(owner.box, config)) {
          owner.uploadTiles = ownedTiles;
          owner.attachments = files.map(({ name, mimeType, size, sha256 }) => ({ name, mimeType, size, sha256 }));
          finish(true);
        }
      };
      observer = new MutationObserver(check); observer.observe(form, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => finish(false), config.uploadReadyMs);
      try { inputs[0].files = transfer.files; inputs[0].dispatchEvent(new Event('change', { bubbles: true })); check(); } catch { finish(false); }
    });
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
  async function prepare(operation, config) {
    try {
      const scope = operation.scope;
      if (!route(scope, config) || !opaque(operation.id, config) || typeof operation.text !== 'string' || operation.text.length > config.maxOperationTextChars) return { ready: false, reason: 'scope-changed' };
      const refusal = blocked(scope, config); if (refusal) return { ready: false, reason: refusal };
      if (state?.operationId === operation.id && same(state.scope, scope)) {
        const owner = state, uploaded = await owner.upload;
        return { ready: uploaded && state === owner && !owner.attempted && compact(draft(owner.box)) === compact(operation.text) &&
          Boolean(sendControl(owner.box, config)) && !busy(owner.box, config), baselineUserIds: [...owner.baseline], attachments: owner.attachments ?? [], reason: owner.attempted ? 'already-dispatched' : uploaded ? 'control-pending' : 'upload-unconfirmed' };
      }
      const readers = globalThis[config.readerGlobal], box = readers?.composer();
      if (!box || !visible(box, config) || box.getAttribute('aria-disabled') === 'true' || busy(box, config)) return { ready: false, reason: 'page-busy' };
      if (attachmentTiles(box).length || uploadBusy(box)) return { ready: false, reason: 'human-attachments' };
      if (operation.modelId) return { ready: false, reason: 'explicit-model-selection-required' }; // Current-model delivery only until evaluated model switching is implemented.
      const baseline = new Set(nativeRows(scope, config).filter(row => row.role === 'user').map(row => row.id));
      if (!insertPrompt(box, operation.text, readers)) return { ready: false, reason: 'draft-unavailable' };
      state = { operationId: operation.id, scope: { ...scope }, text: operation.text, box, baseline, attempted: false };
      const owner = state; owner.upload = upload(operation, config, owner);
      const uploaded = await owner.upload;
      return { ready: uploaded && state === owner && Boolean(sendControl(box, config)), baselineUserIds: [...baseline], attachments: owner.attachments ?? [], reason: uploaded ? 'control-pending' : 'upload-unconfirmed' };
    } catch { return { ready: false, reason: 'prepare-failed' }; }
  }
  function send(operation, config) {
    try {
      if (!state || state.operationId !== operation.id || state.attempted || !same(state.scope, operation.scope) || !route(state.scope, config)) return { dispatched: false };
      const readers = globalThis[config.readerGlobal], box = readers.composer(), button = sendControl(box, config);
      if (box !== state.box || !visible(box, config) || !button || busy(box, config) || compact(draft(box)) !== compact(state.text)) return { dispatched: false };
      const tiles = attachmentTiles(box);
      if (uploadBusy(box) || tiles.length !== (state.uploadTiles?.length ?? 0) || tiles.some(button => !state.uploadTiles?.includes(button))) return { dispatched: false };
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
  function prepareStop(command, config) {
    if (!route(command.scope, config) || !opaque(command.id, config) || !same(command.target?.scope, command.scope)) return { ready: false };
    if (!watch(command.target, config)) return { ready: false };
    const observed = snapshot(command.scope, config);
    if (!observed?.receipt) return { ready: false };
    const rows = nativeRows(command.scope, config), latestUser = rows.filter(row => row.role === 'user').at(-1);
    const ownedLatest = latestUser?.id === observed.receipt.userMessageId;
    if (!ownedLatest && !observed.answer) return { ready: false };
    const box = globalThis[config.readerGlobal]?.composer();
    if (!box || !visible(box, config)) return { ready: false };
    const stops = [...new Set([...controls(STOP, box, config), ...controls(PRIMARY, box, config).filter(stopSquare)])];
    if (ownedLatest && stops.length > 1) return { ready: false };
    const running = ownedLatest && stops.length === 1 && !stops[0].disabled && stops[0].getAttribute('aria-disabled') !== 'true';
    const finished = Boolean(observed.answer);
    return { ready: running || finished, receipt: observed.receipt, running, finished };
  }
  function stop(command, config) {
    const prepared = prepareStop(command, config);
    if (!prepared.ready) return { confirmed: false };
    if (!prepared.running) return { confirmed: prepared.finished === true, receipt: prepared.receipt };
    if (state.stopAttempted === command.id || command.phase !== 'pending') return { confirmed: false, receipt: prepared.receipt };
    const box = globalThis[config.readerGlobal].composer();
    const stops = [...new Set([...controls(STOP, box, config), ...controls(PRIMARY, box, config).filter(stopSquare)])];
    if (stops.length !== 1 || !route(command.scope, config)) return { confirmed: false, receipt: prepared.receipt };
    state.stopAttempted = command.id; stops[0].click(); // Host authorization must already be spent; reinjection observes instead of clicking again.
    return { confirmed: prepareStop(command, config).finished === true, receipt: prepared.receipt };
  }
  return { version: VERSION, prepare, send, snapshot, watch, prepareStop, stop, blocked };
})();
