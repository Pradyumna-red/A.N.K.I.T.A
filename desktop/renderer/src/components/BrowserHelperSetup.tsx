import { useState } from 'react';
import { CAPTURE_ACTIONS } from '../../../browser-helper/protocol.mjs';
import { describeErrorNotice } from '../../../shared/error-notices.mjs';
import type { CaptureSetup, CaptureUnavailable } from '../lib/useMascotCapture';

const asSentence = (title: string) => /[.!?]$/.test(title) ? title : `${title}.`;
const explain = (error: unknown) => {
  const notice = describeErrorNotice(error);
  return [asSentence(notice.title), notice.detail, notice.hint].filter(Boolean).join(' ');
};
const explainUnavailable = (unavailable: CaptureUnavailable) =>
  [asSentence(unavailable.title), unavailable.detail, unavailable.hint].filter(Boolean).join(' ');

export function BrowserHelperSetup() {
  const [status, setStatus] = useState('');
  const [code, setCode] = useState('');
  const pair = async () => {
    try {
      const setup = await window.ankita.invoke<CaptureSetup>(CAPTURE_ACTIONS.setup);
      if (setup?.unavailable) { setCode(''); setStatus(explainUnavailable(setup.unavailable)); return; }
      const value = JSON.stringify({ address: setup.address, code: setup.code });
      setCode(value);
      try { await navigator.clipboard.writeText(value); setStatus('Code copied. Paste it into the helper popup.'); }
      catch { setStatus('Copy the code below into the helper popup.'); }
    } catch (error) { setStatus(explain(error)); }
  };
  return <div className="companion-helper-setup">
    <button type="button" onClick={() => { void window.ankita.invoke<{ unavailable?: CaptureUnavailable }>(CAPTURE_ACTIONS.openHelper).then(result => { if (result?.unavailable) setStatus(explainUnavailable(result.unavailable)); }).catch(error => setStatus(explain(error))); }}>Open helper folder</button>
    <button type="button" onClick={() => void pair()}>Copy pairing code</button>
    <p>In Chrome or Edge's Extensions page, enable Developer mode and choose Load unpacked for this folder. Paste the pairing code into its popup, then drag a mascot onto a webpage.</p>
    {code && <input readOnly aria-label="Browser pairing code" value={code} onFocus={event => event.target.select()} />}
    {status && <span role="status">{status}</span>}
  </div>;
}
