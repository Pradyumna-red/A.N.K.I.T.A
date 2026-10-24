// Host-only defaults: random OS port, loopback binding and bounded MCP payloads.
export const CHATGPT_BROWSER_PROVIDER = 'chatgpt-browser';
export const GATEWAY_HOST = '127.0.0.1';
export const EPHEMERAL_PORT = 0; // TCP port: ask the OS for a free port; never restart Chrome.
export const GATEWAY_MAX_BODY_BYTES = 8 * 1024 * 1024; // Bytes/request; same native MCP bound as the source service.
export const GATEWAY_TOKEN_BYTES = 32; // Cryptographic bytes: independent endpoint capability per lease/lifecycle.
export const GATEWAY_PATH = '/mcp';
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource'; // RFC 9728 discovery route.
export const REQUEST_ID_HEADER = 'x-request-id'; // Native ChatGPT request provenance, never a tool argument.
export const REQUEST_ID_SEPARATOR = '/'; // Source adapters normalize the native request segment before the first slash.
export const GATEWAY_SERVER_NAME = 'ankita-tool-gateway';
export const GATEWAY_VERSION = '1.0.0'; // This adapter's protocol contract, independent of app/model versions.
export const CORE_SURFACE = 'core';
export const NATIVE_TOOL_SURFACES = Object.freeze({ core: CORE_SURFACE, desktop: 'desktop', plugins: 'plugins' }); // Separate native discovery/permission boundaries.
export const JSON_CONTENT_TYPE = 'application/json';
export const JSON_RPC_VERSION = '2.0';
export const RPC_ADMISSION_ERROR = -32000; // JSON-RPC application error; HTTP admission never executes handlers.
export const REQUEST_ID_MAX_CHARS = 100; // Characters/native join key: upstream bounds opaque request metadata.
export const NATIVE_CALL_ID_MAX_CHARS = 1024; // Characters/full native HTTP request token, including call/hop suffixes; bounded independently from the generation join key.
export const REQUEST_ID_PATTERN = /^[a-z0-9_-]+$/i;
export const LEGACY_RECEIPT_CODE = 'LEGACY_NATIVE_RECEIPT'; // Upgrade guard: old generation-wide admissions cannot safely be assigned to a new native call.
export const LEGACY_RECEIPT_MESSAGE = 'This native request predates per-call tracking. Inspect its earlier result and send a new explicit request.';
export const HTTP_STATUS = Object.freeze({ ok: 200, badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, conflict: 409, payloadTooLarge: 413, unavailable: 503 }); // Standard HTTP wire status codes, shared by both transports.
export const TOOL_RESULT_MODE = Object.freeze({ api: 'api', mcp: 'mcp' }); // Projection identifiers; neither mode owns a competing model loop.
export const LOCAL_HTTP_PROTOCOL = 'http:'; // Loopback transport scheme; public HTTPS is a separately approved tunnel.
export const BEARER_PREFIX = 'Bearer '; // HTTP Authorization grammar, shared with the extension-generated config.
export const BROWSER_BINDING_FIELDS = Object.freeze(['leaseId', 'epoch', 'tabId', 'conversationId', 'browserId', 'threadId', 'workspacePath']); // Full host ownership, including the selected project and teammate.
export const sameBrowserBinding = (a, b) => Boolean(a && b && a.openingId === b.openingId && BROWSER_BINDING_FIELDS.every(key =>
  key === 'conversationId' && a.openingId && (a.conversationId === null || b.conversationId === null) ? true : a[key] === b[key])); // A single opening may acquire its first real chat; known chat IDs never alias each other.
export const BROWSER_TRANSPORT_NOTICE = 'transport'; // A transient stream failure pauses actions; read-only observation of the already sent reply can continue.
export const BROWSER_BLOCK_REASONS = Object.freeze(['quota', 'authorization', 'refusal', 'model-unavailable', BROWSER_TRANSPORT_NOTICE]); // Observed provider notices; none authorize a fallback account, chat, or model.
export function normalizeRequestId(value) {
  if (typeof value !== 'string') return null;
  const id = value.split(REQUEST_ID_SEPARATOR)[0].trim();
  return id && id.length <= REQUEST_ID_MAX_CHARS && REQUEST_ID_PATTERN.test(id) ? id : null;
}
export function nativeCallId(value) {
  if (typeof value !== 'string' || value.length > NATIVE_CALL_ID_MAX_CHARS) return null;
  const id = value.trim();
  return normalizeRequestId(id) && id.split(REQUEST_ID_SEPARATOR).every(segment => REQUEST_ID_PATTERN.test(segment)) ? id : null;
}
