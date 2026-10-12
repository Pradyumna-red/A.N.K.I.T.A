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
export const MODEL_TRIGGER_SELECTORS = '[data-codex-intelligence-trigger], [data-composer-navigation-target="reasoning"]'; // Explicit native model controls across the page; other menus stay scoped to the composer form.
export const FORM_MODEL_TRIGGER_SELECTOR = 'button[aria-haspopup="menu"]'; // Native menus within the selected composer, matching the focused upstream discovery boundary.
export const MODEL_TRIGGER_ROLES = 'button,[role="button"]'; // Only native actionable controls can supply model metadata.
export const COMPOSER_PLUS_ID = 'composer-plus-btn'; // Attachment menu is not model evidence.
export const COMPOSER_FORM_SELECTOR = 'form'; // Native form belonging to the uniquely detected editor.
export const DOM_TEST_ID_ATTRIBUTE = 'data-testid'; // Native control identifier; excludes the composer attachment menu.
export const TURN_SELECTORS = 'section[data-testid^="conversation-turn"], [data-app-shell-main-surface] [data-thread-find-target="conversation"] [data-turn-key], [data-chatgpt-search-unit-key$=":user"]';
export const HIDDEN_SELECTORS = '[hidden],[aria-hidden="true"],[inert]'; // Native hidden/transition controls cannot establish current model state.
export const MODEL_TRIGGER_EXCLUSIONS = `.clf-stream,.clf-stage,.clf-composer,.clf-boot,[data-testid^="conversation-turn"],[data-message-author-role],.markdown,[contenteditable],${HIDDEN_SELECTORS}`; // Excludes history, editors and co-installed upstream surfaces.
export const PAGE_UNAVAILABLE_STATUS = 'page-unavailable'; // Missing page evidence does not establish that the user is logged out.
export const BRIDGE_READY_STATUS = 'ready'; // Fresh, explicitly bound page evidence; native requests still require exact ownership.
export const MODEL_MODES = Object.freeze({ current: 'current', explicit: 'explicit' }); // Host policy: inherit the browser selection or require evaluated model evidence for a requested choice.
export const CURRENT_MODEL_MESSAGE = 'Connected · using the current model in your ChatGPT chat.'; // Never invents a provider model ID when its name is unknown.
export const OBSERVATION_REASONS = Object.freeze({ route: 'route-unavailable', readers: 'reader-unavailable', composer: 'composer-unavailable',
  budget: 'picker-budget-exceeded', picker: 'model-picker-unavailable', ambiguous: 'model-picker-ambiguous', error: 'reader-error' }); // Allowlisted diagnostic identifiers, never arbitrary page text.
export const OBSERVATION_MESSAGES = Object.freeze({
  [OBSERVATION_REASONS.route]: 'Connected · the selected conversation changed. Choose it again.',
  [OBSERVATION_REASONS.readers]: 'Connected · the page reader is not available yet.',
  [OBSERVATION_REASONS.composer]: 'Connected · the chat editor has not been detected yet.',
  [OBSERVATION_REASONS.budget]: 'Connected · too many model controls were found to identify the current model safely.',
  [OBSERVATION_REASONS.picker]: 'Connected · the model controls could not be read. Open ChatGPT’s Think/model menu, then Observe this tab again.',
  [OBSERVATION_REASONS.ambiguous]: 'Connected · the current model controls are ambiguous. Close extra model menus and Observe again.',
  [OBSERVATION_REASONS.error]: 'Connected · the page reader could not inspect this conversation.',
}); // Human-readable explanations for safe diagnostic codes; no account/model availability is invented.
export const ROUTES = Object.freeze({ pair: '/pair', tabs: '/tabs', bind: '/bind', poll: '/poll', observe: '/observe', disconnect: '/disconnect', status: '/status' });
export const SESSION_STORAGE_KEY = 'ankitaCompanionSession'; // Extension memory-only key; no pairing secret written to profile storage.
export const EXTENSION_ID_PATTERN = /^[a-p]{32}$/; // Chrome's generated extension ID format.
export const CONVERSATION_PATTERN = /(?:^|\/)c\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/|$)/i; // Durable ChatGPT conversation route, including projects/custom GPTs.
export const READER_GLOBAL = 'AnkitaPageReaders';
export const ORIGINS_GLOBAL = 'AnkitaRequestOrigins'; // Passive response identity namespace; no page message authority.

export function conversationFromUrl(value) {
  try { const url = new URL(value); return url.origin === CHATGPT_ORIGIN ? url.pathname.match(CONVERSATION_PATTERN)?.[1] ?? null : null; }
  catch { return null; }
}
export const browserWire = Object.freeze({ version: COMPANION_VERSION, pollMs: COMPANION_POLL_MS, chatgptMatch: CHATGPT_MATCH,
  chatgptOrigin: CHATGPT_ORIGIN, routes: ROUTES, storageKey: SESSION_STORAGE_KEY, maxTabs: MAX_TABS, maxRequests: MAX_REQUEST_IDS,
  maxModels: MAX_MODELS, maxIdChars: MAX_ID_CHARS, conversationPattern: CONVERSATION_PATTERN.source, readerGlobal: READER_GLOBAL,
  originsGlobal: ORIGINS_GLOBAL, observationMaxAgeMs: OBSERVATION_MAX_AGE_MS,
  maxTurns: MAX_TURN_SECTIONS, maxPickers: MAX_PICKER_CANDIDATES, modelTriggers: MODEL_TRIGGER_SELECTORS, formModelTriggers: FORM_MODEL_TRIGGER_SELECTOR,
  modelTriggerRoles: MODEL_TRIGGER_ROLES, modelTriggerExclusions: MODEL_TRIGGER_EXCLUSIONS, composerPlusId: COMPOSER_PLUS_ID,
  composerForm: COMPOSER_FORM_SELECTOR, testIdAttribute: DOM_TEST_ID_ATTRIBUTE,
  observationReasons: OBSERVATION_REASONS, observationMessages: OBSERVATION_MESSAGES, modelModes: MODEL_MODES,
  readyStatus: BRIDGE_READY_STATUS, currentModelMessage: CURRENT_MODEL_MESSAGE, turns: TURN_SELECTORS, hidden: HIDDEN_SELECTORS,
  loopbackHost: BRIDGE_HOST, requestIdPattern: REQUEST_ID_PATTERN.source, localProtocol: LOCAL_HTTP_PROTOCOL, bearerPrefix: BEARER_PREFIX, jsonContentType: JSON_CONTENT_TYPE });
export const companionManifest = Object.freeze({ manifest_version: 3, name: COMPANION_NAME, version: COMPANION_PACKAGE_VERSION,
  description: 'Read-only, explicitly selected ChatGPT tab attachment for ANKITA. Existing account limits apply.',
  permissions: ['tabs', 'scripting', 'storage'], host_permissions: [CHATGPT_MATCH, LOOPBACK_MATCH],
  background: { service_worker: 'background.mjs', type: 'module' }, action: { default_popup: 'popup.html' } });
