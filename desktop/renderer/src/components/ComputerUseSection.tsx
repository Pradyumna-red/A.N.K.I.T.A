import { useCallback, useEffect, useState } from 'react';
import type { ComputerUseOverview } from '../../../shared/wire';
import { COMPUTER_USE_ACTIONS, COMPUTER_USE_CHANGED, COMPUTER_USE_LABEL } from '../../../shared/computer-use.mjs';
import { Icon } from './Icons';
import './computer-use.css';

export function ComputerUseSection() {
  const [overview, setOverview] = useState<ComputerUseOverview | null>(null);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState<'connect' | 'check' | 'stop' | 'pointer' | null>(null);
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
    setBusy(action); setError(''); setNotice('');
    try {
      await window.ankita.invoke(COMPUTER_USE_ACTIONS[action], action === 'connect' && command.trim() ? { command: command.trim() } : undefined);
      setNotice(action === 'check' ? 'Connection checked.' : action === 'stop' ? 'Computer Use stopped.' : 'Connected. Ask ANKITA to use a desktop app.');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  };
  const setPointer = async (enabled: boolean) => {
    setBusy('pointer'); setError(''); setNotice('');
    setOverview(current => current ? { ...current, pointerEnabled: enabled } : current);
    try {
      setOverview(await window.ankita.invoke<ComputerUseOverview>(COMPUTER_USE_ACTIONS.pointer, { enabled }));
      setNotice(enabled ? 'Pointer shown during computer actions.' : 'Pointer hidden. Computer actions stay connected.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); await refresh(); }
    finally { setBusy(null); }
  };
  const status = !overview ? 'Checking desktop' : !overview.supported ? 'Windows required' : busy === 'connect' || overview.connecting ? 'Connecting' : overview.connected ? 'Connected' : overview.installed ? 'Ready to connect' : 'Setup needed';
  return <section className="plugins-section computer-use-section" aria-labelledby="computer-use-heading">
    <div className="computer-use-card">
      <header className="computer-use-header">
        <span className="computer-use-mark" aria-hidden="true"><Icon name="panel" size={23} /></span>
        <div className="computer-use-title"><h2 id="computer-use-heading">{COMPUTER_USE_LABEL}</h2><p>Your desktop, with ANKITA</p></div>
        <span className="computer-use-status" data-connected={Boolean(overview?.connected)}><i aria-hidden="true" />{status}</span>
      </header>
      {!overview ? <div className="computer-use-loading">Checking your computer…</div> : <>
        <div className="computer-use-body">
          <div className="computer-use-controls">
            <p className="computer-use-description">Ask ANKITA to open apps, type, and click on your current desktop.</p>
            <div className="computer-use-capabilities"><span><Icon name="check" size={14} />No action prompts</span><span><Icon name="eye" size={14} />Screenshots with vision models</span></div>
            <div className="computer-use-actions">
              <button type="button" className="computer-use-button primary" onClick={() => void act('connect')} disabled={Boolean(busy) || !overview.supported || (!overview.installed && !command.trim()) || overview.connected}><Icon name={overview.connected ? 'check' : 'plug'} size={15} />{busy === 'connect' ? 'Connecting…' : overview.connected ? 'Connected' : 'Connect Computer Use'}</button>
              <button type="button" className="computer-use-button" onClick={() => void act('check')} disabled={Boolean(busy) || !overview.connected}><Icon name="refresh" size={15} />{busy === 'check' ? 'Checking…' : 'Check connection'}</button>
              <button type="button" className="computer-use-button stop" onClick={() => void act('stop')} disabled={busy === 'stop' || (!overview.connected && !busy)}><Icon name="stop" size={13} />{busy === 'stop' ? 'Stopping…' : 'Stop Computer Use'}</button>
            </div>
            {!overview.installed && <div className="computer-use-actions"><button type="button" className="computer-use-button" onClick={() => void window.ankita.openExternal(overview.docsUrl)}>Open Cua Driver setup<Icon name="external" size={14} /></button><button type="button" className="computer-use-button" onClick={() => void refresh()} disabled={Boolean(busy)}>Check again</button></div>}
          </div>
          <div className="computer-use-pointer" data-enabled={overview.pointerEnabled}>
            <span className="computer-use-pointer-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="currentColor"><path d="M11 6v27l7-7 6 11 5-3-6-10h10L11 6Z" /></svg></span>
            <label className="computer-use-pointer-label"><span><strong>Show pointer</strong><small id="computer-pointer-description">Follow the animated arrow as ANKITA works.</small></span><input type="checkbox" aria-label="Show pointer" aria-describedby="computer-pointer-description" checked={overview.pointerEnabled} onChange={event => void setPointer(event.target.checked)} disabled={Boolean(busy) || !overview.connected || !overview.pointerSupported} /></label>
            {overview.connected && !overview.pointerSupported && <small className="computer-use-hint">This driver does not expose animated pointer controls.</small>}
          </div>
        </div>
        <details className="computer-use-driver"><summary><Icon name="settings" size={15} /><span>Driver location</span><small>{overview.version ? `Cua Driver ${overview.version}` : 'Detected automatically'}</small><Icon name="chevron" size={14} /></summary>
          <div className="computer-use-driver-content"><label htmlFor="computer-driver-path">Cua Driver executable</label><input id="computer-driver-path" value={command} placeholder={overview.command || 'Select your installed driver path'} onChange={event => setCommand(event.target.value)} disabled={Boolean(busy) || overview.connected} /><p>Use the full executable path if it was installed somewhere else.</p></div>
        </details>
        <p className="computer-use-footnote"><Icon name="info" size={14} />Starts when you connect. Stop leaves your apps open.</p>
      </>}
      {(error || overview?.error) && <p className="computer-use-feedback error" role="alert"><Icon name="alert" size={16} /><span>{error || overview?.error}</span></p>}
      {notice && <p className="computer-use-feedback" role="status"><Icon name="check" size={16} /><span>{notice}</span></p>}
    </div>
  </section>;
}
