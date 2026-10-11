import readline from 'node:readline';
import { spawn } from 'node:child_process';
const IMAGE = { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB9sAAAAASUVORK5CYII=' };
const CURSOR_TOOLS = ['start_session', 'end_session', 'set_agent_cursor_enabled', 'get_agent_cursor_state']; // Test-only cursor protocol boundary.
const tools = ['get_window_state', 'click', 'install_ffmpeg', 'launch_app', ...CURSOR_TOOLS].map(name => ({ name, description: name, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: name === 'get_window_state' } }));
let session = `fixture-${process.pid}`, enabled = false, active = false;
const BLOCK_POINTER_ENABLE = 'ANKITA_TEST_BLOCK_POINTER_ENABLE'; // Test-only dropped reply for cancellation while cursor setup is pending.
const DELAY_POINTER_END = 'ANKITA_TEST_DELAY_POINTER_END'; // Test-only slow cursor cleanup so overlapping Stop requests are observable.
const POINTER_END_DELAY_MS = 100; // Milliseconds; long enough for a second Stop without slowing the normal fixture.
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line); if (message.id === undefined) continue;
  let result = message.method === 'initialize' ? { protocolVersion: message.params.protocolVersion, serverInfo: { name: 'fixture', version: 'test' }, capabilities: { tools: {} } }
    : message.method === 'tools/list' ? { tools }
    : { content: [{ type: 'text', text: 'Observed fixture state' }, IMAGE] };
  if (message.method === 'tools/call' && message.params.name === 'launch_app') {
    const app = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true, detached: true }); // Test-only independent app process, no desktop UI or inherited console.
    app.unref(); result = { content: [{ type: 'text', text: 'Fixture app opened' }], structuredContent: { pid: app.pid } };
  }
  if (message.method === 'tools/call' && CURSOR_TOOLS.includes(message.params.name)) {
    const args = message.params.arguments;
    if (message.params.name === 'set_agent_cursor_enabled' && process.env[BLOCK_POINTER_ENABLE]) continue;
    if (message.params.name === 'start_session') { session = args.session || session; active = true; }
    if (message.params.name === 'set_agent_cursor_enabled') enabled = args.enabled;
    if (message.params.name === 'end_session') {
      if (process.env[DELAY_POINTER_END]) await new Promise(resolve => setTimeout(resolve, POINTER_END_DELAY_MS));
      active = false; enabled = false;
    }
    result = { content: [], structuredContent: { session, active, enabled } };
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}
