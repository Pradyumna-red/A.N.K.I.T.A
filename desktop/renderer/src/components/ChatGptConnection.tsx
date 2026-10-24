import { useEffect, useState } from 'react';
import type { Teammate } from '../../../shared/wire';
import type { ChatGptConnectionState, ChatGptSetupResult, ChatGptNativePreferences } from '../../../shared/chatgpt-browser.mjs';
import { CHATGPT_CONNECTION_ACTIONS, CHATGPT_CONNECTION_CHANGED, CHATGPT_CURRENT_MODEL_LABEL, CHATGPT_NATIVE_SURFACES, CHATGPT_NATIVE_SETUP_LINKS, CHATGPT_COMPANION_UPDATE_MESSAGE, CHATGPT_BROWSER_MODES, CHATGPT_BROWSER_CHOICES, BROWSER_TRANSPORT_NOTICE, chatgptHasPendingReply } from '../../../shared/chatgpt-browser.mjs';
import { Icon } from './Icons';

const statusLabels: Record<string, string> = { ready: 'Connected', observing: 'Reading your chat', 'pairing-required': 'Waiting for Chrome',
  'select-tab': 'Opening your chat', 'page-unavailable': 'Check the ChatGPT window', disconnected: 'Disconnected', 'setup-required': 'Ready to connect', blocked: 'Check ChatGPT' };
export function ChatGptConnection({ teammates, enabled, initialThreadId }: { teammates: Teammate[]; enabled: boolean; initialThreadId?: string | null }) {
  const [state, setState] = useState<ChatGptConnectionState>({ status: 'setup-required', selectedModel: null });
  const [threadId, setThreadId] = useState(initialThreadId ?? teammates[0]?.id ?? '');
  const [mode, setMode] = useState<string>(CHATGPT_BROWSER_MODES.builtin);
  const [setup, setSetup] = useState<ChatGptSetupResult | null>(null);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [nativePreferences, setNativePreferences] = useState<ChatGptNativePreferences>({ tunnels: {}, savedKeys: [] });
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [objective, setObjective] = useState(''), [corrections, setCorrections] = useState('');
  useEffect(() => {
    let active = true;
    void window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.overview).then(value => { if (active) { setState(value); if (value.mode && value.mode !== CHATGPT_BROWSER_MODES.legacy) setMode(value.mode); if (value.threadId && !initialThreadId) setThreadId(value.threadId); } }).catch(() => {});
    void window.ankita.invoke<ChatGptNativePreferences>(CHATGPT_CONNECTION_ACTIONS.nativePreferences).then(value => { if (active) setNativePreferences(value); }).catch(() => {});
    const off = window.ankita.onEvent(event => { if (event.type === CHATGPT_CONNECTION_CHANGED) setState(event.state); });
    return () => { active = false; off(); };
  }, [enabled]);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setNotice(''); try { await action(); } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
  };
  const connect = () => perform(async () => {
    const result = await window.ankita.invoke<ChatGptSetupResult>(CHATGPT_CONNECTION_ACTIONS.start, { threadId, mode });
    setSetup(result); setState(result.state);
  });
  const ready = state.status === 'ready';
  const selectedReady = ready && state.mode === mode && state.threadId === threadId;
  const pending = chatgptHasPendingReply(state);
  const choice = CHATGPT_BROWSER_CHOICES.find(item => item.id === mode)!;
  const appNames = { ...Object.fromEntries(CHATGPT_NATIVE_SURFACES.map(surface => [surface.id, surface.name])), ...nativePreferences.appNames };
  const saveApps = () => perform(async () => {
    setNativePreferences(await window.ankita.invoke<ChatGptNativePreferences>(CHATGPT_CONNECTION_ACTIONS.nativeSaveApps, { appNames, autoMention: nativePreferences.autoMention !== false }));
    setNotice(nativePreferences.autoMention !== false ? 'App names saved. Connected apps will be included in your messages.' : 'App names saved. Automatic app tags are off.');
  });
  return <section className="chatgpt-connection" aria-labelledby="chatgpt-connection-title">
    <header><span className="chatgpt-connection-icon"><Icon name="chat" size={22} /></span><div><h2 id="chatgpt-connection-title">Your ChatGPT conversation</h2><p>Your account, in ANKITA or Chrome. Sign in once and keep working.</p></div><span className={`chatgpt-status ${selectedReady ? 'ready' : ''}`} role="status"><i />{ready && !selectedReady ? 'Ready to switch' : statusLabels[state.status] ?? 'Check connection'}</span></header>
    <div className="chatgpt-connection-body">
      <div className="chatgpt-browser-choices" role="group" aria-label="Where ChatGPT runs">{CHATGPT_BROWSER_CHOICES.map(item => <button type="button" key={item.id} aria-pressed={mode === item.id} disabled={busy || pending} onClick={() => { setMode(item.id); setNotice(''); }}>
        <Icon name={item.icon} size={20} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><Icon name={mode === item.id ? 'check' : 'chevron'} size={16} />
      </button>)}</div>
      <label className="settings-field">Teammate<select aria-label="Teammate" className="settings-select" value={threadId} disabled={busy} onChange={event => setThreadId(event.target.value)}>
        {teammates.map(teammate => <option key={teammate.id} value={teammate.id}>{teammate.name}</option>)}
      </select></label>
      {selectedReady ? <div className="chatgpt-connected-summary"><Icon name="check" size={20} /><div><strong>Connected in {choice.label}</strong><p>{state.selectedModel ?? CHATGPT_CURRENT_MODEL_LABEL}. Replies appear in ANKITA. Your account limits apply.</p>{state.workspacePath && <small>Workspace: {state.workspacePath}</small>}</div></div> : <>
        <p className="chatgpt-setup-intro">{enabled ? mode === CHATGPT_BROWSER_MODES.builtin ? 'Open the compact ChatGPT window and sign in. ANKITA handles the connection.' : 'Open Chrome with the ANKITA companion installed. It connects automatically; no pairing link.' : 'Save ChatGPT Browser as your provider to begin.'}</p>
        <button className="settings-primary" type="button" disabled={busy || pending || !enabled || !threadId} title={pending ? 'Read or stop the existing reply before changing the browser' : undefined} onClick={connect}>{busy ? 'Opening…' : choice.action}</button>
        {mode === CHATGPT_BROWSER_MODES.builtin && state.threadId && <button className="settings-secondary" disabled={busy} onClick={() => void perform(async () => {
          await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.signIn); setNotice('In Chrome, open ANKITA ChatGPT Companion and click “Bring Chrome sign-in to ANKITA”. Allow Chrome’s one-time sign-in permission.');
        })}>Use my Chrome sign-in</button>}
        {mode === CHATGPT_BROWSER_MODES.chrome && <button className="settings-secondary" disabled={busy} onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.folder); })}>Open companion folder</button>}
        {setup?.pairingUrl && <ol className="chatgpt-setup-steps">
          <li><strong>Load the companion in Chrome</strong><p>Open chrome://extensions, turn on Developer mode and load the companion folder. If it is already loaded, reload it.</p><button className="settings-secondary" onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.folder); })}>Open companion folder</button></li>
          <li><strong>Pair with ANKITA</strong><p>Copy this private link into the companion’s Local pairing URL field.</p><div className="chatgpt-pairing-link"><input aria-label="Private pairing link" readOnly type="password" value={setup.pairingUrl} autoComplete="off" /><button type="button" className="settings-secondary" onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.copyPairing, { url: setup.pairingUrl }); setNotice('Pairing link copied.'); })}>Copy link</button></div></li>
          <li><strong>Choose your saved chat</strong><p>Click Connect companion, choose the conversation, then Observe this tab. Keep that ChatGPT tab open.</p></li>
        </ol>}
      </>}
      {state.threadId && <div className="chatgpt-native-links"><button className="settings-secondary" disabled={busy} onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.show); })}>Show ChatGPT</button></div>}
      {notice && <p className="chatgpt-connection-notice" role="status">{notice}</p>}
      {ready && state.mode !== CHATGPT_BROWSER_MODES.builtin && state.nativeAppTagsReady === false && nativePreferences.autoMention !== false && state.nativeTools?.some(native => native.configured) && <div className="chatgpt-native-warning" role="status"><Icon name="alert" size={16} /><p>{CHATGPT_COMPANION_UPDATE_MESSAGE}</p><button type="button" className="settings-secondary" disabled={busy} onClick={() => void perform(async () => { await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.folder); })}>Open updated companion folder</button></div>}
      {state.blockedReason && <p className="chatgpt-connection-notice" role="status">{state.blockedReason === BROWSER_TRANSPORT_NOTICE ? 'ChatGPT’s connection paused. ANKITA is still checking the same reply; your message will not be sent twice.' : 'Open ChatGPT and check its notice. Then read the saved reply here.'}</p>}
      {state.remoteStop && state.remoteStop !== 'confirmed' && <p className="chatgpt-connection-notice" role="status">Local actions have stopped. Waiting for your selected ChatGPT chat to confirm Stop. Keep that tab open.</p>}
      {state.recoveryIssue && <p className="chatgpt-connection-notice" role="status">Open ChatGPT again and finish signing in. In Chrome, check that the updated ANKITA companion is enabled.</p>}
      {state.recoverable?.map(operation => <div className="chatgpt-connected-summary" key={operation.id}><div><strong>{operation.outcome === 'completed' ? 'A saved reply is ready' : 'A previous reply needs checking'}</strong><p>{state.replying ? 'ANKITA is still checking this same reply.' : `Read the existing reply for ${teammates.find(teammate => teammate.id === state.threadId)?.name ?? 'its teammate'}. Your question will not be sent again.`}</p><button className="settings-secondary" disabled={busy || state.replying || (!ready && state.blockedReason !== BROWSER_TRANSPORT_NOTICE)} onClick={() => void perform(async () => {
        await window.ankita.invoke(CHATGPT_CONNECTION_ACTIONS.resume, { threadId: state.threadId, operationId: operation.id });
      })}>Read reply</button></div></div>)}
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
        <label className="chatgpt-native-apps"><input type="checkbox" checked={nativePreferences.autoMention !== false} disabled={busy} onChange={event => setNativePreferences(value => ({ ...value, autoMention: event.target.checked }))} />Include connected apps automatically</label>
        <p>ANKITA adds real app tags to your ChatGPT messages. You can change the names below to match your installed apps.</p>
        {state.nativeTools?.some(native => !native.available) && <div className="chatgpt-native-warning" role="status"><Icon name="alert" size={16} /><p>Connection files missing. Restart with the updated app, then check again.</p><button type="button" className="settings-secondary" disabled={busy} onClick={() => void perform(async () => {
          setState(await window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.overview));
        })}>Check connection files</button></div>}
        {CHATGPT_NATIVE_SURFACES.map(surface => {
          const native = state.nativeTools?.find(item => item.id === surface.id);
          const connected = native?.status === 'connected' || native?.status === 'connecting';
          return <details className="chatgpt-native-card" key={surface.id}>
            <summary><div><strong>{surface.name}</strong><span>{surface.label}</span></div><span className={`chatgpt-status ${native?.status === 'connected' ? 'ready' : ''}`} role="status">{native?.status === 'connected' ? 'Connected' : native?.status === 'connecting' ? 'Connecting' : !native?.available ? 'Connection files missing' : native?.status === 'authorization-required' ? 'Check tunnel key' : 'Set up'}</span></summary>
            <div className="chatgpt-native-card-body">
            <p>{surface.description}</p>
            <label className="settings-field">ChatGPT app name<input className="settings-input" value={appNames[surface.id]} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => setNativePreferences(value => ({ ...value, appNames: { ...appNames, [surface.id]: event.target.value } }))} /></label>
            <label className="settings-field">Tunnel ID<input className="settings-input" disabled={busy || connected} value={nativePreferences.tunnels[surface.id] ?? ''} placeholder="Your dedicated tunnel ID" autoComplete="off" spellCheck={false}
              onChange={event => setNativePreferences(value => ({ ...value, tunnels: { ...value.tunnels, [surface.id]: event.target.value } }))} /></label>
            <label className="settings-field">Restricted tunnel key<input className="settings-input" type="password" disabled={busy || connected} value={keys[surface.id] ?? ''} autoComplete="new-password"
              placeholder={native?.hasSavedKey ? 'Saved securely on this device' : 'Paste your restricted key'} onChange={event => setKeys(value => ({ ...value, [surface.id]: event.target.value }))} /></label>
            <small>Key entry stays in settings and is saved with your device’s secure storage. In ChatGPT, create an MCP app named {appNames[surface.id]}, select this tunnel and choose No authentication.</small>
            <button className={connected ? 'settings-secondary' : 'settings-primary'} disabled={busy || (!connected && !native?.available)} title={!connected && !native?.available ? 'Check the missing connection files above first.' : undefined} type="button" onClick={() => void perform(async () => {
              if (connected) setState(await window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.nativeStop, { surface: surface.id }));
              else {
                setNativePreferences(await window.ankita.invoke<ChatGptNativePreferences>(CHATGPT_CONNECTION_ACTIONS.nativeSaveApps, { appNames, autoMention: nativePreferences.autoMention !== false }));
                setState(await window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.nativeStart, { surface: surface.id, tunnelId: nativePreferences.tunnels[surface.id], apiKey: keys[surface.id] }));
                setKeys(value => ({ ...value, [surface.id]: '' }));
              }
            })}>{connected ? 'Disconnect tools' : 'Connect tools'}</button>
            </div>
          </details>;
        })}
        <button type="button" className="settings-secondary" disabled={busy} onClick={() => void saveApps()}>Save app names</button>
      </details>}
    </div>
  </section>;
}
