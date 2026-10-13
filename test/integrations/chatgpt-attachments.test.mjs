import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { attachmentPayload } from '../../desktop/electron/engine.mjs';
import { prepareBrowserUploads, validateBrowserUploads, uploadReceipt } from '../../src/integrations/chatgpt-browser/attachments.mjs';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';

test('browser upload conversion reuses desktop attachment bounds, MIME, extraction and secret scrubbing', () => {
  const normalized = attachmentPayload([{ name: 'report.pdf', kind: 'document', data: Buffer.from('secret fixture').toString('base64') }]);
  const files = prepareBrowserUploads(normalized, { transform: text => text.replace('secret', '[redacted]') });
  assert.equal(files[0].name, 'report.pdf.txt'); assert.equal(files[0].mimeType, 'text/plain');
  assert.equal(Buffer.from(files[0].data, 'base64').toString(), '[redacted] fixture');
  assert.deepEqual(validateBrowserUploads(files), files);
  assert.throws(() => validateBrowserUploads([{ ...files[0], sha256: 'changed' }]), /upload|hash/i);
  assert.throws(() => prepareBrowserUploads([...normalized, ...normalized]), /duplicate|unique/i);
  assert.throws(() => attachmentPayload([{ name: 'large.txt', data: Buffer.alloc(200001, 'a').toString('base64') }]), /larger/);
  assert.equal(uploadReceipt(files, []), false);
});

test('actual native composer upload needs exact new tiles and readiness before the one Send', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  for (const mode of ['accepted', 'substring', 'extra', 'human-existing']) {
    const page = await browser.newPage(); t.after(() => page.close());
    const origin = 'http://ankita-attachment-fixture.local', conversationId = crypto.randomUUID();
    await page.route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body: '<form><div id="prompt-textarea" contenteditable="true"></div><input type="file" multiple><button type="button" data-testid="send-button">Send</button><div data-composer-attachments></div></form>' }));
    await page.goto(origin + '/c/' + conversationId);
    for (const file of ['readers.js', 'delivery.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/' + file, import.meta.url)) });
    await page.evaluate(mode => {
      window.sends = 0; window.uploads = 0; window.uploadedText = '';
      const tile = name => { const button = document.createElement('button'); button.type = 'button'; button.setAttribute('aria-label', 'Remove file: ' + name); document.querySelector('[data-composer-attachments]').append(button); };
      if (mode === 'human-existing') tile('notes.txt');
      document.querySelector('input').onchange = async event => {
        window.uploads++; window.uploadedText = await event.target.files[0].text();
        tile(mode === 'substring' ? 'prefix-notes.txt-extra' : event.target.files[0].name);
        if (mode === 'extra') tile('human-extra.txt');
      };
      document.querySelector('[data-testid="send-button"]').onclick = () => window.sends++;
    }, mode);
    const attachments = prepareBrowserUploads(attachmentPayload([{ name: 'notes.txt', data: Buffer.from('unique attachment bytes').toString('base64') }]));
    const operation = { id: crypto.randomUUID(), text: 'Read my attachment', attachments,
      scope: { leaseId: crypto.randomUUID(), epoch: crypto.randomUUID(), tabId: 1, conversationId } };
    const config = { ...browserWire, chatgptOrigin: origin, uploadReadyMs: 50 };
    const prepared = await page.evaluate(({ operation, config }) => window[config.deliveryGlobal].prepare(operation, config), { operation, config });
    assert.equal(prepared.ready, mode === 'accepted', mode);
    if (mode === 'accepted') {
      assert.equal(uploadReceipt(attachments, prepared.attachments), true);
      assert.equal(await page.evaluate(() => window.uploadedText), 'unique attachment bytes');
      const sent = await page.evaluate(({ operation, config }) => window[config.deliveryGlobal].send(operation, config), { operation, config });
      assert.equal(sent.dispatched, true);
      await page.evaluate(({ operation, config }) => window[config.deliveryGlobal].send(operation, config), { operation, config });
      assert.equal(await page.evaluate(() => window.sends), 1);
    } else assert.equal(await page.evaluate(() => window.sends), 0);
    assert.equal(await page.evaluate(() => window.uploads), mode === 'human-existing' ? 0 : 1);
  }
});

test('visible quota notice blocks the composer while quoted user text does not establish a provider limit', async t => {
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage(), origin = 'http://ankita-quota-fixture.local', conversationId = crypto.randomUUID();
  await page.route(origin + '/**', route => route.fulfill({ contentType: 'text/html', body: '<form><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button">Send</button></form><div class="markdown"><div role="alert">You have reached your usage limit.</div></div>' }));
  await page.goto(origin + '/c/' + conversationId);
  for (const file of ['readers.js', 'delivery.js']) await page.addScriptTag({ path: fileURLToPath(new URL('../../desktop/chatgpt-companion/upstream/' + file, import.meta.url)) });
  const config = { ...browserWire, chatgptOrigin: origin }, scope = { leaseId: 'quota-lease', epoch: 'quota-epoch', tabId: 1, conversationId };
  assert.equal(await page.evaluate(({ config, scope }) => window[config.deliveryGlobal].blocked(scope, config), { config, scope }), null);
  await page.evaluate(() => { const alert = document.createElement('div'); alert.role = 'alert'; alert.textContent = 'You have reached your usage limit.'; document.querySelector('form').append(alert); });
  assert.equal(await page.evaluate(({ config, scope }) => window[config.deliveryGlobal].blocked(scope, config), { config, scope }), 'quota');
  const prepared = await page.evaluate(({ config, scope }) => window[config.deliveryGlobal].prepare({ id: 'quota-operation', scope, text: 'must not send' }, config), { config, scope });
  assert.equal(prepared.ready, false); assert.equal(prepared.reason, 'quota');
  assert.equal(await page.locator('#prompt-textarea').innerText(), '');
});
