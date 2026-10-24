import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../desktop/renderer/', import.meta.url));
const FIXTURE_ROUTE = '/connection-ui'; // Test-only component preview, never a user profile.
test('connection settings keep setup cards compact and provide an actionable missing-helper state', async t => {
  const vite = await createServer({ configFile: false, root: ROOT, server: { middlewareMode: true }, appType: 'custom' });
  const server = http.createServer(async (req, res) => {
    if (req.url !== FIXTURE_ROUTE) return vite.middlewares(req, res);
    res.setHeader('content-type', 'text/html');
    res.end(await vite.transformIndexHtml(FIXTURE_ROUTE, `<!doctype html><html><body class="desktop-workbench"><div class="settings-scroll"><div id="root"></div></div><script type="module">
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {ChatGptConnection} from '/src/components/ChatGptConnection.tsx';
      import '/src/styles.css'; import '/src/workbench.css';
      const state = {status:'ready',mode:'chrome',nativeAppTagsReady:false,selectedModel:null,threadId:'fixture',nativeTools:['core','desktop','plugins'].map(id=>({id,status:'setup-required',configured:true,available:false,hasSavedKey:false}))};
      window.fixtureState=state; let preferences={tunnels:{},savedKeys:[]};
      const listeners=new Set();window.showConnection=next=>{Object.assign(state,next);listeners.forEach(fn=>fn({type:'chatgpt-connection-changed',state:structuredClone(state)}));};
      window.calls=[]; window.ankita={onEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},invoke:async(action,payload)=>{
        window.calls.push({action,payload});
        if(action==='chatgptConnectionStart'){state.mode=payload.mode;state.threadId=payload.threadId;return{state};}
        if(action==='chatgptNativeSaveApps') preferences={...preferences,...payload};
        return action==='chatgptNativePreferences'||action==='chatgptNativeSaveApps'?preferences:state;
      }};
      createRoot(document.getElementById('root')).render(React.createElement(ChatGptConnection,{teammates:[{id:'fixture',name:'Fixture'},{id:'selected-teammate',name:'Selected teammate'}],initialThreadId:'selected-teammate',enabled:true}));
    </script></body></html>`));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await vite.close(); });
  const page = await browser.newPage({ viewport: { width: 1000, height: 768 } });
  await page.goto(`http://127.0.0.1:${server.address().port}${FIXTURE_ROUTE}`);
  const choices=page.getByRole('group',{name:'Where ChatGPT runs'});
  await choices.waitFor();
  assert.equal(await choices.getByRole('button',{name:/My Chrome/}).getAttribute('aria-pressed'),'true');
  await choices.getByRole('button',{name:/ANKITA window/}).click();
  await page.getByRole('button',{name:'Open ANKITA window',exact:true}).click();
  assert.ok(await page.evaluate(()=>window.calls.some(call=>call.action==='chatgptConnectionStart'&&call.payload.mode==='builtin'&&call.payload.threadId==='selected-teammate')));
  await choices.getByRole('button',{name:/My Chrome/}).click();
  await page.getByRole('button',{name:'Use my Chrome',exact:true}).click();
  assert.equal(await page.getByLabel('Teammate', { exact: true }).isEnabled(), true);
  await page.getByRole('button', { name: 'Open updated companion folder', exact: true }).click();
  assert.ok(await page.evaluate(() => window.calls.some(call => call.action === 'chatgptCompanionFolder')));
  await page.getByText('Let ChatGPT use ANKITA’s tools', { exact: true }).click();
  await page.locator('.chatgpt-native-card').first().waitFor();
  assert.equal(await page.locator('details.chatgpt-native-card:not([open])').count(), 3, 'all three tool groups start as compact rows');
  await page.getByRole('button', { name: 'Check connection files', exact: true }).click();
  assert.ok(await page.evaluate(() => window.calls.filter(call => call.action === 'chatgptConnectionOverview').length > 1));
  assert.equal(await page.locator('.settings-scroll').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
  await page.locator('.chatgpt-native-card > summary').first().click();
  assert.equal(await page.getByLabel('ChatGPT app name', { exact: true }).first().inputValue(), 'ANKITA Core');
  assert.ok(await page.getByText('Connection files missing', { exact: true }).count() > 0);
  assert.equal(await page.getByRole('button', { name: 'Connect tools', exact: true }).first().isEnabled(), false);
  await page.getByLabel('ChatGPT app name', { exact: true }).first().fill('ANKITA Proof');
  await page.getByLabel('Include connected apps automatically', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Save app names', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls.findLast(call => call.action === 'chatgptNativeSaveApps').payload), {
    appNames: { core: 'ANKITA Proof', desktop: 'ANKITA Desktop', plugins: 'ANKITA Plugins' }, autoMention: false,
  });
  await page.evaluate(() => { for (const row of window.fixtureState.nativeTools) row.available = true; });
  await page.getByRole('button', { name: 'Check connection files', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Connect tools', exact: true }).first().isEnabled(), true, 'actual availability enables setup; CSS never bypasses a missing helper');
  await page.evaluate(()=>window.showConnection({threadId:'fixture',recoverable:[{id:'saved-first-reply',outcome:'completed'}],replying:false}));
  const read=page.getByRole('button',{name:'Read reply',exact:true});
  await read.waitFor();
  assert.equal(await choices.getByRole('button',{name:/ANKITA window/}).isDisabled(),true,'unfinished work still prevents a browser switch in Settings');
  await read.click();
  assert.ok(await page.evaluate(()=>window.calls.some(call=>call.action==='chatgptResumeReply'&&call.payload.threadId==='fixture'&&call.payload.operationId==='saved-first-reply')),'Settings reads the original reply for its owning teammate');
  await page.evaluate(()=>window.showConnection({replying:true}));
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Read reply')?.disabled);
});
