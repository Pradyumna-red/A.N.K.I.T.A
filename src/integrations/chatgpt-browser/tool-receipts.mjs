import { randomUUID, createHash } from 'node:crypto';
import { HTTP_STATUS, sameBrowserBinding, LEGACY_RECEIPT_CODE, LEGACY_RECEIPT_MESSAGE } from './protocol.mjs';
import { DurableProfileState } from './durable-profile.mjs';

/** Lifecycle-local Task 1 receipts. A new gateway has a new capability URL.
 * Durable/restart receipts replace this explicit proof-only store in Task 5.
 */
export class MemoryToolReceipts {
  constructor() { this.records = new Map(); }
  begin(identity, argumentsHash, owner, { legacyIdentity } = {}) {
    if (legacyIdentity !== identity && this.records.has(legacyIdentity)) throw legacyReceiptError();
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

const legacyReceiptError = () => Object.assign(new Error(LEGACY_RECEIPT_MESSAGE), { code: LEGACY_RECEIPT_CODE });

const RECEIPT_VERSION = 1; // Native receipt schema; unsupported records fail closed.
const RECEIPT_FILE = 'tool-receipts.json'; // Profile-local native custody; no transport capability URL is stored.
const MAX_RECEIPTS = 1000; // Receipts/journal; refuse admission instead of forgetting previous mutations.
const HASH_PATTERN = /^[a-f0-9]{64}$/; // SHA-256 identity and argument digest grammar.
const PHASES = Object.freeze({ started: 'started', settled: 'settled', uncertain: 'uncertain' });
const UNCERTAIN_RESULT = Object.freeze({ content: [{ type: 'text', text: 'Error: tool outcome is uncertain after restart; do not retry the side effect.' }], isError: true });
const pending = new Map(); // Shared live completions per canonical file/id; never serialized.
const identityHash = value => createHash('sha256').update(value).digest('hex');

/** Durable at-most-once admission, including crash-before-receipt. No automatic mutation replay. */
export class PersistentToolReceipts {
  constructor({ directory, transform = value => value } = {}) {
    this.journal = new DurableProfileState({ directory, filename: RECEIPT_FILE,
      initial: () => ({ version: RECEIPT_VERSION, records: [] }) });
    this.transform = transform;
  }
  #key(id) { return this.journal.file + '/' + id; }
  #run(action, write = false) {
    return this.journal.run(state => {
      if (state.version !== RECEIPT_VERSION || !Array.isArray(state.records) || state.records.length > MAX_RECEIPTS ||
          new Set(state.records.map(row => row.identityHash)).size !== state.records.length ||
          new Set(state.records.map(row => row.id)).size !== state.records.length || state.records.some(row =>
            typeof row.id !== 'string' || !HASH_PATTERN.test(row.identityHash) || !HASH_PATTERN.test(row.argumentsHash) ||
            !Object.values(PHASES).includes(row.phase) || (row.phase !== PHASES.started && !Array.isArray(row.result?.content))))
        throw new Error('Unsupported or corrupt native tool receipt state');
      return action(state);
    }, write);
  }
  async begin(identity, argumentsHash, owner, { legacyIdentity } = {}) {
    if (typeof identity !== 'string' || !identity || !HASH_PATTERN.test(argumentsHash)) throw new Error('Invalid native receipt identity');
    const digest = identityHash(identity); let startedId;
    let admission;
    try {
      admission = await this.#run(state => {
        if (legacyIdentity && legacyIdentity !== identity && state.records.some(row => row.identityHash === identityHash(legacyIdentity))) throw legacyReceiptError();
        const prior = state.records.find(row => row.identityHash === digest);
        if (prior) {
          if (prior.argumentsHash !== argumentsHash) throw new Error('Receipt payload changed');
          if (prior.phase === PHASES.started && !pending.has(this.#key(prior.id))) {
            prior.phase = PHASES.uncertain; prior.result = structuredClone(UNCERTAIN_RESULT);
          }
          return { ...prior, fresh: false };
        }
        if (state.records.length >= MAX_RECEIPTS) throw new Error('Native receipt capacity reached');
        const row = { id: randomUUID(), identityHash: digest, argumentsHash, phase: PHASES.started, startedAt: Date.now(), ...(owner ? { owner: this.transform(owner) } : {}) };
        startedId = row.id;
        let resolve; const completion = new Promise(done => { resolve = done; });
        pending.set(this.#key(row.id), { completion, resolve });
        state.records.push(row); return { ...row, fresh: true };
      }, true);
    } catch (error) { if (startedId) pending.delete(this.#key(startedId)); throw error; }
    return { ...admission, completion: admission.phase === PHASES.started ? pending.get(this.#key(admission.id)).completion : Promise.resolve(admission.result) };
  }
  async settle(id, result) {
    const settled = await this.#run(state => {
      const row = state.records.find(record => record.id === id);
      if (!row) throw new Error('Unknown tool receipt');
      if (row.phase !== PHASES.started) return row.result;
      row.phase = PHASES.settled; row.result = this.transform(result); row.settledAt = Date.now(); return row.result;
    }, true);
    const waiter = pending.get(this.#key(id)); waiter?.resolve(settled); pending.delete(this.#key(id)); return settled;
  }
  lookup(id) { return this.#run(state => state.records.find(row => row.id === id) ?? null); }
  list(binding) { return this.#run(state => state.records.filter(row => sameBrowserBinding(row.owner?.binding, binding))); }
}
