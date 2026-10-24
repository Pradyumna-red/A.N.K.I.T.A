import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { CHATGPT_BROWSER_PROVIDER, BROWSER_TRANSPORT_NOTICE } from './protocol.mjs';
import { sameOperationBinding, STOP_PHASES, OPERATION_OUTCOMES } from './operation-store.mjs';
import { BRIDGE_READY_STATUS, OBSERVATION_MAX_AGE_MS, SEND_READY_POLL_MS } from '../../../services/chatgpt-bridge/config.mjs';
import { CHATGPT_SETUP_MESSAGE, CHATGPT_COMPANION_UPDATE_MESSAGE } from '../../../desktop/shared/chatgpt-browser.mjs';
import { validateBrowserUploads } from './attachments.mjs';
import { validateMentionNames, APP_MENTION_ERRORS } from './app-mentions.mjs';

/** Browser conversation only: no API client or competing Agent loop. */
export class ChatGptRuntime {
  constructor({ bridge, delivery, store, history = value => value, onEvent = () => {}, onCancel = async () => {}, onReadyBinding = async () => {} } = {}) {
    if (!bridge?.view || !delivery?.enqueue || !store?.get) throw new TypeError('Browser runtime needs its bound bridge and durable delivery');
    this.kind = CHATGPT_BROWSER_PROVIDER; this.bridge = bridge; this.delivery = delivery; this.store = store;
    this.history = history; this.onEvent = onEvent; this.pending = new Map(); this.closed = false;
    this.onCancel = onCancel; this.onReadyBinding = onReadyBinding; this.cancelling = new Map(); this.stops = new Map();
    this.recoverable = [];
  }
  view() {
    const view = this.bridge.view(), stop = this.stops.get(view.binding?.threadId);
    return { ...view, remoteStop: sameOperationBinding(stop?.binding, view.binding) ? stop.phase : null };
  }
  listModels() { return this.view().models.map(model => ({ id: model.id, name: model.label, tools: true })); }
  async restore() {
    const binding = this.view().binding;
    if (!binding) return;
    const stop = await this.store.stopCommand(binding);
    if (stop) this.stops.set(binding.threadId, { binding, phase: stop.phase });
    await this.refreshRecoverable();
  }
  async refreshRecoverable() {
    const binding = this.view().binding;
    if (!binding) { this.recoverable = []; return; }
    const rows = await this.store.list(binding);
    if (!sameOperationBinding(binding, this.view().binding)) return; // An old asynchronous read cannot publish recovery for a replacement selection.
    this.recoverable = rows.filter(row => !row.consumed && !this.pending.has(row.id) &&
      [OPERATION_OUTCOMES.accepted, OPERATION_OUTCOMES.dispatched, OPERATION_OUTCOMES.uncertain, OPERATION_OUTCOMES.completed].includes(row.outcome))
      .map(row => ({ id: row.id, outcome: row.outcome }));
  }
  async send({ threadId, text, attachments = [], appNames = [], signal, onProgress, onQueued } = {}) {
    let view = this.view(), binding = view.binding;
    if (this.closed || view.status !== BRIDGE_READY_STATUS || !binding) throw new Error(CHATGPT_SETUP_MESSAGE);
    if (binding.threadId !== threadId) throw new Error('This browser conversation belongs to another teammate. Choose it in ChatGPT connection settings.');
    const uploads = validateBrowserUploads(attachments);
    const names = validateMentionNames(appNames);
    if (names.length && view.nativeAppTagsReady !== true) throw new Error(CHATGPT_COMPANION_UPDATE_MESSAGE);
    if (signal?.aborted) throw signal.reason ?? new Error('Browser reply cancelled');
    if (this.pending.size || this.preparing) throw new Error('The selected ChatGPT conversation is already replying');
    this.preparing = true;
    try {
    if ((await this.store.list(binding)).some(row => [OPERATION_OUTCOMES.claimed, OPERATION_OUTCOMES.dispatched, OPERATION_OUTCOMES.accepted, OPERATION_OUTCOMES.uncertain].includes(row.outcome)))
      throw new Error('Resume the unresolved browser reply before sending another message. It will not be sent again.');
    if (await this.store.isStopped(binding)) {
      const stop = await this.store.stopCommand(binding);
      if (stop && stop.phase !== STOP_PHASES.confirmed) throw new Error('Wait for native Stop confirmation before sending another message. Check the selected chat if it remains unconfirmed.');
      const renewed = await this.bridge.renewBinding(binding);
      const deadline = Date.now() + OBSERVATION_MAX_AGE_MS;
      while (Date.now() < deadline) {
        view = this.view();
        if (!sameOperationBinding(view.binding, renewed)) throw new Error('Browser binding changed while preparing the new message');
        if (view.status === BRIDGE_READY_STATUS) break;
        await pause(SEND_READY_POLL_MS, undefined, { signal });
      }
      if (view.status !== BRIDGE_READY_STATUS) throw new Error(CHATGPT_SETUP_MESSAGE);
      binding = renewed;
    }
    await this.onReadyBinding(binding);
    if (this.closed || signal?.aborted || !sameOperationBinding(this.view().binding, binding)) throw new Error('Browser connection changed before Send');
    const id = randomUUID();
    let resolve, reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Observe errors even if queue persistence fails before the caller starts awaiting completion.
    void completion.catch(() => {});
    this.pending.set(id, { id, binding, resolve, reject, onProgress });
    this.preparing = false;
    const abort = () => { void this.cancel(threadId).catch(error => reject(error)); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const input = { id, binding, kind: 'send', text: this.history(String(text ?? '')), ...(uploads.length ? { attachments: uploads } : {}), ...(names.length ? { appNames: names } : {}) };
      const operation = await (this.bridge.enqueue ? this.bridge.enqueue(input) : this.delivery.enqueue(input));
      await onQueued?.(operation);
      if (signal?.aborted) await this.cancel(threadId);
      return await completion;
    } finally { signal?.removeEventListener('abort', abort); this.pending.delete(id); }
    } finally { this.preparing = false; }
  }
  async resume({ threadId, operationId, signal, onProgress } = {}) {
    const view = this.view(), binding = view.binding, operation = await this.store.get(operationId);
    const readable = view.status === BRIDGE_READY_STATUS || (view.status === 'blocked' && view.blockedReason === BROWSER_TRANSPORT_NOTICE);
    if (this.closed || !readable || !binding || binding.threadId !== threadId || !sameOperationBinding(operation?.binding, binding)) throw new Error(CHATGPT_SETUP_MESSAGE);
    if (this.pending.size || this.preparing) throw new Error('The selected ChatGPT conversation is already replying');
    if (signal?.aborted) throw new Error('Browser reply cancelled');
    if (operation.outcome === OPERATION_OUTCOMES.completed) return { outcome: 'completed', operationId, text: this.history(operation.completion.text) };
    if (![OPERATION_OUTCOMES.accepted, OPERATION_OUTCOMES.uncertain, OPERATION_OUTCOMES.dispatched].includes(operation.outcome)) throw new Error('This saved operation cannot be resumed');
    let reject;
    const completion = new Promise((resolve, no) => { reject = no; this.pending.set(operationId, { id: operationId, binding, resolve, reject: no, onProgress }); });
    void completion.catch(() => {});
    const abort = () => { void this.cancel(threadId).catch(reject); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      // Observation only. Recovery cannot re-enqueue, dispatch, or launch native action transports.
      const current = await this.store.get(operationId);
      if (current.outcome === OPERATION_OUTCOMES.completed) this.deliveryEvent({ type: 'completed', operationId, binding, completion: current.completion });
      return await completion;
    } finally { signal?.removeEventListener('abort', abort); this.pending.delete(operationId); }
  }
  async deliveryEvent(event) {
    if (event.type === 'stop-confirmed' || event.type === 'stop-uncertain') {
      const stop = this.stops.get(event.binding.threadId);
      if (sameOperationBinding(stop?.binding, event.binding)) {
        stop.phase = event.type === 'stop-confirmed' ? STOP_PHASES.confirmed : STOP_PHASES.uncertain;
        this.onEvent(event);
      }
      return;
    }
    const owner = this.pending.get(event.operationId);
    if (!sameOperationBinding(event.binding, this.view().binding)) return;
    if (owner && sameOperationBinding(owner.binding, event.binding)) {
      if (event.type === 'progress') owner.onProgress?.({ ...event.progress, text: this.history(event.progress.text) });
      if (event.type === 'completed') owner.resolve({ outcome: 'completed', text: this.history(event.completion.text), operationId: event.operationId });
      if (event.type === 'blocked') {
        const sent = event.reason === BROWSER_TRANSPORT_NOTICE && Boolean((await this.store.get(event.operationId))?.dispatchedAt);
        if (!sent) owner.reject(new Error(event.reason === BROWSER_TRANSPORT_NOTICE
          ? 'ChatGPT disconnected before your message was sent. Open ChatGPT, then send your message again.'
          : `ChatGPT reported ${event.reason}. Resolve it in the selected chat before explicitly resuming. No fallback or automatic retry was started.`));
      }
      if (event.type === 'rejected' || event.type === 'uncertain') owner.reject(new Error(APP_MENTION_ERRORS[event.reason] ?? (event.type === 'uncertain'
        ? 'ChatGPT delivery could not be confirmed. The message may have been sent and will not be sent again.'
        : 'ChatGPT did not accept this message. Check its editor and connection before trying again.')));
    }
    if (event.type !== 'progress') await this.refreshRecoverable(); // Includes observation-only finals after the active caller has already ended.
    this.onEvent(event);
  }
  async cancel(threadId) {
    if (this.cancelling.has(threadId)) return this.cancelling.get(threadId);
    const owners = [...this.pending.values()].filter(owner => owner.binding.threadId === threadId);
    const binding = owners[0]?.binding ?? this.view().binding;
    if (!binding || binding.threadId !== threadId) return false;
    const stopping = (async () => {
      try {
        await this.delivery.stop(binding);
        const command = await this.store.stopCommand(binding);
        this.stops.set(threadId, { binding, phase: command?.phase ?? STOP_PHASES.confirmed });
        await this.refreshRecoverable();
        this.onEvent({ type: 'stopped', binding });
        await this.onCancel(binding);
      } finally {
        for (const owner of owners) owner.reject(new Error('Browser reply cancelled by user'));
      }
      return true;
    })();
    this.cancelling.set(threadId, stopping);
    try { return await stopping; } finally { this.cancelling.delete(threadId); }
  }
  async waitForStop(binding, timeoutMs = OBSERVATION_MAX_AGE_MS) {
    const deadline = Date.now() + timeoutMs;
    do {
      const command = await this.store.stopCommand(binding);
      if (!command || command.phase === STOP_PHASES.confirmed) return true;
      if (Date.now() >= deadline) return false;
      await pause(Math.min(SEND_READY_POLL_MS, Math.max(1, deadline - Date.now())));
    } while (true);
  }
  async close() {
    this.closed = true;
    const results = await Promise.allSettled([...new Set([...this.pending.values()].map(owner => owner.binding.threadId))].map(id => this.cancel(id)));
    await Promise.all([...this.stops.values()].map(stop => this.waitForStop(stop.binding)));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}
