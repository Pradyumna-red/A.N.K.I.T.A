import { GATEWAY_HOST, EPHEMERAL_PORT, REQUEST_ID_PATTERN, LOCAL_HTTP_PROTOCOL, BEARER_PREFIX, JSON_CONTENT_TYPE } from '../../src/integrations/chatgpt-browser/protocol.mjs';

// One source generates the host/extension wire config and manifest.
export const COMPANION_VERSION = 1; // Wire schema version; incompatible companions cannot pair.
export const COMPANION_NAME = 'ANKITA ChatGPT Companion';
export const COMPANION_PACKAGE_VERSION = '0.1.0'; // Read-only attach milestone, not a shipping desktop provider.
export const CHATGPT_ORIGIN = 'https://chatgpt.com';
export const CHATGPT_MATCH = CHATGPT_ORIGIN + '/*';
export const LOOPBACK_MATCH = `${LOCAL_HTTP_PROTOCOL}//${GATEWAY_HOST}/*`; // Chrome permissions have no port restriction; runtime accepts only paired address.
export const BRIDGE_HOST = GATEWAY_HOST;
export const BRIDGE_PORT = EPHEMERAL_PORT;
export const BRIDGE_MAX_BODY_BYTES = 256 * 1024; // Bytes/metadata observation; no arbitrary page text or screenshots.
export const BRIDGE_SECRET_NAME = 'chatgpt-companion-pairing';
export const COMPANION_POLL_MS = 2000; // Milliseconds/read-only refresh; serial reads avoid concurrent stale snapshots.
export const OBSERVATION_MAX_AGE_MS = 15000; // Milliseconds: stale account/model state cannot remain Ready.
export const OWNER_WAIT_MS = 5000; // Milliseconds: native MCP may arrive just before browser provenance is observed.
export const MAX_TABS = 50; // Tab metadata count; only ChatGPT routes, never browser-wide content.
export const MAX_MODELS = 32; // Evaluated model/effort choices per selected account; not a fabricated catalog.
export const MAX_REQUEST_IDS = 200; // Current native request joins per binding.
export const MAX_ID_CHARS = 200; // Characters/opaque binding/identity field; no arbitrary document data.
export const MAX_TURN_SECTIONS = 6; // Latest visible turns/read: source adapter's bounded observation scope.
export const MAX_PICKER_CANDIDATES = 8; // Current visible menus/read: never walk arbitrary React subtrees.
export const MODEL_TRIGGER_SELECTORS = 'button[aria-haspopup="menu"], [data-codex-intelligence-trigger], [data-composer-navigation-target="reasoning"]';
export const TURN_SELECTORS = 'section[data-testid^="conversation-turn"], [data-app-shell-main-surface] [data-thread-find-target="conversation"] [data-turn-key], [data-chatgpt-search-unit-key$=":user"]';
export const HIDDEN_SELECTORS = '[hidden],[aria-hidden="true"],[inert]'; // Native hidden/transition controls cannot establish current model state.
export const ROUTES = Object.freeze({ pair: '/pair', tabs: '/tabs', bind: '/bind', poll: '/poll', observe: '/observe', disconnect: '/disconnect', status: '/status' });
export const SESSION_STORAGE_KEY = 'ankitaCompanionSession'; // Extension memory-only key; no pairing secret written to profile storage.
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/; // Chrome's generated extension ID format.
export const CONVERSATION_PATTERN = /(?:^|\/)c\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i; // Durable ChatGPT conversation route, including projects/custom GPTs.
export const READER_GLOBAL = 'AnkitaPageReaders';

export function conversationFromUrl(value) {
  try { const url = new URL(value); return url.origin === CHATGPT_ORIGIN ? url.pathname.match(CONVERSATION_PATTERN)?.[1] ?? null : null; }
  catch { return null; }
}
export const browserWire = Object.freeze({ version: COMPANION_VERSION, pollMs: COMPANION_POLL_MS, chatgptMatch: CHATGPT_MATCH,
  chatgptOrigin: CHATGPT_ORIGIN, routes: ROUTES, storageKey: SESSION_STORAGE_KEY, maxTabs: MAX_TABS, maxRequests: MAX_REQUEST_IDS,
  maxModels: MAX_MODELS, maxIdChars: MAX_ID_CHARS, conversationPattern: CONVERSATION_PATTERN.source, readerGlobal: READER_GLOBAL,
  maxTurns: MAX_TURN_SECTIONS, maxPickers: MAX_PICKER_CANDIDATES, modelTriggers: MODEL_TRIGGER_SELECTORS, turns: TURN_SELECTORS, hidden: HIDDEN_SELECTORS,
  loopbackHost: BRIDGE_HOST, requestIdPattern: REQUEST_ID_PATTERN.source, localProtocol: LOCAL_HTTP_PROTOCOL, bearerPrefix: BEARER_PREFIX, jsonContentType: JSON_CONTENT_TYPE });
export const companionManifest = Object.freeze({ manifest_version: 3, name: COMPANION_NAME, version: COMPANION_PACKAGE_VERSION,
  description: 'Read-only, explicitly selected ChatGPT tab attachment for ANKITA. Existing account limits apply.',
  permissions: ['tabs', 'scripting', 'storage'], host_permissions: [CHATGPT_MATCH, LOOPBACK_MATCH],
  background: { service_worker: 'background.mjs', type: 'module' }, action: { default_popup: 'popup.html' } });
