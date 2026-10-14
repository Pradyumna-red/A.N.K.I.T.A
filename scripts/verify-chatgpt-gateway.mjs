import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ToolHost } from '../src/core/tool-host.mjs';
import { McpClient } from '../src/integrations/mcp-client.mjs';
import { createToolGateway } from '../src/integrations/chatgpt-browser/tool-gateway.mjs';
import { MemoryToolReceipts } from '../src/integrations/chatgpt-browser/tool-receipts.mjs';

// Local proof fixture only: never exposes a real profile/workspace or publishes a tunnel.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-native-mcp-proof-'));
const leaseId = randomUUID(); const nativeRequest = randomUUID(); const fileName = 'proof.txt';
const bytes = `Unique ANKITA MCP proof ${randomUUID()}`;
const host = new ToolHost({ context: { cwd: workspace, workspacePath: workspace, config: {}, readOnly: true, allowedTools: new Set(['read_file']) } });
fs.writeFileSync(path.join(workspace, fileName), bytes);
let gateway, client;
try {
  gateway = await createToolGateway({ leaseId, hostForLease: id => { if (id !== leaseId) throw new Error('Wrong lease'); return host; },
    resolveRequestOwner: async ({ requestId }) => { if (requestId !== nativeRequest) throw new Error('Wrong request'); return { leaseId }; }, receipts: new MemoryToolReceipts() });
  client = new McpClient({ transport: 'http', url: gateway.url, headers: { 'x-request-id': nativeRequest } });
  await client.connect();
  const result = await client.callTool('read_file', { path: fileName });
  if (result.isError || result.raw.content[0].text.split('\n')[0] !== `1: ${bytes}`) throw new Error('Native file bytes did not match');
  const denied = await client.callTool('write_file', { path: 'blocked.txt', content: 'never' });
  if (!denied.isError || fs.existsSync(path.join(workspace, 'blocked.txt'))) throw new Error('Proof lease permitted a write');
  console.log(JSON.stringify({ protocol: client.protocolVersion, tools: client.tools.map(tool => tool.name), exactFileBytesMatched: true, writeDenied: true, hostedChatGpt: false }));
} finally {
  await client?.close(); await gateway?.close(); fs.rmSync(workspace, { recursive: true, force: true });
}
