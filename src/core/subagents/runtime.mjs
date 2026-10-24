import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { SESSIONS_DIR } from '../config.mjs';
import { saveSession } from '../sessions.mjs';
import { redactValue } from '../../security/secret-scrubber.mjs';
import { redactText, configuredSecrets } from '../redact.mjs';
import { capOutput } from '../../../tools/shared/_shared.mjs';
import {
  CHILD_RULES,
  SUBAGENT_DEFAULTS,
  SUBAGENT_DESCRIPTION_MAX_CHARS,
  SUBAGENT_EVENT,
  SUBAGENT_EVENT_RESULT_BYTES,
  SUBAGENT_LIMITS,
  SUBAGENT_STATUS,
  SUBAGENT_TRANSCRIPT_PREFIX,
  SUBAGENT_TRANSCRIPT_KEEP,
  SUBAGENT_TYPES,
  SUMMARY_MAX_BYTES,
  presetFor,
  resolveTools,
} from './registry.mjs';

// Workers share one workspace. Serialize them per resolved path so two
// delegations from different threads cannot edit the same tree at once.
const workspaceTails = new Map();

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function capChars(value, max) {
  const text = String(value ?? '').trim();
  return text.length > max ? text.slice(0, max) : text;
}

/** Per-call timeout: the requested value may tighten the configured cap, never exceed it. */
export function resolveTimeout(args = {}, cfg = {}) {
  const configured = clampInt(cfg.subagentTimeoutMs, SUBAGENT_LIMITS.minTimeoutMs, SUBAGENT_LIMITS.maxTimeoutMs, SUBAGENT_DEFAULTS.timeoutMs);
  const requested = Number(args?.timeout_ms);
  if (!Number.isFinite(requested) || requested <= 0) return configured;
  return Math.min(configured, Math.max(SUBAGENT_LIMITS.minTimeoutMs, Math.floor(requested)));
}

/** Per-call step cap: same tighten-only rule as the timeout. */
export function resolveStepLimit(args = {}, cfg = {}) {
  const cap = clampInt(cfg.subagentMaxToolSteps, 1, SUBAGENT_LIMITS.maxToolSteps, SUBAGENT_DEFAULTS.toolSteps);
  const requested = Number(args?.max_steps);
  if (!Number.isFinite(requested) || requested <= 0) return cap;
  return Math.min(cap, Math.max(1, Math.floor(requested)));
}

function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('Sub-agent cancelled.');
  error.name = 'AbortError';
  return error;
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

class Semaphore {
  constructor(limit) {
    this.limit = Math.max(1, limit);
    this.active = 0;
    this.queue = [];
  }

  async acquire(signal) {
    if (signal?.aborted) throw abortError(signal);
    if (this.active < this.limit) {
      this.active++;
      return () => this.release();
    }
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: null };
      waiter.onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) { this.queue.splice(index, 1); reject(abortError(signal)); }
      };
      signal?.addEventListener('abort', waiter.onAbort, { once: true });
      this.queue.push(waiter);
    });
    if (signal?.aborted) {
      this.release();
      throw abortError(signal);
    }
    return () => this.release();
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    while (this.queue.length && this.active < this.limit) {
      const waiter = this.queue.shift();
      waiter.signal?.removeEventListener('abort', waiter.onAbort);
      this.active++;
      waiter.resolve();
    }
  }
}

function workspaceKey(parent) {
  const requested = path.resolve(parent.workspacePath || parent.cwd || process.cwd());
  let canonical = requested;
  try { canonical = fs.realpathSync.native(requested); } catch {}
  // Windows paths are case-insensitive; realpath also folds symlink/junction aliases.
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function withWorkspaceLock(key, signal, task) {
  const previous = workspaceTails.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  workspaceTails.set(key, tail);
  // A cancelled waiter still belongs to the predecessor chain. Remove its tail
  // only after that predecessor and this gate have both finished, so a later
  // worker cannot overtake work that is still running.
  void tail.then(() => { if (workspaceTails.get(key) === tail) workspaceTails.delete(key); });
  return (async () => {
    try {
      await waitFor(previous, signal);
      return await task();
    } finally {
      release();
    }
  })();
}

/**
 * Keep only the newest subagent transcripts. Teammate sessions, project files
 * and anything without the child prefix are never touched.
 */
export function pruneSubagentTranscripts(dir, keep = SUBAGENT_TRANSCRIPT_KEEP) {
  const limit = Math.max(1, Math.floor(Number(keep) || 1));
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.startsWith(SUBAGENT_TRANSCRIPT_PREFIX) && entry.name.endsWith('.json'))
      .map(entry => {
        const file = path.join(dir, entry.name);
        return { file, at: fs.statSync(file).mtimeMs };
      })
      .sort((a, b) => b.at - a.at);
    for (const { file } of entries.slice(limit)) fs.rmSync(file, { force: true });
  } catch {
    // Retention is housekeeping: a missing directory or a locked file must
    // never fail the child that just finished.
  }
}

export function createSubagentRuntime({ parent, createAgent, toolNames = [] }) {
  if (typeof createAgent !== 'function') throw new TypeError('createSubagentRuntime requires a createAgent function');
  const semaphore = new Semaphore(clampInt(parent.config?.maxConcurrentSubagents, 1, SUBAGENT_LIMITS.maxConcurrent, SUBAGENT_DEFAULTS.concurrency));
  let startedThisTurn = 0;

  const config = () => parent.config ?? {};

  function emit(event) {
    try { parent.emitSubagentEvent?.(event); } catch {}
  }

  function envelope(fields) {
    return JSON.stringify({
      subagentId: null,
      parentCallId: null,
      subagentType: null,
      description: null,
      status: SUBAGENT_STATUS.rejected,
      summary: '',
      result: '',
      toolsUsed: [],
      usage: null,
      durationMs: 0,
      transcript: null,
      ...fields,
    });
  }

  function childTimeout(args) {
    return resolveTimeout(args, config());
  }

  function createChild({ id, type, preset, depth, description, args }) {
    const cfg = config();
    const stepLimit = resolveStepLimit(args, cfg);
    const callLimit = clampInt(cfg.subagentMaxToolCalls, 1, SUBAGENT_LIMITS.maxToolCalls, SUBAGENT_DEFAULTS.toolCalls);
    const approvalContext = { subagentId: id, subagentType: type, subagentDescription: description };
    return createAgent({
      client: parent.client,
      config: {
        ...cfg,
        // Defense in depth: depth checks also run here, but a child must never
        // advertise or execute delegation even if a parent is misconfigured.
        subagentsEnabled: false,
        maxToolSteps: stepLimit,
        maxToolCalls: callLimit,
      },
      confirm: (name, detail) => parent.confirm?.(name, detail, approvalContext),
      print: () => {},
      write: () => {},
      project: parent.project || '',
      projectId: parent.projectId ?? null,
      workspacePath: parent.workspacePath ?? null,
      allowedTools: new Set(resolveTools(preset, toolNames)),
      toolContext: { ...(parent.toolContext ?? {}), ...approvalContext },
      deferTools: false,
      skillsEnabled: false,
      mcp: null,
      journal: null,
      tool: null,
      depth,
      readOnly: preset.readOnly === true,
      memoryEnabled: false,
      systemSuffix: [preset.systemPrompt, CHILD_RULES].join('\n\n'),
      approvalContext,
    });
  }

  async function run(args = {}, ctx = {}) {
    const id = randomUUID();
    const startedAt = Date.now();
    const parentCallId = ctx.callId ?? null;
    const signal = ctx.signal ?? parent.abort?.signal ?? null;
    const type = String(args?.subagent_type ?? '');
    const preset = presetFor(type);
    const description = capChars(args?.description, SUBAGENT_DESCRIPTION_MAX_CHARS) || type || 'sub-agent';
    const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : '';
    const cfg = config();
    const base = { subagentId: id, parentCallId, subagentType: type, description, durationMs: Date.now() - startedAt };

    const rejected = error => envelope({ ...base, durationMs: Date.now() - startedAt, status: SUBAGENT_STATUS.rejected, summary: error, error });
    const cancelled = error => envelope({ ...base, durationMs: Date.now() - startedAt, status: SUBAGENT_STATUS.cancelled, summary: error, error });

    if (!preset) return rejected(`Unknown subagent_type "${type}". Valid types: ${[...SUBAGENT_TYPES].join(', ')}.`);
    if (!prompt) return rejected('A nonempty prompt is required.');
    if (cfg.subagentsEnabled === false) return rejected('Sub-agents are disabled by configuration.');
    if (signal?.aborted) return cancelled('The parent request was cancelled before the sub-agent started.');

    const depth = (Number(parent.depth) || 0) + 1;
    const maxDepth = clampInt(cfg.maxSubagentDepth, 0, SUBAGENT_LIMITS.maxDepth, SUBAGENT_DEFAULTS.maxDepth);
    if (depth > maxDepth) return rejected(`Sub-agent depth limit reached (${maxDepth}).`);
    const perTurn = clampInt(cfg.maxSubagentsPerTurn, 1, SUBAGENT_LIMITS.maxPerTurn, SUBAGENT_DEFAULTS.perTurn);
    if (startedThisTurn >= perTurn) return rejected(`Sub-agent budget for this request is exhausted (${perTurn}).`);
    startedThisTurn++;

    let releaseSlot;
    try {
      releaseSlot = await semaphore.acquire(signal);
    } catch {
      return cancelled('The parent request was cancelled while waiting for a sub-agent slot.');
    }

    const context = { id, type, preset, depth, description, prompt, signal, startedAt, parentCallId, args, cfg };
    try {
      const task = () => execute(context);
      if (preset.readOnly) return await task();
      return await withWorkspaceLock(workspaceKey(parent), signal, task);
    } catch (error) {
      if (signal?.aborted) return cancelled('The parent request was cancelled while the sub-agent was running.');
      const message = redactText(String(error?.message || error), { secrets: configuredSecrets(process.env, cfg) });
      return envelope({ ...base, durationMs: Date.now() - startedAt, status: SUBAGENT_STATUS.failed, summary: message, error: message });
    } finally {
      releaseSlot();
    }
  }

  async function execute({ id, type, preset, depth, description, prompt, signal, startedAt, parentCallId, args, cfg }) {
    if (signal?.aborted) {
      return envelope({ subagentId: id, parentCallId, subagentType: type, description, durationMs: Date.now() - startedAt,
        status: SUBAGENT_STATUS.cancelled, summary: 'The parent request was cancelled before the sub-agent started.', error: 'cancelled' });
    }

    let child;
    try {
      child = createChild({ id, type, preset, depth, description, args });
    } catch (error) {
      const message = redactText(String(error?.message || error), { secrets: configuredSecrets(process.env, cfg) });
      return envelope({ subagentId: id, parentCallId, subagentType: type, description, durationMs: Date.now() - startedAt,
        status: SUBAGENT_STATUS.failed, summary: message, error: message, depth });
    }

    const timeoutMs = childTimeout(args);
    const tokenBudget = clampInt(cfg.subagentMaxTokens, SUBAGENT_LIMITS.minTokens, SUBAGENT_LIMITS.maxTokens, SUBAGENT_DEFAULTS.tokens);
    const resultBytes = clampInt(cfg.subagentMaxResultBytes, SUBAGENT_LIMITS.minResultBytes, SUBAGENT_LIMITS.maxResultBytes, SUBAGENT_DEFAULTS.resultBytes);
    let timedOut = false;
    let budgetExceeded = false;
    let failure = null;
    let reply = null;
    let timer = null;

    const stopChild = () => {
      void child.cancel();
      void child.executionHost().cancel().catch(() => {});
    };
    const onParentAbort = () => stopChild();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    emit({ type: SUBAGENT_EVENT.start, subagentId: id, parentCallId, subagentType: type, description,
      prompt: capOutput(prompt, SUBAGENT_EVENT_RESULT_BYTES), depth });

    try {
      timer = setTimeout(() => { timedOut = true; stopChild(); }, timeoutMs);
      timer.unref?.();
      reply = await child.send(prompt, {
        onDelta: text => emit({ type: SUBAGENT_EVENT.delta, subagentId: id, parentCallId, text }),
        onToolCall: call => emit({ type: SUBAGENT_EVENT.toolCall, subagentId: id, parentCallId, call }),
        onToolResult: (call, result) => emit({ type: SUBAGENT_EVENT.toolResult, subagentId: id, parentCallId, call,
          result: capOutput(result, SUBAGENT_EVENT_RESULT_BYTES) }),
        onUsage: () => {
          if (!budgetExceeded && child.sessionUsage.total_tokens >= tokenBudget) {
            budgetExceeded = true;
            stopChild();
          }
        },
      });
    } catch (error) {
      failure = error;
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onParentAbort);
      try { await child.executionHost().cancel(); } catch {}
    }

    const parentCancelled = signal?.aborted === true;
    const status = parentCancelled ? SUBAGENT_STATUS.cancelled
      : timedOut ? SUBAGENT_STATUS.timeout
        : budgetExceeded ? SUBAGENT_STATUS.budgetExceeded
          : failure || reply == null ? SUBAGENT_STATUS.failed
            : SUBAGENT_STATUS.completed;
    const failureMessage = failure
      ? redactText(String(failure.message || failure), { secrets: configuredSecrets(process.env, cfg) })
      : status === SUBAGENT_STATUS.failed ? 'The sub-agent ended without a final answer.' : null;
    const statusNote = parentCancelled ? 'Cancelled by the parent request.'
      : timedOut ? `Timed out after ${timeoutMs} ms.`
        : budgetExceeded ? `Token budget exhausted (${tokenBudget}).` : null;
    const replyText = typeof reply === 'string' ? reply.trim() : '';
    const summary = capOutput(replyText || statusNote || failureMessage || '', SUMMARY_MAX_BYTES);
    const result = capOutput([replyText, statusNote ? `[${statusNote}]` : ''].filter(Boolean).join('\n\n'), resultBytes);
    const transcript = persist(child, {
      id, type, description, prompt, depth, parentCallId, status, startedAt, failureMessage, usage: child.sessionUsage,
    });

    const event = { type: SUBAGENT_EVENT.end, subagentId: id, parentCallId, subagentType: type, description, status, summary,
      usage: { ...child.sessionUsage }, durationMs: Date.now() - startedAt, transcript, toolsUsed: [...(child.ranThisTurn || [])], depth };
    emit(event);

    return envelope({
      subagentId: id,
      parentCallId,
      subagentType: type,
      description,
      status,
      summary,
      result,
      toolsUsed: [...(child.ranThisTurn || [])],
      usage: { ...child.sessionUsage },
      durationMs: Date.now() - startedAt,
      transcript,
      depth,
      ...(failureMessage ? { error: failureMessage } : {}),
      ...(statusNote ? { note: statusNote } : {}),
    });
  }

  function persist(child, { id, type, description, prompt, depth, parentCallId, status, startedAt, failureMessage, usage }) {
    try {
      const file = path.join(SESSIONS_DIR, `${SUBAGENT_TRANSCRIPT_PREFIX}${id}.json`);
      saveSession(file, {
        id,
        kind: 'subagent',
        subagentType: type,
        description,
        depth,
        parentCallId,
        parentSessionId: parent.sessionId ?? null,
        status,
        prompt,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        workspacePath: parent.workspacePath || parent.cwd || null,
        usage,
        error: failureMessage || null,
        messages: child.messages,
      }, { transform: typeof parent.subagentTransform === 'function' ? parent.subagentTransform : redactValue });
      pruneSubagentTranscripts(SESSIONS_DIR);
      return file;
    } catch {
      return null;
    }
  }

  return {
    beginTurn() { startedThisTurn = 0; },
    run,
  };
}
