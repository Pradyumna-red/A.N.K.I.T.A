import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DesktopChatGptBrowser } from '../../desktop/electron/chatgpt-browser.mjs';

// Entirely local Electron/ChatGPT-shaped fixture. No real account, tunnel or browser profile.
if (process.versions.electron) { // Node's full test discovery also loads fixture modules; only the actual Electron entry may open a window.
const { app, session } = await import('electron');
const directory = process.env.ANKITA_WINDOW_FIXTURE;
if (!directory) throw new Error('Isolated native fixture directory required');
app.setPath('userData', path.join(directory, 'user-data'));
const root = fileURLToPath(new URL('../../', import.meta.url));
const phase = value => { fs.writeFileSync(path.join(directory, 'phase.txt'), value); if (globalThis.fixture) globalThis.fixture.phase = value; };
phase('imports-ready');
const final = 'Owned native answer ' + randomUUID();
const html = conversationId => `<form><div contenteditable="true" id="prompt-textarea"></div><button type="button" data-testid="send-button">Send</button></form><script>
window.sends=0;
window.fixtureConversationId=${JSON.stringify(conversationId)};
document.querySelector('button').onclick=()=>{
  window.sends++;
  const text=document.querySelector('#prompt-textarea').innerText;
  history.replaceState(null,'','/c/'+${JSON.stringify(conversationId)});
  const section=document.createElement('section');section.dataset.testid='conversation-turn-fixture';section.dataset.turnId=crypto.randomUUID();
  section.textContent=text;
  section.__reactFiber$fixture={memoizedProps:{conversationId:${JSON.stringify(conversationId)},turn:{messages:[
    {id:crypto.randomUUID(),author:{role:'user'},content:{content_type:'text',parts:[text]}},
    {id:crypto.randomUUID(),author:{role:'assistant'},channel:'final',end_turn:true,status:'finished_successfully',content:{content_type:'text',parts:[${JSON.stringify(final)}]}}
  ]}}};
  if(text==='Native owned stop question') {
    const answer=section.__reactFiber$fixture.memoizedProps.turn.messages.at(-1);answer.end_turn=false;answer.status='in_progress';
    const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='Error in message stream';
    document.querySelector('form').before(notice);
    const stop=document.createElement('button');stop.type='button';stop.dataset.testid='stop-button';stop.textContent='Stop';
    stop.onclick=()=>{window.stopClicks=(window.stopClicks||0)+1;stop.remove();notice.remove();answer.end_turn=true;answer.status='finished_successfully';};
    document.querySelector('form').append(stop);
  }
  if(text==='Native owned first question') {
    const answer=section.__reactFiber$fixture.memoizedProps.turn.messages.at(-1);
    answer.end_turn=false;answer.status='in_progress';
    const notice=document.createElement('div');notice.setAttribute('role','alert');notice.textContent='Error in message stream';
    document.querySelector('form').before(notice);
    window.finishFirstReply=()=>{answer.end_turn=true;answer.status='finished_successfully';notice.remove();};
  }
  document.querySelector('form').before(section);document.querySelector('#prompt-textarea').textContent='';
};</script>`;
globalThis.fixture = { final, phase: 'starting' };
globalThis.fixture.ready = app.whenReady().then(async () => {
  phase('app-ready');
  await session.fromPartition('persist:ankita-chatgpt').protocol.handle('https', request => {
    const id = new URL(request.url).pathname.match(/\/c\/([^/]+)/)?.[1] ?? randomUUID();
    return new Response(html(id), { headers: { 'content-type': 'text/html' } });
  });
  const makeManager = () => new DesktopChatGptBrowser({ directory, resourceRoot: root, getContext: threadId => ({ threadId, workspacePath: directory }) });
  const manager = makeManager(); globalThis.fixture.makeManager = makeManager;
  globalThis.fixture.manager = manager;
  phase('opening');
  const result = await manager.start({ threadId: 'native-owner', mode: 'builtin' });
  phase('opened'); return result;
});
void globalThis.fixture.ready.catch(error => { phase('error: ' + error.message); });
app.on('window-all-closed', () => {});
}
