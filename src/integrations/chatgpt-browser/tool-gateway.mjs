import http from 'node:http';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, localhostHostValidation, localhostOriginValidation } from '@modelcontextprotocol/node';
import { GATEWAY_HOST, EPHEMERAL_PORT, GATEWAY_MAX_BODY_BYTES, GATEWAY_TOKEN_BYTES, GATEWAY_PATH,
  RESOURCE_METADATA_PATH, REQUEST_ID_HEADER, REQUEST_ID_SEPARATOR, GATEWAY_SERVER_NAME, GATEWAY_VERSION,
  CORE_SURFACE, JSON_CONTENT_TYPE, JSON_RPC_VERSION, RPC_ADMISSION_ERROR } from './protocol.mjs';

const gatewayContext = new AsyncLocalStorage(); // Private transport admission, inaccessible to arguments/renderer/page scripts.
const TOOL_CALL_METHOD = 'tools/call';
const TOOL_LIST_METHOD = 'tools/list';
const POST_METHOD = 'POST';
const GET_METHOD = 'GET';
const INVALID_JSON_STATUS = 400;
const BODY_LIMIT_STATUS = 413;
const CLOSED_STATUS = 503;
const CAPABILITY_STATUS = 401;
const OWNER_STATUS = 403;
const SUCCESS_STATUS = 200;
const CONFLICT_STATUS = 409;
const NO_CACHE = 'no-store'; // Endpoint URL carries a secret capability and must never enter shared caches.

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function fail(res, status, message, id = null) {
  res.writeHead(status, { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': NO_CACHE });
  res.end(JSON.stringify({ jsonrpc: JSON_RPC_VERSION, id, error: { code: RPC_ADMISSION_ERROR, message } }));
}
function nativeRequestId(req) {
  const entries = req.rawHeaders.filter((_, index) => index % 2 === 0).filter(name => name.toLowerCase() === REQUEST_ID_HEADER);
  const value = req.headers[REQUEST_ID_HEADER];
  if (entries.length !== 1 || typeof value !== 'string') return null;
  return value.split(REQUEST_ID_SEPARATOR)[0].trim() || null;
}
async function readBody(req, maxBytes) {
  if (Number(req.headers['content-length']) > maxBytes) throw Object.assign(new Error('Request body too large'), { status: BODY_LIMIT_STATUS });
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Request body too large'), { status: BODY_LIMIT_STATUS });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: INVALID_JSON_STATUS }); }
}

/** Explicitly started local native MCP endpoint. Publishing a tunnel is a separate operation. */
export async function createToolGateway({ leaseId, hostForLease, resolveRequestOwner, receipts, sdk = { McpServer, createMcpHandler, toNodeHandler }, config = {} }) {
  if (!leaseId || !hostForLease || !resolveRequestOwner || !receipts) throw new TypeError('Gateway requires a lease, host, owner resolver and receipts');
  const maxBodyBytes = config.maxBodyBytes ?? GATEWAY_MAX_BODY_BYTES;
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0) throw new TypeError('Invalid body byte limit');
  const token = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
  const endpointPath = `${GATEWAY_PATH}/${token}/${CORE_SURFACE}`;
  const metadataPath = RESOURCE_METADATA_PATH + endpointPath; // Discovery uses the same capability; public discovery must not reveal it.
  const validateHost = localhostHostValidation(); const validateOrigin = localhostOriginValidation();
  const active = new Set(); let closing = false; let closePromise;
  const handler = sdk.createMcpHandler(() => {
    const server = new sdk.McpServer({ name: GATEWAY_SERVER_NAME, version: GATEWAY_VERSION }, { capabilities: { tools: {} } });
    server.server.setRequestHandler(TOOL_LIST_METHOD, async () => {
      const admitted = gatewayContext.getStore();
      return { tools: hostForLease(admitted.leaseId).specs(admitted.surface) };
    });
    server.server.setRequestHandler(TOOL_CALL_METHOD, async request => {
      const admitted = gatewayContext.getStore();
      const receipt = admitted.receipt;
      if (!receipt.fresh) return receipt.completion;
      let result;
      try {
        result = await hostForLease(admitted.leaseId).execute({ id: receipt.id,
          name: request.params.name, arguments: request.params.arguments ?? {} }, { signal: admitted.signal, resultMode: 'mcp' });
      } catch { result = { content: [{ type: 'text', text: 'Error: tool outcome is uncertain; do not retry the side effect.' }], isError: true }; }
      await receipts.settle(receipt.id, result);
      return result;
    });
    return server;
  }, { maxRequestBodySize: maxBodyBytes });
  const nodeHandler = sdk.toNodeHandler(handler, { maxRequestBodySize: maxBodyBytes });
  const server = http.createServer((req, res) => {
    const task = handle(req, res).catch(() => { if (!res.headersSent) fail(res, INVALID_JSON_STATUS, 'Request rejected'); else res.end(); });
    active.add(task); task.finally(() => active.delete(task));
  });
  let address;
  async function handle(req, res) {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (closing) return fail(res, CLOSED_STATUS, 'Gateway is closing');
    const route = new URL(req.url, address).pathname;
    if (route === metadataPath && req.method === GET_METHOD) {
      res.writeHead(SUCCESS_STATUS, { 'Content-Type': JSON_CONTENT_TYPE, 'Cache-Control': NO_CACHE });
      return res.end(JSON.stringify({ resource: address + endpointPath, resource_name: GATEWAY_SERVER_NAME, bearer_methods_supported: [] }));
    }
    const supplied = Buffer.from(route); const expected = Buffer.from(endpointPath);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return fail(res, CAPABILITY_STATUS, 'Invalid endpoint capability');
    if (req.method !== POST_METHOD) return nodeHandler(req, res);
    let body;
    try { body = await readBody(req, maxBodyBytes); } catch (error) { return fail(res, error.status ?? INVALID_JSON_STATUS, error.message); }
    // Batch admission is deliberately absent: one authoritative receipt per HTTP/RPC call.
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(res, INVALID_JSON_STATUS, 'A single RPC message is required');
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    const admitted = { leaseId, surface: CORE_SURFACE, signal: controller.signal };
    if (body.method === TOOL_CALL_METHOD) {
      admitted.requestId = nativeRequestId(req);
      if (!admitted.requestId || !['string', 'number'].includes(typeof body.id)) return fail(res, OWNER_STATUS, 'Native request ownership is required', body.id);
      let owner;
      try { owner = await resolveRequestOwner({ leaseId, requestId: admitted.requestId, signal: admitted.signal }); } catch { return fail(res, OWNER_STATUS, 'Request owner is unavailable', body.id); }
      if (owner?.leaseId !== leaseId) return fail(res, OWNER_STATUS, 'Request does not own this lease', body.id);
      const identity = JSON.stringify([leaseId, admitted.requestId, typeof body.id, body.id]);
      const hash = createHash('sha256').update(JSON.stringify(canonical(body.params))).digest('hex');
      try { admitted.receipt = await receipts.begin(identity, hash); } catch { return fail(res, CONFLICT_STATUS, 'Receipt payload changed', body.id); }
      admitted.operationId = admitted.receipt.id;
    }
    res.setHeader('Cache-Control', NO_CACHE);
    try { await gatewayContext.run(admitted, () => nodeHandler(req, res, body)); }
    finally {
      if (admitted.receipt?.fresh && !receipts.lookup(admitted.receipt.id)?.result) {
        await receipts.settle(admitted.receipt.id, { content: [{ type: 'text', text: 'Error: admission ended without an execution receipt; do not retry the side effect.' }], isError: true });
      }
    }
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(EPHEMERAL_PORT, GATEWAY_HOST, resolve); });
  address = `http://${GATEWAY_HOST}:${server.address().port}`;
  return { url: address + endpointPath, metadata: address + metadataPath,
    close() {
      closePromise ??= (async () => {
        closing = true;
        // Drain admitted executions before SDK teardown; client disconnect never authorizes replay.
        await Promise.allSettled([...active]);
        await handler.close();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      })();
      return closePromise;
    },
  };
}
