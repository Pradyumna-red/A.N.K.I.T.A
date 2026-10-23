// Runs the production App with disposable IPC fixtures. No user configuration is read.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import electronPath from 'electron';
import { chromium, _electron } from 'playwright';
import { createServer } from 'vite';
import { IPC_CONTRACT } from '../desktop/shared/version.mjs';
import { CHATGPT_BROWSER_PROVIDER } from '../desktop/shared/chatgpt-browser.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const READY_MS = 15_000; // Milliseconds; local renderer startup and interactive UI responses.
const NATIVE_READY_MS = 30_000; // Milliseconds; production engine and native preload startup.
const NATIVE_MODE = process.argv.includes('--native'); // Opt-in runs real Electron after desktop:build.
const LOOPBACK_HOST = '127.0.0.1'; // Test-only provider binds to the local computer.
const NATIVE_COPY_PATHS = ['desktop/electron', 'desktop/shared', 'desktop/browser-helper', 'desktop/renderer/dist', 'desktop/build', 'src', 'tools', 'skills', 'services/chatgpt-bridge', 'vendor/openai-tunnel/source.json', 'package.json']; // Complete production import graph, copied unchanged to prevent checkout .env discovery.
const EVIDENCE_PREFIX = 'ankita-desktop-slash-'; // Disposable OS temp directory, retained for review.
const VIEWPORT = { width: 1366, height: 768 }; // Pixels; normal desktop verification size.
const COMPACT_VIEWPORTS = [{ width: 640, height: 720 }, { width: 900, height: 540 }]; // Pixels; narrow and short windows.
const THEMES = ['graphite', 'mono', 'slate']; // Supported desktop appearance IDs under test.
const PIXEL_TOLERANCE = 1; // Pixels; permits fractional layout rounding at viewport edges.
const COMPACT_MENU_HEIGHT_PX = 320; // CSS pixels; the requested compact command surface ceiling.
const MESSAGE_LABEL = 'Message Chief'; // Accessible UI contract for the fixture teammate.
const COMMAND_LIST_LABEL = 'Commands'; // Accessible UI contract for the slash listbox.
const ROOT_COMMANDS = ['/model', '/project', '/skill', '/settings', '/clear', '/export', '/schedule', '/review', '/plugins', '/browser', '/new', '/commands'];
const FIXTURE = {
  threadId: 'chief', name: 'Chief', color: '#baa47d',
  models: [{ id: 'fixture-fast', name: 'Fixture Fast' }, { id: 'fixture-reasoning', name: 'Fixture Reasoning' }],
  project: { id: 'fixture-project', name: 'Slash project', path: '/fixture/slash-workspace', summary: 'Disposable command selection context', todos: [], notes: [], decisions: [], conventions: [], archived: false },
  skill: { id: 'skill:fixture-research', source: 'skill', skill: 'fixture-research', title: 'fixture-research', hint: 'Research the disposable verification fixture' },
  skillFailure: 'Fixture skill lookup unavailable',
  attachment: { name: 'slash-context.txt', text: 'Disposable attachment context' },
  ordinaryDraft: 'Keep this ordinary message',
  unmatchedCommand: '/fixture-no-such-command-xyz',
}; // Test-only labels and data; never persisted into the user's runtime.

const evidence = await fs.mkdtemp(path.join(os.tmpdir(), EVIDENCE_PREFIX));
const version = JSON.parse(await fs.readFile(path.join(REPO, 'package.json'), 'utf8')).version;
let server;
const checks = [];
const layouts = [];
let browser;
let page;
const errors = [];
async function check(name, run) {
  await run();
  checks.push(name);
  console.log('PASS ' + name);
}

async function settleMotion(target) {
  await target.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(animation => animation.effect.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
}

async function captureLayout(target, file) {
  await settleMotion(target);
  const layout = await target.evaluate(() => {
    const menu = document.querySelector('.slash-menu');
    const list = menu.querySelector('[role="listbox"]');
    const bounds = menu.getBoundingClientRect();
    const listBounds = list.getBoundingClientRect();
    const pane = document.querySelector('.chat-pane').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, pane: { top: pane.top, bottom: pane.bottom }, menu: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, height: bounds.height }, list: { top: listBounds.top, bottom: listBounds.bottom, height: listBounds.height, scrollHeight: list.scrollHeight, overflowY: getComputedStyle(list).overflowY, scrollbarWidth: getComputedStyle(list).scrollbarWidth } };
  });
  await target.screenshot({ path: path.join(evidence, file) });
  layouts.push({ file, ...layout });
  await fs.writeFile(path.join(evidence, 'layouts.json'), JSON.stringify(layouts, null, 2));
  assert.ok(layout.scrollWidth <= layout.width + PIXEL_TOLERANCE, 'slash menu must not cause page overflow: ' + JSON.stringify(layout));
  assert.ok(layout.menu.left >= -PIXEL_TOLERANCE && layout.menu.right <= layout.width + PIXEL_TOLERANCE, 'slash menu must fit the window width: ' + JSON.stringify(layout));
  assert.ok(layout.menu.top >= -PIXEL_TOLERANCE && layout.menu.bottom <= layout.height + PIXEL_TOLERANCE, 'slash menu must fit the window height: ' + JSON.stringify(layout));
  assert.ok(layout.menu.top >= layout.pane.top - PIXEL_TOLERANCE && layout.menu.bottom <= layout.pane.bottom + PIXEL_TOLERANCE, 'slash menu must fit inside the clipping chat pane: ' + JSON.stringify(layout));
  assert.ok(layout.list.height > 0, 'the command list must remain usable: ' + JSON.stringify(layout));
  assert.ok(layout.menu.height <= COMPACT_MENU_HEIGHT_PX + PIXEL_TOLERANCE, 'command suggestions must stay compact');
  assert.equal(layout.list.scrollbarWidth, 'none', 'hide the scrollbar while keeping commands scrollable');
  if (layout.list.scrollHeight > layout.list.height + PIXEL_TOLERANCE) assert.ok(['auto', 'scroll'].includes(layout.list.overflowY), 'overflowing commands must scroll inside the list');
  return layout;
}

async function installFixture(target) {
  await target.addInitScript(({ contract, version, fixture }) => {
    const teammates = [{ id: fixture.threadId, name: fixture.name, color: fixture.color, persona: 'A disposable slash-menu verification teammate.', lastMessage: '', projectId: null }];
    const projects = [fixture.project];
    const models = fixture.models;
    const preferences = { provider: 'custom', model: models[0].id, appearance: 'graphite', customApiBase: '', profileSetupDone: true, username: 'Fixture', timeZone: 'UTC', contextWindow: 0, maxTokens: 0 };
    const settings = { provider: preferences.provider, model: preferences.model, tools: [], username: preferences.username };
    const listeners = new Set();
    window.__slashCalls = [];
    window.__slashPreferences = preferences;
    window.__slashSettings = settings;
    window.__slashModels = models;
    window.__slashSkills = { mode: 'ready' };
    window.__slashEmit = event => listeners.forEach(listener => listener(event));
    window.ankita = {
      onEvent: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      onMenuCommand: () => () => {}, onUpdateEvent: () => () => {},
      openExternal: async () => {}, windowAction: async () => {},
      invoke: async (action, payload) => {
        window.__slashCalls.push({ action, payload });
        if (action === 'initialize') return { teammates, models, settings, preferences, chrome: 'custom', contract, version, jobs: [] };
        if (action === 'listProjects') return structuredClone(projects);
        if (action === 'listTeammates') return structuredClone(teammates);
        if (action === 'loadThread') return [];
        if (action === 'setModel') {
          teammates.find(teammate => teammate.id === payload.id).model = payload.modelId;
          window.__slashEmit({ type: 'teammates-changed' });
          return {};
        }
        if (action === 'assignProject') { teammates.find(teammate => teammate.id === payload.id).projectId = payload.projectId; return {}; }
        if (action === 'palette:query') {
          if (window.__slashSkills.mode === 'deferred') await new Promise(resolve => { window.__slashSkills.resolve = resolve; });
          if (window.__slashSkills.mode === 'error') throw new Error(fixture.skillFailure);
          return [fixture.skill];
        }
        if (action === 'skills:list') return [];
        if (action === 'listSkills') return [{ name: fixture.skill.skill, description: fixture.skill.hint, enabled: true, body: 'Keep the disposable fixture request editable.' }];
        if (action === 'getStartupProfile') return '';
        if (action === 'saveDesktopSettings') { Object.assign(preferences, payload); return { preferences: { ...preferences }, settings, models }; }
        if (action === 'workspaceSnapshot') return { cwd: fixture.project.path, files: [], artifacts: [], jobs: [] };
        if (action === 'secureStoreList') return { records: [] };
        if (action === 'pluginsOverview') return { mode: 'unavailable', services: {}, live: false };
        if (action === 'browserPluginsOverview') return { isolated: { mode: 'isolated', enabled: false, installed: false, ready: false, allowedSites: [], blockedSites: [] }, local: { mode: 'local', enabled: false, installed: false, ready: false, allowedSites: [], blockedSites: [] } };
        if (action === 'scheduleHostSettings') return { supported: false, startAtLogin: false };
        if (action === 'companionCaptureInbox') return [];
        return {};
      },
    };
  }, { contract: IPC_CONTRACT, version, fixture: FIXTURE });
}

async function verifyNative() {
  const config = path.join(evidence, 'config');
  const runtime = path.join(evidence, 'runtime');
  const appData = path.join(evidence, 'app-data');
  const providerCalls = [];
  const nativeOutput = [];
  let app;
  let nativePage;
  const provider = http.createServer(async (request, response) => {
    if (request.url.endsWith('/models')) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: FIXTURE.models.map(model => ({ ...model, tools: true })) }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    providerCalls.push({ route: request.url, body });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'Unexpected slash send reached the fixture provider.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  });
  console.log('Native slash evidence: ' + evidence);
  try {
    await fs.access(path.join(REPO, 'desktop/renderer/dist/index.html'));
    for (const relative of NATIVE_COPY_PATHS) await fs.cp(path.join(REPO, relative), path.join(runtime, relative), { recursive: true });
    await fs.symlink(path.join(REPO, 'node_modules'), path.join(runtime, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    await fs.mkdir(config);
    await fs.mkdir(appData);
    const skillDirectory = path.join(runtime, 'skills', FIXTURE.skill.skill);
    await fs.mkdir(skillDirectory, { recursive: true });
    await fs.writeFile(path.join(skillDirectory, 'SKILL.md'), `---\nname: ${FIXTURE.skill.skill}\ndescription: ${FIXTURE.skill.hint}\n---\nKeep this disposable fixture request editable until the user sends it.\n`);
    await new Promise(resolve => provider.listen(0, LOOPBACK_HOST, resolve));
    const apiBase = `http://${LOOPBACK_HOST}:${provider.address().port}/v1`;
    await fs.writeFile(path.join(config, 'config.env'), `PROVIDER=custom\nAPI_BASE=${apiBase}\nMODEL=${FIXTURE.models[0].id}\nAUTO_APPROVE=off\nTOOLS=on\nMEMORY_CONSOLIDATION=off\n`);
    await fs.writeFile(path.join(config, 'desktop-settings.json'), JSON.stringify({ version: 1, settings: { provider: 'custom', customApiBase: apiBase, model: FIXTURE.models[0].id, profileSetupDone: true, username: 'Fixture', timeZone: 'UTC' } }));
    const entry = path.join(evidence, 'entry.mjs');
    await fs.writeFile(entry, "import { app } from 'electron';\napp.setPath('userData', process.env.ANKITA_SLASH_DATA);\napp.setVersion(process.env.ANKITA_SLASH_VERSION);\napp.whenReady().then(() => import(process.env.ANKITA_SLASH_MAIN)).catch(error => { console.error(error.stack); app.exit(1); });\n");
    const nativeEnv = { ...process.env, CONFIG_DIR: config, ANKITA_SLASH_DATA: appData, ANKITA_SLASH_VERSION: version, ANKITA_SLASH_MAIN: pathToFileURL(path.join(runtime, 'desktop/electron/main.mjs')).href, ANKITA_DESKTOP_DEV_URL: '' };
    delete nativeEnv.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: electronPath, args: [entry], cwd: evidence, timeout: NATIVE_READY_MS, env: nativeEnv });
    app.process().stdout?.on('data', chunk => nativeOutput.push(String(chunk)));
    app.process().stderr?.on('data', chunk => nativeOutput.push(String(chunk)));
    nativePage = await app.firstWindow();
    nativePage.setDefaultTimeout(NATIVE_READY_MS);
    nativePage.on('pageerror', error => errors.push(error.message));
    const input = nativePage.getByLabel(MESSAGE_LABEL, { exact: true });
    await input.waitFor();
    const menu = nativePage.locator('.slash-menu');
    const open = async text => { await input.fill(''); await input.fill(text); await menu.waitFor(); };
    await check('native typing slash opens the built production menu', async () => {
      await open('/');
      await nativePage.getByRole('listbox', { name: COMMAND_LIST_LABEL, exact: true }).waitFor();
      await captureLayout(nativePage, 'native-slash.png');
    });
    await check('native model selection persists through preload and DesktopEngine', async () => {
      await open('/model ');
      await menu.getByRole('option').filter({ hasText: FIXTURE.models[1].name }).click();
      await nativePage.waitForFunction(async ({ id, modelId }) => (await window.ankita.invoke('listTeammates')).find(item => item.id === id)?.model === modelId, { id: FIXTURE.threadId, modelId: FIXTURE.models[1].id });
      const persisted = JSON.parse(await fs.readFile(path.join(config, 'desktop-teammates.json'), 'utf8'));
      assert.equal(persisted.teammates.find(item => item.id === FIXTURE.threadId).model, FIXTURE.models[1].id);
    });
    await check('native project chooser persists production project assignment', async () => {
      const project = await nativePage.evaluate(({ name, summary, path }) => window.ankita.invoke('createProject', { name, summary, path }), { name: FIXTURE.project.name, summary: FIXTURE.project.summary, path: evidence });
      await open('/project Slash');
      await menu.getByRole('option').filter({ hasText: FIXTURE.project.name }).click();
      await nativePage.waitForFunction(async ({ id, projectId }) => (await window.ankita.invoke('listTeammates')).find(item => item.id === id)?.projectId === projectId, { id: FIXTURE.threadId, projectId: project.id });
      const persisted = JSON.parse(await fs.readFile(path.join(config, 'desktop-teammates.json'), 'utf8'));
      assert.equal(persisted.teammates.find(item => item.id === FIXTURE.threadId).projectId, project.id);
    });
    await check('native installed-skill lookup prepares a draft with its attachment', async () => {
      await nativePage.locator('.composer-shell input[type="file"]').setInputFiles({ name: FIXTURE.attachment.name, mimeType: 'text/plain', buffer: Buffer.from(FIXTURE.attachment.text) });
      await nativePage.getByRole('button', { name: 'Remove ' + FIXTURE.attachment.name, exact: true }).waitFor();
      await open('/skill ' + FIXTURE.skill.skill);
      await menu.getByRole('option').filter({ hasText: FIXTURE.skill.title }).waitFor();
      await input.press('Tab');
      assert.equal(await input.inputValue(), `Use the ${FIXTURE.skill.skill} skill. `);
      await nativePage.getByRole('button', { name: 'Remove ' + FIXTURE.attachment.name, exact: true }).waitFor();
      await nativePage.screenshot({ path: path.join(evidence, 'native-skill-draft.png') });
    });
    await check('native settings and clear confirmation perform no provider requests', async () => {
      await open('/settings');
      await input.press('Enter');
      await nativePage.getByRole('button', { name: 'Close settings', exact: true }).click();
      await open('/clear');
      await input.press('Enter');
      await nativePage.getByRole('dialog', { name: 'Clear this conversation?', exact: true }).waitFor();
      await nativePage.screenshot({ path: path.join(evidence, 'native-clear-confirm.png') });
      await nativePage.getByRole('button', { name: 'Cancel', exact: true }).click();
      assert.equal(providerCalls.length, 0);
      assert.deepEqual(errors, []);
    });
    await fs.writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ checks, errors, providerRequests: providerCalls.length }, null, 2));
    console.log(`Native slash checks: ${checks.length}/${checks.length}; provider requests: ${providerCalls.length}; renderer errors: ${errors.length}`);
  } catch (error) {
    await nativePage?.screenshot({ path: path.join(evidence, 'native-failure.png'), fullPage: true }).catch(() => {});
    await fs.writeFile(path.join(evidence, 'failure.txt'), String(error.stack || error) + '\n');
    console.error(`Native slash checks: ${checks.length} passed before failure; provider requests: ${providerCalls.length}; evidence: ${evidence}`);
    console.error(nativeOutput.join(''));
    throw error;
  } finally {
    await fs.writeFile(path.join(evidence, 'native-output.log'), nativeOutput.join(''));
    if (app) {
      const deadline = setTimeout(() => app.process().kill(), NATIVE_READY_MS);
      await app.evaluate(({ app }) => app.exit()).catch(() => {});
      await app.close().catch(() => {});
      clearTimeout(deadline);
    }
    provider.closeAllConnections();
    if (provider.listening) await new Promise(resolve => provider.close(resolve));
  }
}

if (NATIVE_MODE) await verifyNative();
else try {
  console.log('Slash evidence: ' + evidence);
  server = await createServer({ configFile: path.join(REPO, 'desktop/vite.config.ts'), server: { port: 0, strictPort: false } });
  await server.listen();
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: VIEWPORT, reducedMotion: 'reduce' });
  page.setDefaultTimeout(READY_MS);
  page.on('pageerror', error => errors.push(error.message));
  await installFixture(page);
  await page.goto(server.resolvedUrls.local[0]);
  const input = page.getByLabel(MESSAGE_LABEL, { exact: true });
  await input.waitFor();
  await input.fill('/');
  await page.screenshot({ path: path.join(evidence, 'initial-slash.png') });
  await check('typing slash opens the command listbox', async () => {
    assert.equal(await page.locator('.slash-menu').count(), 1, 'typing slash must display .slash-menu');
    await page.getByRole('listbox', { name: COMMAND_LIST_LABEL, exact: true }).waitFor();
  });
  await check('root menu lists every discoverable command', async () => {
    for (const command of ROOT_COMMANDS) assert.ok((await page.locator('.slash-menu').getByRole('option').allTextContents()).some(text => text.includes(command)), command + ' must be discoverable');
  });
  const menu = page.locator('.slash-menu');
  const options = menu.getByRole('option');
  const calls = action => page.evaluate(action => window.__slashCalls.filter(call => call.action === action), action);
  const open = async text => { await input.fill(''); await input.fill(text); await menu.waitFor(); };
  const choose = async command => { await open(command); await menu.getByRole('option').filter({ hasText: command }).first().click(); };

  await check('arrow keys move selection while keeping the textarea focused', async () => {
    const before = await menu.locator('[role="option"][aria-selected="true"]').getAttribute('id');
    await input.press('ArrowDown');
    const next = await menu.locator('[role="option"][aria-selected="true"]').getAttribute('id');
    assert.notEqual(next, before);
    await input.press('ArrowUp');
    assert.equal(await menu.locator('[role="option"][aria-selected="true"]').getAttribute('id'), before);
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
  });
  await check('IME composition Enter never runs a command or sends a message', async () => {
    const before = await input.inputValue();
    for (const composing of [{ key: 'Enter', isComposing: true }, { key: 'Enter', isComposing: false, keyCode: 229 }]) {
      await input.dispatchEvent('keydown', composing);
      assert.equal(await input.inputValue(), before);
      await menu.waitFor();
    }
    assert.equal((await calls('send')).length, 0);
  });
  await check('Escape dismisses the menu and preserves the typed command', async () => {
    await input.press('Escape');
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), '/');
  });
  await check('deleting a dismissed slash and typing it again reopens commands', async () => {
    await input.fill('');
    await input.fill('/');
    await menu.waitFor();
    await input.press('Escape');
    await menu.waitFor({ state: 'hidden' });
  });
  await check('Browse commands restores an existing ordinary draft on Escape', async () => {
    await input.fill(FIXTURE.ordinaryDraft);
    await page.getByRole('button', { name: 'Browse commands', exact: true }).click();
    await menu.waitFor();
    await input.press('Escape');
    assert.equal(await input.inputValue(), FIXTURE.ordinaryDraft);
    await menu.waitFor({ state: 'hidden' });
  });
  await check('choosing a model from Browse commands restores the existing draft', async () => {
    await page.getByRole('button', { name: 'Browse commands', exact: true }).click();
    await input.fill('/model ');
    await options.filter({ hasText: FIXTURE.models[0].name }).click();
    assert.equal(await input.inputValue(), FIXTURE.ordinaryDraft);
    assert.equal((await calls('send')).length, 0);
  });
  await check('replacing a toolbar command preserves the new ordinary draft across navigation', async () => {
    await page.getByRole('button', { name: 'Browse commands', exact: true }).click();
    await menu.waitFor();
    const updated = FIXTURE.ordinaryDraft + ' updated';
    await input.fill(updated);
    await page.getByRole('button', { name: 'Plugins', exact: true }).click();
    await page.getByRole('heading', { name: 'Connected apps', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    assert.equal(await input.inputValue(), updated);
    await input.fill(FIXTURE.ordinaryDraft);
  });
  await check('outside dismissal restores the draft and leaves focus on the clicked control', async () => {
    await page.getByRole('button', { name: 'Browse commands', exact: true }).click();
    await menu.waitFor();
    const target = page.getByRole('button', { name: 'Conversation options', exact: true });
    await target.click();
    await menu.waitFor({ state: 'hidden' });
    assert.equal(await input.inputValue(), FIXTURE.ordinaryDraft);
    assert.equal(await target.evaluate(element => element === document.activeElement), true);
    await target.click();
  });
  await check('Enter with no matching command keeps the draft and never sends', async () => {
    await open(FIXTURE.unmatchedCommand);
    await menu.getByText('No matches yet', { exact: true }).waitFor();
    assert.equal(await options.count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Choose command', exact: true }).isDisabled(), true);
    await input.press('Enter');
    assert.equal(await input.inputValue(), FIXTURE.unmatchedCommand);
    assert.equal((await calls('send')).length, 0);
    await input.press('Escape');
  });
  await check('Browse commands opens the discoverable root menu', async () => {
    await input.fill('');
    await page.getByRole('button', { name: 'Browse commands', exact: true }).click();
    await page.getByRole('listbox', { name: COMMAND_LIST_LABEL, exact: true }).waitFor();
    assert.ok(await options.count() >= ROOT_COMMANDS.length);
  });
  await check('composer action chooses the highlighted command instead of sending it', async () => {
    await open('/model');
    await page.getByRole('button', { name: 'Choose command', exact: true }).click();
    for (const model of FIXTURE.models) await options.filter({ hasText: model.name }).waitFor();
    assert.equal((await calls('send')).length, 0);
  });
  await check('filtered Enter opens model choices without sending', async () => {
    await open('/model');
    await input.press('Enter');
    for (const model of FIXTURE.models) await options.filter({ hasText: model.name }).waitFor();
    assert.equal((await calls('send')).length, 0);
  });
  await check('model click reaches the existing setModel IPC', async () => {
    await options.filter({ hasText: FIXTURE.models[1].name }).click();
    await page.waitForFunction(modelId => window.__slashCalls.some(call => call.action === 'setModel' && call.payload.modelId === modelId), FIXTURE.models[1].id);
    assert.deepEqual((await calls('setModel')).at(-1).payload, { id: FIXTURE.threadId, modelId: FIXTURE.models[1].id });
    await menu.waitFor({ state: 'hidden' });
  });
  await check('typed model search and Tab select the matching runtime model', async () => {
    await open('/model Fast');
    await options.filter({ hasText: FIXTURE.models[0].name }).waitFor();
    assert.equal(await options.count(), 1);
    await input.press('Tab');
    await page.waitForFunction(modelId => window.__slashCalls.filter(call => call.action === 'setModel').at(-1)?.payload.modelId === modelId, FIXTURE.models[0].id);
    await menu.waitFor({ state: 'hidden' });
  });
  await check('ChatGPT browser provider explains model choice and never offers fictitious switching', async () => {
    const setProvider = provider => page.evaluate(provider => {
      window.__slashPreferences.provider = provider;
      window.__slashSettings.provider = provider;
      window.__slashEmit({ type: 'settings-updated', preferences: { ...window.__slashPreferences }, settings: { ...window.__slashSettings }, models: window.__slashModels });
    }, provider);
    await setProvider(CHATGPT_BROWSER_PROVIDER);
    await open('/model ');
    await menu.getByText('Change the model in your selected ChatGPT conversation. ANKITA follows that chat’s model.', { exact: true }).waitFor();
    assert.equal(await options.count(), 0);
    const before = (await calls('setModel')).length;
    await input.press('Enter');
    assert.equal((await calls('setModel')).length, before);
    assert.equal((await calls('send')).length, 0);
    await page.screenshot({ path: path.join(evidence, 'chatgpt-model-guidance.png') });
    await input.press('Escape');
    await setProvider('custom');
  });
  await check('project search and selection reach assignProject IPC', async () => {
    await open('/project Slash');
    await options.filter({ hasText: FIXTURE.project.name }).click();
    await page.waitForFunction(projectId => window.__slashCalls.some(call => call.action === 'assignProject' && call.payload.projectId === projectId), FIXTURE.project.id);
    assert.deepEqual((await calls('assignProject')).at(-1).payload, { id: FIXTURE.threadId, projectId: FIXTURE.project.id });
  });
  await check('skills show a loading state while the installed catalog is pending', async () => {
    await page.evaluate(() => { window.__slashSkills = { mode: 'deferred' }; });
    await open('/skill ');
    await menu.getByRole('status').getByText(/loading installed skills/i).waitFor();
    assert.equal((await calls('send')).length, 0);
    await page.waitForFunction(() => typeof window.__slashSkills.resolve === 'function');
    await page.evaluate(() => { window.__slashSkills.mode = 'ready'; window.__slashSkills.resolve(); });
    await options.filter({ hasText: FIXTURE.skill.title }).waitFor();
  });
  await check('skill selection prepares an editable draft and preserves its attachment', async () => {
    await page.locator('.composer-shell input[type="file"]').setInputFiles({ name: FIXTURE.attachment.name, mimeType: 'text/plain', buffer: Buffer.from(FIXTURE.attachment.text) });
    await page.getByRole('button', { name: 'Remove ' + FIXTURE.attachment.name, exact: true }).waitFor();
    await input.press('Tab');
    assert.equal(await input.inputValue(), `Use the ${FIXTURE.skill.skill} skill. `);
    await page.getByRole('button', { name: 'Remove ' + FIXTURE.attachment.name, exact: true }).waitFor();
    assert.equal((await calls('send')).length, 0);
  });
  await check('skill lookup errors show an explicit retry and recover', async () => {
    await page.evaluate(() => { window.__slashSkills = { mode: 'error' }; });
    await open('/skill research');
    await menu.getByRole('status').getByText('Skills could not load. Your commands still work.', { exact: true }).waitFor();
    assert.equal(await menu.getByRole('button', { name: /retry/i }).getAttribute('title'), FIXTURE.skillFailure);
    await page.screenshot({ path: path.join(evidence, 'skills-error.png') });
    await page.evaluate(() => { window.__slashSkills.mode = 'ready'; });
    await menu.getByRole('button', { name: /retry/i }).click();
    await options.filter({ hasText: FIXTURE.skill.title }).waitFor();
    await input.press('Escape');
    assert.equal(await input.inputValue(), '/skill research');
  });
  await check('settings Enter opens the existing dialog without a model request', async () => {
    await open('/settings');
    await input.press('Enter');
    await page.getByRole('button', { name: 'Close settings', exact: true }).waitFor();
    assert.equal((await calls('send')).length, 0);
    await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  });
  await check('clear uses the existing confirmation and cancellation keeps the thread', async () => {
    await choose('/clear');
    await page.getByRole('dialog', { name: 'Clear this conversation?', exact: true }).waitFor();
    assert.equal((await calls('clearThread')).length, 0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await calls('clearThread')).length, 0);
    await choose('/clear');
    await page.getByRole('button', { name: 'Clear conversation', exact: true }).click();
    await page.waitForFunction(() => window.__slashCalls.some(call => call.action === 'clearThread'));
    assert.deepEqual((await calls('clearThread')).at(-1).payload, { id: FIXTURE.threadId });
  });
  await check('export routes to the existing protected transcript IPC', async () => {
    await choose('/export');
    await page.waitForFunction(() => window.__slashCalls.some(call => call.action === 'exportChat'));
    assert.deepEqual((await calls('exportChat')).at(-1).payload, { id: FIXTURE.threadId });
  });
  await check('schedule and review commands open their existing workspace panels', async () => {
    await choose('/schedule');
    await page.getByRole('button', { name: 'Close scheduled tasks', exact: true }).click();
    await choose('/review');
    await page.getByRole('button', { name: 'Close work review', exact: true }).click();
  });
  await check('plugin and browser commands open connected-app management', async () => {
    await choose('/plugins');
    await page.getByRole('heading', { name: 'Connected apps', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
    await choose('/browser');
    await page.locator('.browser-plugins-section').waitFor();
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  });
  await check('manage skills opens the installed Skills section directly', async () => {
    await choose('/skills');
    await page.getByLabel('Search installed skills', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'View ' + FIXTURE.skill.skill + ' skill', exact: true }).waitFor();
    assert.equal(await page.getByRole('navigation', { name: 'Plugin sections', exact: true }).getByRole('button', { name: 'Skills', exact: true }).getAttribute('aria-current'), 'page');
    assert.ok((await calls('listSkills')).length > 0);
    await page.getByRole('button', { name: 'Conversations', exact: true }).click();
  });
  await check('new teammate and command browser route through existing desktop actions', async () => {
    await choose('/new');
    await page.getByRole('dialog', { name: 'A new teammate', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await choose('/commands');
    await page.getByRole('listbox', { name: COMMAND_LIST_LABEL, exact: true }).waitFor();
    assert.equal(await input.inputValue(), '/');
    await input.press('Escape');
  });
  await check('all slash interactions so far leave the provider idle', async () => {
    assert.equal((await calls('send')).length, 0);
    assert.equal((await calls('palette:run')).length, 0, 'preparing a skill draft must not execute a palette action');
  });
  await check('ordinary Shift+Enter and Enter keep normal sending and attachment behavior', async () => {
    await input.fill(FIXTURE.ordinaryDraft);
    await input.press('End');
    await input.press('Shift+Enter');
    await input.pressSequentially('Second line');
    assert.equal(await input.inputValue(), FIXTURE.ordinaryDraft + '\nSecond line');
    assert.equal(await menu.count(), 0);
    assert.equal((await calls('send')).length, 0);
    await input.press('Enter');
    await page.waitForFunction(() => window.__slashCalls.some(call => call.action === 'send'));
    const sent = (await calls('send')).at(-1).payload;
    assert.equal(sent.text, FIXTURE.ordinaryDraft + '\nSecond line');
    assert.deepEqual(sent.attachments, [{ name: FIXTURE.attachment.name, data: Buffer.from(FIXTURE.attachment.text).toString('base64'), kind: undefined }]);
  });
  await check('all themes and normal, compact and low-height menus fit the viewport', async () => {
    for (const theme of THEMES) {
      await page.getByRole('button', { name: 'Open settings', exact: true }).click();
      await page.getByRole('button', { name: 'Appearance', exact: true }).click();
      await page.locator('.settings-theme-card').filter({ has: page.getByText(new RegExp('^' + theme + '$', 'i')) }).click();
      await page.getByRole('button', { name: 'Apply appearance', exact: true }).click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.getByRole('button', { name: 'Close settings', exact: true }).click();
      for (const viewport of [VIEWPORT, ...COMPACT_VIEWPORTS]) {
        await page.setViewportSize(viewport);
        await open('/');
        await captureLayout(page, `slash-${theme}-${viewport.width}x${viewport.height}.png`);
        await input.press('Escape');
      }
    }
  });
  assert.deepEqual(errors, [], 'the production renderer must not throw');
  await fs.writeFile(path.join(evidence, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
  console.log(`Slash checks: ${checks.length}/${checks.length}; renderer errors: ${errors.length}`);
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  await fs.writeFile(path.join(evidence, 'failure.txt'), String(error.stack || error) + '\n');
  console.error(`Slash checks: ${checks.length} passed before failure; evidence: ${evidence}`);
  throw error;
} finally {
  await browser?.close();
  await server?.close();
}
