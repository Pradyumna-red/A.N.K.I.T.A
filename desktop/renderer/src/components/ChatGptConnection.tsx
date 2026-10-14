import { useEffect, useState } from 'react';
import type { Teammate } from '../../../shared/wire';
import type { ChatGptConnectionState, ChatGptSetupResult, ChatGptNativePreferences } from '../../../shared/chatgpt-browser.mjs';
import { CHATGPT_CONNECTION_ACTIONS, CHATGPT_CONNECTION_CHANGED, CHATGPT_CURRENT_MODEL_LABEL, CHATGPT_NATIVE_SURFACES, CHATGPT_NATIVE_SETUP_LINKS } from '../../../shared/chatgpt-browser.mjs';
import { Icon } from './Icons';

const statusLabels: Record<string, string> = { ready: 'Connected', observing: 'Reading your chat', 'pairing-required': 'Pair the companion',
  'select-tab': 'Choose your saved chat', 'page-unavailable': 'Open the selected chat', disconnected: 'Disconnected', 'setup-required': 'Ready to connect', blocked: 'Check ChatGPT' };
export function ChatGptConnection({ teammates, enabled }: { teammates: Teammate[]; enabled: boolean }) {
  const [state, setState] = useState<ChatGptConnectionState>({ status: 'setup-required', selectedModel: null });
  const [threadId, setThreadId] = useState(teammates[0]?.id ?? '');
  const [setup, setSetup] = useState<ChatGptSetupResult | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [nativePreferences, setNativePreferences] = useState<ChatGptNativePreferences>({ tunnels: {}, savedKeys: [] });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [objective, setObjective] = useState(''), [corrections, setCorrections] = useState('');
  useEffect(() => {
    let active = true;
    void window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.overview).then(value => { if (active) setState(value); }).catch(() => {});
    void window.ankita.invoke<ChatGptNativePreferences>(CHATGPT_CONNECTION_ACTIONS.nativePreferences).then(value => { if (active) setNativePreferences(value); }).catch(() => {});
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
      {state.blockedReason && <p className="chatgpt-connection-notice" role="status">ChatGPT reported {state.blockedReason}. Check the notice in your selected chat, then explicitly resume when it is resolved.</p>}
      {state.remoteStop && state.remoteStop !== 'confirmed' && <p className="chatgpt-connection-notice" role="status">Local actions have stopped. Waiting for your selected ChatGPT chat to confirm Stop. Keep that tab open.</p>}
      {state.recoveryIssue && <p className="chatgpt-connection-notice" role="status">The saved connection could not be reopened. Create a new pairing link and select your chat again.</p>}
      {state.recoverable?.map(operation => <div className="chatgpt-connected-summary" key={operation.id}><div><strong>{operation.outcome === 'completed' ? 'A saved reply is ready' : 'A previous reply needs checking'}</strong><p>Read its existing result. Your question will not be sent again.</p><button className="settings-secondary" disabled={busy || !ready} onClick={() => void perform(async () => {
        await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.resume, { threadId: state.threadId, operationId: operation.id });
      })}>Resume saved reply</button></div></div>)}
      {state.threadId && <button className="settings-secondary" disabled={busy} type="button" onClick={() => void perform(async () => {
        await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.disconnect); setSetup(null); setState({ status: 'disconnected', selectedModel: null });
      })}>Disconnect browser</button>}
      {state.conversationId && <details className="chatgpt-native-setup"><summary><Icon name="chat" size={18} />Take this context to another chat</summary>
        <p>Copy the objective, selected project and saved receipts. Choose the destination yourself, then pair that saved chat before sending. Check ChatGPT limits and unconfirmed actions first.</p>
        <label className="settings-field">Objective<input className="settings-input" value={objective} onChange={event => setObjective(event.target.value)} /></label>
        <label className="settings-field">Corrections or next steps<input className="settings-input" value={corrections} onChange={event => setCorrections(event.target.value)} /></label>
        <button className="settings-secondary" disabled={busy || !objective.trim()} onClick={() => void perform(async () => {
          await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.handoff, { threadId: state.threadId, objective, corrections }); setNotice('Context handoff copied.');
        })}>Copy context handoff</button>
      </details>}
      {ready && <details className="chatgpt-native-setup">
        <summary><Icon name="plug" size={18} /><span>Let ChatGPT use ANKITA’s tools</span><small>Optional</small></summary>
        <p>Connect each tool group you want ChatGPT to use. Create a dedicated OpenAI tunnel, then install its MCP app in ChatGPT. Use a restricted key with Tunnels Read and Use.</p>
        <div className="chatgpt-native-links">
          <a href={CHATGPT_NATIVE_SETUP_LINKS.tunnels} target="_blank" rel="noreferrer">Open tunnels ↗</a>
          <a href={CHATGPT_NATIVE_SETUP_LINKS.keys} target="_blank" rel="noreferrer">Open API keys ↗</a>
          <a href={CHATGPT_NATIVE_SETUP_LINKS.plugins} target="_blank" rel="noreferrer">Open ChatGPT apps ↗</a>
        </div>
        {CHATGPT_NATIVE_SURFACES.map(surface => {
          const native = state.nativeTools?.find(item => item.id === surface.id);
          const connected = native?.status === 'connected' || native?.status === 'connecting';
          return <article className="chatgpt-native-card" key={surface.id}>
            <header><div><strong>{surface.name}</strong><span>{surface.label}</span></div><span className={`chatgpt-status ${native?.status === 'connected' ? 'ready' : ''}`} role="status">{native?.status === 'connected' ? 'Connected' : native?.status === 'connecting' ? 'Connecting' : native?.status === 'authorization-required' ? 'Check tunnel key' : 'Ready to set up'}</span></header>
            <p>{surface.description}</p>
            <label className="settings-field">Tunnel ID<input className="settings-input" disabled={busy || connected} value={nativePreferences.tunnels[surface.id] ?? ''} placeholder="Your dedicated tunnel ID" autoComplete="off" spellCheck={false}
              onChange={event => setNativePreferences(value => ({ ...value, tunnels: { ...value.tunnels, [surface.id]: event.target.value } }))} /></label>
            <label className="settings-field">Restricted tunnel key<input className="settings-input" type="password" disabled={busy || connected} value={keys[surface.id] ?? ''} autoComplete="new-password"
              placeholder={native?.hasSavedKey ? 'Saved securely on this device' : 'Paste your restricted key'} onChange={event => setKeys(value => ({ ...value, [surface.id]: event.target.value }))} /></label>
            <small>Key entry stays in settings and is saved with your device’s secure storage. In ChatGPT, create an MCP app named {surface.name}, select this tunnel and choose No authentication.</small>
            {!native?.available && <p>The native connection helper is missing. Install ANKITA’s full desktop package to enable these tools.</p>}
            <button className={connected ? 'settings-secondary' : 'settings-primary'} disabled={busy || (!connected && !native?.available)} type="button" onClick={() => void perform(async () => {
              if (connected) setState(await window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.nativeStop, { surface: surface.id }));
              else {
                setState(await window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.nativeStart, { surface: surface.id, tunnelId: nativePreferences.tunnels[surface.id], apiKey: keys[surface.id] }));
                setKeys(value => ({ ...value, [surface.id]: '' }));
              }
            })}>{connected ? 'Disconnect tools' : 'Connect tools'}</button>
          </article>;
        })}
      </details>}
    </div>
  </section>;
}
