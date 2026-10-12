import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCompanionBridge } from '../../services/chatgpt-bridge/server.mjs';
import { RequestOwners } from '../../src/integrations/chatgpt-browser/request-owners.mjs';
import { observeBoundTab, trustedPopup } from '../../desktop/chatgpt-companion/background.mjs';
import { companionManifest } from '../../services/chatgpt-bridge/config.mjs';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-companion-'));
test.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
const secret = 'test-only-pair-key';
const extensionId = 'a'.repeat(32);
const browserId = 'existing-profile';
const conversationId = crypto.randomUUID();
const otherConversation = crypto.randomUUID();
const config = { workspacePath: workspace, threadId: 'proof-thread' };
const secrets = { withSecret: async (_, callback) => callback(secret) };
const snapshot = { accountReady: true, models: [{ id: 'observed-model', label: 'Observed model', available: true }], selectedModel: 'observed-model', requestIds: ['native-owned'] };

async function paired() {
  const bridge = await createCompanionBridge({ config, secrets });
  await bridge.pair({ extensionId, version: 1, browserId });
  await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}`, title: 'Same title' }, { id: 2, url: `https://chatgpt.com/c/${otherConversation}`, title: 'Same title' }, { id: 3, url: 'https://unrelated.invalid/', title: 'Private unrelated tab' }] });
  return bridge;
}

test('two identical tab titles bind only the explicitly selected existing conversation', async () => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 2, conversationId: otherConversation, ...config });
    assert.equal(binding.workspacePath, fs.realpathSync(workspace));
    assert.deepEqual((await bridge.listTabs()).filter(tab => tab.bound).map(tab => tab.id), [2]);
    assert.equal((await bridge.listTabs()).length, 2);
    assert.equal(bridge.view().status, 'observing');
    assert.equal(bridge.view().accountReady, false);
  } finally { await bridge.close(); }
});

test('forged, wrong-tab, stale-nonce and navigated observations cannot authorize ownership', async () => {
  const bridge = await paired();
  try {
    const binding = await bridge.bind({ browserId, tabId: 1, conversationId, ...config });
    const command = await bridge.poll();
    assert.equal(await bridge.observe({ binding: { ...binding, tabId: 2 }, nonce: command.nonce, snapshot }), false);
    assert.equal(await bridge.observe({ binding, nonce: 'forged', snapshot }), false);
    assert.equal(bridge.view().status, 'observing');
    assert.equal(await bridge.observe({ binding, nonce: command.nonce, snapshot: { ...snapshot, conversationId } }), true);
    assert.equal(bridge.view().status, 'ready');
    const next = await bridge.poll();
    assert.equal(await bridge.observe({ binding, nonce: next.nonce, snapshot: { ...snapshot, conversationId, requestIds: ['native-owned', 'new-native-owned'] } }), true);
    const owner = await bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'new-native-owned' });
    assert.equal(owner.tabId, 1);
    await bridge.reportTabs({ browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${otherConversation}` }] });
    await assert.rejects(bridge.resolveRequestOwner({ leaseId: binding.leaseId, requestId: 'native-owned' }), /owner|binding|disconnect/i);
  } finally { await bridge.close(); }
});

test('incompatible pairing and explicit disconnect remain stopped on reconnect', async () => {
  const bridge = await paired();
  try {
    await assert.rejects(bridge.pair({ extensionId, version: 999, browserId }), /version/i);
    await bridge.disconnect();
    await assert.rejects(bridge.pair({ extensionId, version: 1, browserId }), /disconnect/i);
    assert.equal(bridge.view().status, 'disconnected');
  } finally { await bridge.close(); }
});

test('real external HTTP bridge rejects hostile origins and unauthorized page requests', async () => {
  const bridge = await createCompanionBridge({ config, secrets });
  try {
    const body = JSON.stringify({ extensionId, version: 1, browserId });
    assert.equal((await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
    assert.equal((await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, Origin: 'https://chatgpt.com' }, body })).status, 403);
    const response = await fetch(bridge.address + '/pair', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, Origin: `chrome-extension://${extensionId}` }, body });
    assert.equal(response.status, 200);
    assert.equal(JSON.stringify(await response.json()).includes(secret), false);
  } finally { await bridge.close(); }
});

test('exact request join refuses unknown requests, changed lease and conflicting conversation evidence', async () => {
  const owners = new RequestOwners({ timeoutMs: 1 });
  const binding = { leaseId: 'current-lease', tabId: 1, conversationId, epoch: 'current-epoch' };
  owners.bind(binding); owners.observe(binding, ['request-one']);
  assert.equal((await owners.resolve({ leaseId: binding.leaseId, requestId: 'request-one/hop' })).conversationId, conversationId);
  await assert.rejects(owners.resolve({ leaseId: 'old-lease', requestId: 'request-one' }), /owner|lease/i);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'missing' }), /owner/i);
  owners.observe({ ...binding, conversationId: otherConversation }, ['request-one']);
  await assert.rejects(owners.resolve({ leaseId: binding.leaseId, requestId: 'request-one' }), /ambiguous|conflict/i);
});

test('only the actual extension popup can control pairing; web/content-script messages are refused', () => {
  const runtime = { id: extensionId, getURL: file => `chrome-extension://${extensionId}/${file}` };
  const sender = { id: extensionId, url: runtime.getURL('popup.html') };
  assert.equal(trustedPopup(sender, runtime), true);
  assert.equal(trustedPopup({ ...sender, tab: { id: 1 } }, runtime), false);
  assert.equal(trustedPopup({ ...sender, url: `https://chatgpt.com/c/${conversationId}` }, runtime), false);
  const manifest = JSON.parse(fs.readFileSync(new URL('../../desktop/chatgpt-companion/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest, companionManifest);
  assert.equal(manifest.permissions.includes('debugger'), false);
  assert.equal(manifest.permissions.includes('cookies'), false);
  assert.equal(manifest.content_scripts, undefined);
});

test('extension reads exactly the selected tab and discards navigation during the read', async () => {
  const calls = []; let currentUrl = `https://chatgpt.com/c/${conversationId}`;
  const binding = { tabId: 2, conversationId };
  const chromeApi = { tabs: { get: async id => { calls.push(id); return { url: currentUrl }; } }, scripting: { executeScript: async request => {
    calls.push(request.target.tabId);
    if (request.func) { currentUrl = `https://chatgpt.com/c/${otherConversation}`; return [{ result: { privateUnrelatedText: 'must be discarded' } }]; }
    return [];
  } } };
  assert.equal(await observeBoundTab(chromeApi, binding), null);
  assert.deepEqual(calls, [2, 2, 2, 2]);
});
