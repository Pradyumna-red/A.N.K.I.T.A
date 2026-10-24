import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NativeTunnel } from '../../src/integrations/chatgpt-browser/native-tunnel.mjs';

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-tunnel-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'fixture-helper'); fs.writeFileSync(binary, 'fixture helper bytes');
  const sha256 = createHash('sha256').update(fs.readFileSync(binary)).digest('hex');
  const companionBinary = path.join(directory, 'fixture-forwarder'); fs.writeFileSync(companionBinary, 'fixture forwarder bytes');
  const companionSha256 = createHash('sha256').update(fs.readFileSync(companionBinary)).digest('hex');
  const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const events = []; let spawned;
  const tunnel = new NativeTunnel({ binary, sha256, companionBinary, companionSha256, surface: 'core', tunnelId: 'tunnel_' + 'a'.repeat(32),
    endpointUrl: 'http://127.0.0.1:12345/mcp/test-capability/core', environment: { PATH: process.env.PATH ?? '', UNRELATED_API_KEY: 'must-not-inherit' },
    onChange: state => events.push(state), spawnImpl: (command, args, settings) => { spawned = { command, args, settings: { ...settings, env: { ...settings.env } } }; return child; },
    stopImpl: async owned => { assert.equal(owned, child); owned.emit('exit', 0); }, ...options });
  t.after(() => tunnel.close());
  return { tunnel, child, events, companionBinary, spawn: () => spawned };
}

test('development resource preflight accepts complete pinned files and rejects missing or modified helpers', async t => {
  const api = await import('../../src/integrations/chatgpt-browser/native-tunnel.mjs');
  assert.equal(typeof api.nativeTunnelResourcesReady, 'function');
  const { tunnel, companionBinary } = fixture(t);
  assert.equal(api.nativeTunnelResourcesReady(tunnel), true);
  fs.writeFileSync(companionBinary, 'changed bytes');
  assert.equal(api.nativeTunnelResourcesReady(tunnel), false);
  fs.unlinkSync(companionBinary);
  assert.equal(api.nativeTunnelResourcesReady(tunnel), false);
  assert.equal(api.nativeTunnelResourcesReady(null), false);
});

test('native helper starts only after checksum validation with private credentials in its limited child environment', async t => {
  const { tunnel, spawn, child, events } = fixture(t);
  await tunnel.start({ apiKey: 'fixture-private-key' });
  assert.ok(spawn()); assert.equal(spawn().settings.windowsHide, true);
  assert.equal(spawn().settings.env.CONTROL_PLANE_API_KEY, 'fixture-private-key');
  assert.match(spawn().settings.env.MCP_SERVER_URL, /channel=main/);
  assert.equal(spawn().settings.env.UNRELATED_API_KEY, undefined);
  assert.equal(JSON.stringify(spawn().args).includes('fixture-private-key'), false);
  child.stdout.write(JSON.stringify({ status_code: 401, secret: 'fixture-private-key', privateUrl: 'secret-capability' }) + '\n');
  assert.equal(JSON.stringify(events).includes('fixture-private-key'), false);
  assert.equal(JSON.stringify(events).includes('secret-capability'), false);
  assert.equal(tunnel.view().status, 'authorization-required');
});

test('wrong helper bytes and a non-owned endpoint start no helper', async t => {
  const bad = fixture(t, { sha256: 'b'.repeat(64) });
  await assert.rejects(bad.tunnel.start({ apiKey: 'private' }), /checksum/i); assert.equal(bad.spawn(), undefined);
  const foreign = fixture(t, { endpointUrl: 'https://unowned.invalid/mcp/cap/core' });
  await assert.rejects(foreign.tunnel.start({ apiKey: 'private' }), /loopback|endpoint/i); assert.equal(foreign.spawn(), undefined);
});

test('the bundled forwarding helper is checksum-checked before any credential-bearing process starts', async t => {
  const { tunnel, companionBinary, spawn } = fixture(t);
  fs.writeFileSync(companionBinary, 'changed forwarding helper');
  await assert.rejects(tunnel.start({ apiKey: 'private' }), /checksum/i);
  assert.equal(spawn(), undefined);
});

test('native readiness needs the local helper and a successful OpenAI poll, with no raw metrics in status', async t => {
  let polled = false;
  const { tunnel } = fixture(t, { fetchImpl: async url => new Response(url.pathname === '/metrics'
    ? 'commands_poll_last_successful_timestamp_seconds ' + (polled ? '1' : '0') + '\nprivate_metric secret-capability' : '', { status: 200 }) });
  await tunnel.start({ apiKey: 'private' });
  fs.writeFileSync(tunnel.healthFile, 'http://127.0.0.1:12346');
  await tunnel.probeHealth(); assert.equal(tunnel.view().status, 'connecting');
  polled = true; await tunnel.probeHealth(); assert.equal(tunnel.view().status, 'connected');
  assert.equal(JSON.stringify(tunnel.view()).includes('secret-capability'), false);
});
