import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { GATEWAY_TOKEN_BYTES } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { MODEL_MODES, MAX_REQUEST_IDS, BRIDGE_READY_STATUS, BRIDGE_SECRET_NAME } from '../../services/chatgpt-bridge/config.mjs';
import { BrowserOperationStore, sameOperationBinding } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { PersistentToolReceipts } from '../../src/integrations/chatgpt-browser/tool-receipts.mjs';
import { createToolGateway } from '../../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { DurableProfileState } from '../../src/integrations/chatgpt-browser/durable-profile.mjs';
import { NativeTunnel, nativeTunnelArtifact, NATIVE_TUNNEL_ID_PATTERN, NATIVE_TUNNEL_SECRET_PREFIX, NATIVE_TUNNEL_RESOURCE_DIRECTORY } from '../../src/integrations/chatgpt-browser/native-tunnel.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { verifyCompanionResources } from './chatgpt-resources.mjs';
import { CHATGPT_BROWSER_PROVIDER, CHATGPT_CONNECTION_CHANGED, CHATGPT_PROFILE_DIRECTORY, CHATGPT_SETUP_MESSAGE, CHATGPT_NATIVE_SURFACES } from '../shared/chatgpt-browser.mjs';

const COMPANION_RESOURCE_DIRECTORY = 'desktop/chatgpt-companion'; // Bundled resource contract; caller supplies its discovered root.
const INSPECTION_HOST = Symbol('nativeDiscoveryHost'); // Schema observation never shares a workflow's execution counters.
const NATIVE_PREFERENCES_FILE = 'native-connections.json'; // Profile-local tunnel IDs/intent only; key bytes live in SecureStore.
const NATIVE_PREFERENCES_VERSION = 1; // Unsupported native setup state fails closed.
const SESSION_VERSION = 1; // Encrypted pairing custody; unknown formats require a fresh explicit connection.
const TUNNEL_COLLISION_MESSAGE = 'Use a different tunnel for each tool group. This tunnel is assigned to another native surface.'; // One official tunnel/channel cannot route competing local helpers reliably.
const NATIVE_SETUP_CHANGED_MESSAGE = 'Native connection changed or stopped during setup'; // Shared late-setup refusal; Stop must not launch a helper after an asynchronous credential operation.
/** Desktop owns credentials/workspace; companion owns only its explicitly selected browser tab. */
export class DesktopChatGptBrowser {
  constructor({ directory, resourceRoot, companionPath, getContext, toolHostForBinding, secureStore, nativeResourceRoot, nativeArtifact,
    nativeTunnelFactory = options => new NativeTunnel(options), onCancelTools = async () => {}, history = value => value, emit = () => {} } = {}) {
    if (!directory || !resourceRoot || !getContext) throw new TypeError('Browser connection requires discovered profile/resources and host context');
    this.kind = CHATGPT_BROWSER_PROVIDER; this.directory = path.join(directory, CHATGPT_PROFILE_DIRECTORY);
    this.extensionPath = companionPath ?? path.join(resourceRoot, COMPANION_RESOURCE_DIRECTORY); this.getContext = getContext; this.history = history; this.emit = emit;
    this.toolHostForBinding = toolHostForBinding; this.nativeHosts = new Map(); this.gateway = null; this.gatewayBinding = null;
    this.onCancelTools = onCancelTools;
    this.secureStore = secureStore; this.nativeTunnelFactory = nativeTunnelFactory; this.nativeTunnels = new Map(); this.nativePreferences = {}; this.savedNativeKeys = new Set();
    this.nativeStarting = new Map(); // Reserve IDs before gateway/key awaits so simultaneous connection cards cannot race.
    this.nativeArtifact = nativeArtifact ?? nativeTunnelArtifact({ resourceRoot: nativeResourceRoot ?? path.join(resourceRoot, 'desktop', NATIVE_TUNNEL_RESOURCE_DIRECTORY) });
    this.nativeSettings = new DurableProfileState({ directory: this.directory, filename: NATIVE_PREFERENCES_FILE,
      initial: () => ({ version: NATIVE_PREFERENCES_VERSION, tunnels: {} }) });
    this.runtime = null; this.bridge = null;
  }
  async init() {
    if (this.initialized) return this;
    this.initialized = true; await this.readNativePreferences();
    if (this.savedNativeKeys.has(BRIDGE_SECRET_NAME)) {
      try {
        const saved = await this.secureStore.withSecret(BRIDGE_SECRET_NAME, value => JSON.parse(value));
        if (saved?.version !== SESSION_VERSION || typeof saved.key !== 'string' || !saved.key) throw new Error('Unsupported saved pairing');
        if (saved.connection?.desired) await this.openCompanion({ threadId: saved.threadId, key: saved.key, connection: saved.connection });
      } catch (error) { this.recoveryIssue = error.code === 'EADDRINUSE' ? 'port-unavailable' : 'saved-connection-unavailable'; }
    }
    return this; // Recovery opens only its remembered loopback reader; never Chrome, a helper or an action transport.
  }
  async readNativePreferences() {
    const preferences = await this.nativeSettings.run(state => {
      if (state.version !== NATIVE_PREFERENCES_VERSION || !state.tunnels || typeof state.tunnels !== 'object' || Array.isArray(state.tunnels) ||
          Object.entries(state.tunnels).some(([surface, value]) => !CHATGPT_NATIVE_SURFACES.some(item => item.id === surface) ||
            !NATIVE_TUNNEL_ID_PATTERN.test(value?.tunnelId) || typeof value?.desired !== 'boolean')) throw new Error('Native connection settings are corrupt or unsupported');
      return state.tunnels;
    });
    this.nativePreferences = preferences;
    this.savedNativeKeys = new Set((await this.secureStore?.listSecrets?.() ?? []).map(item => item.name));
    return { tunnels: Object.fromEntries(Object.entries(preferences).map(([surface, value]) => [surface, value.tunnelId])),
      savedKeys: CHATGPT_NATIVE_SURFACES.filter(item => this.savedNativeKeys.has(NATIVE_TUNNEL_SECRET_PREFIX + item.id)).map(item => item.id) };
  }
  listModels() { return this.runtime?.listModels() ?? []; }
  view() {
    const view = this.runtime?.view() ?? this.bridge?.view();
    const nativeTools = CHATGPT_NATIVE_SURFACES.map(surface => ({ id: surface.id,
      status: this.nativeTunnels.get(surface.id)?.view().status ?? 'setup-required',
      configured: Boolean(this.nativePreferences[surface.id]), hasSavedKey: this.savedNativeKeys.has(NATIVE_TUNNEL_SECRET_PREFIX + surface.id),
      available: Boolean(this.nativeArtifact?.binary && fs.existsSync(this.nativeArtifact.binary)) }));
    return view ? { status: view.status, accountReady: view.accountReady, selectedModel: view.selectedModel, modelMode: view.modelMode, nativeTools,
      conversationId: view.binding?.conversationId ?? null, threadId: view.binding?.threadId ?? this.threadId, workspacePath: view.binding?.workspacePath ?? this.workspacePath,
      observationReason: view.observationReason, blockedReason: view.blockedReason, remoteStop: view.remoteStop, recoverable: this.runtime?.recoverable ?? [] } : { status: 'setup-required', selectedModel: null, threadId: null, conversationId: null, nativeTools, recoveryIssue: this.recoveryIssue ?? null };
  }
  changed() {
    const state = this.view(), signature = JSON.stringify(state);
    if (signature === this.lastView) return;
    this.lastView = signature; this.emit({ type: CHATGPT_CONNECTION_CHANGED, state });
  }
  async start({ threadId } = {}) {
    if (this.runtime?.pending.size) throw new Error('Wait for the browser reply before changing its connection');
    const context = this.getContext(threadId);
    if (!context?.workspacePath || context.threadId !== threadId) throw new Error('Select a teammate and workspace for this browser conversation');
    verifyCompanionResources(this.extensionPath);
    await this.close();
    const key = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
    await this.openCompanion({ threadId, key }); this.recoveryIssue = null;
    return { pairingUrl: `${this.bridge.address}/#${key}`, extensionPath: this.extensionPath, state: this.view() }; // Owner-only setup return; never an event/log/settings value.
  }
  async openCompanion({ threadId, key, connection } = {}) {
    const context = this.getContext(threadId);
    if (context?.threadId !== threadId || !context?.workspacePath) throw new Error('Saved pairing no longer owns this teammate');
    const store = new BrowserOperationStore({ directory: this.directory });
    const delivery = new BrowserDelivery({ store, transform: this.history, onEvent: event => this.runtime?.deliveryEvent(event) });
    this.threadId = threadId; this.workspacePath = fs.realpathSync(context.workspacePath);
    const encrypted = await this.secureStore?.available?.();
    const pairingStore = encrypted ? { load: async () => connection,
      save: value => this.secureStore.saveSecret(BRIDGE_SECRET_NAME, JSON.stringify({ version: SESSION_VERSION, threadId, key, connection: value })) } : undefined;
    this.bridge = await createCompanionBridge({ config: { workspacePath: this.workspacePath, threadId, modelMode: MODEL_MODES.current },
      secrets: { withSecret: async (_, use) => use(key) }, store: pairingStore, delivery,
      onObservation: async value => {
        this.changed();
        if (this.gatewayBinding && !sameOperationBinding(this.gatewayBinding, value.binding)) await this.closeNative();
        if (value.blockedReason) await this.closeNative(value.binding);
      } });
    this.runtime = new ChatGptRuntime({ bridge: this.bridge, delivery, store, history: this.history,
      onCancel: binding => this.closeNative(binding), onEvent: () => this.changed(),
      onReadyBinding: async () => {
        for (const [surface, preference] of Object.entries(this.nativePreferences))
          if (preference.desired && !this.nativeTunnels.has(surface)) await this.startNativeTools({ surface });
      } });
    if (connection?.binding) await this.runtime.restore();
    this.changed();
  }
  send(input) { if (!this.runtime) throw new Error(CHATGPT_SETUP_MESSAGE); return this.runtime.send(input); }
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
  cancel(id) { return this.runtime?.cancel(id) ?? false; }
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
      await this.nativeSettings.run(state => { assertSetup(); state.tunnels[surface] = { tunnelId: selectedId, desired: true }; }, true);
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
        this.nativeHosts.set(key, this.toolHostForBinding(binding));
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
  async close() {
    let failure;
    try { await this.runtime?.close(); } catch (error) { failure = error; }
    try { await this.closeNative(); } catch (error) { failure ??= error; }
    try { await this.bridge?.close(); } catch (error) { failure ??= error; }
    this.runtime = null; this.bridge = null;
    if (failure) throw failure;
  }
}
