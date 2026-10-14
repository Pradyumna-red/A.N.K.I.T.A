import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { McpClient } from '../../src/integrations/mcp-client.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { MemoryToolReceipts, PersistentToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';
import { NATIVE_CALL_ID_MAX_CHARS } from '../../src/integrations/chatgpt-browser/protocol.mjs';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-gateway-'));
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));
const leaseId = 'proof-lease';
async function fixture(overrides = {}) {
  const host = new ToolHost({ context: { cwd: directory, workspacePath: directory, config: {}, readOnly: true, allowedTools: new Set(['read_file']) } });
  return createToolGateway({ leaseId, hostForLease: id => { assert.equal(id, leaseId); return host; },
    resolveRequestOwner: async ({ leaseId: id }) => ({ leaseId: id }), receipts: new MemoryToolReceipts(), ...overrides });
}
const rpc = (id, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'read_file', arguments: args } });
const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Protocol-Version': '2025-11-25', 'x-request-id': 'native-request/segment' };
const deferred = () => {
  let resolve; const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
function rawRequest(url, extraHeaders) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers: extraHeaders }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end();
  });
}

test('actual MCP HTTP client reads exact local bytes through SDK and shared ToolHost', async () => {
  const bytes = 'native-proof-' + crypto.randomUUID();
  fs.writeFileSync(path.join(directory, 'proof.txt'), bytes);
  const gateway = await fixture();
  const client = new McpClient({ transport: 'http', url: gateway.url, headers: { 'x-request-id': 'proof-native' } });
  try {
    await client.connect();
    assert.ok(client.tools.some(tool => tool.name === 'read_file'));
    const result = await client.callTool('read_file', { path: 'proof.txt' });
    assert.equal(result.isError, false);
    assert.ok(result.raw.content[0].text.includes(bytes));
    const denied = await client.callTool('write_file', { path: 'no.txt', content: 'never' });
    assert.equal(denied.isError, true);
    assert.equal(fs.existsSync(path.join(directory, 'no.txt')), false);
  } finally { await client.close(); await gateway.close(); }
});

test('HTTP admission rejects wrong route, hostile Host/Origin, bounded body and missing ownership', async () => {
  const gateway = await fixture({ config: { maxBodyBytes: 1024 } });
  try {
    assert.equal((await fetch(new URL('/missing', gateway.url))).status, 401);
    assert.equal(await rawRequest(gateway.url, { Host: 'attacker.invalid' }), 403);
    assert.equal((await fetch(gateway.url, { headers: { Origin: 'https://attacker.invalid' } })).status, 403);
    assert.equal((await fetch(gateway.url, { method: 'POST', headers, body: 'x'.repeat(1025) })).status, 413);
    const missing = { ...headers }; delete missing['x-request-id'];
    assert.equal((await fetch(gateway.url, { method: 'POST', headers: missing, body: JSON.stringify(rpc('bad', {})) })).status, 403);
    for (const invalid of ['native-request/call,other', 'native-request//call', 'native-request/' + 'x'.repeat(NATIVE_CALL_ID_MAX_CHARS)])
      assert.equal((await fetch(gateway.url, { method: 'POST', headers: { ...headers, 'x-request-id': invalid }, body: JSON.stringify(rpc('bad', {})) })).status, 403);
    const metadata = await fetch(gateway.metadata);
    assert.equal(metadata.status, 200);
    assert.match(metadata.headers.get('content-type'), /application\/json/);
    assert.equal((await metadata.json()).resource, gateway.url);
    assert.equal((await fetch(new URL('/.well-known/oauth-protected-resource', gateway.url))).status, 401);
  } finally { await gateway.close(); }
});

test('wrong lease and forged workspace never reach a tool handler', async () => {
  let calls = 0;
  const gateway = await fixture({ resolveRequestOwner: async () => ({ leaseId: 'wrong-lease' }), hostForLease: () => { calls++; assert.fail('wrong lease'); } });
  try {
    const response = await fetch(gateway.url, { method: 'POST', headers, body: JSON.stringify(rpc('wrong', { workspacePath: os.tmpdir() })) });
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  } finally { await gateway.close(); }
});

test('identical HTTP retry uses one receipt; changed payload under same identity is refused', async () => {
  let calls = 0;
  const host = { specs: () => [], execute: async () => { calls++; return { content: [{ type: 'text', text: 'once' }], isError: false }; } };
  const gateway = await fixture({ hostForLease: () => host });
  try {
    const options = { method: 'POST', headers, body: JSON.stringify(rpc('same', { path: 'one' })) };
    const responses = await Promise.all([fetch(gateway.url, options), fetch(gateway.url, options)]);
    for (const response of responses) { assert.equal(response.status, 200); assert.match(await response.text(), /once/); }
    assert.equal(calls, 1);
    assert.equal((await fetch(gateway.url, { ...options, body: JSON.stringify(rpc('same', { path: 'two' })) })).status, 409);
  } finally { await gateway.close(); }
});

test('a disconnected HTTP request cannot settle a still-pending approved write or let gateway teardown forget its final result', async () => {
  const approval = deferred(), approvalEntered = deferred(), adapterReturned = deferred();
  const receipts = new PersistentToolReceipts({ directory: path.join(directory, 'disconnected-receipts') });
  const file = 'disconnected-write.txt', content = 'exactly one approved write';
  let prompts = 0, admission;
  const host = new ToolHost({ context: { cwd: directory, workspacePath: directory, config: {} },
    authorize: () => { prompts++; approvalEntered.resolve(); return approval.promise; } });
  const gateway = await fixture({ hostForLease: () => host, receipts: {
    begin: async (...args) => (admission = await receipts.begin(...args)),
    lookup: id => receipts.lookup(id), settle: (...args) => receipts.settle(...args),
  }, sdk: { McpServer, createMcpHandler, toNodeHandler: (...args) => {
    const actual = toNodeHandler(...args);
    return async (...request) => { try { return await actual(...request); } finally { adapterReturned.resolve(); } };
  } } });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/call', params: { name: 'write_file', arguments: { path: file, content } } });
  const request = http.request(gateway.url, { method: 'POST', headers });
  request.on('error', () => {}); request.end(body);
  try {
    await approvalEntered.promise;
    request.destroy();
    await adapterReturned.promise;
    // The real SDK adapter has returned after socket loss, while the accepted tool still awaits its human decision.
    await new Promise(resolve => setImmediate(resolve));
    assert.equal((await receipts.lookup(admission.id)).result, undefined, 'socket lifetime must not become a false tool outcome');
    assert.equal(fs.existsSync(path.join(directory, file)), false);
    let closed = false;
    const closing = gateway.close().then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false, 'gateway teardown must drain the accepted execution, even without its HTTP request');
    approval.resolve(true); await closing;
    assert.equal(fs.readFileSync(path.join(directory, file), 'utf8'), content);
    assert.equal((await receipts.lookup(admission.id)).result.isError, false);
    const restarted = await fixture({ hostForLease: () => host, receipts: new PersistentToolReceipts({ directory: path.join(directory, 'disconnected-receipts') }) });
    try {
      const retry = await fetch(restarted.url, { method: 'POST', headers, body });
      assert.equal(retry.status, 200); assert.doesNotMatch(await retry.text(), /admission ended|uncertain|"isError":true/);
      assert.equal(prompts, 1, 'an exact retry must reuse the actual durable result without another write or approval');
    } finally { await restarted.close(); }
  } finally { approval.resolve(true); request.destroy(); await gateway.close(); }
});

test('native generation ownership does not collapse distinct tool calls that reuse an HTTP-scoped RPC ID', async () => {
  let calls = 0;
  const joined = [];
  const host = { specs: () => [], execute: async () => ({ content: [{ type: 'text', text: 'call-' + ++calls }], isError: false }) };
  const gateway = await fixture({ hostForLease: () => host, resolveRequestOwner: async input => { joined.push(input.requestId); return { leaseId }; } });
  const first = { method: 'POST', headers: { ...headers, 'x-request-id': 'same-generation/tool-one' }, body: JSON.stringify(rpc(0, { path: 'one' })) };
  const second = { ...first, headers: { ...headers, 'x-request-id': 'same-generation/tool-two' }, body: JSON.stringify(rpc(0, { path: 'two' })) };
  try {
    for (const options of [first, second, first]) {
      const response = await fetch(gateway.url, options); assert.equal(response.status, 200); await response.text();
    }
    assert.equal(calls, 2); assert.deepEqual(joined, Array(3).fill('same-generation'));
    // An intentional repeated action gets a different native call token, even when its arguments are identical.
    const repeated = await fetch(gateway.url, { ...first, headers: { ...headers, 'x-request-id': 'same-generation/tool-three' } });
    assert.equal(repeated.status, 200); await repeated.text(); assert.equal(calls, 3);
    const changed = await fetch(gateway.url, { ...first, body: JSON.stringify(rpc(0, { path: 'changed' })) });
    assert.equal(changed.status, 409); assert.equal(calls, 3);
  } finally { await gateway.close(); }
});

test('native surface paths retain separate discovery and exact host-owned request context', async () => {
  const owner = { leaseId, threadId: 'host-thread', workspacePath: directory };
  const host = { specs: surface => [{ name: 'fixture_' + surface, inputSchema: { type: 'object' } }],
    execute: async (call, options) => ({ content: [{ type: 'text', text: options.surface }], isError: false }) };
  const gateway = await fixture({ resolveRequestOwner: async () => owner, hostForLease: (id, resolved) => {
    assert.equal(id, leaseId); if (resolved) assert.deepEqual(resolved, owner); return host;
  } });
  try {
    assert.ok(gateway.urls?.desktop, 'desktop and plugin capabilities need separate endpoint paths');
    for (const surface of ['core', 'desktop', 'plugins']) {
      const client = new McpClient({ transport: 'http', url: gateway.urls[surface], headers: { 'x-request-id': 'surface-native-' + surface } });
      try {
        await client.connect(); assert.deepEqual(client.tools.map(tool => tool.name), ['fixture_' + surface]);
        assert.equal((await client.callTool('fixture_' + surface, { threadId: 'forged', workspacePath: os.tmpdir() })).raw.content[0].text, surface);
      } finally { await client.close(); }
    }
  } finally { await gateway.close(); }
});
