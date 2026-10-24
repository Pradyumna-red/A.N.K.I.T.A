import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

test('owned ChatGPT windows reuse their teammate, isolate other teammates and restrict script targets', async () => {
  const module = await import('../../desktop/electron/chatgpt-window.mjs').catch(() => ({}));
  assert.equal(typeof module.ChatGptWindow, 'function', 'the built-in browser transport must exist');
  const created = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; created.push(this);
      this.webContents = Object.assign(new EventEmitter(), { id: created.length, debugger: { attach() {}, isAttached: () => true, sendCommand: async () => ({}) },
        getURL: () => this.url, isDestroyed: () => false, setWindowOpenHandler() {}, executeJavaScript: async text => text });
    }
    async loadURL(url) { this.url = url; if (this.redirectNext) { this.redirectNext = false; this.url = 'https://chatgpt.com/?mweb_fallback=1'; throw Object.assign(new Error('Navigation superseded'), { code: 'ERR_ABORTED' }); } }
    isDestroyed() { return false; }
    show() { this.shown = true; }
    focus() {}
    hide() { this.shown = false; }
    destroy() { this.emit('closed'); }
    setMenuBarVisibility() {}
  }
  const manager = new module.ChatGptWindow({ companionPath: fileURLToPath(new URL('../../desktop/chatgpt-companion', import.meta.url)), BrowserWindow: Window });
  try {
    const first = await manager.open({ owner: 'first', url: 'https://chatgpt.com/c/' + crypto.randomUUID(), reveal: true });
    assert.notEqual(first.id, created[0].webContents.id, 'durable owned tab IDs must not be recycled Electron window handles');
    assert.equal((await manager.open({ owner: 'first', reveal: true })).id, first.id);
    assert.equal(created.length, 1);
    const loginReturn = 'https://chatgpt.com/#ankita-opening=' + crypto.randomUUID();
    created[0].url = 'https://auth.openai.com/';
    assert.equal((await manager.open({ owner: 'first', url: loginReturn, reveal: true })).url, loginReturn, 'explicit Open returns an existing sign-in window to its owned opening');
    created[0].redirectNext = true;
    assert.equal((await manager.open({ owner: 'first', url: loginReturn + '-redirect', reveal: true })).url, 'https://chatgpt.com/?mweb_fallback=1', 'a page-owned redirect is observed without repeating the navigation');
    const second = await manager.open({ owner: 'second', url: 'https://chatgpt.com/c/' + crypto.randomUUID() });
    assert.notEqual(first.id, second.id);
    assert.equal(created[0].options.webPreferences.nodeIntegration, false);
    assert.equal(created[0].options.webPreferences.sandbox, true);
    assert.equal(created[0].options.webPreferences.backgroundThrottling, false);
    const [result] = await manager.api.scripting.executeScript({ target: { tabId: first.id }, func: value => value, args: ['public metadata'] });
    assert.match(result.result, /public metadata/);
    await assert.rejects(manager.api.scripting.executeScript({ target: { tabId: first.id }, files: ['../../electron/secure-store.mjs'] }), /script|adapter/i);
    created[0].url = 'https://unrelated.invalid/';
    await assert.rejects(manager.api.scripting.executeScript({ target: { tabId: first.id }, func: () => true }), /ChatGPT|page/i);
    await assert.rejects(manager.api.tabs.get(999), /owned|tab/i);
  } finally { await manager.close(); }
});
