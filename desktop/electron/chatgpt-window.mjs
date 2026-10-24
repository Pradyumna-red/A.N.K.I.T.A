import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { browserWire, PAGE_ADAPTER_FILES, conversationFromUrl, openingFromUrl, CHATGPT_WINDOW_BOUNDS as BOUNDS } from '../../services/chatgpt-bridge/config.mjs';
import { clickSelectedSend } from '../chatgpt-companion/commands.mjs';

const PARTITION = 'persist:ankita-chatgpt'; // Persistent Electron browser session, separate from ANKITA's privileged renderer.
const DEBUG_VERSION = '1.3'; // Chromium DevTools Protocol compatibility version used by Electron.
const EMPTY_PAGE_URL = 'about:blank'; // Materialize Chromium's renderer before awaiting Page commands; still install observers before ChatGPT navigation.
const TAB_ID_BYTES = 6; // A random 48-bit logical ID fits JavaScript's safe integer range and is independent of recycled Electron handles.
const NAVIGATION_SETTLE_MS = 45_000; // Milliseconds to observe a superseding native sign-in navigation; never retry the original request.
const NAVIGATION_ABORT = 'ERR_ABORTED'; // Chromium's cancelled-load code also covers an in-page redirect superseding loadURL.
const EMBEDDER_TOKENS = /\s(?:Electron|ankita)\/\S+/gi; // CoS chromiumUserAgent principle: retain Chromium/platform tokens, remove only this embedder's product branding.
const LOGIN_HOSTS = new Set(['chatgpt.com', 'auth.openai.com', 'auth0.openai.com', 'accounts.google.com']); // Popup hosts used by explicit account sign-in; other links stay in the system browser.
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']); // A model page does not inherit app camera/microphone/filesystem privileges.
const SCRIPT_REFUSAL = 'Only bundled ChatGPT adapter scripts can run in this browser';
const OWNED_START_MESSAGE = 'The owned browser must start on ChatGPT'; // Shared navigation admission error across initial and reused windows.
const chatPage = url => { try { return new URL(url).origin === browserWire.chatgptOrigin; } catch { return false; } };
const loginPage = url => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && LOGIN_HOSTS.has(parsed.hostname); } catch { return false; } };

/** App-owned sandboxed Chromium, reusing Electron rather than a second Chrome installation.
 * Inspired by CoS cos-browser/host.ts at a9c02cc8 (MIT); no upstream application state imported.
 */
export class ChatGptWindow {
  constructor({ companionPath, BrowserWindow, onChange = () => {} } = {}) {
    this.companionPath = fs.realpathSync(companionPath); this.Window = BrowserWindow; this.onChange = onChange;
    this.windows = new Map(); this.tabs = new Map(); this.ids = new WeakMap(); this.starting = new Map(); this.sources = new Map(); this.popups = new Set(); this.closed = false;
    this.api = {
      tabs: { get: async id => this.tab(id), query: async () => [...this.tabs.keys()].map(id => this.tab(id)).filter(tab => chatPage(tab.url)) },
      scripting: { executeScript: request => this.execute(request) },
    };
  }
  tab(id) {
    const win = this.tabs.get(id);
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) throw new Error('This tab is not owned by ANKITA');
    return { id, url: win.webContents.getURL(), title: win.webContents.getTitle?.() ?? 'ChatGPT' };
  }
  sessionForTab(id) { this.tab(id); return this.tabs.get(id).webContents.session; } // Host-only cookie jar access; never projected into page scripts or renderer IPC.
  source(file) {
    if (!PAGE_ADAPTER_FILES.includes(file)) throw new Error(SCRIPT_REFUSAL);
    if (!this.sources.has(file)) {
      const resolved = fs.realpathSync(path.join(this.companionPath, file));
      const relative = path.relative(this.companionPath, resolved);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(SCRIPT_REFUSAL);
      this.sources.set(file, fs.readFileSync(resolved, 'utf8'));
    }
    return this.sources.get(file);
  }
  async navigate(win, url) {
    try { await win.loadURL(url); }
    catch (error) {
      const contents = win.webContents;
      if (error.code !== NAVIGATION_ABORT || win.isDestroyed() || !loginPage(contents.getURL())) throw error;
      if (contents.isLoadingMainFrame?.()) await new Promise((resolve, reject) => {
        const finish = () => { cleanup(); loginPage(contents.getURL()) ? resolve() : reject(error); };
        const closed = () => { cleanup(); reject(error); };
        const timeout = setTimeout(closed, NAVIGATION_SETTLE_MS);
        const cleanup = () => { clearTimeout(timeout); contents.removeListener('did-stop-loading', finish); win.removeListener('closed', closed); };
        contents.once('did-stop-loading', finish); win.once('closed', closed);
        if (!contents.isLoadingMainFrame()) finish();
      });
    }
  }
  async open({ owner, url, tabId, reveal = false } = {}) {
    if (this.closed || typeof owner !== 'string' || !owner) throw new Error('An active teammate must own the ChatGPT window');
    const present = this.windows.get(owner);
    if (present && !present.isDestroyed()) {
      if (url && present.webContents.getURL() !== url) {
        if (!chatPage(url)) throw new Error(OWNED_START_MESSAGE);
        await this.navigate(present, url); // Explicit Open restores the host-selected destination after a sign-in redirect; Show alone never navigates.
      }
      if (reveal) { present.show(); present.focus(); } return this.tab(this.ids.get(present));
    }
    if (this.starting.has(owner)) return this.starting.get(owner);
    const task = this.create(owner, url ?? browserWire.chatgptOrigin, reveal, tabId).finally(() => this.starting.delete(owner));
    this.starting.set(owner, task); return task;
  }
  async create(owner, url, reveal, tabId) {
    if (!chatPage(url)) throw new Error(OWNED_START_MESSAGE);
    const electron = this.Window ? null : await import('electron');
    if (this.closed) throw new Error('The owned browser was disconnected');
    const Window = this.Window ?? electron.BrowserWindow;
    const win = new Window({ ...BOUNDS, show: false, title: 'ANKITA · ChatGPT', autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    const contents = win.webContents;
    if (contents.session?.getUserAgent && contents.session?.setUserAgent)
      contents.session.setUserAgent(contents.session.getUserAgent().replace(EMBEDDER_TOKENS, ''));
    let id = tabId;
    if (id === undefined) do { id = randomBytes(TAB_ID_BYTES).readUIntBE(0, TAB_ID_BYTES); } while (this.tabs.has(id));
    if (!Number.isSafeInteger(id) || this.tabs.has(id)) { win.destroy(); throw new Error('Owned browser tab identity conflicts'); }
    this.windows.set(owner, win); this.tabs.set(id, win); this.ids.set(win, id);
    contents.session?.setPermissionRequestHandler((_contents, permission, reply) => reply(PERMISSIONS.has(permission)));
    contents.session?.setPermissionCheckHandler((_contents, permission) => PERMISSIONS.has(permission));
    contents.setWindowOpenHandler(({ url: destination }) => {
      let parsed; try { parsed = new URL(destination); } catch { return { action: 'deny' }; }
      if (parsed.protocol === 'https:' && LOGIN_HOSTS.has(parsed.hostname)) return { action: 'allow', overrideBrowserWindowOptions: {
        ...BOUNDS, webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true } } };
      if (parsed.protocol === 'https:') void electron?.shell.openExternal(destination);
      return { action: 'deny' };
    });
    contents.on('did-create-window', popup => {
      if (this.closed) { popup.destroy(); return; }
      this.popups.add(popup); popup.once('closed', () => this.popups.delete(popup));
    });
    win.on('close', event => { if (!this.closed) { event.preventDefault(); win.hide(); } });
    win.once('closed', () => { this.tabs.delete(id); if (this.windows.get(owner) === win) this.windows.delete(owner); this.onChange(); });
    for (const name of ['did-navigate', 'did-navigate-in-page', 'did-finish-load']) contents.on(name, () => this.onChange());
    try {
      // Install before navigation: app metadata fetched by the first document is observable.
      await win.loadURL(EMPTY_PAGE_URL);
      contents.debugger.attach(DEBUG_VERSION);
      await contents.debugger.sendCommand('Page.enable');
      await contents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_ADAPTER_FILES.map(file => this.source(file)).join('\n;\n') });
      if (this.closed) throw new Error('The owned browser was disconnected');
      await this.navigate(win, url);
      if (reveal) { win.show(); win.focus(); }
      this.onChange(); return this.tab(id);
    } catch (error) { win.destroy(); throw error; }
  }
  async execute({ target, files, func, args = [] }) {
    const before = this.tab(target.tabId);
    if (!chatPage(before.url)) throw new Error('Adapter requires the owned ChatGPT page');
    const contents = this.tabs.get(target.tabId).webContents;
    let result;
    if (files) for (const file of files) await contents.executeJavaScript(this.source(file), true);
    else if (typeof func === 'function') result = await contents.executeJavaScript(`(${func.toString()})(...${JSON.stringify(args)})`, true);
    else throw new Error(SCRIPT_REFUSAL);
    const after = this.tab(target.tabId);
    const assignedChat = func === clickSelectedSend && result?.dispatched === true && openingFromUrl(before.url) && conversationFromUrl(after.url);
    if (after.url !== before.url && !assignedChat) throw new Error('ChatGPT page changed during its adapter read');
    return [{ result }];
  }
  async close() {
    this.closed = true;
    for (const popup of this.popups) if (!popup.isDestroyed()) popup.destroy();
    this.popups.clear();
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy();
    await Promise.allSettled([...this.starting.values()]); this.windows.clear(); this.tabs.clear();
  }
}
