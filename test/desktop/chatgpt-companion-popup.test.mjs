import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'playwright';

const root = new URL('../../desktop/chatgpt-companion/', import.meta.url);
const files = new Map([
  ['/popup.html', ['popup.html', 'text/html']], ['/popup.css', ['popup.css', 'text/css']],
  ['/popup.mjs', ['popup.mjs', 'text/javascript']], ['/wire.mjs', ['wire.mjs', 'text/javascript']],
  ['/sign-in.mjs', ['sign-in.mjs', 'text/javascript']],
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
      globalThis.companionFixtureView = { status: 'pairing-required', tabs: [] };
      globalThis.signInCalls = [];
      globalThis.chrome = { permissions: { request: async value => { globalThis.signInCalls.push({ permission: value }); return true; } }, runtime: { sendMessage: async message => {
        if (message.type === 'sign-in-transfer') { globalThis.signInCalls.push({ message }); globalThis.companionFixtureView.signInOffer = null; return { value: { imported: true } }; }
        return { value: globalThis.companionFixtureView };
      } } };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
    await page.waitForFunction(() => document.getElementById('status').textContent !== 'Setup required');
    assert.match(await page.locator('#status').textContent(), /Settings.*Providers.*My Chrome.*Use my Chrome/i);
    assert.equal(await page.locator('#tabs').isVisible(),false,'connection setup should not show a dead conversation picker');
    assert.equal(await page.locator('#disconnect').isVisible(),false,'there is nothing to disconnect before setup');
    assert.equal(await page.locator('#tabs').isDisabled(),true);
    await page.evaluate(()=>{globalThis.companionFixtureView={status:'select-tab',tabs:[]};});
    await page.waitForFunction(()=>document.getElementById('status').textContent.includes('saved ChatGPT'));
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
    await page.waitForFunction(() => document.getElementById('status').textContent.includes('chat editor'));
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
    assert.equal(await page.locator('#sign-in-transfer').isVisible(), false);
    await page.evaluate(() => { globalThis.companionFixtureView.signInOffer = { id: 'fixture-offer' };globalThis.companionFixtureView.tabs=[]; });
    await page.locator('#sign-in-transfer').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#sign-in-transfer').isDisabled(),true,'sign-in transfer needs a selected source tab');
    await page.evaluate(()=>{globalThis.companionFixtureView.tabs=[{id:4,title:'Signed-in ChatGPT',signInTab:true,bound:false}];});
    await page.waitForFunction(()=>!document.getElementById('sign-in-transfer').disabled);
    assert.equal(await page.locator('#bind').isVisible(),false,'a sign-in-only connection cannot bind a conversation');
    await page.locator('#sign-in-transfer').waitFor({ state: 'visible' });
    await page.locator('#sign-in-transfer').click();
    await page.locator('#sign-in-transfer').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => globalThis.signInCalls), [
      { permission: { permissions: ['cookies'] } }, { message: { type: 'sign-in-transfer', id: 'fixture-offer', tabId: 4 } },
    ], 'the popup requests permission first and sends no cookie values');
    await page.evaluate(()=>{
      globalThis.companionFixtureView.signInOffer={id:'denied-offer'};
      chrome.permissions.request=async()=>false;
    });
    await page.locator('#sign-in-transfer').waitFor({state:'visible'});
    await page.locator('#sign-in-transfer').click();
    await page.locator('#notice').filter({hasText:/did not allow/}).waitFor();
    assert.equal(await page.evaluate(()=>globalThis.signInCalls.filter(call=>call.message).length),1,'denied cookie permission never starts sign-in transfer');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test('popup explains an unreachable app, recovers on demand and preserves a chosen conversation across refresh',async t=>{
  const server=http.createServer((request,response)=>{
    const file=files.get(request.url);
    if(!file){response.writeHead(404);response.end();return;}
    response.writeHead(200,{'Content-Type':file[1]});response.end(fs.readFileSync(new URL(file[0],root)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  t.after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const page=await browser.newPage({viewport:{width:360,height:600}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.popupCalls=[];window.statusReads=0;window.offline=true;
    window.popupView={status:'ready',modelMode:'current',selectedModel:null,tabs:[
      {id:4,title:'Current research chat',conversationId:'private-id-four',bound:true},
      {id:5,title:'My other saved chat',conversationId:'private-id-five',bound:false},
    ]};
    window.chrome={runtime:{sendMessage:async message=>{
      window.popupCalls.push(message);
      if(message.type==='status'){window.statusReads++;if(window.offline)throw new TypeError('Failed to fetch');}
      if(message.type==='bind')for(const tab of window.popupView.tabs)tab.bound=tab.id===message.tabId;
      return{value:window.popupView};
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/popup.html`);
  await page.waitForFunction(()=>document.getElementById('status').textContent!=='Setup required');
  assert.doesNotMatch(await page.locator('#status').textContent(),/Failed to fetch/i,'a network error needs a next step, not a raw exception');
  assert.match(await page.locator('#status').textContent(),/Settings.*Providers.*My Chrome/i);
  assert.equal(await page.locator('#tabs').isVisible(),false);
  assert.equal(await page.locator('#bind').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.popupCalls.some(call=>call.type==='connect')),false,'opening a popup never authorizes a connection');
  const compact=await page.evaluate(()=>({width:document.body.scrollWidth,height:document.body.scrollHeight,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert.ok(compact.height<480,'the normal disconnected popup fits without a tall empty form');
  assert.equal(compact.overflow,false);
  if(process.env.ANKITA_UI_CAPTURE_DIR){fs.mkdirSync(process.env.ANKITA_UI_CAPTURE_DIR,{recursive:true});await page.locator('main').screenshot({path:path.join(process.env.ANKITA_UI_CAPTURE_DIR,'popup-offline.png')});}
  await page.evaluate(()=>{window.offline=false;});
  await page.locator('#connect').click();
  await page.locator('#tabs').waitFor({state:'visible'});
  assert.equal(await page.locator('#disconnect').isVisible(),true);
  assert.equal(await page.locator('#connect').isVisible(),false,'connected state removes the redundant Connect button');
  assert.doesNotMatch(await page.locator('#tabs option').first().textContent(),/private-id/,'opaque chat IDs do not belong in the picker');
  await page.locator('#tabs').selectOption('5');
  const reads=await page.evaluate(()=>window.statusReads);
  await page.waitForFunction(before=>window.statusReads>before,reads);
  assert.equal(await page.locator('#tabs').inputValue(),'5','polling cannot overwrite a choice before the user confirms it');
  await page.locator('#bind').click();
  assert.deepEqual(await page.evaluate(()=>window.popupCalls.filter(call=>call.type==='bind')),[{type:'bind',tabId:5}]);
  assert.equal(await page.locator('#tabs').inputValue(),'5');
  await page.locator('.advanced > summary').click();
  await page.locator('#pairing').fill('http://127.0.0.1:1/#fixture-only-pairing');
  await page.locator('#pair-connect').click();
  await page.waitForFunction(()=>document.getElementById('pairing').value==='');
  assert.equal(await page.evaluate(()=>window.popupCalls.findLast(call=>call.type==='connect').url),'http://127.0.0.1:1/#fixture-only-pairing');
  await page.locator('.advanced > summary').click();
  if(process.env.ANKITA_UI_CAPTURE_DIR)await page.locator('main').screenshot({path:path.join(process.env.ANKITA_UI_CAPTURE_DIR,'popup-connected.png')});
  assert.deepEqual(errors,[]);
});
