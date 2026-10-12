import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { GATEWAY_TOKEN_BYTES } from '../../src/integrations/chatgpt-browser/protocol.mjs';
import { MODEL_MODES } from '../../services/chatgpt-bridge/config.mjs';
import { BrowserOperationStore } from '../../src/integrations/chatgpt-browser/operation-store.mjs';
import { BrowserDelivery } from '../../src/integrations/chatgpt-browser/delivery.mjs';
import { ChatGptRuntime } from '../../src/integrations/chatgpt-browser/runtime.mjs';
import { CHATGPT_BROWSER_PROVIDER, CHATGPT_CONNECTION_CHANGED, CHATGPT_PROFILE_DIRECTORY, CHATGPT_SETUP_MESSAGE } from '../shared/chatgpt-browser.mjs';

const COMPANION_RESOURCE_DIRECTORY = 'desktop/chatgpt-companion'; // Bundled resource contract; caller supplies its discovered root.
/** Desktop owns credentials/workspace; companion owns only its explicitly selected browser tab. */
export class DesktopChatGptBrowser {
  constructor({ directory, resourceRoot, getContext, history = value => value, emit = () => {} } = {}) {
    if (!directory || !resourceRoot || !getContext) throw new TypeError('Browser connection requires discovered profile/resources and host context');
    this.kind = CHATGPT_BROWSER_PROVIDER; this.directory = path.join(directory, CHATGPT_PROFILE_DIRECTORY);
    this.extensionPath = path.join(resourceRoot, COMPANION_RESOURCE_DIRECTORY); this.getContext = getContext; this.history = history; this.emit = emit;
    this.runtime = null; this.bridge = null;
  }
  async init() { return this; } // Choosing a provider never launches Chrome, a helper or a tunnel.
  listModels() { return this.runtime?.listModels() ?? []; }
  view() {
    const view = this.bridge?.view();
    return view ? { status: view.status, accountReady: view.accountReady, selectedModel: view.selectedModel, modelMode: view.modelMode,
      conversationId: view.binding?.conversationId ?? null, threadId: view.binding?.threadId ?? this.threadId, workspacePath: view.binding?.workspacePath ?? this.workspacePath,
      observationReason: view.observationReason } : { status: 'setup-required', selectedModel: null, threadId: null, conversationId: null };
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
    if (!fs.existsSync(path.join(this.extensionPath, 'manifest.json'))) throw new Error('The bundled ChatGPT companion is missing');
    await this.close();
    const key = randomBytes(GATEWAY_TOKEN_BYTES).toString('base64url');
    const store = new BrowserOperationStore({ directory: this.directory });
    const delivery = new BrowserDelivery({ store, transform: this.history, onEvent: event => this.runtime?.deliveryEvent(event) });
    this.threadId = threadId; this.workspacePath = fs.realpathSync(context.workspacePath);
    this.bridge = await createCompanionBridge({ config: { workspacePath: this.workspacePath, threadId, modelMode: MODEL_MODES.current },
      secrets: { withSecret: async (_, use) => use(key) }, delivery, onObservation: () => this.changed() });
    this.runtime = new ChatGptRuntime({ bridge: this.bridge, delivery, store, history: this.history });
    this.changed();
    return { pairingUrl: `${this.bridge.address}/#${key}`, extensionPath: this.extensionPath, state: this.view() }; // Owner-only setup return; never an event/log/settings value.
  }
  send(input) { if (!this.runtime) throw new Error(CHATGPT_SETUP_MESSAGE); return this.runtime.send(input); }
  cancel(id) { return this.runtime?.cancel(id) ?? false; }
  async close() { await this.runtime?.close(); await this.bridge?.close(); this.runtime = null; this.bridge = null; }
}
