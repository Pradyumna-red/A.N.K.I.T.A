import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { McpStore } from '../../src/integrations/mcp-store.mjs';
import { MCP_FILE } from '../../src/core/config.mjs';
import { formatToolResult } from '../../src/integrations/mcp-client.mjs';
import { COMPUTER_USE_LABEL } from '../shared/computer-use.mjs';
import { COMPUTER_MCP_ID, COMPUTER_POINTER_CONFIG, COMPUTER_POINTER_SESSION, COMPUTER_CURSOR_TOOLS, COMPUTER_CURSOR_CLEANUP_TIMEOUT_MS, COMPUTER_CURSOR_STATE_TIMEOUT_MS, COMPUTER_CURSOR_STATE_POLL_MS, COMPUTER_DRIVER_NAME, COMPUTER_DRIVER_ENV, COMPUTER_DRIVER_DOCS, COMPUTER_DRIVER_MANIFEST_ARGS, COMPUTER_DRIVER_LOCATION, COMPUTER_SUPPORTED_PLATFORM, COMPUTER_TOOLS, COMPUTER_HEALTH_TOOL, COMPUTER_REQUEST_TIMEOUT_MS, COMPUTER_DISCOVERY_TIMEOUT_MS, COMPUTER_MANIFEST_MAX_BYTES, driverManifest } from '../../src/integrations/computer-use.mjs';

const runFile = promisify(execFile);
const supportsPointer = client => Object.values(COMPUTER_CURSOR_TOOLS).every(name => client?.tools?.some(tool => tool.name === name));
export async function discoverComputerDriver({ command, env = process.env, run = runFile, signal } = {}) {
  const explicit = command?.trim() || env[COMPUTER_DRIVER_ENV]?.trim();
  const local = env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, ...COMPUTER_DRIVER_LOCATION) : null;
  const candidates = explicit ? [explicit] : [COMPUTER_DRIVER_NAME, ...(local && fs.existsSync(local) ? [local] : [])];
  let failure;
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    try {
      const { stdout } = await run(candidate, COMPUTER_DRIVER_MANIFEST_ARGS, { windowsHide: true, timeout: COMPUTER_DISCOVERY_TIMEOUT_MS, maxBuffer: COMPUTER_MANIFEST_MAX_BYTES, signal });
      return driverManifest(JSON.parse(stdout));
    } catch (error) { signal?.throwIfAborted(); failure = error; }
  }
  throw new Error(`Cua Driver was not found or could not start. Install it or select its executable. ${failure?.message || ''}`);
}

/** One explicit, process-lived MCP desktop connection. No replacement input engine. */
export class DesktopComputerUse {
  constructor({ mcpFile = MCP_FILE, mcp, platform = process.platform, discover = discoverComputerDriver, onChange = () => {} } = {}) {
    Object.assign(this, { mcpFile, mcp, platform, discover, onChange });
    this.connecting = null; this.controller = null; this.detected = null; this.closed = false;
    this.pointerSession = null;
    this.stopping = null;
    this.mcp?.setConnectionSetup?.(COMPUTER_MCP_ID, (record, options) => this.preparePointer(record, options));
  }
  get pointerSupported() {
    const client = this.mcp?.servers?.get(COMPUTER_MCP_ID)?.client;
    return supportsPointer(client);
  }
  async overview() {
    const record = new McpStore(this.mcpFile).load().find(COMPUTER_MCP_ID);
    const supported = this.platform === COMPUTER_SUPPORTED_PLATFORM;
    let error = null;
    if (supported && !this.detected) {
      try { this.detected = await this.discover({ command: record?.command }); }
      catch (cause) { error = cause.message; }
    }
    return { supported, installed: Boolean(this.detected), connected: Boolean(this.mcp?.has(COMPUTER_MCP_ID)), connecting: Boolean(this.connecting), command: this.detected?.command || record?.command || '', version: this.detected?.version || '', docsUrl: COMPUTER_DRIVER_DOCS, error,
      tools: this.mcp?.servers?.get(COMPUTER_MCP_ID)?.tools?.map(tool => tool.name) || [],
      pointerSupported: this.pointerSupported, pointerEnabled: record?.[COMPUTER_POINTER_CONFIG] !== false };
  }
  async connect({ command } = {}) {
    if (this.stopping) await this.stopping;
    if (this.closed) throw new Error('Computer Use is closed');
    if (this.platform !== COMPUTER_SUPPORTED_PLATFORM) throw new Error('Computer Use currently supports Windows desktops');
    if (this.connecting) return this.connecting;
    if (!command && this.mcp?.has(COMPUTER_MCP_ID)) return this.overview();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.connecting = this.start({ command, signal }).finally(() => { this.connecting = null; this.controller = null; this.onChange(); });
    this.onChange();
    return this.connecting;
  }
  async start({ command, signal }) {
    const store = new McpStore(this.mcpFile).load();
    const previous = store.find(COMPUTER_MCP_ID);
    const driver = await this.discover({ command: command || previous?.command, signal });
    signal.throwIfAborted();
    if (!this.mcp) throw new Error('MCP manager is unavailable');
    if (this.mcp.has(COMPUTER_MCP_ID)) { await this.endPointer(); await this.mcp.disconnect(COMPUTER_MCP_ID); }
    signal.throwIfAborted();
    if (previous) store.remove(COMPUTER_MCP_ID);
    const record = store.add({ id: COMPUTER_MCP_ID, name: COMPUTER_USE_LABEL, ...driver, manualStart: true, allowedTools: COMPUTER_TOOLS, terminateTree: false });
    record[COMPUTER_POINTER_CONFIG] = previous?.[COMPUTER_POINTER_CONFIG] !== false;
    store.save();
    // Connect authorizes the displayed native driver. Desktop agents run its native actions directly; explicit blocks still apply.
    store.markApproved(COMPUTER_MCP_ID);
    this.detected = driver;
    try {
      await this.mcp.connect({ ...record, signal, requestTimeoutMs: COMPUTER_REQUEST_TIMEOUT_MS, initTimeoutMs: COMPUTER_REQUEST_TIMEOUT_MS });
      signal.throwIfAborted();
      await this.preparePointer(this.mcp.servers?.get(COMPUTER_MCP_ID), { signal });
      signal.throwIfAborted();
      store.markConnected(COMPUTER_MCP_ID, true);
    } catch (error) {
      await this.endPointer().catch(() => {});
      await this.mcp.disconnect(COMPUTER_MCP_ID);
      store.setEnabled(COMPUTER_MCP_ID, false); store.markConnected(COMPUTER_MCP_ID, false, error.message);
      throw error;
    }
    return this.overview();
  }
  async preparePointer(record, { signal } = {}) {
    if (this.closed) throw new Error('Computer Use is closed');
    signal?.throwIfAborted();
    if (record?.[COMPUTER_POINTER_SESSION]) { this.pointerSession = record[COMPUTER_POINTER_SESSION]; return; }
    this.pointerSession = null;
    const client = record?.client;
    if (!supportsPointer(client)) return;
    // The driver's implicit label can be shared by separate transports; reserve one unique desktop-owned session.
    const session = await this.cursorCall(COMPUTER_CURSOR_TOOLS.start, { session: randomUUID() }, { signal, client });
    if (typeof session.session !== 'string' || !session.session) throw new Error('Driver did not return its cursor session');
    this.pointerSession = session.session;
    record[COMPUTER_POINTER_SESSION] = this.pointerSession;
    const saved = new McpStore(this.mcpFile).load().find(COMPUTER_MCP_ID);
    await this.applyPointer(saved?.[COMPUTER_POINTER_CONFIG] !== false, { signal, client });
  }
  async cursorCall(name, args, { client = this.mcp?.servers?.get(COMPUTER_MCP_ID)?.client, ...options } = {}) {
    // These host-owned UI controls use the same MCP transport/session without exposing cursor configuration to the model.
    if (!client?.tools?.some(tool => tool.name === name)) throw new Error('This driver does not support the animated pointer');
    const result = await client.callTool(name, args, options);
    if (result.isError) throw new Error(formatToolResult(result));
    return result.raw?.structuredContent || {};
  }
  async applyPointer(enabled, options) {
    const session = this.pointerSession;
    const client = options?.client || this.mcp?.servers?.get(COMPUTER_MCP_ID)?.client;
    const current = () => {
      if (this.closed || this.stopping || this.pointerSession !== session || client?.closed) throw new Error('Pointer change cancelled because Computer Use stopped or reconnected');
    };
    current();
    const state = await this.cursorCall(COMPUTER_CURSOR_TOOLS.enabled, { session, enabled }, { ...options, client });
    current();
    if (state.enabled !== enabled) throw new Error('Driver did not confirm the pointer setting');
    // The driver acknowledges configuration before its overlay thread applies it; confirm actual visibility before reporting success.
    const deadline = Date.now() + COMPUTER_CURSOR_STATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      current();
      const observed = await this.cursorCall(COMPUTER_CURSOR_TOOLS.state, { session }, { ...options, client, timeoutMs: Math.max(COMPUTER_CURSOR_STATE_POLL_MS, deadline - Date.now()) });
      current();
      if (observed.enabled === enabled) return;
      await delay(COMPUTER_CURSOR_STATE_POLL_MS, undefined, { signal: options?.signal });
    }
    throw new Error('Driver did not apply the pointer setting before the timeout');
  }
  async setPointer({ enabled } = {}) {
    if (typeof enabled !== 'boolean') throw new Error('Pointer enabled must be a boolean');
    if (this.closed || this.connecting || !this.pointerSession || !this.mcp?.has(COMPUTER_MCP_ID)) throw new Error('Connect Computer Use before changing the pointer');
    await this.applyPointer(enabled);
    // Re-read immediately before saving so another settings writer is preserved.
    const store = new McpStore(this.mcpFile).load();
    const record = store.find(COMPUTER_MCP_ID);
    if (record) { record[COMPUTER_POINTER_CONFIG] = enabled; store.save(); }
    this.onChange();
    return this.overview();
  }
  async endPointer() {
    const session = this.pointerSession;
    this.pointerSession = null;
    const record = this.mcp?.servers?.get(COMPUTER_MCP_ID);
    if (record) delete record[COMPUTER_POINTER_SESSION];
    if (session && this.mcp?.has(COMPUTER_MCP_ID)) await this.cursorCall(COMPUTER_CURSOR_TOOLS.end, { session }, { timeoutMs: COMPUTER_CURSOR_CLEANUP_TIMEOUT_MS });
  }
  async check() {
    if (!this.mcp?.has(COMPUTER_MCP_ID)) throw new Error('Connect Computer Use first');
    const result = await this.mcp.callToolResult(`mcp__${COMPUTER_MCP_ID}__${COMPUTER_HEALTH_TOOL}`);
    const text = formatToolResult(result);
    if (result.isError) throw new Error(text);
    return { text };
  }
  stop() {
    if (this.stopping) return this.stopping;
    this.stopping = this.performStop().finally(() => { this.stopping = null; });
    return this.stopping;
  }
  async performStop() {
    const pending = this.connecting;
    const connected = Boolean(this.mcp?.has?.(COMPUTER_MCP_ID));
    const preparing = this.mcp?.isConnecting?.(COMPUTER_MCP_ID);
    this.controller?.abort();
    if (pending || connected || preparing) new McpStore(this.mcpFile).load().setEnabled(COMPUTER_MCP_ID, false);
    if (preparing) await this.mcp.cancelConnection(COMPUTER_MCP_ID);
    try { await this.endPointer(); }
    catch (error) { if (!pending) throw error; } // Cancellation can close this transport while end-session is in flight; teardown below still owns completion.
    finally {
      if (connected) await this.mcp.disconnect(COMPUTER_MCP_ID);
      await pending?.catch(() => {});
      this.onChange();
    }
    return { stopped: true };
  }
  async close() {
    this.closed = true;
    // A cosmetic cleanup failure must not prevent engine-wide job/channel teardown.
    try { await this.stop(); }
    catch { await this.mcp?.disconnect?.(COMPUTER_MCP_ID).catch(() => {}); }
  }
}
