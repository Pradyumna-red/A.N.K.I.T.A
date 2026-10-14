import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ChromeBrowserAdapter } from '../../tools/browser/chrome.mjs';
import { PlaywrightBrowserAdapter } from '../../tools/browser/playwright.mjs';

test('connected-Chrome task adapter hides the model tab and refuses direct targeting and navigation before native action', async () => {
  const model = 'http://127.0.0.1/model', task = 'http://127.0.0.1/task';
  const calls = [];
  const adapter = new ChromeBrowserAdapter({ has: () => true, callTool: async (name, args) => {
    calls.push({ name, args });
    if (name.endsWith('__list_pages')) return `1: Model (${model}) [selected]\n2: Task (${task})`;
    return 'uid=1_1 button "Task button"';
  } }, { protectedPage: url => url === model });
  assert.deepEqual((await adapter.tabs()).map(tab => tab.id), ['2']);
  const ctx = { config: { allowPrivateHosts: true } };
  await assert.rejects(adapter.run({ action: 'snapshot', tab: '1' }, ctx), /protected|model|unavailable/i);
  await assert.rejects(adapter.run({ action: 'open', url: model }, ctx), /protected|model/i);
  assert.equal(calls.some(call => call.name.endsWith('__take_snapshot') || call.name.endsWith('__new_page')), false);
  await adapter.run({ action: 'snapshot', tab: '2' }, ctx);
  assert.equal(calls.filter(call => call.name.endsWith('__take_snapshot')).length, 1);
});

test('real isolated task browser omits a protected page, refuses its existing refs, and preserves normal task actions', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ankita-protected-browser-'));
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<title>Fixture</title><button>Task button</button>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let protectedUrl = null;
  const adapter = new PlaywrightBrowserAdapter({ profile: path.join(directory, 'profile'), protectedPage: url => url === protectedUrl });
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(directory, { recursive: true, force: true }); });
  const ctx = { config: { allowPrivateHosts: true }, settings: { headless: true } };
  await adapter.run({ action: 'open', url: origin + '/model' }, ctx);
  const modelId = (await adapter.tabs())[0].id;
  protectedUrl = origin + '/model';
  assert.equal((await adapter.tabs()).length, 0);
  await assert.rejects(adapter.run({ action: 'snapshot', tab: modelId }, ctx), /protected|model|unavailable/i);
  await assert.rejects(adapter.run({ action: 'open', url: protectedUrl }, ctx), /protected|model/i);
  await adapter.run({ action: 'open', url: origin + '/task' }, ctx);
  assert.deepEqual((await adapter.tabs()).map(tab => tab.url), [origin + '/task']);
});
