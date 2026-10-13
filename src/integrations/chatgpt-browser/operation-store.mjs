import { createHash, randomUUID } from 'node:crypto';
import { MAX_ID_CHARS, MAX_OPERATION_TEXT_CHARS, MAX_REQUEST_IDS } from '../../../services/chatgpt-bridge/config.mjs';
import { acceptedReceipt, completedReceipt } from './observations.mjs';
import { DurableProfileState } from './durable-profile.mjs';
import { BROWSER_BINDING_FIELDS as BINDING_FIELDS, sameBrowserBinding } from './protocol.mjs';
import { validateBrowserUploads, uploadReceipt, attachmentMetadata } from './attachments.mjs';

const STORE_VERSION = 1; // Durable schema version; unsupported state must never reset a spent Send.
const STORE_FILE = 'operations.json'; // Profile-local file name; caller supplies the discovered directory.
const MAX_OPERATIONS = 500; // Retained operations; refuse new work before losing unsettled receipts.
const MAX_STOPPED_EPOCHS = 1000; // Cancellation fences; fail closed instead of forgetting old Stop intent.
export const STOP_PHASES = Object.freeze({ pending: 'pending', dispatched: 'dispatched', confirmed: 'confirmed', uncertain: 'uncertain' }); // Durable remote Stop custody, separate from the cancelled Send.
export const OPERATION_OUTCOMES = Object.freeze({ queued: 'queued', claimed: 'claimed', dispatched: 'dispatched', accepted: 'accepted',
  completed: 'completed', stopped: 'stopped', rejected: 'rejected', uncertain: 'uncertain' });
const TERMINAL = [OPERATION_OUTCOMES.completed, OPERATION_OUTCOMES.stopped, OPERATION_OUTCOMES.rejected];
const opaque = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_CHARS;
export const sameOperationBinding = sameBrowserBinding;
function bindingValue(value) {
  if (!value || !Number.isSafeInteger(value.tabId) || BINDING_FIELDS.filter(key => key !== 'tabId' && key !== 'workspacePath').some(key => !opaque(value[key])) ||
      typeof value.workspacePath !== 'string' || !value.workspacePath) throw new Error('Invalid operation binding');
  return Object.fromEntries(BINDING_FIELDS.map(key => [key, value[key]]));
}
function immutable(value) {
  if (!opaque(value?.id) || value.kind !== 'send' || typeof value.text !== 'string' || !value.text.trim() || value.text.length > MAX_OPERATION_TEXT_CHARS) throw new Error('Invalid browser operation');
  return { id: value.id, binding: bindingValue(value.binding), kind: value.kind, text: value.text,
    ...(value.attachments?.length ? { attachments: validateBrowserUploads(value.attachments) } : {}),
    ...(value.modelId !== undefined ? { modelId: value.modelId } : {}) };
}
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const epochKey = binding => hash(bindingValue(binding));
const receiptEqual = (a, b) => Boolean(a && b && ['conversationId', 'userMessageId', 'turnId'].every(key => a[key] === b[key]));

/** Atomic host-owned Send ledger. Recovery reports custody and never submits browser work. */
export class BrowserOperationStore {
  constructor({ directory } = {}) {
    this.journal = new DurableProfileState({ directory, filename: STORE_FILE,
      initial: () => ({ version: STORE_VERSION, operations: [], stoppedEpochs: [], stopRequests: [] }) });
    this.directory = this.journal.directory; this.file = this.journal.file;
  }
  #validate(state) {
    state.stopRequests ??= []; // Additive schema migration; never resets an old Send or cancellation fence.
    if (state.version !== STORE_VERSION || !Array.isArray(state.operations) || state.operations.length > MAX_OPERATIONS ||
        !Array.isArray(state.stoppedEpochs) || state.stoppedEpochs.length > MAX_STOPPED_EPOCHS || state.stoppedEpochs.some(key => typeof key !== 'string') ||
        new Set(state.operations.map(row => row.id)).size !== state.operations.length) throw new Error('Unsupported or corrupt operation state version');
    for (const row of state.operations) if (hash(immutable(row)) !== row.argumentsHash || !Object.values(OPERATION_OUTCOMES).includes(row.outcome)) throw new Error('Corrupt operation state');
    if (!Array.isArray(state.stopRequests) || state.stopRequests.length > MAX_STOPPED_EPOCHS ||
        new Set(state.stopRequests.map(row => row.id)).size !== state.stopRequests.length || state.stopRequests.some(row =>
          !opaque(row.id) || !opaque(row.targetId) || !Object.values(STOP_PHASES).includes(row.phase) ||
          !state.operations.some(target => target.id === row.targetId && sameOperationBinding(target.binding, row.binding)))) throw new Error('Corrupt Stop state');
    return state;
  }
  #run(action, write = false) {
    return this.journal.run(state => action(this.#validate(state)), write);
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
        if (row.attachments?.length && !uploadReceipt(row.attachments, witness.attachments)) return false;
        if (row.attachments?.length) row.uploadReceipt = attachmentMetadata(row.attachments);
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
      for (const row of rows) {
        if (row.outcome === OPERATION_OUTCOMES.queued) row.outcome = OPERATION_OUTCOMES.rejected;
        if ([OPERATION_OUTCOMES.claimed, OPERATION_OUTCOMES.dispatched].includes(row.outcome)) row.outcome = OPERATION_OUTCOMES.uncertain;
      }
      return rows;
    }, true);
  }
  consume(id, binding) {
    return this.#run(state => {
      const row = this.#owned(state, id, binding);
      if (row.outcome !== OPERATION_OUTCOMES.completed) throw new Error('Only a completed browser reply can be imported');
      row.consumed = true; return true;
    }, true);
  }
  block(binding, reason) {
    return this.#run(state => {
      const rows = state.operations.filter(row => sameOperationBinding(row.binding, binding) && !TERMINAL.includes(row.outcome));
      for (const row of rows) {
        row.outcome = row.dispatchedAt ? OPERATION_OUTCOMES.uncertain : OPERATION_OUTCOMES.rejected;
        row.blockedReason = reason;
      }
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
      const target = state.operations.find(row => sameOperationBinding(row.binding, binding) && !TERMINAL.includes(row.outcome) && row.dispatchedAt);
      if (target && !state.stopRequests.some(row => sameOperationBinding(row.binding, binding))) {
        if (state.stopRequests.length >= MAX_STOPPED_EPOCHS) throw new Error('Stop request capacity reached');
        state.stopRequests.push({ id: randomUUID(), targetId: target.id, binding: bindingValue(binding), phase: STOP_PHASES.pending, createdAt: Date.now() });
      }
      for (const row of state.operations) if (sameOperationBinding(row.binding, binding) && !TERMINAL.includes(row.outcome)) { row.outcome = OPERATION_OUTCOMES.stopped; row.stoppedAt = Date.now(); }
      return true;
    }, true);
  }
  isStopped(binding) { return this.#run(state => state.stoppedEpochs.includes(epochKey(binding))); }
  stopCommand(binding) {
    return this.#run(state => {
      const row = state.stopRequests.find(stop => sameOperationBinding(stop.binding, binding));
      return row ? { ...row, target: state.operations.find(operation => operation.id === row.targetId) } : null;
    });
  }
  authorizeStop(id, binding, witness) {
    return this.#run(state => {
      const row = state.stopRequests.find(stop => stop.id === id && sameOperationBinding(stop.binding, binding));
      if (!row || row.phase !== STOP_PHASES.pending || !state.stoppedEpochs.includes(epochKey(binding))) return false;
      const target = this.#owned(state, row.targetId, binding), receipt = acceptedReceipt(binding, witness);
      if (!receipt || (target.receipt && !receiptEqual(target.receipt, receipt)) || (!target.receipt && target.baselineUserIds?.includes(receipt.userMessageId))) return false;
      row.receipt = receipt; row.phase = STOP_PHASES.dispatched; row.dispatchedAt = Date.now(); return true;
    }, true);
  }
  settleStop(id, binding, value) {
    return this.#run(state => {
      const row = state.stopRequests.find(stop => stop.id === id && sameOperationBinding(stop.binding, binding));
      if (!row || ![STOP_PHASES.dispatched, STOP_PHASES.uncertain].includes(row.phase) || !receiptEqual(row.receipt, acceptedReceipt(binding, value?.receipt))) return false;
      row.phase = value.confirmed === true ? STOP_PHASES.confirmed : STOP_PHASES.uncertain;
      row.observedAt = Date.now(); return true;
    }, true);
  }
}
