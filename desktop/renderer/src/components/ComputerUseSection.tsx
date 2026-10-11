import { useCallback, useEffect, useState } from 'react';
import type { ComputerUseOverview } from '../../../shared/wire';
import { COMPUTER_USE_ACTIONS, COMPUTER_USE_CHANGED, COMPUTER_USE_LABEL } from '../../../shared/computer-use.mjs';

export function ComputerUseSection() {
  const [overview, setOverview] = useState<ComputerUseOverview | null>(null);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = useCallback(async () => {
    try { setOverview(await window.ankita.invoke<ComputerUseOverview>(COMPUTER_USE_ACTIONS.overview)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => { void refresh(); return window.ankita.onEvent(event => {
    if (event.type === COMPUTER_USE_CHANGED || event.type === 'tools-changed') void refresh();
  }); }, [refresh]);
  const act = async (action: 'connect' | 'check' | 'stop') => {
    setBusy(true); setError(''); setNotice('');
    try {
      await window.ankita.invoke(COMPUTER_USE_ACTIONS[action], action === 'connect' && command.trim() ? { command: command.trim() } : undefined);
      setNotice(action === 'check' ? 'Connection checked.' : action === 'stop' ? 'Computer Use stopped.' : 'Connected. Ask ANKITA to use a desktop app.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="plugins-section" aria-labelledby="computer-use-heading">
    <div className="plugins-section-head"><h2 id="computer-use-heading">{COMPUTER_USE_LABEL}</h2></div>
    <div className="browser-plugin-details">
      <p>Let ANKITA read and use apps on your current Windows desktop with Cua Driver.</p>
      <p>Connect gives ANKITA access to desktop controls. Desktop actions run without approval prompts. Your selected model sees screenshots when it supports images.</p>
      {!overview ? <div className="plugins-loading">Checking your computer…</div> : <>
        <div className="browser-plugin-setup-row"><span>{!overview.supported ? 'Windows desktop required' : overview.connected ? 'Connected' : overview.installed ? 'Driver found' : 'Setup needed'}{overview.version ? ` · ${overview.version}` : ''}</span>
          <button type="button" className="browser-plugin-primary" onClick={() => void act('connect')} disabled={busy || !overview.supported || (!overview.installed && !command.trim()) || overview.connected}>{busy && !overview.connected ? 'Connecting…' : overview.connected ? 'Connected' : 'Connect Computer Use'}</button>
        </div>
        <details><summary>Driver location</summary><label className="browser-plugin-instruction" htmlFor="computer-driver-path">Cua Driver executable</label><input id="computer-driver-path" value={command} placeholder={overview.command || 'Select your installed driver path'} onChange={event => setCommand(event.target.value)} disabled={busy || overview.connected} />
          <p>Detected automatically. Use the full executable path if it was installed somewhere else.</p></details>
        {!overview.installed && <p><button type="button" onClick={() => void window.ankita.openExternal(overview.docsUrl)}>Open Cua Driver setup</button><button type="button" onClick={() => void refresh()} disabled={busy}>Check again</button></p>}
        <div className="browser-plugin-setup-row"><button type="button" onClick={() => void act('check')} disabled={busy || !overview.connected}>Check connection</button><button type="button" onClick={() => void act('stop')} disabled={!overview.connected && !busy}>Stop Computer Use</button></div>
        <small>Uses direct app controls where available, and screenshots when needed. No connection starts when ANKITA opens.</small>
      </>}
      {(error || overview?.error) && <p className="browser-details-error" role="alert">{error || overview?.error}</p>}
      {notice && <p className="browser-details-notice" role="status">{notice}</p>}
    </div>
  </section>;
}
