import { useEffect, useState } from 'react';
import type { ChatGptConnectionState } from '../../../shared/chatgpt-browser.mjs';
import { CHATGPT_CONNECTION_ACTIONS, CHATGPT_CONNECTION_CHANGED } from '../../../shared/chatgpt-browser.mjs';

// Chat consumes connection state only for Send/Stop guards; setup UI lives in Settings.
export function useChatGptConnection(enabled: boolean) {
  const [state, setState] = useState<ChatGptConnectionState | null>(null);
  useEffect(() => {
    if (!enabled) { setState(null); return; }
    let active = true, observed = false;
    const off = window.ankita.onEvent(event => { if (event.type === CHATGPT_CONNECTION_CHANGED) { observed = true; setState(event.state); } });
    void window.ankita.invoke<ChatGptConnectionState>(CHATGPT_CONNECTION_ACTIONS.overview).then(value => { if (active && !observed) setState(value); }).catch(() => {});
    return () => { active = false; off(); };
  }, [enabled]);
  return state;
}
