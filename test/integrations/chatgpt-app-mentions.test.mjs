import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'http://ankita-app-metadata.local'; // Isolated page, never a signed-in account.
const ADAPTER = fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/app-mentions.js', import.meta.url));
const APP = { name: 'ANKITA Core', system_hint: 'plugin:asdk_app_core_fixture' };
async function fixture(t) {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route(ORIGIN + '/**', route => route.request().url().includes('/backend-api/system_hints')
    ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ system_hints: [APP] }) })
    : route.fulfill({ contentType: 'text/html', body: '<div contenteditable="true"></div>' }));
  await page.goto(ORIGIN);
  await page.evaluate(() => { window.originalFetch = window.fetch; });
  await page.addScriptTag({ path: ADAPTER });
  return page;
}
test('reinjection restores passive app observation after ChatGPT replaces fetch, without repeated requests', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { window.fetch = window.originalFetch; });
  await page.addScriptTag({ path: ADAPTER });
  let requests = 0; page.on('request', () => requests++);
  await page.evaluate(() => fetch('/backend-api/system_hints?mode=plugins'));
  await page.waitForFunction(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).ready, null, { timeout: 1000 });
  assert.equal(requests, 1, 'only the page requests metadata; the adapter observes its response');
  assert.deepEqual(await page.evaluate(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).appMentions), [{ name: APP.name, path: 'app://asdk_app_core_fixture' }]);
});
test('a disposed adapter can be installed again and keeps plain message lines intact', async t => {
  const page = await fixture(t);
  await page.evaluate(() => window.AnkitaAppMentions.dispose());
  await page.addScriptTag({ path: ADAPTER });
  await page.evaluate(() => fetch('/backend-api/system_hints?mode=plugins'));
  await page.waitForFunction(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).ready, null, { timeout: 1000 });
  const text = await page.evaluate(() => {
    const box = document.querySelector('div'); box.innerHTML = '<p>first line</p><p>second<br>third</p>';
    return window.AnkitaAppMentions.plainText(box);
  });
  assert.equal(text, 'first line\nsecond\nthird\n');
});
test('composer text ignores rich-preview presentation nodes while preserving literal markup and paragraph breaks', async t => {
  const page = await fixture(t);
  const value = await page.evaluate(() => {
    const box = document.querySelector('div');
    box.innerHTML = '<p>Keep &lt;style&gt; literal</p><style>.preview{display:none}</style><script type="text/plain">not a question</script><noscript>hidden</noscript><template>template words</template><p>second line</p>';
    return { authored: window.AnkitaAppMentions.plainText(box), presentation: window.AnkitaAppMentions.plainText(box.querySelector('style')) };
  });
  assert.deepEqual(value, { authored: 'Keep <style> literal\nsecond line\n', presentation: '' });
});
test('a proven app survives a missing catalogue, while a fresh complete list can revoke its ID', async t => {
  const page = await fixture(t);
  const before = await page.evaluate(() => {
    window.AnkitaAppMentions.remember?.([{ name: 'ANKITA Core', path: 'app://asdk_app_proven' }]);
    return window.AnkitaAppMentions.resolve(['ANKITA Core']);
  });
  assert.equal(before.ready, true);
  assert.equal(before.appMentions[0].path, 'app://asdk_app_proven');
  await page.evaluate(() => fetch('/backend-api/system_hints?mode=plugins'));
  await page.waitForFunction(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).ready === false);
  assert.equal((await page.evaluate(() => window.AnkitaAppMentions.resolve(['ANKITA Core']))).reason, 'app-not-found', 'same name with another ID cannot replace a proven connector');
});
test('fetch-hook refresh retains an app response already in flight through the old wrapper', async t => {
  const page = await fixture(t);
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  await page.route(ORIGIN + '/backend-api/system_hints?mode=plugins', async route => {
    entered(); await held;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ system_hints: [APP] }) });
  });
  await page.evaluate(() => { window.pendingFetch = fetch('/backend-api/system_hints?mode=plugins'); });
  await started;
  await page.evaluate(() => { const delegate = window.fetch; window.fetch = (...args) => delegate(...args); });
  await page.addScriptTag({ path: ADAPTER });
  release(); await page.evaluate(() => window.pendingFetch.then(() => null));
  await page.waitForFunction(() => window.AnkitaAppMentions.resolve(['ANKITA Core']).ready, null, { timeout: 1000 });
});
