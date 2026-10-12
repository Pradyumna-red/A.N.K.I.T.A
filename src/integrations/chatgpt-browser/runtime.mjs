import { randomUUID } from 'node:crypto';
import { CHATGPT_BROWSER_PROVIDER } from './protocol.mjs';
import { sameOperationBinding } from './operation-store.mjs';
import { BRIDGE_READY_STATUS } from '../../../services/chatgpt-bridge/config.mjs';
import { CHATGPT_SETUP_MESSAGE } from '../../../desktop/shared/chatgpt-browser.mjs';

/** Browser conversation only: no API client or competing Agent loop. */
export class ChatGptRuntime {
  constructor({ bridge, delivery, store, history = value => value, onEvent = () => {} } = {}) {
    if (!bridge?.view || !delivery?.enqueue || !store?.get) throw new TypeError('Browser runtime needs its bound bridge and durable delivery');
    this.kind = CHATGPT_BROWSER_PROVIDER; this.bridge = bridge; this.delivery = delivery; this.store = store;
    this.history = history; this.onEvent = onEvent; this.pending = new Map(); this.closed = false;
  }
  view() { return this.bridge.view(); }
  listModels() { return this.view().models.map(model => ({ id: model.id, name: model.label, tools: true })); }
  async send({ threadId, text, attachments = [], signal, onProgress } = {}) {
    const view = this.view(), binding = view.binding;
    if (this.closed || view.status !== BRIDGE_READY_STATUS || !binding) throw new Error(CHATGPT_SETUP_MESSAGE);
    if (binding.threadId !== threadId) throw new Error('This browser conversation belongs to another teammate. Choose it in ChatGPT connection settings.');
    if (attachments?.length) throw new Error('Browser file delivery is not ready yet. Send this message without attachments.');
    if (signal?.aborted) throw signal.reason ?? new Error('Browser reply cancelled');
    if (this.pending.size) throw new Error('The selected ChatGPT conversation is already replying');
    const id = randomUUID();
    let resolve, reject;
    const completion = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Observe errors even if queue persistence fails before the caller starts awaiting completion.
    void completion.catch(() => {});
    this.pending.set(id, { id, binding, resolve, reject, onProgress });
    const abort = () => { void this.cancel(threadId); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      await this.delivery.enqueue({ id, binding, kind: 'send', text: this.history(String(text ?? '')) });
      if (signal?.aborted) await this.cancel(threadId);
      return await completion;
    } finally { signal?.removeEventListener('abort', abort); this.pending.delete(id); }
  }
  deliveryEvent(event) {
    const owner = this.pending.get(event.operationId);
    if (!owner || !sameOperationBinding(owner.binding, event.binding)) return;
    if (event.type === 'progress') owner.onProgress?.({ ...event.progress, text: this.history(event.progress.text) });
    if (event.type === 'completed') owner.resolve({ outcome: 'completed', text: this.history(event.completion.text), operationId: event.operationId });
    if (event.type === 'rejected' || event.type === 'uncertain') owner.reject(new Error(event.type === 'uncertain'
      ? 'ChatGPT delivery could not be confirmed. The message may have been sent and will not be sent again.'
      : 'ChatGPT did not accept this message. Check its editor and connection before trying again.'));
    this.onEvent(event);
  }
  async cancel(threadId) {
    const owners = [...this.pending.values()].filter(owner => owner.binding.threadId === threadId);
    for (const owner of owners) {
      await this.delivery.stop(owner.binding);
      owner.reject(new Error('Browser reply cancelled by user'));
    }
    return owners.length > 0;
  }
  async close() {
    this.closed = true;
    await Promise.all([...new Set([...this.pending.values()].map(owner => owner.binding.threadId))].map(id => this.cancel(id)));
  }
}
