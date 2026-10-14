import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PersistentToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { RequestOwners } from '../../src/integrations/chatgpt-browser/request-owners.mjs';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { McpClient } from '../../src/integrations/mcp-client.mjs';
import { COMPUTER_MCP_ID, COMPUTER_DIRECT_CONFIG, COMPUTER_POINTER_SESSION } from '../../src/integrations/computer-use.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-receipts-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const result = { content: [{ type: 'text', text: 'committed-once' }], isError: false };
const hash = 'a'.repeat(64);
const binding = { leaseId: 'owned-native-lease', epoch: 'owned-epoch', tabId: 1, conversationId: crypto.randomUUID(),
  threadId: 'owned-thread', browserId: 'owned-browser', workspacePath: directory };

test('durable native receipt survives another process and an identical retry cannot grant execution again', async () => {
  const receipts = new PersistentToolReceipts({ directory: path.join(directory, 'settled') });
  const first = await receipts.begin('transport/request/rpc-identity', hash);
  assert.equal(first.fresh, true);
  const duplicate = await receipts.begin('transport/request/rpc-identity', hash);
  assert.equal(duplicate.fresh, false);
  await receipts.settle(first.id, result);
  assert.deepEqual(await duplicate.completion, result);
  const restored = new PersistentToolReceipts({ directory: path.join(directory, 'settled') });
  const repeated = await restored.begin('transport/request/rpc-identity', hash);
  assert.equal(repeated.id, first.id); assert.equal(repeated.fresh, false);
  assert.deepEqual(await repeated.completion, result);
  await assert.rejects(restored.begin('transport/request/rpc-identity', 'b'.repeat(64)), /payload changed/i);
});

test('old generation-wide receipt identities cannot be replayed under a new per-call identity', async () => {
  const receipts = new PersistentToolReceipts({ directory: path.join(directory, 'legacy-call-identity') });
  const legacyIdentity = JSON.stringify([binding.leaseId, 'core', 'legacy-generation', 'number', 0]);
  const first = await receipts.begin(legacyIdentity, hash); await receipts.settle(first.id, result);
  const currentIdentity = JSON.stringify([binding.leaseId, 'core', 'legacy-generation/call-one', 'number', 0]);
  await assert.rejects(receipts.begin(currentIdentity, hash, undefined, { legacyIdentity }), /predates.*call tracking|new explicit request/i);
  const fresh = await receipts.begin('fresh-generation/call-one', hash, undefined, { legacyIdentity: 'fresh-generation' });
  assert.equal(fresh.fresh, true); await receipts.settle(fresh.id, result);
});

test('handoff lists only receipt metadata for its exact original host binding and preserves crash uncertainty', async () => {
  const receipts = new PersistentToolReceipts({ directory: path.join(directory, 'handoff') });
  const admission = await receipts.begin('owned-handoff', hash, { binding, surface: 'core', name: 'write_file' });
  await receipts.begin('other-handoff', hash, { binding: { ...binding, workspacePath: os.tmpdir() }, surface: 'core', name: 'write_file' });
  const rows = await receipts.list(binding);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, admission.id); assert.equal(rows[0].phase, 'started');
  assert.equal(rows[0].owner.name, 'write_file');
  await receipts.settle(admission.id, result);
  assert.equal((await receipts.list(binding))[0].phase, 'settled');
});

test('a process lost after durable admission reports uncertain and never re-executes', async () => {
  const location = path.join(directory, 'crashed');
  const receipts = new PersistentToolReceipts({ directory: location });
  const first = await receipts.begin('lost-before-receipt', hash);
  const module = new URL('../../src/integrations/chatgpt-browser/tool-receipts.mjs', import.meta.url).href;
  const script = `import { PersistentToolReceipts } from ${JSON.stringify(module)};
    const store = new PersistentToolReceipts({directory:process.argv[1]});
    const row = await store.begin('lost-before-receipt', '${hash}');
    const result = await row.completion;
    console.log(JSON.stringify({fresh:row.fresh,id:row.id,isError:result.isError,text:result.content[0].text}));`;
  const recovered = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, location], { encoding: 'utf8' }));
  assert.equal(recovered.id, first.id); assert.equal(recovered.fresh, false);
  assert.equal(recovered.isError, true); assert.match(recovered.text, /uncertain.*do not retry/i);
});

test('exact request ownership refuses concurrent conflict and host-context changes under the same page scope', async () => {
  const owners = new RequestOwners({ timeoutMs: 1 }); owners.bind(binding);
  owners.observe(binding, ['owned-request']);
  owners.observe({ ...binding, workspacePath: os.tmpdir() }, ['owned-request']);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'owned-request' }), /ambiguous|conflict/i);
  await assert.rejects(owners.resolve({ leaseId: 'stale', requestId: 'owned-request' }), /lease/i);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'missing' }), /observed/i);
});

test('disconnect after a committed native write drains its receipt and a retry executes exactly once', async () => {
  const receipts = new PersistentToolReceipts({ directory: path.join(directory, 'disconnect') });
  let entered, finish, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const host = { specs: () => [], execute: async (_, options) => {
    calls++; fs.writeFileSync(path.join(directory, 'once.txt'), String(calls)); entered(); await gate;
    assert.equal(options.signal?.aborted ?? false, false, 'socket lifetime does not cancel already-admitted work');
    return result;
  } };
  const gateway = await createToolGateway({ leaseId: binding.leaseId, receipts, hostForLease: () => host,
    resolveRequestOwner: async () => binding });
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'Mcp-Protocol-Version': '2025-11-25', 'x-request-id': 'disconnect-native/hop' };
  const payload = { jsonrpc: '2.0', id: 'same-write', method: 'tools/call', params: { name: 'write_file', arguments: { path: 'once.txt' } } };
  const options = { method: 'POST', headers, body: JSON.stringify(payload) };
  const controller = new AbortController();
  const request = fetch(gateway.url, { ...options, signal: controller.signal });
  void request.catch(() => {});
  try {
    await started; controller.abort(); await assert.rejects(request); finish();
    const retry = await fetch(gateway.url, options);
    assert.equal(retry.status, 200); assert.match(await retry.text(), /committed-once/);
    assert.equal(calls, 1); assert.equal(fs.readFileSync(path.join(directory, 'once.txt'), 'utf8'), '1');
    const changed = await fetch(gateway.url, { ...options, body: JSON.stringify({ ...payload, params: { ...payload.params, arguments: { path: 'changed.txt' } } }) });
    assert.equal(changed.status, 409); assert.equal(calls, 1);
  } finally { finish(); await gateway.close(); }
});

test('real native HTTP preserves a fixture driver image and fresh target readback under the host pointer without action prompts', async () => {
  const image = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS3sAAAAASUVORK5CYII=' };
  const names = ['get_window_state', 'set_value'];
  const tools = names.map(name => ({ name, description: name, inputSchema: { type: 'object', properties: { session: { type: 'string' } } }, annotations: { readOnlyHint: name === names[0] } }));
  const record = { tools, [COMPUTER_POINTER_SESSION]: 'owned-pointer-session' };
  let actions = 0, approvals = 0;
  const mcp = { specs: () => tools.map(tool => ({ function: { name: `mcp__${COMPUTER_MCP_ID}__${tool.name}`, description: tool.description, parameters: tool.inputSchema } })),
    findTool: fullName => ({ record, tool: tools.find(tool => fullName.endsWith('__' + tool.name)) }), needsApproval: () => true,
    callToolResult: async (name, args) => {
      assert.equal(args.session, record[COMPUTER_POINTER_SESSION]);
      if (name.endsWith('__set_value')) {
        assert.equal(args.element_token, 'fresh-target-one'); actions++;
        return { content: [{ type: 'text', text: 'readback: native fixture value' }], isError: false };
      }
      return { content: [{ type: 'text', text: 'fixture native window' }, image], structuredContent: {
        snapshot_id: 'fresh-snapshot-one', elements: [{ index: 0, role: 'textbox', element_token: 'fresh-target-one' }] }, isError: false };
    } };
  const host = new ToolHost({ context: { cwd: directory, workspacePath: directory, config: { [COMPUTER_DIRECT_CONFIG]: true } }, mcp,
    authorize: () => { approvals++; return false; } });
  const gateway = await createToolGateway({ leaseId: binding.leaseId, hostForLease: () => host, resolveRequestOwner: async () => binding,
    receipts: new PersistentToolReceipts({ directory: path.join(directory, 'native-images') }) });
  const client = new McpClient({ transport: 'http', url: gateway.urls.desktop, headers: { 'x-request-id': 'native-image-fixture/hop' } });
  try {
    await client.connect();
    const observed = await client.callTool(`mcp__${COMPUTER_MCP_ID}__get_window_state`, { session: 'untrusted-session' });
    assert.deepEqual(observed.raw.content.find(part => part.type === 'image'), image);
    assert.match(observed.raw.content[0].text, /fresh-snapshot-one/); assert.match(observed.raw.content[0].text, /fresh-target-one/);
    const changed = await client.callTool(`mcp__${COMPUTER_MCP_ID}__set_value`, { session: 'untrusted-session', element_token: 'fresh-target-one', text: 'native fixture value' });
    assert.equal(changed.isError, false); assert.match(changed.raw.content[0].text, /readback: native fixture value/);
    assert.equal(actions, 1); assert.equal(approvals, 0);
    console.log('NATIVE_IMAGE_PROTOCOL_FIXTURE', JSON.stringify({ realHttpMcp: true, nativeImagePreserved: true, freshTargetReadback: true, pointerSessionOwned: true, approvals, actualCuaDriver: false, hostedChatGpt: false }));
  } finally { await client.close(); await gateway.close(); }
});
