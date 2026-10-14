import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright';

const root = new URL('../../desktop/chatgpt-companion/', import.meta.url);
const files = new Map([
  ['/popup.html', ['popup.html', 'text/html']], ['/popup.css', ['popup.css', 'text/css']],
  ['/popup.mjs', ['popup.mjs', 'text/javascript']], ['/wire.mjs', ['wire.mjs', 'text/javascript']],
]);

test('connected popup explains a blank new chat and enables observation when an existing conversation appears', async () => {
  const server = http.createServer((request, response) => {
    const file = files.get(request.url);
    if (!file) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': file[1] });
    response.end(fs.readFileSync(new URL(file[0], root)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.addInitScript(() => {
      // Chrome messaging is external to this ordinary test page; the real popup DOM/module runs unchanged.
      globalThis.companionFixtureView = { status: 'select-tab', tabs: [] };
      globalThis.chrome = { runtime: { sendMessage: async () => ({ value: globalThis.companionFixtureView }) } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await page.waitForFunction(() => document.getElementById('status').textContent !== 'Setup required');
    assert.match(await page.locator('#status').textContent(), /existing|saved/i);
    assert.equal(await page.locator('#tabs option').count(), 1, 'empty lists need an explanatory option');
    assert.match(await page.locator('#tabs option').textContent(), /conversation/i);
    assert.equal(await page.locator('#tabs').isDisabled(), true);
    assert.equal(await page.locator('#bind').isDisabled(), true);
    await page.evaluate(() => {
      globalThis.companionFixtureView = { status: 'select-tab', tabs: [{ id: 4, title: 'Existing chat', conversationId: 'fixture-conversation', bound: false }] };
    });
    await page.waitForFunction(() => document.getElementById('tabs').value === '4');
    assert.equal(await page.locator('#tabs').isDisabled(), false);
    assert.equal(await page.locator('#bind').isDisabled(), false);
    assert.match(await page.locator('#tabs option').textContent(), /Existing chat/);
    await page.evaluate(() => {
      globalThis.companionFixtureView.status = 'page-unavailable';
      globalThis.companionFixtureView.observationReason = 'composer-unavailable';
    });
    await page.waitForFunction(() => document.getElementById('status').textContent !== 'select-tab');
    assert.match(await page.locator('#status').textContent(), /chat editor/i);
    assert.doesNotMatch(await page.locator('#status').textContent(), /logged.out/i);
    await page.evaluate(() => {
      globalThis.companionFixtureView.status = 'ready';
      globalThis.companionFixtureView.modelMode = 'current';
      globalThis.companionFixtureView.selectedModel = null;
      globalThis.companionFixtureView.observationReason = 'model-picker-unavailable';
    });
    await page.waitForFunction(() => !document.getElementById('status').textContent.includes('chat editor'));
    assert.match(await page.locator('#status').textContent(), /current.*model/i);
    assert.doesNotMatch(await page.locator('#status').textContent(), /Open.*menu/i);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
