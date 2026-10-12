import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { McpClient } from '../../src/integrations/mcp-client.mjs';

export const PUBLIC_PROOF_DNS_RESOLVER = 'https://cloudflare-dns.com/dns-query'; // HTTPS DNS for an explicitly requested public proof only; callers may supply their own resolver.
const HTTPS_PROTOCOL = 'https:'; // TLS remains mandatory for both the resolver and public endpoint.
const POST_METHOD = 'POST'; // HTTP method used by native MCP discovery.
const DNS_ACCEPT = 'application/dns-json'; // Resolver metadata format; no endpoint path or credential is sent.
const DNS_IPV4_QUERY = 'A'; // IANA IPv4 query name.
const DISCOVERY_METHODS = new Set(['initialize', 'notifications/initialized', 'tools/list']); // Read-only protocol setup: tool execution must never be replayed.
const DNS_FAILURE_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']); // Only name-resolution failures permit this optional fallback.
const DNS_IPV4_TYPE = 1; // IANA A-record type; native HTTPS connects with the original hostname/SNI.
const DNS_OK_STATUS = 0; // DNS NOERROR, distinct from HTTP success.
const IPV4_FAMILY = 4; // Node lookup callback's IPv4 address family.
const MAX_DNS_BYTES = 64 * 1024; // Bytes/resolver answer: bounded metadata, never user conversation content.
const MAX_PROBE_BYTES = 1024 * 1024; // Bytes/discovery response; this helper does not execute tools or accept images.
const NO_BODY_STATUS = new Set([204, 205, 304]); // Fetch Response rejects a body for these HTTP statuses.
export const PUBLIC_PROBE_DNS_PENDING = 'ANKITA_PUBLIC_DNS_PENDING'; // Transient public hostname propagation, never a tool execution receipt.
const MAX_READY_ATTEMPTS = 30; // Discovery attempts; protocol calls only, not tools/call.
const READY_RETRY_MS = 2000; // Milliseconds between startup-readiness checks.
const READY_TIMEOUT_MS = 90000; // Milliseconds for the entire public discovery check, including network calls.
const TRANSIENT_HTTP_STATUS = new Set([502, 503, 504, 530]); // Proxy/tunnel startup failures; authentication and admission errors never retry.
const HTTP_ERROR_STATUS = /^MCP HTTP request failed \(HTTP (\d{3})\)$/; // Existing McpClient's safe HTTP diagnostic, no URL or payload.

async function boundedBytes(stream, maxBytes) {
  const chunks = []; let bytes = 0;
  for await (const chunk of stream ?? []) {
    const buffer = Buffer.from(chunk); bytes += buffer.length;
    if (bytes > maxBytes) throw new Error('Public probe response exceeded byte limit');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function discoveryRequest(url, init, origin) {
  if (url.protocol !== HTTPS_PROTOCOL || url.origin !== origin || url.username || url.password || init.method !== POST_METHOD) return false;
  try { return DISCOVERY_METHODS.has(JSON.parse(init.body).method); } catch { return false; }
}

/** Optional public-protocol diagnostic fallback. Does not change OS DNS, bypass TLS or retry a tool call. */
export function createPublicProbeFetch({ expectedOrigin, dnsResolverUrl, fetchImpl = fetch, requestImpl = httpsRequest, maxResponseBytes = MAX_PROBE_BYTES } = {}) {
  const resolver = dnsResolverUrl ? new URL(dnsResolverUrl) : null;
  const origin = expectedOrigin ? new URL(expectedOrigin) : null;
  if (resolver && (resolver.protocol !== HTTPS_PROTOCOL || origin?.protocol !== HTTPS_PROTOCOL || resolver.username || resolver.password || origin.username || origin.password)) throw new TypeError('Public probe requires HTTPS origins without credentials');
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) throw new TypeError('Invalid public probe byte limit');
  return async (input, init = {}) => {
    const url = new URL(input);
    init.signal?.throwIfAborted();
    try { return await fetchImpl(input, init); }
    catch (error) {
      init.signal?.throwIfAborted();
      if (!resolver || !DNS_FAILURE_CODES.has(error.cause?.code) || !discoveryRequest(url, init, origin.origin)) throw error;
    }
    const query = new URL(resolver);
    query.searchParams.set('name', url.hostname); query.searchParams.set('type', DNS_IPV4_QUERY);
    const resolved = await fetchImpl(query, { headers: { accept: DNS_ACCEPT }, signal: init.signal });
    if (!resolved.ok) throw new Error('Public probe DNS resolver refused the query');
    const records = JSON.parse((await boundedBytes(resolved.body, MAX_DNS_BYTES)).toString('utf8'));
    const addresses = records.Status === DNS_OK_STATUS ? (records.Answer ?? []).filter(record => record.type === DNS_IPV4_TYPE && isIP(record.data) === IPV4_FAMILY).map(record => ({ address: record.data, family: IPV4_FAMILY })) : [];
    if (!addresses.length) throw Object.assign(new Error('Public probe DNS answer has no valid address'), { code: PUBLIC_PROBE_DNS_PENDING });
    init.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const request = requestImpl(url, { method: init.method, headers: init.headers, signal: init.signal,
        servername: url.hostname, rejectUnauthorized: true,
        lookup: (hostname, options, callback) => {
          if (hostname !== url.hostname) return callback(new Error('Public probe DNS hostname changed'));
          return options?.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
        },
      }, response => {
        void boundedBytes(response, maxResponseBytes).then(bytes => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
          }
          resolve(new Response(NO_BODY_STATUS.has(response.statusCode) ? null : bytes, { status: response.statusCode, headers }));
        }).catch(error => { request.destroy(error); reject(error); });
      });
      request.on('error', reject);
      request.end(init.body);
    });
  };
}

/** Wait for protocol initialization and the exact read-only surface. Never dispatches a tool. */
export async function waitForPublicMcp({ url, expectedToolNames, fetchImpl = fetch, signal, onRetry,
  maxAttempts = MAX_READY_ATTEMPTS, retryMs = READY_RETRY_MS, timeoutMs = READY_TIMEOUT_MS,
  clientFactory = options => new McpClient(options) } = {}) {
  if (!Array.isArray(expectedToolNames) || !expectedToolNames.length || expectedToolNames.some(name => typeof name !== 'string')) throw new TypeError('Public proof requires an explicit expected tool surface');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0 || !Number.isFinite(retryMs) || retryMs < 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid public readiness budget');
  const lifecycle = new AbortController();
  const abort = () => lifecycle.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => lifecycle.abort(new Error('Public MCP readiness timed out')), timeoutMs);
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lifecycle.signal.throwIfAborted();
      const client = clientFactory({ transport: 'http', url, fetchImpl: (input, options = {}) => fetchImpl(input, {
        ...options, signal: options.signal ? AbortSignal.any([options.signal, lifecycle.signal]) : lifecycle.signal,
      }) });
      let cancelAttempt, retry;
      try {
        const cancelled = new Promise((_, reject) => { cancelAttempt = () => reject(lifecycle.signal.reason); lifecycle.signal.addEventListener('abort', cancelAttempt, { once: true }); });
        await Promise.race([client.connect(), cancelled]);
        lifecycle.signal.throwIfAborted();
        const names = client.tools.map(tool => tool.name).sort();
        if (JSON.stringify(names) !== JSON.stringify([...expectedToolNames].sort())) throw new Error('Unexpected published proof surface');
        return { toolNames: names, attempts: attempt, protocol: client.protocolVersion ?? null };
      } catch (error) {
        lifecycle.signal.throwIfAborted();
        const status = Number(error.message?.match(HTTP_ERROR_STATUS)?.[1]) || null;
        if (attempt === maxAttempts || !(error.code === PUBLIC_PROBE_DNS_PENDING || DNS_FAILURE_CODES.has(error.cause?.code) || TRANSIENT_HTTP_STATUS.has(status))) throw error;
        retry = { attempt, errorCode: error.code ?? error.cause?.code ?? null, httpStatus: status };
      } finally { lifecycle.signal.removeEventListener('abort', cancelAttempt); await client.close(); }
      onRetry?.(retry);
      await sleep(retryMs, undefined, { signal: lifecycle.signal });
    }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
