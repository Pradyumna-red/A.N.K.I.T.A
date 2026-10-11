import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';
import { McpManager } from '../src/integrations/mcp-manager.mjs';
import { McpStore } from '../src/integrations/mcp-store.mjs';
import { DesktopComputerUse } from '../desktop/electron/computer-use.mjs';
import { COMPUTER_USE_ACTIONS } from '../desktop/shared/computer-use.mjs';
import { COMPUTER_CURSOR_TOOLS, COMPUTER_MCP_ID } from '../src/integrations/computer-use.mjs';

const HOST = '127.0.0.1'; // Loopback only; the temporary UI harness is never exposed to other machines.
const PANEL_PATH = '/computer-use'; // Test-only page, rendering the shipped component.
const INVOKE_PATH = '/invoke/'; // Test-only Electron IPC bridge to the real main-process controller.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-computer-panel-'));
const manager = new McpManager();
const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json') });
const actions = {
  [COMPUTER_USE_ACTIONS.overview]: () => service.overview(), [COMPUTER_USE_ACTIONS.connect]: args => service.connect(args),
  [COMPUTER_USE_ACTIONS.check]: () => service.check(), [COMPUTER_USE_ACTIONS.stop]: () => service.stop(),
  [COMPUTER_USE_ACTIONS.pointer]: args => service.setPointer(args),
};
const renderer = fileURLToPath(new URL('../desktop/renderer/', import.meta.url));
const vite = await createViteServer({ configFile: false, root: renderer, server: { middlewareMode: true, hmr: false, fs: { allow: [path.dirname(path.dirname(renderer))] } }, appType: 'custom' });
const server = http.createServer(async (req, res) => {
  if (req.url.startsWith(INVOKE_PATH)) {
    const action = actions[req.url.slice(INVOKE_PATH.length)];
    if (!action || req.method !== 'POST') { res.statusCode = 404; res.end(); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    try { res.end(JSON.stringify({ value: await action(body ? JSON.parse(body) : undefined) })); }
    catch (cause) { res.end(JSON.stringify({ error: cause.message })); }
    return;
  }
  if (req.url !== PANEL_PATH) { vite.middlewares(req, res); return; }
  const html = `<!doctype html><html><body><div id="root" class="plugins-page"></div><script type="module">
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { ComputerUseSection } from '/src/components/ComputerUseSection.tsx';
    import '/src/styles.css'; import '/src/workbench.css';
    window.ankita = { onEvent: () => () => {}, openExternal: async () => {},
      invoke: async (action, args) => { const response = await fetch(${JSON.stringify(INVOKE_PATH)} + action, { method: 'POST', body: JSON.stringify(args) });
        const result = await response.json(); if (result.error) throw new Error(result.error); return result.value; } };
    createRoot(document.getElementById('root')).render(React.createElement(ComputerUseSection));
  </script></body></html>`;
  try { res.setHeader('content-type', 'text/html'); res.end(await vite.transformIndexHtml(PANEL_PATH, html)); }
  catch (cause) { res.statusCode = 500; res.end(cause.message); }
});
let browser;
try {
  await new Promise(resolve => server.listen(0, HOST, resolve));
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://${HOST}:${server.address().port}${PANEL_PATH}`);
  const connect = page.getByRole('button', { name: 'Connect Computer Use', exact: true });
  await connect.waitFor({ state: 'visible' }); assert.equal(await connect.isEnabled(), true);
  await connect.click(); await page.getByRole('status').filter({ hasText: 'Connected. Ask ANKITA' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Connected', exact: true }).isDisabled(), true);
  const pointer = page.getByRole('checkbox', { name: 'Show pointer' });
  assert.equal(await pointer.isChecked(), true);
  let client = manager.servers.get(COMPUTER_MCP_ID).client;
  const cursorState = async () => (await client.callTool(COMPUTER_CURSOR_TOOLS.state, { session: service.pointerSession })).raw.structuredContent;
  assert.equal((await cursorState()).enabled, true);
  await pointer.uncheck(); await page.getByRole('status').filter({ hasText: 'Pointer hidden.' }).waitFor();
  assert.equal((await cursorState()).enabled, false);
  assert.equal((await service.overview()).connected, true);
  const previousClient = client;
  const previousSession = service.pointerSession;
  const saved = new McpStore(service.mcpFile).load().find(COMPUTER_MCP_ID);
  await manager.disconnect(COMPUTER_MCP_ID); await manager.connect(saved);
  client = manager.servers.get(COMPUTER_MCP_ID).client;
  assert.notEqual(client, previousClient); assert.notEqual(service.pointerSession, previousSession);
  assert.equal((await cursorState()).enabled, false);
  await pointer.check(); await page.getByRole('status').filter({ hasText: 'Pointer shown' }).waitFor();
  assert.equal((await cursorState()).enabled, true);
  let ended;
  const callTool = client.callTool.bind(client);
  client.callTool = async (...args) => { const result = await callTool(...args); if (args[0] === COMPUTER_CURSOR_TOOLS.end) ended = result; return result; };
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Connection checked.' }).waitFor();
  await page.getByRole('button', { name: 'Stop Computer Use', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Computer Use stopped.' }).waitFor();
  assert.equal(await connect.isEnabled(), true); assert.deepEqual(errors, []);
  assert.equal((await service.overview()).connected, false);
  assert.equal(ended?.isError, false);
  assert.equal(ended.raw.structuredContent.active, false);
  console.log(JSON.stringify({ ok: true, realController: true, connect: true, pointerDefaultOn: true, pointerHideShow: true, pointerReloadHidden: true, pointerSessionEnded: true, health: true, stop: true, pageErrors: errors.length }));
} finally {
  await browser?.close(); await service.close(); await manager.closeAll(); await vite.close();
  server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve));
  assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(os.tmpdir()));
  fs.rmSync(directory, { recursive: true, force: true });
}
