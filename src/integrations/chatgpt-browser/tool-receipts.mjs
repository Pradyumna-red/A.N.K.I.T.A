import { randomUUID } from 'node:crypto';
import { HTTP_STATUS } from './protocol.mjs';

/** Lifecycle-local Task 1 receipts. A new gateway has a new capability URL.
 * Durable/restart receipts replace this explicit proof-only store in Task 5.
 */
export class MemoryToolReceipts {
  constructor() { this.records = new Map(); }
  begin(identity, argumentsHash) {
    const prior = this.records.get(identity);
    if (prior) {
      if (prior.argumentsHash !== argumentsHash) throw Object.assign(new Error('Receipt payload changed'), { status: HTTP_STATUS.conflict });
      return { ...prior, fresh: false };
    }
    let resolve;
    const completion = new Promise(done => { resolve = done; });
    const record = { id: randomUUID(), argumentsHash, completion, resolve };
    this.records.set(identity, record);
    return { ...record, fresh: true };
  }
  settle(id, result) {
    const record = this.lookup(id);
    if (!record) throw new Error('Unknown tool receipt');
    record.result = structuredClone(result); record.resolve(record.result);
  }
  lookup(id) { return [...this.records.values()].find(record => record.id === id); }
}
