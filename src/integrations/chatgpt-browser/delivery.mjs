import { OPERATION_OUTCOMES } from './operation-store.mjs';

/** Host-side delivery custody; only a durable first dispatch can authorize a browser click. */
export class BrowserDelivery {
  constructor({ store, onEvent = () => {} } = {}) {
    if (!store?.queue || !store?.dispatch) throw new TypeError('Browser delivery requires a durable operation store');
    this.store = store; this.onEvent = onEvent;
  }
  enqueue(operation) { return this.store.queue(operation); }
  async poll(binding) {
    const rows = await this.store.list(binding);
    if (rows.some(row => [OPERATION_OUTCOMES.claimed, OPERATION_OUTCOMES.dispatched, OPERATION_OUTCOMES.accepted, OPERATION_OUTCOMES.uncertain].includes(row.outcome))) return null;
    const next = rows.find(row => row.outcome === OPERATION_OUTCOMES.queued);
    return next ? this.store.claim(next.id, binding) : null;
  }
  authorize(id, binding, witness) { return this.store.dispatch(id, binding, witness); }
  async readback(binding) {
    return (await this.store.list(binding)).find(row => [OPERATION_OUTCOMES.dispatched, OPERATION_OUTCOMES.accepted, OPERATION_OUTCOMES.uncertain].includes(row.outcome)) ?? null;
  }
  fail(id, binding) { return this.store.fail(id, binding); }
  async receipt(id, binding, receipt) {
    const fresh = await this.store.accept(id, binding, receipt);
    if (fresh) this.onEvent({ type: 'accepted', operationId: id, binding, receipt: (await this.store.get(id)).receipt });
    return fresh;
  }
  async observe(id, binding, answer) {
    const fresh = await this.store.complete(id, binding, answer);
    if (fresh) this.onEvent({ type: 'completed', operationId: id, binding, completion: (await this.store.get(id)).completion });
    return fresh;
  }
  recover(binding) { return this.store.recover(binding); }
  stop(binding) { return this.store.stop(binding); }
}
