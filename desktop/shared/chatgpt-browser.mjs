export { CHATGPT_BROWSER_PROVIDER } from '../../src/integrations/chatgpt-browser/protocol.mjs';
export const CHATGPT_BROWSER_LABEL = 'ChatGPT Browser';
export const CHATGPT_CONNECTION_CHANGED = 'chatgpt-connection-changed';
export const CHATGPT_CURRENT_MODEL_LABEL = 'Current ChatGPT model'; // Honest display label, never a fabricated provider model ID.
export const CHATGPT_PROFILE_DIRECTORY = 'chatgpt-browser'; // App-owned profile subdirectory; host discovers its parent.
export const CHATGPT_WORKSPACE_DIRECTORY = 'chatgpt-workspace'; // Safe projectless workspace under app data, shown in connection settings.
export const CHATGPT_SETUP_MESSAGE = 'Connect your existing ChatGPT conversation in Settings before sending.';
export const CHATGPT_CONNECTION_ACTIONS = Object.freeze({ overview: 'chatgptConnectionOverview', start: 'chatgptConnectionStart',
  disconnect: 'chatgptConnectionDisconnect', folder: 'chatgptCompanionFolder', copyPairing: 'chatgptCopyPairing' }); // Owner-window setup IPC contract.
