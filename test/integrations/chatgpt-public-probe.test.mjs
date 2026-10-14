import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createPublicProbeFetch } from '../../services/chatgpt-bridge/public-probe.mjs';
import * as publicProbe from '../../services/chatgpt-bridge/public-probe.mjs';

const origin = 'https://proof-test.example'; // Test-only endpoint and capability, never a production connection.
const endpoint = origin + '/mcp/test-capability/core';
const resolver = 'https://resolver-test.example/dns-query';
const discovery = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) };
const dnsFailure = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('DNS failed'), { code: 'ENOTFOUND' }) });

function transportFixture({ body = '{"jsonrpc":"2.0","id":1,"result":{}}' } = {}) {
  const requests = [];
  const requestImpl = (url, options, receive) => {
    const request = new EventEmitter();
    requests.push({ url, options, body: null });
    request.end = data => {
      requests.at(-1).body = data;
      queueMicrotask(() => {
        const response = Readable.from([Buffer.from(body)]);
        response.statusCode = 200;
        response.headers = { 'content-type': 'application/json', 'mcp-session-id': 'test-session' };
        receive(response);
      });
    };
    request.destroy = error => queueMicrotask(() => request.emit('error', error));
    return request;
  };
  return { requests, requestImpl };
}
function failedDnsFetch(records = [{ type: 1, data: '203.0.113.7' }]) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith(resolver)) return new Response(JSON.stringify({ Status: 0, Answer: records }));
    throw dnsFailure();
  };
  return { calls, fetchImpl };
}

test('a working default fetch does not use another DNS resolver', async () => {
  const fixture = transportFixture();
  const fetchImpl = async () => new Response('default-success');
  const probe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl, requestImpl: fixture.requestImpl });
  assert.equal(await (await probe(endpoint, discovery)).text(), 'default-success');
  assert.equal(fixture.requests.length, 0);
});

test('discovery falls back after DNS failure while preserving TLS hostname, signal and RPC bytes', async () => {
  const fixture = transportFixture(); const dns = failedDnsFetch(); const controller = new AbortController();
  const probe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl: dns.fetchImpl, requestImpl: fixture.requestImpl });
  const response = await probe(endpoint, { ...discovery, signal: controller.signal });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-session-id'), 'test-session');
  assert.deepEqual(JSON.parse(await response.text()), { jsonrpc: '2.0', id: 1, result: {} });
  const sent = fixture.requests[0];
  assert.equal(sent.url.hostname, new URL(origin).hostname);
  assert.equal(sent.options.servername, new URL(origin).hostname);
  assert.equal(sent.options.rejectUnauthorized, true);
  assert.equal(sent.options.signal, controller.signal);
  assert.equal(sent.body, discovery.body);
  const addresses = await new Promise((resolve, reject) => sent.options.lookup(sent.url.hostname, { all: true }, (error, value) => error ? reject(error) : resolve(value)));
  assert.deepEqual(addresses, [{ address: '203.0.113.7', family: 4 }]);
  const query = new URL(dns.calls[1].url);
  assert.equal(query.searchParams.get('name'), new URL(origin).hostname);
  assert.equal(query.searchParams.get('type'), 'A');
  assert.equal(dns.calls.some(call => call.url.includes('test-capability') && call.url.startsWith(resolver)), false);
});

test('tool calls, another origin and TLS failures are never replayed through the fallback', async () => {
  const fixture = transportFixture(); const dns = failedDnsFetch();
  const probe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl: dns.fetchImpl, requestImpl: fixture.requestImpl });
  await assert.rejects(probe(endpoint, { ...discovery, body: JSON.stringify({ method: 'tools/call', params: { name: 'write_file' } }) }), /fetch failed/);
  await assert.rejects(probe('https://another-test.example/mcp', discovery), /fetch failed/);
  assert.equal(dns.calls.length, 2); assert.equal(fixture.requests.length, 0);
  const tlsFailure = Object.assign(new TypeError('fetch failed'), { cause: { code: 'CERT_HAS_EXPIRED' } });
  const tlsProbe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl: async () => { throw tlsFailure; }, requestImpl: fixture.requestImpl });
  await assert.rejects(tlsProbe(endpoint, discovery), error => error === tlsFailure);
  assert.equal(fixture.requests.length, 0);
});

test('bad DNS answers and responses beyond the configured byte limit fail closed', async () => {
  const fixture = transportFixture(); const dns = failedDnsFetch([{ type: 1, data: 'not-an-address' }]);
  const probe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl: dns.fetchImpl, requestImpl: fixture.requestImpl });
  await assert.rejects(probe(endpoint, discovery), /DNS answer/);
  assert.equal(fixture.requests.length, 0);
  const large = transportFixture({ body: 'response-too-large' }); const valid = failedDnsFetch();
  const limited = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, maxResponseBytes: 4, fetchImpl: valid.fetchImpl, requestImpl: large.requestImpl });
  await assert.rejects(limited(endpoint, discovery), /byte limit/);
});

test('cancelled discovery never makes a fallback connection and non-HTTPS resolvers are rejected', async () => {
  const fixture = transportFixture(); const controller = new AbortController(); controller.abort(new Error('test cancelled'));
  const probe = createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: resolver, fetchImpl: async () => { throw dnsFailure(); }, requestImpl: fixture.requestImpl });
  await assert.rejects(probe(endpoint, { ...discovery, signal: controller.signal }), /test cancelled/);
  assert.equal(fixture.requests.length, 0);
  assert.throws(() => createPublicProbeFetch({ expectedOrigin: origin, dnsResolverUrl: 'http://resolver-test.example/dns-query' }), /HTTPS/);
});

function clientsFixture({ failures = [], tools = ['read_file'] } = {}) {
  let created = 0, closed = 0, executions = 0;
  return { counts: () => ({ created, closed, executions }), clientFactory: () => {
    const index = created++;
    return { tools: tools.map(name => ({ name })), protocolVersion: 'test-protocol',
      connect: async () => { if (failures[index]) throw failures[index]; }, close: async () => { closed++; },
      callTool: async () => { executions++; throw new Error('A readiness probe must never execute a tool'); } };
  } };
}
const dnsPending = () => Object.assign(new Error('DNS not ready'), { code: 'ANKITA_PUBLIC_DNS_PENDING' });

test('public readiness waits through DNS propagation and a temporary HTTP failure without tool execution', async () => {
  const fixture = clientsFixture({ failures: [dnsPending(), new Error('MCP HTTP request failed (HTTP 503)')] });
  const retries = [];
  const result = await publicProbe.waitForPublicMcp({ url: endpoint, expectedToolNames: ['read_file'], retryMs: 1,
    clientFactory: fixture.clientFactory, onRetry: retry => retries.push(retry) });
  assert.deepEqual(result, { toolNames: ['read_file'], attempts: 3, protocol: 'test-protocol' });
  assert.deepEqual(fixture.counts(), { created: 3, closed: 3, executions: 0 });
  assert.equal(retries.length, 2);
  assert.equal(JSON.stringify(retries).includes('test-capability'), false);
});

test('public readiness never retries denied discovery or a different tool surface', async () => {
  for (const fixture of [clientsFixture({ failures: [new Error('MCP HTTP request failed (HTTP 403)')] }), clientsFixture({ tools: ['read_file', 'write_file'] })]) {
    await assert.rejects(publicProbe.waitForPublicMcp({ url: endpoint, expectedToolNames: ['read_file'], retryMs: 1, clientFactory: fixture.clientFactory }), /403|surface/);
    assert.deepEqual(fixture.counts(), { created: 1, closed: 1, executions: 0 });
  }
});

test('public readiness has a bounded retry budget and honors cancellation before creating a client', async () => {
  const fixture = clientsFixture({ failures: [dnsPending(), dnsPending(), dnsPending()] });
  await assert.rejects(publicProbe.waitForPublicMcp({ url: endpoint, expectedToolNames: ['read_file'], retryMs: 1, maxAttempts: 2, clientFactory: fixture.clientFactory }), /DNS not ready/);
  assert.deepEqual(fixture.counts(), { created: 2, closed: 2, executions: 0 });
  const cancelled = clientsFixture(); const controller = new AbortController(); controller.abort(new Error('readiness cancelled'));
  await assert.rejects(publicProbe.waitForPublicMcp({ url: endpoint, expectedToolNames: ['read_file'], signal: controller.signal, clientFactory: cancelled.clientFactory }), /readiness cancelled/);
  assert.deepEqual(cancelled.counts(), { created: 0, closed: 0, executions: 0 });
});
