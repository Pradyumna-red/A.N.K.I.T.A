import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sandbox the config layer so no real config.env or project .env leaks in.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-subagent-config-'));
process.env.CONFIG_DIR = SANDBOX;
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

const { loadConfig } = await import('../../src/core/config.mjs');
const { SUBAGENT_DEFAULTS, SUBAGENT_LIMITS } = await import('../../src/core/subagents/registry.mjs');

const MISSING = path.join(SANDBOX, 'missing.env');
let sequence = 0;

/** One isolated project .env per case; the global layer stays absent. */
function load(vars = {}) {
  const file = path.join(SANDBOX, `case-${++sequence}.env`);
  fs.writeFileSync(file, Object.entries(vars).map(([key, value]) => `${key}=${value}`).join('\n'));
  return loadConfig(file, { globalEnvFile: MISSING });
}

test('sub-agent defaults ship the raised budgets', () => {
  const config = load();
  assert.equal(config.subagentsEnabled, SUBAGENT_DEFAULTS.enabled);
  assert.equal(config.maxSubagentDepth, SUBAGENT_DEFAULTS.maxDepth);
  assert.equal(config.maxConcurrentSubagents, SUBAGENT_DEFAULTS.concurrency);
  assert.equal(config.maxSubagentsPerTurn, SUBAGENT_DEFAULTS.perTurn);
  assert.equal(config.subagentMaxToolSteps, SUBAGENT_DEFAULTS.toolSteps);
  assert.equal(config.subagentMaxToolCalls, SUBAGENT_DEFAULTS.toolCalls);
  assert.equal(config.subagentTimeoutMs, SUBAGENT_DEFAULTS.timeoutMs);
  assert.equal(config.subagentMaxTokens, SUBAGENT_DEFAULTS.tokens);
  assert.equal(config.subagentMaxResultBytes, SUBAGENT_DEFAULTS.resultBytes);
  // Long tasks are the point: a child must not be capped at a single recon pass.
  assert.ok(config.subagentMaxToolCalls >= 200, 'call budget fits an edit-test-fix loop');
  assert.ok(config.subagentTimeoutMs >= 30 * 60 * 1000, 'wall clock fits a real implementation task');
});

test('sub-agent env overrides clamp to the advertised ranges', () => {
  const high = load({
    MAX_SUBAGENT_DEPTH: '99',
    MAX_CONCURRENT_SUBAGENTS: '999',
    MAX_SUBAGENTS_PER_TURN: '999',
    SUBAGENT_MAX_TOOL_STEPS: '99999',
    SUBAGENT_MAX_TOOL_CALLS: '99999',
    SUBAGENT_TIMEOUT_MS: '999999999',
    SUBAGENT_MAX_TOKENS: '999999999',
    SUBAGENT_MAX_RESULT_BYTES: '999999999',
  });
  assert.equal(high.maxSubagentDepth, SUBAGENT_LIMITS.maxDepth);
  assert.equal(high.maxConcurrentSubagents, SUBAGENT_LIMITS.maxConcurrent);
  assert.equal(high.maxSubagentsPerTurn, SUBAGENT_LIMITS.maxPerTurn);
  assert.equal(high.subagentMaxToolSteps, SUBAGENT_LIMITS.maxToolSteps);
  assert.equal(high.subagentMaxToolCalls, SUBAGENT_LIMITS.maxToolCalls);
  assert.equal(high.subagentTimeoutMs, SUBAGENT_LIMITS.maxTimeoutMs);
  assert.equal(high.subagentMaxTokens, SUBAGENT_LIMITS.maxTokens);
  assert.equal(high.subagentMaxResultBytes, SUBAGENT_LIMITS.maxResultBytes);

  const low = load({
    MAX_CONCURRENT_SUBAGENTS: '0',
    MAX_SUBAGENTS_PER_TURN: '0',
    SUBAGENT_MAX_TOOL_STEPS: '0',
    SUBAGENT_MAX_TOOL_CALLS: '0',
    SUBAGENT_TIMEOUT_MS: '1',
    SUBAGENT_MAX_TOKENS: '1',
    SUBAGENT_MAX_RESULT_BYTES: '1',
  });
  assert.equal(low.maxConcurrentSubagents, 1);
  assert.equal(low.maxSubagentsPerTurn, 1);
  assert.equal(low.subagentMaxToolSteps, 1);
  assert.equal(low.subagentMaxToolCalls, 1);
  assert.equal(low.subagentTimeoutMs, SUBAGENT_LIMITS.minTimeoutMs);
  assert.equal(low.subagentMaxTokens, SUBAGENT_LIMITS.minTokens);
  assert.equal(low.subagentMaxResultBytes, SUBAGENT_LIMITS.minResultBytes);
});

test('SUBAGENTS_ENABLED=0 turns delegation off without touching other budgets', () => {
  const config = load({ SUBAGENTS_ENABLED: '0', SUBAGENT_MAX_TOOL_CALLS: '300' });
  assert.equal(config.subagentsEnabled, false);
  assert.equal(config.subagentMaxToolCalls, 300);
});
