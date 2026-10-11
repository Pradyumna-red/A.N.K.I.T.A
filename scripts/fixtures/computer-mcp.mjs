import readline from 'node:readline';
import { spawn } from 'node:child_process';
const IMAGE = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=' };
const tools = ['get_window_state', 'click', 'install_ffmpeg', 'launch_app'].map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: name === 'get_window_state' } }));
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line); if (message.id === undefined) continue;
  let result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, serverInfo: { name: 'fixture', version: 'test' }, capabilities: { tools: {} } }
    : message.method === 'tools/list' ? { tools }
    : { content: [{ type: 'text', text: 'Observed fixture state' }, IMAGE] };
  if (message.method === 'tools/call' && message.params.name === 'launch_app') {
    const app = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: true }); // Test-only independent app process, no desktop UI or inherited console.
    app.unref(); result = { content: [{ type: 'text', text: 'Fixture app opened' }], structuredContent: { pid: app.pid } };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}
