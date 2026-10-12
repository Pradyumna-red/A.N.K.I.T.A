import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { MAX_ID_CHARS, MAX_OPERATION_TEXT_CHARS, MAX_REQUEST_IDS } from '../../../services/chatgpt-bridge/config.mjs';
import { acceptedReceipt, completedReceipt } from './observations.mjs';

const STORE_VERSION = 1; // Durable schema version; unsupported state must never reset a spent Send.
const STORE_FILE = 'operations.json'; // Profile-local file name; caller supplies the discovered directory.
const MAX_FILE_BYTES = 16 * 1024 * 1024; // Bytes/operation ledger; bounded local parsing.
const MAX_OPERATIONS = 500; // Retained operations; refuse new work before losing unsettled receipts.
const MAX_STOPPED_EPOCHS = 1000; // Cancellation fences; fail closed instead of forgetting old Stop intent.
export const OPERATION_OUTCOMES = Object.freeze({ queued: 'queued', claimed: 'claimed', dispatched: 'dispatched', accepted: 'accepted',
  completed: 'completed', stopped: 'stopped', rejected: 'rejected', uncertain: 'uncertain' });
const TERMINAL = [OPERATION_OUTCOMES.completed, OPERATION_OUTCOMES.stopped, OPERATION_OUTCOMES.rejected];
const BINDING_FIELDS = ['leaseId', 'epoch', 'tabId', 'conversationId', 'browserId', 'threadId', 'workspacePath'];
const locks = new Map(); // One serialized owner/file even when two host components open the same ledger.
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
export const sameOperationBinding = (a, b) => Boolean(a && b && BINDING_FIELDS.every(key => a[key] === b[key]));
function bindingValue(value) {
  if (!value || !Number.isSafeInteger(value.tabId) || BINDING_FIELDS.filter(key => key !== 'tabId' && key !== 'workspacePath').some(key => !opaque(value[key])) ||
      typeof value.workspacePath !== 'string' || !value.workspacePath) throw new Error('Invalid operation binding');
  return Object.fromEntries(BINDING_FIELDS.map(key => [key, value[key]]));
}
function immutable(value) {
  if (!opaque(value?.id) || value.kind !== 'send' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_OPERATION_TEXT_CHARS) throw new Error('Invalid browser operation');
  return { id: value.id, binding: bindingValue(value.binding), kind: value.kind, text: value.text,
    ...(value.modelId !== undefined ? { modelId: value.modelId } : {}) };
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const epochKey = binding => hash(bindingValue(binding));
const receiptEqual = (a, b) => Boolean(a && b && ['conversationId', 'userMessageId', 'turnId'].every(key => a[key] === b[key]));

/** Atomic host-owned Send ledger. Recovery reports custody and never submits browser work. */
export class BrowserOperationStore {
  constructor({ directory } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('An explicit absolute operation directory is required');
    fs.mkdirSync(directory, { recursive: true }); this.directory = fs.realpathSync(directory); this.file = path.join(this.directory, STORE_FILE);
  }
  #load() {
    let text;
    try { if (fs.statSync(this.file).size > MAX_FILE_BYTES) throw new Error('Operation state exceeds byte limit'); text = fs.readFileSync(this.file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { version: STORE_VERSION, operations: [], stoppedEpochs: [] }; throw error; }
    const state = JSON.parse(text);
    if (state.version !== STORE_VERSION || !Array.isArray(state.operations) || state.operations.length > MAX_OPERATIONS ||
        !Array.isArray(state.stoppedEpochs) || state.stoppedEpochs.length > MAX_STOPPED_EPOCHS || state.stoppedEpochs.some(key => typeof key !== 'string') ||
        new Set(state.operations.map(row => row.id)).size !== state.operations.length) throw new Error('Unsupported or corrupt operation state version');
    for (const row of state.operations) if (hash(immutable(row)) !== row.argumentsHash || !Object.values(OPERATION_OUTCOMES).includes(row.outcome)) throw new Error('Corrupt operation state');
    return state;
  }
  #write(state) {
    const text = JSON.stringify(state);
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('Operation state exceeds byte limit');
    const temp = path.join(this.directory, `.${STORE_FILE}.${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, text); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, this.file);
    } finally { if (fd !== undefined) fs.closeSync(fd); try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  }
  #run(action, write = false) {
    const task = (locks.get(this.file) ?? Promise.resolve()).catch(() => {}).then(() => {
      const state = this.#load(), result = action(state);
      if (write) this.#write(state);
      return structuredClone(result);
    });
    locks.set(this.file, task);
    return task.finally(() => { if (locks.get(this.file) === task) locks.delete(this.file); });
  }
  #owned(state, id, binding) {
    const row = state.operations.find(row => row.id === id);
    if (!row || !sameOperationBinding(row.binding, binding)) throw new Error('Operation binding does not own this receipt');
    return row;
  }
  queue(input) {
    const value = immutable(input), argumentsHash = hash(value);
    return this.#run(state => {
      if (state.stoppedEpochs.includes(epochKey(value.binding))) throw new Error('This browser epoch was stopped');
      const prior = state.operations.find(row => row.id === value.id);
      if (prior) { if (prior.argumentsHash !== argumentsHash) throw new Error('Operation identity payload changed'); return prior; }
      if (state.operations.length >= MAX_OPERATIONS) throw new Error('Operation ledger capacity reached');
      const row = { ...value, argumentsHash, outcome: OPERATION_OUTCOMES.queued, createdAt: Date.now() };
      state.operations.push(row); return row;
    }, true);
  }
  get(id) { return this.#run(state => state.operations.find(row => row.id === id) ?? null); }
  list(binding) { return this.#run(state => state.operations.filter(row => sameOperationBinding(row.binding, binding))); }
  claim(id, binding) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if (row.outcome !== OPERATION_OUTCOMES.queued || state.stoppedEpochs.includes(epochKey(binding))) return null;
      row.outcome = OPERATION_OUTCOMES.claimed; row.claimedAt = Date.now(); return row;
    }, true);
  }
  dispatch(id, binding, witness) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if (row.outcome !== OPERATION_OUTCOMES.claimed || state.stoppedEpochs.includes(epochKey(binding))) return false;
      if (witness !== undefined) {
        if (!Array.isArray(witness.baselineUserIds) || witness.baselineUserIds.length > MAX_REQUEST_IDS || witness.baselineUserIds.some(id => !opaque(id))) throw new Error('Invalid native Send baseline');
        row.baselineUserIds = [...new Set(witness.baselineUserIds)];
      }
      row.outcome = OPERATION_OUTCOMES.dispatched; row.dispatchedAt = Date.now(); return true;
    }, true);
  }
  accept(id, binding, receipt) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if ([OPERATION_OUTCOMES.stopped, OPERATION_OUTCOMES.rejected].includes(row.outcome)) return false;
      const accepted = acceptedReceipt(binding, receipt);
      if (!accepted) throw new Error('Invalid native user receipt');
      if (row.receipt) { if (!receiptEqual(row.receipt, accepted)) throw new Error('Native receipt owner changed'); return false; }
      if (![OPERATION_OUTCOMES.dispatched, OPERATION_OUTCOMES.uncertain].includes(row.outcome)) throw new Error('Receipt precedes durable dispatch');
      if (state.operations.some(other => other.id !== id && other.receipt?.conversationId === accepted.conversationId && other.receipt?.userMessageId === accepted.userMessageId)) throw new Error('Native message receipt already has an owner');
      row.receipt = accepted; row.outcome = OPERATION_OUTCOMES.accepted; row.acceptedAt = Date.now(); return true;
    }, true);
  }
  complete(id, binding, answer) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if (row.outcome !== OPERATION_OUTCOMES.accepted) return false;
      const completed = completedReceipt(binding, row.receipt, answer);
      if (!completed) return false;
      row.completion = completed; row.outcome = OPERATION_OUTCOMES.completed; row.completedAt = Date.now(); return true;
    }, true);
  }
  uncertain(id, binding) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if ([OPERATION_OUTCOMES.claimed, OPERATION_OUTCOMES.dispatched].includes(row.outcome)) row.outcome = OPERATION_OUTCOMES.uncertain;
      return row;
    }, true);
  }
  fail(id, binding) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if (row.outcome === OPERATION_OUTCOMES.claimed) row.outcome = OPERATION_OUTCOMES.rejected;
      else if (row.outcome === OPERATION_OUTCOMES.dispatched) row.outcome = OPERATION_OUTCOMES.uncertain;
      return row;
    }, true);
  }
  recover(binding) {
    return this.#run(state => {
      const rows = state.operations.filter(row => sameOperationBinding(row.binding, binding));
      for (const row of rows) if ([OPERATION_OUTCOMES.claimed, OPERATION_OUTCOMES.dispatched].includes(row.outcome)) row.outcome = OPERATION_OUTCOMES.uncertain;
      return rows;
    }, true);
  }
  stop(binding) {
    return this.#run(state => {
      const key = epochKey(binding);
      if (!state.stoppedEpochs.includes(key)) {
        if (state.stoppedEpochs.length >= MAX_STOPPED_EPOCHS) throw new Error('Cancellation fence capacity reached');
        state.stoppedEpochs.push(key);
      }
      for (const row of state.operations) if (sameOperationBinding(row.binding, binding) && !TERMINAL.includes(row.outcome)) { row.outcome = OPERATION_OUTCOMES.stopped; row.stoppedAt = Date.now(); }
      return true;
    }, true);
  }
}
