import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { TIER_DENY } from '../../src/integrations/mcp-tiers.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-tool-host-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const context = { cwd: directory, workspacePath: directory, config: { memoryConsolidation: false }, readOnly: true };
const call = (name, args = {}) => ({ id: 'host-proof', name, arguments: args });
const text = result => result.content.filter(part => part.type === 'text').map(part => part.text).join('\n');

test('read-only host refuses mutation even with automatic approval', async () => {
  const host = new ToolHost({ context: { ...context, config: { autoApprove: true } } });
  const result = await host.execute(call('write_file', { path: 'denied.txt', content: 'never' }));
  assert.equal(result.isError, true);
  assert.match(text(result), /read-only/i);
  assert.equal(fs.existsSync(path.join(directory, 'denied.txt')), false);
});

test('real reads keep the host workspace and reject argument-based escape', async () => {
  fs.writeFileSync(path.join(directory, 'proof.txt'), 'host-owned bytes');
  const host = new ToolHost({ context });
  assert.match(text(await host.execute(call('read_file', { path: 'proof.txt', cwd: os.tmpdir() }))), /host-owned bytes/);
  const result = await host.execute(call('read_file', { path: '../outside.txt' }));
  assert.equal(result.isError, true);
  assert.match(text(result), /outside|escape|workspace/i);
});

test('a stopped call never reaches the MCP handler', async () => {
  let executed = 0;
  const controller = new AbortController(); controller.abort();
  const mcp = { findTool: () => ({}), needsApproval: () => false, callToolResult: () => { executed++; return { content: [] }; } };
  const host = new ToolHost({ context: { ...context, readOnly: false }, mcp });
  assert.equal((await host.execute(call('mcp__proof__read'), { signal: controller.signal })).isError, true);
  assert.equal(executed, 0);
});

test('explicit blocked MCP tier survives auto approval and direct desktop mode', async () => {
  let executed = 0;
  const mcp = { findTool: () => ({}), tierFor: () => ({ tier: TIER_DENY, label: 'proof' }), callToolResult: () => { executed++; } };
  const host = new ToolHost({ context: { ...context, readOnly: false, config: { autoApprove: true, computerUseDirect: true } }, mcp });
  assert.match(text(await host.execute(call('mcp__proof__read'))), /blocked/);
  assert.equal(executed, 0);
});

test('native MCP images and text remain native without API history or client', async () => {
  const content = [{ type: 'text', text: 'observed' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }];
  const mcp = { findTool: () => ({ tool: { annotations: { readOnlyHint: true } } }), needsApproval: () => false, callToolResult: async () => ({ raw: { content }, isError: false }) };
  const result = await new ToolHost({ context, mcp }).execute(call('mcp__proof__read'), { resultMode: 'mcp' });
  assert.deepEqual(result, { content, isError: false });
});

test('cancellation during approval cannot execute a newly approved mutation', async () => {
  const controller = new AbortController();
  let prompts = 0;
  const host = new ToolHost({ context: { ...context, readOnly: false }, authorize: async () => { prompts++; controller.abort(); return true; } });
  const result = await host.execute(call('write_file', { path: 'cancelled.txt', content: 'never' }), { signal: controller.signal });
  assert.equal(result.isError, true);
  assert.equal(fs.existsSync(path.join(directory, 'cancelled.txt')), false);
  assert.equal(prompts, 1);
});

test('native MCP output bounds untrusted text and omits malformed image blocks', async () => {
  const mcp = { findTool: () => ({ tool: { annotations: { readOnlyHint: true } } }), needsApproval: () => false,
    callToolResult: async () => ({ content: [{ type: 'text', text: 'x'.repeat(8000) }, { type: 'image', mimeType: 'image/png', data: '<unsafe>' }] }) };
  const result = await new ToolHost({ context: { ...context, config: { maxToolChars: 1024 } }, mcp }).execute(call('mcp__proof__read'));
  assert.ok(Buffer.byteLength(text(result)) <= 1024);
  assert.equal(result.content.filter(part => part.type === 'image').length, 0);
});

test('an explicit current approval setting takes priority over older config for local and MCP writes', async () => {
  let prompts = 0, executions = 0;
  const mcp = { findTool: () => ({}), needsApproval: () => true, approvalDetail: () => 'Fixture mutation', callToolResult: async () => { executions++; return { content: [] }; } };
  const host = new ToolHost({ context: { ...context, readOnly: false, autoApprove: false, config: { autoApprove: true } }, mcp,
    authorize: async () => { prompts++; return false; } });
  const result = await host.execute(call('write_file', { path: 'current-policy.txt', content: 'never' }));
  assert.equal(result.isError, true);
  assert.equal(fs.existsSync(path.join(directory, 'current-policy.txt')), false);
  const native = await host.execute(call('mcp__proof__write'));
  assert.equal(native.isError, true);
  assert.equal(executions, 0); assert.equal(prompts, 2, text(native));
});

test('a thrown native tool error is an MCP error result rather than a successful receipt', async () => {
  const mcp = { findTool: () => ({}), needsApproval: () => false, callToolResult: async () => { throw new Error('fixture transport disconnected'); } };
  const host = new ToolHost({ context: { ...context, readOnly: false }, mcp });
  const result = await host.execute(call('mcp__proof__read'));
  assert.equal(result.isError, true);
  assert.match(text(result), /fixture transport disconnected/);
});
