import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Agent } from '../src/core/agent.mjs';
import { DesktopComputerUse } from '../desktop/electron/computer-use.mjs';
import { McpManager } from '../src/integrations/mcp-manager.mjs';
import { COMPUTER_MCP_ID, COMPUTER_DIRECT_CONFIG, COMPUTER_CURSOR_TOOLS } from '../src/integrations/computer-use.mjs';
import { computerOverlayWindow } from './lib/computer-menu-evidence.mjs';

const MENU_SETTLE_MS = 160; // Milliseconds; two native overlay z-order ticks before independent readback.
const DIAGNOSTIC_TIMEOUT_MS = 10_000; // Milliseconds; bounded read-only native window enumeration.
const POEM = 'The morning wakes in quiet light,\r\nA little hope makes shadows bright.\r\n'; // Test-only document content.
const DEFAULT_APP = 'Notepad'; // This live Windows regression targets the user's reported application.
const runFile = promisify(execFile);
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-menu-check-'));
const file = path.join(directory, `menu-${randomUUID()}.txt`);
fs.writeFileSync(file, '');
const manager = new McpManager();
const service = new DesktopComputerUse({ mcp: manager, mcpFile: path.join(directory, 'mcp.json') });
let approvals = 0;
const agent = Object.create(Agent.prototype);
Object.assign(agent, { mcp: manager, config: { [COMPUTER_DIRECT_CONFIG]: true }, client: {}, messages: [], confirm: () => { approvals++; return false; } });
const call = async (name, args = {}) => {
  const result = await agent.runMcpToolCall({ id: name, function: { name: `mcp__${COMPUTER_MCP_ID}__${name}`, arguments: JSON.stringify(args) } });
  assert.doesNotMatch(result, /^Error|denied permission/i);
  return result;
};
const observe = async (name, args = {}) => {
  const result = await manager.callToolResult(`mcp__${COMPUTER_MCP_ID}__${name}`, { ...args, session: service.pointerSession });
  assert.equal(result.isError, false, result.text);
  return result.raw.structuredContent;
};
const layers = async (pid, driverPid) => {
  const { stdout } = await runFile('powershell', ['-NoProfile', '-File', fileURLToPath(new URL('./fixtures/computer-window-layers.ps1', import.meta.url)), '-TargetProcessId', String(pid), '-DriverProcessId', String(driverPid)], { windowsHide: true, timeout: DIAGNOSTIC_TIMEOUT_MS });
  return JSON.parse(stdout.trim());
};
try {
  await service.connect(option('--driver') ? { command: option('--driver') } : undefined);
  const driverPid = manager.servers.get(COMPUTER_MCP_ID).client.child.pid;
  assert.ok(Number.isInteger(driverPid) && driverPid > 0, 'layer evidence must identify the actual launched driver');
  const application = option('--app');
  await call('launch_app', { ...(application ? { path: application } : { name: DEFAULT_APP }), additional_arguments: [file] });
  const windows = await observe('list_windows');
  const targetWindow = windows.windows.find(window => window.title.includes(path.basename(file, '.txt')));
  assert.ok(targetWindow, 'the new unique test document must be observed before any input');
  const target = { pid: targetWindow.pid, window_id: targetWindow.window_id };
  const state = () => observe('get_window_state', { ...target, include_screenshot: false });
  await call('bring_to_front', target);
  let snapshot = await state();
  const editor = snapshot.elements.find(element => element.role === 'Edit' && element.label === 'Text Editor');
  assert.ok(editor && !editor.value, 'only the owned blank document receives the poem');
  await call('click', { ...target, element_token: editor.element_token, delivery_mode: 'foreground' });
  snapshot = await state();
  const focused = snapshot.elements.find(element => element.role === 'Edit' && element.label === editor.label);
  await call('type_text', { ...target, element_token: focused.element_token, text: POEM, delivery_mode: 'foreground' });
  snapshot = await state();
  assert.equal(snapshot.elements.find(element => element.label === editor.label).value.replace(/\r\n/g, '\n'), POEM.replace(/\r\n/g, '\n'));
  const menu = snapshot.elements.find(element => element.role === 'MenuItem' && element.label === 'File');
  assert.ok(menu);
  await call('click', { ...target, element_token: menu.element_token, delivery_mode: 'foreground' });
  snapshot = await state();
  assert.ok(snapshot.elements.some(element => element.role === 'MenuItem' && /^Save\t/.test(element.label)), 'File must actually open');
  await delay(MENU_SETTLE_MS);
  const opened = await layers(target.pid, driverPid);
  const popup = opened.windows.find(window => window.root_owner === target.window_id && window.window_id !== target.window_id && window.topmost);
  const overlay = computerOverlayWindow(opened.windows, driverPid);
  assert.ok(popup && overlay, 'independent native enumeration must find the titleless owned menu and real overlay');
  console.log(JSON.stringify({ phase: 'menu-open', popup, overlay, foreground: opened.foreground }));
  assert.ok(overlay.z < popup.z, 'the arrow must paint above the owned dropdown');
  assert.equal(opened.foreground, target.window_id, 'layer maintenance must preserve application focus');
  const save = snapshot.elements.find(element => element.role === 'MenuItem' && /^Save\t/.test(element.label));
  await call('click', { ...target, element_token: save.element_token, delivery_mode: 'foreground' });
  snapshot = await state();
  assert.equal(fs.readFileSync(file, 'utf8'), POEM, 'disk readback independently confirms the saved poem');
  await delay(MENU_SETTLE_MS);
  const dismissed = await layers(target.pid, driverPid);
  const settledOverlay = computerOverlayWindow(dismissed.windows, driverPid);
  assert.ok(settledOverlay && !settledOverlay.topmost, 'the overlay must leave the topmost band after dismissal');
  const cursor = await service.cursorCall(COMPUTER_CURSOR_TOOLS.state, { session: service.pointerSession });
  assert.equal(cursor.enabled, true);
  await service.stop();
  assert.equal(approvals, 0);
  console.log(JSON.stringify({ ok: true, ownedPopupLayering: true, returnedToNormalBand: true, poemSaved: true, approvals, cursorFrame: cursor.visual_state.frame, file, stop: !manager.has(COMPUTER_MCP_ID) }));
} finally { await service.close(); await manager.closeAll(); }
