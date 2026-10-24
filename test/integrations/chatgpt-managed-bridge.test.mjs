import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';

test('an owned browser uses internal admission without an HTTP listener or extension identity', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-owned-bridge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const browserId = crypto.randomUUID(), conversationId = crypto.randomUUID();
  const bridge = await createCompanionBridge({ config: { workspacePath: directory, threadId: 'owner', modelMode: 'current' },
    managedBrowserId: browserId, secrets: { withSecret: async () => { throw new Error('Internal browser must not read a pairing secret'); } } });
  t.after(() => bridge.close());
  assert.equal(bridge.address, null, 'owned browser must not listen for external pair requests');
  assert.equal(bridge.view().status, 'select-tab');
  await assert.rejects(bridge.pair({ version: 1, browserId, extensionId: 'a'.repeat(32) }), /owned|internal/i);
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}` }] });
  const binding = await bridge.bind({ browserId, tabId: 1, conversationId, threadId: 'owner', workspacePath: directory });
  const poll = await bridge.poll();
  assert.equal(await bridge.observe({ binding, nonce: poll.nonce, snapshot: { conversationId, accountReady: true, models: [], requestIds: [] } }), true);
  assert.equal(bridge.view().status, 'ready');
  bridge.requestShow();
  assert.equal((await bridge.poll()).showTabId, binding.tabId);
  assert.equal((await bridge.poll()).showTabId, undefined, 'one Show click does not repeatedly steal focus');
});

test('automatic Chrome setup provisions only an explicitly opened host for compatible extension origins', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-auto-bridge-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const key = crypto.randomUUID(), browserId = crypto.randomUUID(), extensionId = 'b'.repeat(32);
  const bridge = await createCompanionBridge({ config: { workspacePath: directory, threadId: 'owner', autoConnect: true, discoveryPorts: [0] },
    secrets: { withSecret: async (_, use) => use(key) } });
  t.after(() => bridge.close());
  const origin = `chrome-extension://${extensionId}`, headers = { Origin: origin, 'Content-Type': 'application/json' };
  const hello = await fetch(bridge.address + '/hello', { headers });
  assert.equal(hello.status, 200);
  const greeting = await hello.json(); assert.equal(greeting.app, 'ankita');
  const pair = input => fetch(bridge.address + '/provision', { method: 'POST', headers, body: JSON.stringify({ hostId: greeting.hostId, ...input }) });
  assert.equal((await pair({ extensionId, browserId, version: -1 })).status, 409);
  const denied = await fetch(bridge.address + '/provision', { method: 'POST', headers: { ...headers, Origin: 'https://chatgpt.com' }, body: JSON.stringify({ extensionId, browserId, version: 1 }) });
  assert.equal(denied.status, 403);
  const response = await pair({ extensionId, browserId, version: 1 });
  assert.equal(response.status, 200); assert.equal((await response.json()).key, key);
  assert.equal((await pair({ extensionId, browserId: 'another-browser', version: 1 })).status, 409);
  await bridge.disconnect();
  assert.equal((await pair({ extensionId, browserId, version: 1 })).status, 409, 'Disconnect cannot be undone by stale provisioning');
});

test('the companion discovers and provisions one real local host without a pasted link', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-discovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const module = await import('../../desktop/chatgpt-companion/discovery.mjs').catch(() => ({}));
  assert.equal(typeof module.discoverCompanion, 'function', 'the companion must discover the explicitly opened ANKITA host');
  const key = crypto.randomUUID();
  const create = () => createCompanionBridge({ config: { workspacePath: directory, threadId: 'owner', autoConnect: true, discoveryPorts: [0] },
    secrets: { withSecret: async (_, use) => use(key) } });
  const first = await create(); t.after(() => first.close());
  const options = { ports: [Number(new URL(first.address).port)], browserId: 'browser', extensionId: 'c'.repeat(32) };
  const connection = await module.discoverCompanion(options);
  assert.equal(connection.address, first.address); assert.equal(connection.key, key);
  const second = await create(); t.after(() => second.close());
  await assert.rejects(module.discoverCompanion({ ...options, ports: [...options.ports, Number(new URL(second.address).port)] }), /more than one|multiple/i);
  assert.equal((await module.discoverCompanion({ ...options, preferredAddress: first.address,
    preferredHostId: connection.hostId,
    ports: [...options.ports, Number(new URL(second.address).port)] })).address, first.address);
  await assert.rejects(module.discoverCompanion({ ...options, preferredAddress: first.address, preferredHostId: crypto.randomUUID(),
    ports: [...options.ports, Number(new URL(second.address).port)] }), /more than one|multiple/i, 'a recycled port is not proof of the remembered app profile');
});
