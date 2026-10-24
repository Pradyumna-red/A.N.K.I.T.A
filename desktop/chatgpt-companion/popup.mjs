import { SIGN_IN_COOKIE_PERMISSION } from './sign-in.mjs';
import { wire } from './wire.mjs';

const byId = id => document.getElementById(id);
const status = byId('status'), selector = byId('tabs');
const PAIRING_REQUIRED_STATUS = 'pairing-required'; // Wire state before a paired browser connection; also used after a failed local read.
const UNPAIRED_STATUSES = new Set([PAIRING_REQUIRED_STATUS, 'disconnected', 'setup-required']); // Wire states without an active selected browser connection.
const NETWORK_ERROR = /failed to fetch|fetch failed|networkerror|connection.*(?:refused|closed)|receiving end does not exist/i; // Browser/extension transport failures, presented as a recovery step.
const EMPTY_OPTION = 'No ChatGPT conversation found';
const EMPTY_MESSAGE = 'Open a saved ChatGPT conversation in this Chrome profile, then refresh here. A blank new-chat page cannot be selected.';
const SIGN_IN_EMPTY_MESSAGE = 'Open your signed-in ChatGPT tab in this Chrome profile, then refresh here.';
const CONNECTION_TITLES = Object.freeze({ ready: 'Connected to ANKITA', observing: 'Reading your chat', 'select-tab': 'Choose a ChatGPT chat',
  'page-unavailable': 'Check your ChatGPT chat', blocked: 'ChatGPT needs attention' }); // Display copy only; status values still come from the host.
const ACTION_ERRORS = Object.freeze({ permission: 'Chrome did not allow sign-in access. You can try again from ANKITA.',
  signIn: 'Sign-in could not be brought over. Keep your signed-in ChatGPT tab open, then start again in ANKITA.',
  chooseTab: 'Choose your signed-in ChatGPT tab first.',
  pending: 'A reply is still running. Finish or stop it in ANKITA before changing chats.',
  changed: 'The connection changed. Refresh here, then try again.',
  unknown: 'That step could not finish. Refresh the connection, then try again.' });
let signInOffer = null, selectedTabId = null, currentView = null, busy = false, readVersion = 0;

async function action(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response?.error) throw new Error(response.error);
  return response?.value;
}
function updateControls() {
  document.querySelector('main').setAttribute('aria-busy', String(busy));
  for (const id of ['connect', 'refresh', 'disconnect', 'pair-connect']) byId(id).disabled = busy;
  selector.disabled = busy || !selector.value;
  byId('bind').disabled = selector.disabled;
  const selected = currentView?.tabs?.find(tab => String(tab.id) === selector.value);
  byId('sign-in-transfer').disabled = busy || !signInOffer || !selected;
  byId('bind').hidden = selected?.signInTab === true || selected?.bound === true && currentView?.status === wire.readyStatus;
}
function paint(view) {
  currentView = view;
  const connected = !UNPAIRED_STATUSES.has(view.status) && !view.discoveryIssue;
  const tabs = connected ? view.tabs ?? [] : [];
  signInOffer = connected ? view.signInOffer ?? null : null;
  byId('sign-in-section').hidden = !signInOffer;
  byId('connect').hidden = connected;
  byId('connect').textContent = view.discoveryIssue ? 'Try again' : 'Connect to ANKITA';
  byId('disconnect').hidden = !connected;
  byId('conversation').hidden = !tabs.length;
  const preferred = tabs.find(tab => String(tab.id) === selectedTabId) ?? tabs.find(tab => tab.bound) ?? tabs[0];
  const options = tabs.map(tab => {
    const option = document.createElement('option'); option.value = String(tab.id);
    option.textContent = tab.title || (tab.conversationId || tab.signInTab ? 'ChatGPT' : 'New ANKITA chat');
    option.selected = tab.id === preferred?.id; return option;
  });
  if (!options.length) { const option = document.createElement('option'); option.value = ''; option.textContent = EMPTY_OPTION; options.push(option); }
  selector.replaceChildren(...options);
  const ready = view.status === wire.readyStatus;
  const detail = view.modelMode === wire.modelModes.current && ready && !view.selectedModel
    ? wire.currentModelMessage : wire.observationMessages[view.observationReason];
  byId('status-title').textContent = view.discoveryIssue ? 'ANKITA isn’t connected' : signInOffer ? 'Bring your Chrome sign-in' : connected ? CONNECTION_TITLES[view.status] ?? 'Check connection' : 'Connect your Chrome';
  status.closest('section').dataset.tone = ready && connected ? 'success' : view.discoveryIssue || view.status === 'blocked' ? 'attention' : 'neutral';
  status.textContent = !connected ? wire.chromeSetupMessage : signInOffer ? tabs.length ? 'Choose the ChatGPT tab you are signed into below.' : SIGN_IN_EMPTY_MESSAGE : !tabs.length ? EMPTY_MESSAGE : detail ?? (view.selectedModel
    ? `Using ${view.selectedModel}. Keep this ChatGPT chat open.` : view.status === 'blocked'
      ? 'Open your ChatGPT chat and check its notice. ANKITA will keep the same reply.'
      : 'Keep your selected ChatGPT chat open while ANKITA works.');
  updateControls();
}
function unavailable() { paint({ status: PAIRING_REQUIRED_STATUS, discoveryIssue: true, tabs: [] }); }
function showNotice(message) { byId('notice').textContent = message; byId('notice').hidden = false; }
function showError(error) {
  const message = String(error?.message ?? '');
  if (NETWORK_ERROR.test(message) || message === wire.chromeSetupMessage) { unavailable(); return; }
  showNotice(/unresolved|confirm Stop|already replying/i.test(message) ? ACTION_ERRORS.pending
    : /40[139]/.test(message) ? ACTION_ERRORS.changed : Object.values(ACTION_ERRORS).includes(message) ? message : ACTION_ERRORS.unknown);
}
async function refresh() {
  const version = ++readVersion;
  try { const view = await action({ type: 'status' }); if (version === readVersion) paint(view); }
  catch { if (version === readVersion) unavailable(); }
}
async function perform(callback) {
  if (busy) return;
  busy = true; readVersion++; byId('notice').hidden = true; updateControls();
  try { await callback(); await refresh(); } catch (error) { showError(error); }
  finally { busy = false; updateControls(); }
}
function click(id, callback) { byId(id).addEventListener('click', () => void perform(callback)); }
selector.addEventListener('change', () => { selectedTabId = selector.value; updateControls(); });
click('connect', () => action({ type: 'connect' }));
click('pair-connect', async () => {
  if (!byId('pairing').value.trim()) { showNotice('Paste the pairing link from your older ANKITA app first.'); return; }
  await action({ type: 'connect', url: byId('pairing').value }); byId('pairing').value = '';
});
click('bind', async () => { await action({ type: 'bind', tabId: Number(selector.value) }); selectedTabId = null; });
click('refresh', async () => {}); // perform() makes one read-only refresh, without connecting or sending.
click('disconnect', async () => { await action({ type: 'disconnect' }); selectedTabId = null; });
byId('sign-in-transfer').addEventListener('click', () => {
  if (busy) return;
  const offer = signInOffer, tabId = Number(selector.value);
  if (!offer || !Number.isSafeInteger(tabId) || !selector.value) { showNotice(ACTION_ERRORS.chooseTab); return; }
  const permission = chrome.permissions.request({ permissions: [SIGN_IN_COOKIE_PERMISSION] }); // Keep Chrome's user gesture before any await or messaging.
  void perform(async () => {
    if (!await permission) throw new Error(ACTION_ERRORS.permission);
    try { await action({ type: 'sign-in-transfer', id: offer.id, tabId }); }
    catch { throw new Error(ACTION_ERRORS.signIn); }
    showNotice('Sign-in is ready. Return to ANKITA’s ChatGPT window.');
  });
});
void perform(async () => {});
const refreshTimer = setInterval(() => { if (!busy) void refresh(); }, wire.pollMs);
window.addEventListener('unload', () => { readVersion++; clearInterval(refreshTimer); }, { once: true });
