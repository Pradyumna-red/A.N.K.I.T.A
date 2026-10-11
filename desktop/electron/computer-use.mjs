import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpStore } from '../../src/integrations/mcp-store.mjs';
import { MCP_FILE } from '../../src/core/config.mjs';
import { formatToolResult } from '../../src/integrations/mcp-client.mjs';
import { COMPUTER_USE_LABEL } from '../shared/computer-use.mjs';
import { COMPUTER_MCP_ID, COMPUTER_DRIVER_NAME, COMPUTER_DRIVER_ENV, COMPUTER_DRIVER_DOCS, COMPUTER_DRIVER_MANIFEST_ARGS, COMPUTER_DRIVER_LOCATION, COMPUTER_SUPPORTED_PLATFORM, COMPUTER_TOOLS, COMPUTER_HEALTH_TOOL, COMPUTER_REQUEST_TIMEOUT_MS, COMPUTER_DISCOVERY_TIMEOUT_MS, COMPUTER_MANIFEST_MAX_BYTES, driverManifest } from '../../src/integrations/computer-use.mjs';

const runFile = promisify(execFile);
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
      tools: this.mcp?.servers?.get(COMPUTER_MCP_ID)?.tools?.map(tool => tool.name) || [] };
  }
  async connect({ command } = {}) {
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
    if (this.mcp.has(COMPUTER_MCP_ID)) await this.mcp.disconnect(COMPUTER_MCP_ID);
    signal.throwIfAborted();
    if (previous) store.remove(COMPUTER_MCP_ID);
    const record = store.add({ id: COMPUTER_MCP_ID, name: COMPUTER_USE_LABEL, ...driver, manualStart: true, allowedTools: COMPUTER_TOOLS, terminateTree: false });
    // Connect authorizes the displayed native driver. Desktop agents run its native actions directly; explicit blocks still apply.
    store.markApproved(COMPUTER_MCP_ID);
    this.detected = driver;
    try {
      await this.mcp.connect({ ...record, signal, requestTimeoutMs: COMPUTER_REQUEST_TIMEOUT_MS, initTimeoutMs: COMPUTER_REQUEST_TIMEOUT_MS });
      signal.throwIfAborted();
      store.markConnected(COMPUTER_MCP_ID, true);
    } catch (error) {
      await this.mcp.disconnect(COMPUTER_MCP_ID);
      store.setEnabled(COMPUTER_MCP_ID, false); store.markConnected(COMPUTER_MCP_ID, false, error.message);
      throw error;
    }
    return this.overview();
  }
  async check() {
    if (!this.mcp?.has(COMPUTER_MCP_ID)) throw new Error('Connect Computer Use first');
    const result = await this.mcp.callToolResult(`mcp__${COMPUTER_MCP_ID}__${COMPUTER_HEALTH_TOOL}`);
    const text = formatToolResult(result);
    if (result.isError) throw new Error(text);
    return { text };
  }
  async stop() {
    const pending = this.connecting;
    const connected = Boolean(this.mcp?.has?.(COMPUTER_MCP_ID));
    this.controller?.abort();
    if (pending || connected) new McpStore(this.mcpFile).load().setEnabled(COMPUTER_MCP_ID, false);
    if (connected) await this.mcp.disconnect(COMPUTER_MCP_ID);
    await pending?.catch(() => {});
    this.onChange();
    return { stopped: true };
  }
  async close() {
    this.closed = true;
    await this.stop();
  }
}
