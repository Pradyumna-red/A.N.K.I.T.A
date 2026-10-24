import { NATIVE_TOOL_SURFACES } from '../../src/integrations/chatgpt-browser/protocol.mjs';
export { CHATGPT_BROWSER_PROVIDER } from '../../src/integrations/chatgpt-browser/protocol.mjs';
export { BROWSER_TRANSPORT_NOTICE } from '../../src/integrations/chatgpt-browser/protocol.mjs';
export const CHATGPT_BROWSER_LABEL = 'ChatGPT Browser';
export const CHATGPT_BROWSER_MODES = Object.freeze({ builtin: 'builtin', chrome: 'chrome', legacy: 'legacy' }); // Built-in Chromium or the installed Chrome companion; legacy preserves existing explicit pairings.
export const CHATGPT_BROWSER_CHOICES = Object.freeze([
  { id: CHATGPT_BROWSER_MODES.builtin, label: 'ANKITA window', action: 'Open ANKITA window', icon: 'panel', detail: 'A compact window inside ANKITA. Your sign-in stays saved.' },
  { id: CHATGPT_BROWSER_MODES.chrome, label: 'My Chrome', action: 'Use my Chrome', icon: 'browser', detail: 'Use the Chrome profile you already signed into. Companion needed once.' },
]); // One vocabulary for browser choices in Settings.
export const CHATGPT_CHROME_SETUP_MESSAGE = 'In ANKITA, open Settings → Providers, choose My Chrome, then click Use my Chrome. Keep this Chrome profile open.'; // The companion cannot discover the internal-only ANKITA window.
export const chatgptHasPendingReply = state => Boolean(state?.replying || state?.recoverable?.length || (state?.remoteStop && state.remoteStop !== 'confirmed')); // Unimported or stopped-but-unconfirmed work must remain with its original teammate.
export const CHATGPT_CONNECTION_CHANGED = 'chatgpt-connection-changed';
export const CHATGPT_CURRENT_MODEL_LABEL = 'Current ChatGPT model'; // Honest display label, never a fabricated provider model ID.
export const CHATGPT_PROFILE_DIRECTORY = 'chatgpt-browser'; // App-owned profile subdirectory; host discovers its parent.
export const CHATGPT_WORKSPACE_DIRECTORY = 'chatgpt-workspace'; // Safe projectless workspace under app data, shown in connection settings.
export const CHATGPT_SETUP_MESSAGE = 'Connect your existing ChatGPT conversation in Settings before sending.';
export const CHATGPT_COMPANION_UPDATE_MESSAGE = 'Update ANKITA ChatGPT Companion, reload it in Chrome, then Observe this chat again before sending with tools.'; // A legacy companion must be caught before it types an app-bearing draft.
export const CHATGPT_CONNECTION_ACTIONS = Object.freeze({ overview: 'chatgptConnectionOverview', start: 'chatgptConnectionStart',
  show: 'chatgptConnectionShow', signIn: 'chatgptChromeSignIn',
  disconnect: 'chatgptConnectionDisconnect', folder: 'chatgptCompanionFolder', copyPairing: 'chatgptCopyPairing',
  nativePreferences: 'chatgptNativePreferences', nativeSaveApps: 'chatgptNativeSaveApps', nativeStart: 'chatgptNativeStart', nativeStop: 'chatgptNativeStop', resume: 'chatgptResumeReply', handoff: 'chatgptContextHandoff' }); // Owner-window setup IPC contract.
export const CHATGPT_NATIVE_SURFACES = Object.freeze([
  { id: NATIVE_TOOL_SURFACES.core, name: 'ANKITA Core', label: 'Files and commands', description: 'Read and edit files in your selected workspace, and run commands.' },
  { id: NATIVE_TOOL_SURFACES.desktop, name: 'ANKITA Desktop', label: 'Desktop and browser', description: 'Use your connected Computer Use driver and ANKITA task browsers.' },
  { id: NATIVE_TOOL_SURFACES.plugins, name: 'ANKITA Plugins', label: 'Connected plugins', description: 'Use the external plugins you have connected in ANKITA.' },
]); // Each surface has its own discovery and connection permission.
export const CHATGPT_NATIVE_SETUP_LINKS = Object.freeze({ tunnels: 'https://platform.openai.com/settings/organization/tunnels',
  keys: 'https://platform.openai.com/settings/organization/api-keys', plugins: 'https://chatgpt.com/settings/plugins-settings' }); // Owner-opened account setup pages; the ChatGPT route matches the reviewed CoS flow.
