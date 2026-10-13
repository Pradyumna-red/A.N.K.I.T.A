import { OPERATION_OUTCOMES, STOP_PHASES, sameOperationBinding } from './operation-store.mjs';
import { publicReply } from './observations.mjs';

/** Host-side delivery custody; only a durable first dispatch can authorize a browser click. */
export class BrowserDelivery {
  constructor({ store, onEvent = () => {}, transform = value => value } = {}) {
    if (!store?.queue || !store?.dispatch) throw new TypeError('Browser delivery requires a durable operation store');
    this.store = store; this.onEvent = onEvent; this.transform = transform;
  }
  enqueue(operation) { return this.store.queue(this.transform(operation)); }
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
  async fail(id, binding) {
    const row = await this.store.fail(id, binding);
    this.onEvent({ type: row.outcome, operationId: id, binding }); return row;
  }
  async receipt(id, binding, receipt) {
    const fresh = await this.store.accept(id, binding, receipt);
    if (fresh) this.onEvent({ type: 'accepted', operationId: id, binding, receipt: (await this.store.get(id)).receipt });
    return fresh;
  }
  async observe(id, binding, answer) {
    const fresh = await this.store.complete(id, binding, this.transform(answer));
    if (fresh) this.onEvent({ type: 'completed', operationId: id, binding, completion: (await this.store.get(id)).completion });
    return fresh;
  }
  async progress(id, binding, answer) {
    const row = await this.store.get(id);
    if (!row || row.outcome !== OPERATION_OUTCOMES.accepted || !sameOperationBinding(row.binding, binding)) return false;
    const progress = publicReply(binding, row.receipt, this.transform(answer));
    if (!progress) return false;
    this.onEvent({ type: 'progress', operationId: id, binding, progress }); return true;
  }
  recover(binding) { return this.store.recover(binding); }
  async block(binding, reason) {
    for (const row of await this.store.block(binding, reason)) this.onEvent({ type: 'blocked', operationId: row.id, binding, reason });
  }
  stop(binding) { return this.store.stop(binding); }
  async pollStop(binding) {
    const command = await this.store.stopCommand(binding);
    return command?.phase === STOP_PHASES.pending ? command : null;
  }
  async stopReadback(binding) {
    const command = await this.store.stopCommand(binding);
    return command && [STOP_PHASES.dispatched, STOP_PHASES.uncertain].includes(command.phase) ? command : null;
  }
  authorizeStop(id, binding, witness) { return this.store.authorizeStop(id, binding, witness); }
  async observeStop(id, binding, value) {
    const fresh = await this.store.settleStop(id, binding, value);
    if (fresh) this.onEvent({ type: value.confirmed === true ? 'stop-confirmed' : 'stop-uncertain', binding });
    return fresh;
  }
}
