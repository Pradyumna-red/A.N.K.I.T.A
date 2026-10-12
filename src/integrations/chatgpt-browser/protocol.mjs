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
export const JSON_CONTENT_TYPE = 'application/json';
export const JSON_RPC_VERSION = '2.0';
export const RPC_ADMISSION_ERROR = -32000; // JSON-RPC application error; HTTP admission never executes handlers.
