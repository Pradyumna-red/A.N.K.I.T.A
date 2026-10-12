import { useEffect, useState } from 'react';
import type { Teammate } from '../../../shared/wire';
import type { ChatGptConnectionState, ChatGptSetupResult } from '../../../shared/chatgpt-browser.mjs';
import { CHATGPT_CONNECTION_ACTIONS, CHATGPT_CONNECTION_CHANGED, CHATGPT_CURRENT_MODEL_LABEL } from '../../../shared/chatgpt-browser.mjs';
import { Icon } from './Icons';

const statusLabels: Record<string, string> = { ready: 'Connected', observing: 'Reading your chat', 'pairing-required': 'Pair the companion',
  'select-tab': 'Choose your saved chat', 'page-unavailable': 'Open the selected chat', disconnected: 'Disconnected', 'setup-required': 'Ready to connect' };
export function ChatGptConnection({ teammates, enabled }: { teammates: Teammate[]; enabled: boolean }) {
  const [state, setState] = useState<ChatGptConnectionState>({ status: 'setup-required', selectedModel: null });
  const [threadId, setThreadId] = useState(teammates[0]?.id ?? '');
  const [setup, setSetup] = useState<ChatGptSetupResult | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.overview).then(value => { if (active) setState(value); }).catch(() => {});
    const off = window.ankita.onEvent(event => { if (event.type === CHATGPT_CONNECTION_CHANGED) setState(event.state); });
    return () => { active = false; off(); };
  }, [enabled]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(''); try { await action(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const connect = () => perform(async () => {
    const result = await window.ankita.invoke<ChatGptSetupResult>(CHATGPT_CONNECTION_ACTIONS.start, { threadId });
    setSetup(result); setState(result.state);
  });
  const ready = state.status === 'ready';
  return <section className="chatgpt-connection" aria-labelledby="chatgpt-connection-title">
    <header><span className="chatgpt-connection-icon"><Icon name="chat" size={22} /></span><div><h2 id="chatgpt-connection-title">Your ChatGPT conversation</h2><p>Send from ANKITA using the chat you already have open.</p></div><span className={`chatgpt-status ${ready ? 'ready' : ''}`} role="status"><i />{statusLabels[state.status] ?? 'Check connection'}</span></header>
    <div className="chatgpt-connection-body">
      <label className="settings-field">Teammate<select className="settings-select" value={state.threadId ?? threadId} disabled={busy || Boolean(state.threadId)} onChange={event => setThreadId(event.target.value)}>
        {teammates.map(teammate => <option key={teammate.id} value={teammate.id}>{teammate.name}</option>)}
      </select></label>
      {ready ? <div className="chatgpt-connected-summary"><Icon name="check" size={20} /><div><strong>{state.selectedModel ?? CHATGPT_CURRENT_MODEL_LABEL}</strong><p>Your selected chat is connected. Its account limits apply.</p>{state.workspacePath && <small>Workspace: {state.workspacePath}</small>}</div></div> : <>
        <p className="chatgpt-setup-intro">{enabled ? 'Connect once, then choose a saved ChatGPT conversation in the companion.' : 'Save ChatGPT Browser as your provider to begin.'}</p>
        <button className="settings-primary" type="button" disabled={busy || !enabled || !threadId} onClick={connect}>{busy ? 'Connecting…' : setup ? 'Create a new pairing link' : 'Connect browser'}</button>
        {setup && <ol className="chatgpt-setup-steps">
          <li><strong>Load the companion in Chrome</strong><p>Open chrome://extensions, turn on Developer mode and load the companion folder. If it is already loaded, reload it.</p><button className="settings-secondary" onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.folder); })}>Open companion folder</button></li>
          <li><strong>Pair with ANKITA</strong><p>Copy this private link into the companion’s Local pairing URL field.</p><div className="chatgpt-pairing-link"><input aria-label="Private pairing link" readOnly type="password" value={setup.pairingUrl} autoComplete="off" /><button type="button" className="settings-secondary" onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.copyPairing, { url: setup.pairingUrl }); setNotice('Pairing link copied.'); })}>Copy link</button></div></li>
          <li><strong>Choose your saved chat</strong><p>Click Connect companion, choose the conversation, then Observe this tab. Keep that ChatGPT tab open.</p></li>
        </ol>}
      </>}
      {notice && <p className="chatgpt-connection-notice" role="status">{notice}</p>}
      {state.threadId && <button className="settings-secondary" disabled={busy} type="button" onClick={() => void perform(async () => {
        await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.disconnect); setSetup(null); setState({ status: 'disconnected', selectedModel: null });
      })}>Disconnect browser</button>}
    </div>
  </section>;
}
