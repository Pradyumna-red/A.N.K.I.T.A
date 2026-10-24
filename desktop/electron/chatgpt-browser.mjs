import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { GATEWAY_TOKEN_BYTES } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { MODEL_MODES, MAX_REQUEST_IDS, BRIDGE_READY_STATUS, BRIDGE_SECRET_NAME, browserWire, conversationFromUrl, openingFromUrl, OPENING_FRAGMENT_KEY, OBSERVATION_MAX_AGE_MS, SEND_READY_POLL_MS } from '../../services/chatgpt-bridge/config.mjs';
import { pumpBoundBrowser } from '../chatgpt-companion/background.mjs';
import { ChatGptWindow } from './chatgpt-window.mjs';
import { SignInTransfer, importSessionCookies } from './chatgpt-sign-in.mjs';
import { openChromeIfAbsent } from './chatgpt-chrome-launch.mjs';
import { BrowserOperationStore, sameOperationBinding } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { PersistentToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { DurableProfileState } from '../../src/integrations/chatgpt-browser/durable-profile.mjs';
import { NativeTunnel, nativeTunnelArtifact, NATIVE_TUNNEL_ID_PATTERN, NATIVE_TUNNEL_SECRET_PREFIX, NATIVE_TUNNEL_RESOURCE_DIRECTORY } from '../../src/integrations/chatgpt-browser/native-tunnel.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { verifyCompanionResources } from './chatgpt-resources.mjs';
import { validateMentionNames, APP_MENTION_PATH_PATTERN } from '../../src/integrations/chatgpt-browser/app-mentions.mjs';
import { connectorScope, provenConnectorApps, MAX_CONNECTOR_SCOPES } from '../../src/integrations/chatgpt-browser/connector-identity.mjs';
import { CHATGPT_BROWSER_PROVIDER, CHATGPT_CONNECTION_CHANGED, CHATGPT_PROFILE_DIRECTORY, CHATGPT_SETUP_MESSAGE, CHATGPT_NATIVE_SURFACES, CHATGPT_BROWSER_MODES } from '../shared/chatgpt-browser.mjs';

const COMPANION_RESOURCE_DIRECTORY = 'desktop/chatgpt-companion'; // Bundled resource contract; caller supplies its discovered root.
const INSPECTION_HOST = Symbol('nativeDiscoveryHost'); // Schema observation never shares a workflow's execution counters.
const NATIVE_PREFERENCES_FILE = 'native-connections.json'; // Profile-local tunnel IDs/intent only; key bytes live in SecureStore.
const NATIVE_PREFERENCES_VERSION = 1; // Unsupported native setup state fails closed.
const SESSION_VERSION = 1; // Encrypted pairing custody; unknown formats require a fresh explicit connection.
const TUNNEL_COLLISION_MESSAGE = 'Use a different tunnel for each tool group. This tunnel is assigned to another native surface.'; // One official tunnel/channel cannot route competing local helpers reliably.
const NATIVE_SETUP_CHANGED_MESSAGE = 'Native connection changed or stopped during setup'; // Shared late-setup refusal; Stop must not launch a helper after an asynchronous credential operation.
const INVALID_APP_SETTINGS_MESSAGE = 'Invalid ChatGPT app settings'; // Shared persisted/IPC validation failure, without echoing owner input.
const INVALID_AUTO_MENTION_MESSAGE = 'Invalid automatic app setting'; // Malformed saved toggle must not silently opt into app tags.
const ACTIVE_APP_SETTINGS_MESSAGE = 'Wait for the current reply before changing included apps'; // A dispatched reply retains its original app selection.
const BROWSER_SETUP_CHANGED_MESSAGE = 'The ChatGPT connection was closed or changed during setup'; // Late asynchronous window/bridge setup must not revive a disconnected owner.
/** Desktop owns credentials/workspace; companion owns only its explicitly selected browser tab. */
export class DesktopChatGptBrowser {
  constructor({ directory, resourceRoot, companionPath, getContext, toolHostForBinding, secureStore, nativeResourceRoot, nativeArtifact,
    windowFactory = options => new ChatGptWindow(options),
    nativeTunnelFactory = options => new NativeTunnel(options), onCancelTools = async () => {}, history = value => value, emit = () => {} } = {}) {
    if (!directory || !resourceRoot || !getContext) throw new TypeError('Browser connection requires discovered profile/resources and host context');
    this.kind = CHATGPT_BROWSER_PROVIDER; this.directory = path.join(directory, CHATGPT_PROFILE_DIRECTORY);
    this.extensionPath = companionPath ?? path.join(resourceRoot, COMPANION_RESOURCE_DIRECTORY); this.getContext = getContext; this.history = history; this.emit = emit;
    this.toolHostForBinding = toolHostForBinding; this.nativeHosts = new Map(); this.gateway = null; this.gatewayBinding = null;
    this.onCancelTools = onCancelTools;
    this.secureStore = secureStore; this.nativeTunnelFactory = nativeTunnelFactory; this.nativeTunnels = new Map(); this.nativePreferences = {}; this.savedNativeKeys = new Set();
    this.nativeStarting = new Map(); // Reserve IDs before gateway/key awaits so simultaneous connection cards cannot race.
    this.appPreferences = { appNames: Object.fromEntries(CHATGPT_NATIVE_SURFACES.map(surface => [surface.id, surface.name])), autoMention: true };
    this.nativeArtifact = nativeArtifact ?? nativeTunnelArtifact({ resourceRoot: nativeResourceRoot ?? path.join(resourceRoot, 'desktop', NATIVE_TUNNEL_RESOURCE_DIRECTORY) });
    this.nativeSettings = new DurableProfileState({ directory: this.directory, filename: NATIVE_PREFERENCES_FILE,
      initial: () => ({ version: NATIVE_PREFERENCES_VERSION, tunnels: {} }) });
    this.runtime = null; this.bridge = null;
    this.mode = CHATGPT_BROWSER_MODES.legacy; this.windowFactory = windowFactory;
    this.connectorApps = {}; this.savedChats = new Map();
    this.waitingSends = new Map(); this.connectionVersion = 0; this.signInSequence = 0;
  }
  async init() {
    if (this.initialized) return this;
    this.initialized = true;
    const preferences = await this.readNativePreferences(); this.mode = preferences.browserMode ?? CHATGPT_BROWSER_MODES.legacy;
    if (this.mode === CHATGPT_BROWSER_MODES.builtin) return this; // Saved sign-in does not authorize a browser/action launch on app startup.
    if (this.savedNativeKeys.has(BRIDGE_SECRET_NAME)) {
      try {
        const saved = await this.secureStore.withSecret(BRIDGE_SECRET_NAME, value => JSON.parse(value));
        if (saved?.version !== SESSION_VERSION || typeof saved.key !== 'string' || !saved.key) throw new Error('Unsupported saved pairing');
        if (saved.connection?.desired) {
          const openingId = saved.connection.binding?.openingId;
          const conversationId = saved.connection.binding?.conversationId;
          const targetUrl = this.mode === CHATGPT_BROWSER_MODES.chrome ? conversationId ? `${browserWire.chatgptOrigin}/c/${conversationId}` : openingId ? `${browserWire.chatgptOrigin}/#${OPENING_FRAGMENT_KEY}=${openingId}` : undefined : undefined;
          await this.openCompanion({ threadId: saved.threadId, key: saved.key, connection: saved.connection, autoConnect: this.mode === CHATGPT_BROWSER_MODES.chrome, openingId, targetUrl });
        }
      } catch (error) { this.recoveryIssue = error.code === 'EADDRINUSE' ? 'port-unavailable' : 'saved-connection-unavailable'; }
    }
    return this; // Recovery opens only its remembered loopback reader; never Chrome, a helper or an action transport.
  }
  async readNativePreferences() {
    const preferences = await this.nativeSettings.run(state => {
      if (state.version !== NATIVE_PREFERENCES_VERSION || !state.tunnels || typeof state.tunnels !== 'object' || Array.isArray(state.tunnels) ||
          Object.entries(state.tunnels).some(([surface, value]) => !CHATGPT_NATIVE_SURFACES.some(item => item.id === surface) ||
            !NATIVE_TUNNEL_ID_PATTERN.test(value?.tunnelId) || typeof value?.desired !== 'boolean')) throw new Error('Native connection settings are corrupt or unsupported');
      const apps = state.apps ?? {};
      if (apps.appNames && (typeof apps.appNames !== 'object' || Array.isArray(apps.appNames) || Object.keys(apps.appNames).some(id => !CHATGPT_NATIVE_SURFACES.some(surface => surface.id === id)))) throw new Error(INVALID_APP_SETTINGS_MESSAGE);
      const appNames = Object.fromEntries(CHATGPT_NATIVE_SURFACES.map(surface => [surface.id, apps.appNames?.[surface.id] ?? surface.name]));
      validateMentionNames(Object.values(appNames));
      if (apps.autoMention !== undefined && typeof apps.autoMention !== 'boolean') throw new Error(INVALID_AUTO_MENTION_MESSAGE);
      this.appPreferences = { appNames, autoMention: apps.autoMention !== false };
      return state.tunnels;
    });
    this.nativePreferences = preferences;
    this.savedNativeKeys = new Set((await this.secureStore?.listSecrets?.() ?? []).map(item => item.name));
    const browser = await this.nativeSettings.run(state => state.browser ?? {});
    this.connectorApps = browser.identities && typeof browser.identities === 'object' && !Array.isArray(browser.identities) ? browser.identities : {};
    return { tunnels: Object.fromEntries(Object.entries(preferences).map(([surface, value]) => [surface, value.tunnelId])),
      savedKeys: CHATGPT_NATIVE_SURFACES.filter(item => this.savedNativeKeys.has(NATIVE_TUNNEL_SECRET_PREFIX + item.id)).map(item => item.id),
      browserMode: browser.mode, ...this.appPreferences };
  }
  async saveAppPreferences({ appNames, autoMention } = {}) {
    if (this.runtime?.pending.size) throw new Error(ACTIVE_APP_SETTINGS_MESSAGE);
    if (!appNames || typeof appNames !== 'object' || Array.isArray(appNames) || Object.keys(appNames).some(id => !CHATGPT_NATIVE_SURFACES.some(surface => surface.id === id)) || typeof autoMention !== 'boolean') throw new Error(INVALID_APP_SETTINGS_MESSAGE);
    const names = Object.fromEntries(CHATGPT_NATIVE_SURFACES.map(surface => [surface.id, appNames[surface.id] ?? surface.name]));
    validateMentionNames(Object.values(names));
    const changedNames = JSON.stringify(names) !== JSON.stringify(this.appPreferences.appNames);
    await this.nativeSettings.run(state => { state.apps = { appNames: names, autoMention }; if (changedNames && state.browser) state.browser.identities = {}; }, true);
    const result = await this.readNativePreferences(); this.changed(); return result;
  }
  listModels() { return this.runtime?.listModels() ?? []; }
  getProvenApps(binding) {
    const rows = this.connectorApps[connectorScope(binding)];
    return (Array.isArray(rows) ? rows.slice(0, CHATGPT_NATIVE_SURFACES.length) : []).filter(app =>
      CHATGPT_NATIVE_SURFACES.some(surface => surface.id === app?.surface) && APP_MENTION_PATH_PATTERN.test(app?.path) &&
      app.tunnelId === this.nativePreferences[app.surface]?.tunnelId).map(app => ({ name: this.appPreferences.appNames[app.surface], path: app.path }));
  }
  async learnConnectorApps(binding, sightings) {
    if (!sightings?.length || !binding.conversationId) return;
    const receipts = (await new PersistentToolReceipts({ directory: this.directory }).list(binding)).filter(row =>
      !this.nativePreferences[row.owner?.surface]?.identitySince || row.startedAt >= this.nativePreferences[row.owner.surface].identitySince);
    const proven = provenConnectorApps(sightings, receipts).map(app => ({ ...app, tunnelId: this.nativePreferences[app.surface]?.tunnelId })), key = connectorScope(binding);
    if (!proven.length) return;
    const current = Array.isArray(this.connectorApps[key]) ? this.connectorApps[key] : [];
    const next = [...current.filter(old => !proven.some(app => app.surface === old.surface)), ...proven];
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await this.nativeSettings.run(state => {
      state.browser ??= {}; state.browser.identities ??= {};
      if (!state.browser.identities[key] && Object.keys(state.browser.identities).length >= MAX_CONNECTOR_SCOPES) return;
      state.browser.identities[key] = next;
      state.apps ??= {}; state.apps.appNames ??= {};
      for (const app of proven) {
        const configured = this.appPreferences.appNames[app.surface], prior = current.find(row => row.surface === app.surface);
        if (configured === CHATGPT_NATIVE_SURFACES.find(surface => surface.id === app.surface)?.name || configured === prior?.name) state.apps.appNames[app.surface] = app.name;
      }
    }, true);
    await this.readNativePreferences();
  }
  view() {
    const view = this.runtime?.view() ?? this.bridge?.view();
    const nativeTools = CHATGPT_NATIVE_SURFACES.map(surface => ({ id: surface.id,
      status: this.nativeTunnels.get(surface.id)?.view().status ?? 'setup-required',
      configured: Boolean(this.nativePreferences[surface.id]), hasSavedKey: this.savedNativeKeys.has(NATIVE_TUNNEL_SECRET_PREFIX + surface.id),
      available: Boolean(this.nativeArtifact?.binary && fs.existsSync(this.nativeArtifact.binary)) }));
    return view ? { status: view.status, mode: this.mode, replying: Boolean(this.runtime?.pending?.size || this.waitingSends.size), recoveryIssue: this.recoveryIssue ?? null, accountReady: view.accountReady, nativeAppTagsReady: view.nativeAppTagsReady, selectedModel: view.selectedModel, modelMode: view.modelMode, nativeTools,
      conversationId: view.binding?.conversationId ?? null, threadId: view.binding?.threadId ?? this.threadId, workspacePath: view.binding?.workspacePath ?? this.workspacePath,
      observationReason: view.observationReason, blockedReason: view.blockedReason, remoteStop: view.remoteStop, recoverable: this.runtime?.recoverable ?? [] } : { status: 'setup-required', mode: this.mode, selectedModel: null, threadId: null, conversationId: null, nativeTools, recoveryIssue: this.recoveryIssue ?? null };
  }
  changed() {
    const state = this.view(), signature = JSON.stringify(state);
    if (signature === this.lastView) return;
    this.lastView = signature; this.emit({ type: CHATGPT_CONNECTION_CHANGED, state });
  }
  async start({ threadId, mode = CHATGPT_BROWSER_MODES.legacy, signal } = {}) {
    if (this.openingAttempt) throw new Error('ChatGPT is already opening; wait for that window.');
    const control = new AbortController();
    const attempt = { cancelled: false, threadId, control, signal: signal ? AbortSignal.any([signal, control.signal]) : control.signal }; this.openingAttempt = attempt;
    try { return await this.startConnection({ threadId, mode }, attempt); }
    catch (error) { if (attempt.cancelled || attempt.signal.aborted) await this.close(); throw error; }
    finally { if (this.openingAttempt === attempt) this.openingAttempt = null; }
  }
  async startConnection({ threadId, mode }, attempt) {
    const assertSetup = () => { if (attempt.cancelled || attempt.signal.aborted) throw new Error(BROWSER_SETUP_CHANGED_MESSAGE); };
    assertSetup();
    if (this.runtime?.pending.size) throw new Error('Wait for the browser reply before changing its connection');
    if (this.bridge?.view().binding && !await this.runtime.delivery.canReplaceBinding(this.bridge.view().binding)) throw new Error('Resume the saved browser reply or confirm Stop before switching browser or teammate');
    const context = this.getContext(threadId);
    if (!context?.workspacePath || context.threadId !== threadId) throw new Error('Select a teammate and workspace for this browser conversation');
    verifyCompanionResources(this.extensionPath);
    if (!Object.values(CHATGPT_BROWSER_MODES).includes(mode)) throw new Error('Choose In ANKITA or In Chrome');
    await this.close({ keepWindows: true, transition: attempt }); assertSetup(); this.mode = mode;
    const key = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
    if (mode === CHATGPT_BROWSER_MODES.builtin) {
      const owner = this.browserOwner(context);
      const profile = await this.nativeSettings.run(state => ({ session: state.browser?.sessions?.[owner], conversationId: state.browser?.chats?.[owner] }));
      assertSetup();
      const connection = profile.session?.desired ? profile.session : undefined;
      const managedBrowserId = connection?.pairing?.browserId ?? randomUUID();
      const openingId = connection?.binding?.openingId ?? randomUUID();
      await this.openCompanion({ threadId, key, managedBrowserId, connection, openingId });
      assertSetup();
      this.ownedWindow ??= this.windowFactory({ companionPath: this.extensionPath, onChange: () => { void this.pumpOwned(); } });
      const saved = connection?.binding?.conversationId ?? profile.conversationId;
      const tab = await this.ownedWindow.open({ owner, tabId: connection?.binding?.tabId,
        url: saved ? `${browserWire.chatgptOrigin}/c/${saved}` : `${browserWire.chatgptOrigin}/#${OPENING_FRAGMENT_KEY}=${openingId}`, reveal: true });
      assertSetup();
      this.ownedTabId = tab.id; this.managedBrowserId = managedBrowserId;
      this.ownedOpeningId = saved ? null : openingId; this.returnedOpening = false;
      await this.nativeSettings.run(state => { state.browser = { ...state.browser, mode }; }, true);
      await this.pumpOwned(); assertSetup(); return { state: this.view() };
    }
    const owner = this.browserOwner(context), saved = await this.nativeSettings.run(state => state.browser?.chats?.[owner]);
    assertSetup();
    const openingId = mode === CHATGPT_BROWSER_MODES.chrome && !saved ? randomUUID() : undefined;
    const targetUrl = mode === CHATGPT_BROWSER_MODES.chrome ? saved ? `${browserWire.chatgptOrigin}/c/${saved}` : `${browserWire.chatgptOrigin}/#${OPENING_FRAGMENT_KEY}=${openingId}` : undefined;
    await this.openCompanion({ threadId, key, autoConnect: mode === CHATGPT_BROWSER_MODES.chrome, openingId, targetUrl }); this.recoveryIssue = null;
    assertSetup();
    if (mode === CHATGPT_BROWSER_MODES.chrome) {
      await this.nativeSettings.run(state => { state.browser = { ...state.browser, mode }; }, true);
      assertSetup();
      await openChromeIfAbsent(targetUrl, { signal: attempt.signal });
      assertSetup();
      return { state: this.view(), extensionPath: this.extensionPath };
    }
    return { pairingUrl: `${this.bridge.address}/#${key}`, extensionPath: this.extensionPath, state: this.view() }; // Owner-only setup return; never an event/log/settings value.
  }
  browserOwner(context) { return createHash('sha256').update(JSON.stringify([context.threadId, fs.realpathSync(context.workspacePath)])).digest('hex'); }
  async show() {
    if (this.mode === CHATGPT_BROWSER_MODES.builtin && this.threadId) return this.ownedWindow?.open({ owner: this.browserOwner(this.getContext(this.threadId)), reveal: true });
    this.bridge?.requestShow(); return this.view();
  }
  startSignInTransfer() {
    this.signInStarting ??= this.openSignInTransfer().finally(() => { this.signInStarting = null; });
    return this.signInStarting;
  }
  async openSignInTransfer() {
    const version = this.connectionVersion, sequence = this.signInSequence, window = this.ownedWindow, tabId = this.ownedTabId;
    const current = () => version === this.connectionVersion && sequence === this.signInSequence && window === this.ownedWindow && !window?.closed && !this.runtime?.pending.size;
    if (this.mode !== CHATGPT_BROWSER_MODES.builtin || !this.ownedWindow || !this.ownedTabId) throw Error('Open ChatGPT in ANKITA first.');
    const binding = this.bridge.view().binding;
    if (this.runtime?.pending.size || (binding && !await this.runtime.delivery.canReplaceBinding(binding))) throw Error('Finish or stop the current reply before bringing your Chrome sign-in.');
    if (!current()) throw Error(BROWSER_SETUP_CHANGED_MESSAGE);
    this.signInTransfer ??= new SignInTransfer(); this.signInTransfer.cancel();
    await this.signInBridge?.close(); this.signInBridge = null;
    if (!current()) throw Error(BROWSER_SETUP_CHANGED_MESSAGE);
    this.signInTransfer.begin(current, async (cookies, owns) => {
      await this.nativeSettings.run(state => { if (owns() && state.browser) state.browser.identities = {}; }, true);
      if (!owns()) throw Error(BROWSER_SETUP_CHANGED_MESSAGE);
      this.connectorApps = {};
      const transaction = await importSessionCookies(window.sessionForTab(tabId), cookies, owns, () => !window.closed);
      const selected = this.bridge.view().binding;
      const destination = selected?.conversationId ? `${browserWire.chatgptOrigin}/c/${selected.conversationId}` : `${browserWire.chatgptOrigin}/#${OPENING_FRAGMENT_KEY}=${this.ownedOpeningId}`;
      return { ...transaction, commit: () => {
        if (current()) void window.open({ owner: this.browserOwner(this.getContext(this.threadId)), url: destination, reveal: true }).catch(() => { this.recoveryIssue = 'owned-browser-unavailable'; this.changed(); });
        void this.pumpOwned();
      } };
    });
    const hostId = await this.nativeSettings.run(state => { state.browser ??= {}; state.browser.hostId ??= randomUUID(); return state.browser.hostId; }, true);
    if (!current()) { this.signInTransfer.cancel(); throw Error(BROWSER_SETUP_CHANGED_MESSAGE); }
    const key = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
    const transport = await createCompanionBridge({ config: { workspacePath: this.workspacePath, threadId: this.threadId, autoConnect: true, signInOnly: true, hostId },
      secrets: { withSecret: async (_name, use) => use(key) }, getSignInOffer: () => this.signInTransfer.pending(),
      acceptSignIn: (...args) => this.signInTransfer.accept(...args) });
    if (!current()) { this.signInTransfer.cancel(); await transport.close(); throw Error(BROWSER_SETUP_CHANGED_MESSAGE); }
    this.signInBridge = transport;
    return { waiting: true }; // No cookie, token or local capability leaves this owner action.
  }
  pumpOwned() {
    if (this.ownedPump) return this.ownedPump;
    this.ownedPump = this.runOwnedPump().finally(() => { this.ownedPump = null; });
    return this.ownedPump;
  }
  async runOwnedPump() {
    clearTimeout(this.ownedTimer);
    if (this.mode !== CHATGPT_BROWSER_MODES.builtin || !this.ownedWindow || !this.bridge || !this.ownedTabId) return;
    const bridge = this.bridge, version = this.connectionVersion, window = this.ownedWindow;
    const { threadId, workspacePath, managedBrowserId, ownedTabId } = this;
    const current = () => this.bridge === bridge && this.connectionVersion === version;
    try {
      let tab = await window.api.tabs.get(ownedTabId);
      const destination = new URL(tab.url);
      if (current() && !bridge.view().binding && this.ownedOpeningId && !this.returnedOpening && destination.origin === browserWire.chatgptOrigin && destination.pathname === '/' && !openingFromUrl(tab.url)) {
        this.returnedOpening = true;
        destination.hash = new URLSearchParams({ [OPENING_FRAGMENT_KEY]: this.ownedOpeningId }).toString();
        tab = await window.open({ owner: this.browserOwner(this.getContext(threadId)), url: destination.href }); // One owned home return after login; never retarget a known or unsettled conversation.
      }
      const conversationId = conversationFromUrl(tab.url), openingId = openingFromUrl(tab.url);
      if (!current()) return;
      await bridge.reportTabs({ browserId: managedBrowserId, tabs: [tab] });
      if (!current()) return;
      if ((conversationId || openingId) && !bridge.view().binding) {
        await bridge.bind({ browserId: managedBrowserId, tabId: tab.id, conversationId, openingId: conversationId ? undefined : openingId, threadId, workspacePath });
      }
      if (!current()) return;
      await pumpBoundBrowser(window.api, bridge, browserWire);
      if (current()) this.recoveryIssue = null;
    } catch { if (current()) this.recoveryIssue = 'owned-browser-unavailable'; }
    finally {
      this.changed();
      if (current()) { this.ownedTimer = setTimeout(() => { void this.pumpOwned(); }, browserWire.pollMs); this.ownedTimer.unref?.(); }
    }
  }
  async openCompanion({ threadId, key, connection, managedBrowserId, autoConnect = false, openingId, targetUrl } = {}) {
    const version = this.connectionVersion;
    const context = this.getContext(threadId);
    if (context?.threadId !== threadId || !context?.workspacePath) throw new Error('Saved pairing no longer owns this teammate');
    const store = new BrowserOperationStore({ directory: this.directory });
    let runtime;
    const delivery = new BrowserDelivery({ store, transform: this.history, onEvent: event => runtime?.deliveryEvent(event) });
    this.threadId = threadId; this.workspacePath = fs.realpathSync(context.workspacePath);
    const encrypted = await this.secureStore?.available?.();
    const pairingStore = encrypted ? { load: async () => connection,
      save: value => this.secureStore.saveSecret(BRIDGE_SECRET_NAME, JSON.stringify({ version: SESSION_VERSION, threadId, key, connection: value })) } : undefined;
    const owner = this.browserOwner(context);
    const hostId = autoConnect ? await this.nativeSettings.run(state => {
      state.browser ??= {}; state.browser.hostId ??= randomUUID(); return state.browser.hostId;
    }, true) : undefined; // Stable profile identity: an OS port alone cannot identify the intended local app.
    const ownedStore = { load: async () => connection, save: value => this.nativeSettings.run(state => {
      state.browser ??= {}; state.browser.sessions ??= {}; state.browser.sessions[owner] = value;
      if (value.binding?.conversationId) { state.browser.chats ??= {}; state.browser.chats[owner] = value.binding.conversationId; }
    }, true) };
    const bridge = await createCompanionBridge({ config: { workspacePath: this.workspacePath, threadId, modelMode: MODEL_MODES.current, autoConnect, openingId, targetUrl, hostId },
      managedBrowserId, secrets: { withSecret: async (_, use) => use(key) }, store: managedBrowserId ? ownedStore : pairingStore, delivery,
      getAppIdentities: binding => this.getProvenApps(binding),
      onObservation: async value => {
        if (version !== this.connectionVersion) return;
        this.changed();
        if (value.binding.conversationId && this.savedChats.get(owner) !== value.binding.conversationId) await this.nativeSettings.run(state => {
          state.browser ??= {}; state.browser.chats ??= {}; state.browser.chats[owner] = value.binding.conversationId;
          this.savedChats.set(owner, value.binding.conversationId);
        }, true);
        await this.learnConnectorApps(value.binding, value.appSightings);
        if (version !== this.connectionVersion) return;
        if (this.gatewayBinding && !sameOperationBinding(this.gatewayBinding, value.binding)) await this.closeNative();
        if (value.blockedReason) await this.closeNative(value.binding);
      } });
    if (version !== this.connectionVersion) { await bridge.close(); throw new Error(BROWSER_SETUP_CHANGED_MESSAGE); }
    this.bridge = bridge;
    this.runtime = runtime = new ChatGptRuntime({ bridge, delivery, store, history: this.history,
      onCancel: binding => this.closeNative(binding), onEvent: () => this.changed(),
      onReadyBinding: async () => {
        for (const [surface, preference] of Object.entries(this.nativePreferences))
          if (preference.desired && !this.nativeTunnels.has(surface)) await this.startNativeTools({ surface });
      } });
    if (connection?.binding) await this.runtime.restore();
    this.changed();
  }
  async send(input) {
    const control = new AbortController();
    if (this.waitingSends.has(input.threadId)) throw new Error('This teammate is already connecting to ChatGPT');
    this.waitingSends.set(input.threadId, control);
    const signal = input.signal ? AbortSignal.any([input.signal, control.signal]) : control.signal;
    try {
    if ([CHATGPT_BROWSER_MODES.builtin, CHATGPT_BROWSER_MODES.chrome].includes(this.mode) && this.threadId !== input.threadId) await this.start({ threadId: input.threadId, mode: this.mode, signal });
    if (!this.runtime) throw new Error(CHATGPT_SETUP_MESSAGE);
    const runtime = this.runtime, deadline = Date.now() + OBSERVATION_MAX_AGE_MS;
    if (this.mode !== CHATGPT_BROWSER_MODES.legacy) while (runtime.view().status !== BRIDGE_READY_STATUS) {
      signal.throwIfAborted();
      if (runtime !== this.runtime || runtime.closed) throw new Error('The ChatGPT connection was closed');
      if (Date.now() >= deadline) throw new Error('Open your ChatGPT window and finish signing in, then send again.');
      await pause(SEND_READY_POLL_MS, undefined, { signal });
    }
    signal.throwIfAborted();
    await this.readNativePreferences();
    const appNames = this.appPreferences.autoMention && input.includeTools !== false ? CHATGPT_NATIVE_SURFACES.filter(surface => this.nativePreferences[surface.id]?.desired).map(surface => this.appPreferences.appNames[surface.id]) : [];
    return await runtime.send({ ...input, signal, appNames, onQueued: async operation => { await input.onQueued?.(operation); void this.pumpOwned(); } });
    } finally { if (this.waitingSends.get(input.threadId) === control) this.waitingSends.delete(input.threadId); this.changed(); }
  }
  resume(input) { if (!this.runtime) throw new Error(CHATGPT_SETUP_MESSAGE); return this.runtime.resume(input); }
  async operation(operationId) {
    const operation = await this.runtime?.store.get(operationId);
    if (!operation || !sameOperationBinding(operation.binding, this.bridge?.view().binding)) throw new Error('Saved browser reply belongs to another connection');
    return operation;
  }
  async handoffReceipts(threadId) {
    const binding = this.bridge?.view().binding;
    if (!binding || binding.threadId !== threadId || fs.realpathSync(this.getContext(threadId).workspacePath) !== binding.workspacePath) throw new Error('Handoff must use the selected teammate and workspace');
    const records = await new PersistentToolReceipts({ directory: this.directory }).list(binding);
    const completed = records.filter(row => row.phase === 'settled' && !row.result.isError).map(row => ({ name: row.owner.name,
      result: row.result.content.filter(part => part.type === 'text').map(part => part.text).join('\n') }));
    const unresolved = records.filter(row => row.phase !== 'settled' || row.result.isError).map(row => ({ id: row.id, name: row.owner.name, phase: row.result?.isError ? 'error-or-unconfirmed' : row.phase }));
    for (const row of await this.runtime.store.list(binding)) if (['claimed', 'dispatched', 'accepted', 'uncertain'].includes(row.outcome)) unresolved.push({ id: row.id, name: 'browser reply', phase: row.outcome });
    return { completed, unresolved };
  }
  async consume(operationId) { await this.runtime?.store.consume(operationId, this.bridge.view().binding); await this.runtime?.restore(); this.changed(); }
  async disconnect() {
    try { await this.runtime?.close(); } finally { await this.bridge?.disconnect(); await this.close(); this.changed(); }
  }
  cancel(id) {
    this.signInSequence++; this.signInTransfer?.cancel();
    const waiting = this.waitingSends.get(id);
    waiting?.abort(new Error('Browser reply cancelled by user'));
    if (this.openingAttempt?.threadId === id) { this.openingAttempt.cancelled = true; this.openingAttempt.control.abort(); }
    return this.runtime?.cancel(id) ?? Boolean(waiting);
  }
  async startNativeTools({ surface, tunnelId, apiKey } = {}) {
    if (this.runtime?.pending.size) throw new Error('Wait for the current reply before changing native connections');
    if (!CHATGPT_NATIVE_SURFACES.some(item => item.id === surface)) throw new Error('Choose a supported native tool connection');
    await this.readNativePreferences();
    const selectedId = String(tunnelId ?? this.nativePreferences[surface]?.tunnelId ?? '').trim();
    if (!NATIVE_TUNNEL_ID_PATTERN.test(selectedId)) throw new Error('Enter the dedicated tunnel ID for this connection');
    if (this.nativeStarting.has(surface)) throw new Error('This native connection is already being set up');
    const collision = [...this.nativeStarting].some(([other, attempt]) => other !== surface && attempt.tunnelId === selectedId) ||
      Object.entries(this.nativePreferences).some(([other, value]) => other !== surface && value.tunnelId === selectedId && (value.desired || this.nativeTunnels.has(other)));
    if (collision) throw new Error(TUNNEL_COLLISION_MESSAGE);
    if (!this.nativeArtifact?.binary || !fs.existsSync(this.nativeArtifact.binary)) throw new Error('The reviewed native tunnel helper is missing from this installation');
    if (!this.secureStore?.withSecret) throw new Error('Secure native credential storage is unavailable');
    const attempt = { tunnelId: selectedId, cancelled: false };
    this.nativeStarting.set(surface, attempt);
    let tunnel;
    try {
      const gateway = await this.startNativeGateway(), name = NATIVE_TUNNEL_SECRET_PREFIX + surface;
      const assertSetup = () => {
        if (attempt.cancelled || this.nativeStarting.get(surface) !== attempt || !this.gatewayBinding ||
            !sameOperationBinding(this.gatewayBinding, this.bridge?.view().binding) || this.gateway !== gateway || this.runtime?.closed)
          throw new Error(NATIVE_SETUP_CHANGED_MESSAGE);
      };
      assertSetup();
      if (apiKey?.trim()) await this.secureStore.saveSecret(name, apiKey.trim());
      assertSetup();
      await this.nativeTunnels.get(surface)?.close(); assertSetup();
      tunnel = this.nativeTunnelFactory({ binary: this.nativeArtifact.binary, sha256: this.nativeArtifact.sha256,
        companionBinary: this.nativeArtifact.companionBinary, companionSha256: this.nativeArtifact.companionSha256,
        surface, tunnelId: selectedId, endpointUrl: gateway.urls[surface], onChange: () => this.changed() });
      this.nativeTunnels.set(surface, tunnel);
      const started = await this.secureStore.withSecret(name, value => { assertSetup(); return tunnel.start({ apiKey: value }); });
      assertSetup();
      if (started === null) throw new Error('Enter a restricted tunnel key in this connection card');
      await this.nativeSettings.run(state => {
        assertSetup(); const previous = state.tunnels[surface];
        if (previous?.tunnelId !== selectedId && state.browser?.identities) for (const [key, rows] of Object.entries(state.browser.identities))
          state.browser.identities[key] = Array.isArray(rows) ? rows.filter(app => app?.surface !== surface) : [];
        state.tunnels[surface] = { tunnelId: selectedId, desired: true,
          identitySince: previous?.tunnelId === selectedId ? previous.identitySince : Date.now() }; // Epoch milliseconds: old requests cannot re-teach an app ID after replacing its tunnel.
      }, true);
      await this.readNativePreferences(); assertSetup(); this.changed(); return this.view();
    } catch (error) {
      await tunnel?.close(); if (tunnel && this.nativeTunnels.get(surface) === tunnel) this.nativeTunnels.delete(surface);
      this.changed(); throw error;
    } finally { if (this.nativeStarting.get(surface) === attempt) this.nativeStarting.delete(surface); apiKey = ''; }
  }
  async stopNativeTools({ surface } = {}) {
    if (!CHATGPT_NATIVE_SURFACES.some(item => item.id === surface)) throw new Error('Choose a supported native tool connection');
    const attempt = this.nativeStarting.get(surface); if (attempt) attempt.cancelled = true;
    await this.nativeSettings.run(state => { if (state.tunnels[surface]) state.tunnels[surface].desired = false; }, true);
    await this.nativeTunnels.get(surface)?.close(); this.nativeTunnels.delete(surface); await this.readNativePreferences(); this.changed(); return this.view();
  }
  async startNativeGateway() {
    const view = this.bridge?.view(), binding = view?.binding;
    if (view?.status !== BRIDGE_READY_STATUS || !binding || !this.toolHostForBinding) throw new Error('Connect an owned ChatGPT conversation before enabling native tools');
    if (this.runtime?.closed || await this.runtime?.store.isStopped(binding)) throw new Error('This browser connection was stopped; explicitly send after Stop confirmation to renew it');
    if (this.gateway && sameOperationBinding(binding, this.gatewayBinding)) return this.gateway;
    if (this.gatewayStarting) return this.gatewayStarting;
    this.gatewayStarting = this.openNativeGateway(binding).finally(() => { this.gatewayStarting = null; });
    return this.gatewayStarting;
  }
  async openNativeGateway(binding) {
    await this.closeNative(this.gatewayBinding, { cancelPending: false }); // Replace an old gateway without cancelling the setup that requested this one.
    if (this.bridge?.view().status !== BRIDGE_READY_STATUS || !sameOperationBinding(this.bridge?.view().binding, binding) ||
        this.runtime?.closed || await this.runtime?.store.isStopped(binding)) throw new Error('Native connection changed or stopped during setup');
    this.gatewayBinding = binding;
    const receipts = new PersistentToolReceipts({ directory: this.directory, transform: this.history });
    const hostForLease = (leaseId, owner, requestId) => {
      const current = this.bridge?.view();
      if (leaseId !== binding.leaseId || current?.status !== BRIDGE_READY_STATUS || !sameOperationBinding(current.binding, binding) ||
          !sameOperationBinding(this.gatewayBinding, binding) || (owner && !sameOperationBinding(owner, binding)))
        throw new Error('Native tool connection no longer owns this conversation');
      const key = requestId ?? INSPECTION_HOST;
      if (!this.nativeHosts.has(key)) {
        if (this.nativeHosts.size >= MAX_REQUEST_IDS) throw new Error('Native tool workflow capacity reached');
        this.nativeHosts.set(key, this.toolHostForBinding(owner ?? current.binding));
      }
      return this.nativeHosts.get(key);
    };
    try {
      const gateway = await createToolGateway({ leaseId: binding.leaseId, receipts, hostForLease,
        resolveRequestOwner: input => this.bridge.resolveRequestOwner(input) });
      if (!sameOperationBinding(this.gatewayBinding, binding) || !sameOperationBinding(this.bridge?.view().binding, binding) || this.runtime?.closed) {
        await gateway.close(); throw new Error('Native connection changed during gateway setup');
      }
      this.gateway = gateway;
      return this.gateway;
    } catch (error) { this.gatewayBinding = null; throw error; }
  }
  closeNative(owner = this.gatewayBinding, { cancelPending = true } = {}) {
    if (cancelPending) for (const attempt of this.nativeStarting.values()) attempt.cancelled = true;
    if (this.nativeClosing) return this.nativeClosing;
    const hosts = [...this.nativeHosts.values()], tunnels = [...this.nativeTunnels.values()], gateway = this.gateway;
    this.gatewayBinding = null;
    this.gateway = null; this.nativeHosts.clear(); this.nativeTunnels.clear();
    this.nativeClosing = (async () => {
      const cancellations = await Promise.allSettled([...hosts.map(host => host.cancel()), owner ? this.onCancelTools(owner) : undefined]);
      const transports = await Promise.allSettled([...tunnels.map(tunnel => tunnel.close()), gateway?.close()]);
      const failure = [...cancellations, ...transports].find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
    })().finally(() => { this.nativeClosing = null; });
    return this.nativeClosing;
  }
  async close({ keepWindows = false, transition } = {}) {
    this.signInSequence++; this.signInTransfer?.cancel(); await this.signInStarting?.catch(() => {}); await this.signInBridge?.close(); this.signInBridge = null;
    if (this.openingAttempt && this.openingAttempt !== transition) this.openingAttempt.cancelled = true;
    clearTimeout(this.ownedTimer);
    if (!transition) for (const control of this.waitingSends.values()) control.abort(new Error('Browser connection closed'));
    let failure;
    try { await this.runtime?.close(); } catch (error) { failure = error; }
    this.connectionVersion++; clearTimeout(this.ownedTimer); this.ownedTabId = null;
    await this.ownedPump;
    try { await this.closeNative(); } catch (error) { failure ??= error; }
    try { await this.bridge?.close(); } catch (error) { failure ??= error; }
    this.runtime = null; this.bridge = null;
    if (!keepWindows) { await this.ownedWindow?.close(); this.ownedWindow = null; }
    if (failure) throw failure;
  }
}
