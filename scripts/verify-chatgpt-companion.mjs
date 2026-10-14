import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startCompanionProof } from '../services/chatgpt-bridge/main.mjs';
import { McpClient } from '../src/integrations/mcp-client.mjs';
import { COMPANION_VERSION, ROUTES } from '../services/chatgpt-bridge/config.mjs';

// Local protocol fixture, not a browser/account proof. Fake identities never become production defaults.
const proof = await startCompanionProof();
const extensionId = 'a'.repeat(32), browserId = randomUUID(), conversationId = randomUUID(), requestId = randomUUID();
const key = new URL(proof.pairingUrl).hash.slice(1);
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, Origin: `chrome-extension://${extensionId}` };
const post = async (route, input) => {
  const response = await fetch(proof.bridge.address + route, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!response.ok) throw new Error(`Fixture HTTP failure ${response.status}`);
  return response.json();
};
let client;
try {
  const unauthorized = await fetch(proof.bridge.address + ROUTES.pair, { method: 'POST', body: '{}' });
  if (unauthorized.status !== 401) throw new Error('Unpaired requests were permitted');
  await post(ROUTES.pair, { extensionId, browserId, version: COMPANION_VERSION });
  await post(ROUTES.tabs, { browserId, tabs: [{ id: 1, url: `https://chatgpt.com/c/${conversationId}`, title: 'Fixture conversation' }] });
  const binding = await post(ROUTES.bind, { browserId, tabId: 1, conversationId });
  const observe = async requestIds => {
    const response = await fetch(proof.bridge.address + ROUTES.poll, { headers });
    const command = await response.json();
    await post(ROUTES.observe, { binding, nonce: command.nonce, snapshot: { conversationId, accountReady: true,
      selectedModel: 'fixture-model', models: [{ id: 'fixture-model', label: 'Fixture', available: true }], requestIds } });
  };
  await observe([]);
  await observe([requestId]);
  const gateway = proof.gateway();
  if (!gateway) throw new Error('Read-only gateway did not start after scoped observation');
  client = new McpClient({ transport: 'http', url: gateway.url, headers: { 'x-request-id': requestId } });
  await client.connect();
  const result = await client.callTool('read_file', { path: proof.proofFile });
  const bytes = fs.readFileSync(path.join(proof.workspacePath, proof.proofFile), 'utf8');
  if (result.isError || result.raw.content[0].text.split('\n')[0] !== `1: ${bytes}`) throw new Error('Scoped bridge/gateway file read did not match');
  await post(ROUTES.disconnect, {});
  const stale = await fetch(gateway.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'x-request-id': requestId },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'after-disconnect', method: 'tools/call', params: { name: 'read_file', arguments: { path: proof.proofFile } } }) });
  if (stale.status !== 403) throw new Error('Disconnected binding still authorized a tool');
  console.log(JSON.stringify({ realHttpPairing: true, selectedFixtureTab: true, attributedLocalReadMatched: true, disconnectRefusedTools: true, browserRelaunches: 0, hostedChatGpt: false }));
} finally { await client?.close(); await proof.close(); }
