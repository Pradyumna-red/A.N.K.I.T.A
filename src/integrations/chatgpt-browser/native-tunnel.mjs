import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { killTree } from '../../../tools/shared/_job-tree.mjs';
import { GATEWAY_HOST, EPHEMERAL_PORT, GATEWAY_PATH, LOCAL_HTTP_PROTOCOL, NATIVE_TOOL_SURFACES, HTTP_STATUS } from './protocol.mjs';
import publisher from '../../../vendor/openai-tunnel/source.json' with { type: 'json' };

export const NATIVE_TUNNEL_ENV = 'ANKITA_TUNNEL_CLIENT'; // Optional owner/development executable override; never supplied by a model tool.
export const NATIVE_TUNNEL_ID_PATTERN = /^tunnel_[a-f0-9]{32}$/i; // Official Secure MCP Tunnel identifier grammar.
export const NATIVE_TUNNEL_SECRET_PREFIX = 'chatgpt-tunnel-'; // SecureStore key name per separately authorized surface.
export const NATIVE_TUNNEL_RESOURCE_DIRECTORY = 'native-tunnel'; // Real packaged resource directory; its parent is supplied by the desktop host.
export function nativeTunnelArtifact({ resourceRoot, environment = process.env, platform = process.platform, arch = process.arch } = {}) {
  const target = platform + '-' + arch, artifact = publisher.targets[target];
  if (!artifact) return null;
  const binary = environment[NATIVE_TUNNEL_ENV]?.trim() || path.join(resourceRoot, target, artifact.filename);
  return { ...artifact, binary, companionBinary: path.join(path.dirname(binary), artifact.companionFilename) };
}
const HEALTH_POLL_MS = 2000; // Milliseconds/read-only native transport status.
const HEALTH_TIMEOUT_MS = 3000; // Milliseconds/one local health request.
const STOP_TIMEOUT_MS = 5000; // Milliseconds/owned helper termination acknowledgement.
const MAX_LOG_BYTES = 64 * 1024; // Bytes/partial helper log; raw records/URLs are never forwarded or saved.
const MAX_BINARY_BYTES = 128 * 1024 * 1024; // Bytes/integrity input; avoids loading an arbitrary owner-selected oversized file.
const MAX_KEY_CHARS = 16 * 1024; // Characters/private restricted key input, before spawning.
const TEMP_PREFIX = 'ankita-native-tunnel-';
const HEALTH_FILE = 'health.url'; // Official helper's discovered loopback health endpoint file.
const ENV_KEYS = new Set(['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'SSL_CERT_FILE', 'SSL_CERT_DIR']); // OS/TLS environment only.
const POLL_METRIC = /^commands_poll_last_successful_timestamp_seconds(?:\{[^}]*\})?\s+([0-9.e+-]+)/m; // Official helper's successful control-plane poll counter.
const HASH_PATTERN = /^[a-f0-9]{64}$/; // Pinned publisher member SHA-256.
const STATUSES = Object.freeze({ setup: 'setup-required', connecting: 'connecting', connected: 'connected', authorization: 'authorization-required', error: 'unavailable', disconnected: 'disconnected' });
function verifyHelper(binary, sha256) {
  const resolved = fs.realpathSync(binary);
  if (!HASH_PATTERN.test(sha256) || fs.statSync(resolved).size > MAX_BINARY_BYTES || createHash('sha256').update(fs.readFileSync(resolved)).digest('hex') !== sha256)
    throw new Error('Native helper checksum mismatch');
  return resolved;
}

/** Lifecycle wrapper for the reviewed official helper. It does not implement a tunnel or inherit CoS credentials. */
export class NativeTunnel {
  constructor({ binary, sha256, companionBinary, companionSha256, surface, tunnelId, endpointUrl, environment = process.env,
    spawnImpl = spawn, stopImpl = killTree, fetchImpl = fetch, onChange = () => {} } = {}) {
    Object.assign(this, { binary, sha256, companionBinary, companionSha256, surface, tunnelId, endpointUrl, environment, spawnImpl, stopImpl, fetchImpl, onChange });
    this.status = STATUSES.setup; this.child = null; this.closed = false; this.buffer = ''; this.timer = null;
  }
  view() { return { surface: this.surface, status: this.status }; } // Credentials, argv, URLs, raw helper logs and health paths never become UI events.
  changed(status) { if (this.status === status) return; this.status = status; this.onChange(this.view()); }
  async start({ apiKey } = {}) {
    if (this.closed || this.child) throw new Error('Native tunnel is already started or closed');
    if (!Object.values(NATIVE_TOOL_SURFACES).includes(this.surface) || !NATIVE_TUNNEL_ID_PATTERN.test(this.tunnelId)) throw new Error('Enter the dedicated native tunnel ID for this surface');
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > MAX_KEY_CHARS) throw new Error('Enter a restricted native tunnel key');
    const endpoint = new URL(this.endpointUrl);
    const segments = endpoint.pathname.split('/');
    if (endpoint.protocol !== LOCAL_HTTP_PROTOCOL || endpoint.hostname !== GATEWAY_HOST || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        segments.length !== 4 || '/' + segments[1] !== GATEWAY_PATH || !segments[2] || segments[3] !== this.surface) throw new Error('Native tools require their owned loopback endpoint');
    const binary = verifyHelper(this.binary, this.sha256);
    verifyHelper(this.companionBinary, this.companionSha256);
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX)); this.healthFile = path.join(this.directory, HEALTH_FILE);
    const env = Object.fromEntries(Object.entries(this.environment).filter(([key]) => ENV_KEYS.has(key.toUpperCase())));
    env.CONTROL_PLANE_API_KEY = apiKey.trim(); env.MCP_SERVER_URL = `url=${endpoint.href},channel=main`;
    const args = ['run', '--control-plane.tunnel-id', this.tunnelId, '--health.listen-addr', `${GATEWAY_HOST}:${EPHEMERAL_PORT}`,
      '--health.url-file', this.healthFile, '--log.format', 'json', '--log.level', 'info'];
    try {
      this.child = this.spawnImpl(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
      if (!Number.isInteger(this.child?.pid) || this.child.pid <= 0) throw new Error('Native helper did not start');
      this.changed(STATUSES.connecting);
      const read = bytes => this.readLog(bytes);
      this.child.stdout.on('data', read); this.child.stderr.on('data', read);
      this.child.once('error', () => this.changed(STATUSES.error));
      this.child.once('exit', () => { clearTimeout(this.timer); this.exited = true; this.changed(this.closed ? STATUSES.disconnected : STATUSES.error); });
      void this.probeHealth().catch(() => {});
      return this.view();
    } finally { apiKey = ''; delete env.CONTROL_PLANE_API_KEY; delete env.MCP_SERVER_URL; }
  }
  readLog(bytes) {
    this.buffer = (this.buffer + bytes.toString()).slice(-MAX_LOG_BYTES);
    const lines = this.buffer.split(/\r?\n/); this.buffer = lines.pop();
    for (const line of lines) {
      try { const record = JSON.parse(line); if ([HTTP_STATUS.unauthorized, HTTP_STATUS.forbidden].includes(Number(record.status_code))) this.changed(STATUSES.authorization); }
      catch { /* Helper records can carry endpoint capabilities; raw output is intentionally discarded. */ }
    }
  }
  async probeHealth() {
    clearTimeout(this.timer);
    if (this.closed || this.exited || !this.child) return false;
    try {
      if (!fs.existsSync(this.healthFile) || this.status === STATUSES.authorization) return false;
      const base = new URL(fs.readFileSync(this.healthFile, 'utf8').trim());
      if (base.protocol !== LOCAL_HTTP_PROTOCOL || base.hostname !== GATEWAY_HOST || !base.port || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Unexpected native health origin');
      const ready = await this.fetchImpl(new URL('/readyz', base), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      const metrics = await this.fetchImpl(new URL('/metrics', base), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      const text = metrics.ok ? (await metrics.text()).slice(0, MAX_LOG_BYTES) : '';
      await ready.arrayBuffer();
      const polled = Number(POLL_METRIC.exec(text)?.[1]) > 0;
      if (!this.closed && !this.exited && this.status !== STATUSES.authorization) this.changed(ready.ok && polled ? STATUSES.connected : STATUSES.connecting);
      return ready.ok && polled;
    } catch { if (!this.closed && this.status !== STATUSES.authorization) this.changed(STATUSES.connecting); return false; }
    finally { if (!this.closed && !this.exited) { this.timer = setTimeout(() => { void this.probeHealth(); }, HEALTH_POLL_MS); this.timer.unref?.(); } }
  }
  close() {
    this.closePromise ??= (async () => {
      this.closed = true; clearTimeout(this.timer);
      if (this.child && !this.exited) {
        const stopped = new Promise(resolve => this.child.once('exit', resolve));
        await this.stopImpl(this.child);
        let timer;
        try { await Promise.race([stopped, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native helper termination was not confirmed')), STOP_TIMEOUT_MS); })]); }
        finally { clearTimeout(timer); }
      }
      if (this.directory && fs.existsSync(this.directory)) {
        const directory = fs.realpathSync(this.directory), temporaryRoot = fs.realpathSync(os.tmpdir());
        if (path.dirname(directory) !== temporaryRoot || !path.basename(directory).startsWith(TEMP_PREFIX)) throw new Error('Native helper temporary directory is not owned');
        fs.rmSync(directory, { recursive: true, force: true });
      }
      this.buffer = ''; this.child = null; this.changed(STATUSES.disconnected);
    })();
    return this.closePromise;
  }
}
