import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ToolHost } from '../../src/core/tool-host.mjs';
import { McpClient } from '../../src/integrations/mcp-client.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { MemoryToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';

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
