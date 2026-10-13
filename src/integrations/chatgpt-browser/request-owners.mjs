import { EventEmitter } from 'node:events';
import { normalizeRequestId, sameBrowserBinding } from './protocol.mjs';
import { OWNER_WAIT_MS, MAX_REQUEST_IDS } from '../../../services/chatgpt-bridge/config.mjs';

export const sameBinding = sameBrowserBinding;

/** Joins native HTTP metadata to one currently bound conversation. Never chooses by recency. */
export class RequestOwners {
  constructor({ timeoutMs = OWNER_WAIT_MS } = {}) { this.timeoutMs = timeoutMs; this.events = new EventEmitter(); this.records = new Map(); this.baseline = new Set(); }
  bind(binding) { this.binding = Object.freeze({ ...binding }); this.records.clear(); this.baseline.clear(); this.events.emit('change'); }
  clear() { this.binding = null; this.records.clear(); this.baseline.clear(); this.events.emit('change'); }
  prime(ids) { for (const value of ids.slice(0, MAX_REQUEST_IDS)) { const id = normalizeRequestId(value); if (id) this.baseline.add(id); } }
  observe(binding, ids) {
    for (const value of ids.slice(0, MAX_REQUEST_IDS)) {
      const id = normalizeRequestId(value);
      if (!id || this.baseline.has(id)) continue;
      const prior = this.records.get(id);
      if (!sameBinding(binding, this.binding) || (prior && !sameBinding(prior, binding))) this.records.set(id, null);
      else if (!this.records.has(id) && this.records.size < MAX_REQUEST_IDS) this.records.set(id, Object.freeze({ ...binding }));
    }
    this.events.emit('change');
  }
  async resolve({ leaseId, requestId, signal, ready = () => true }) {
    const id = normalizeRequestId(requestId);
    if (!id || !this.binding || this.binding.leaseId !== leaseId || signal?.aborted) throw new Error('Request owner lease is unavailable');
    const check = () => {
      if (!this.binding || this.binding.leaseId !== leaseId) throw new Error('Request owner binding was disconnected');
      if (!this.records.has(id)) return null;
      const owner = this.records.get(id);
      if (!owner || !sameBinding(owner, this.binding)) throw new Error('Request owner is ambiguous or conflicting');
      return ready(owner) === true ? owner : null;
    };
    const known = check(); if (known) return known;
    return new Promise((resolve, reject) => {
      const clean = () => { clearTimeout(timer); this.events.off('change', changed); signal?.removeEventListener('abort', aborted); };
      const aborted = () => { clean(); reject(new Error('Request owner wait was cancelled')); };
      const changed = () => { try { const owner = check(); if (owner) { clean(); resolve(owner); } } catch (error) { clean(); reject(error); } };
      const timer = setTimeout(() => { clean(); reject(new Error('Request owner was not observed')); }, this.timeoutMs);
      this.events.on('change', changed); signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted(); else changed();
    });
  }
}
