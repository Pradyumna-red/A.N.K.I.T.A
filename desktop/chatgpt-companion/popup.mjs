const byId = id => document.getElementById(id);
const status = byId('status'); const selector = byId('tabs');
const BIND_CONTROL_ID = 'bind'; // Popup control whose availability follows the durable conversation list.
const PAIRING_REQUIRED_STATUS = 'pairing-required'; // Background response before any owner pairing.
const PAIRING_OPTION = 'Connect to discover your ChatGPT conversations';
const EMPTY_OPTION = 'No existing ChatGPT conversation found';
const EMPTY_MESSAGE = 'Open a saved ChatGPT conversation in this Chrome profile, then reopen the companion. The blank new-chat page cannot be selected.';
async function action(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response.error) throw new Error(response.error);
  return response.value;
}
async function refresh() {
  const view = await action({ type: 'status' });
  const tabs = view.tabs ?? [];
  const needsPairing = view.status === PAIRING_REQUIRED_STATUS;
  const options = tabs.map(tab => {
    const option = document.createElement('option'); option.value = String(tab.id);
    option.textContent = `${tab.title || 'ChatGPT'} · ${tab.conversationId}`; option.selected = tab.bound; return option;
  });
  if (!options.length) {
    const option = document.createElement('option'); option.value = ''; option.textContent = needsPairing ? PAIRING_OPTION : EMPTY_OPTION;
    options.push(option);
  }
  selector.replaceChildren(...options);
  selector.disabled = !tabs.length; byId(BIND_CONTROL_ID).disabled = selector.disabled;
  const detail = view.modelMode === wire.modelModes.current && view.status === wire.readyStatus && !view.selectedModel
    ? wire.currentModelMessage : wire.observationMessages[view.observationReason];
  status.textContent = !needsPairing && !tabs.length ? EMPTY_MESSAGE : detail ?? (view.selectedModel ? `${view.status} · ${view.selectedModel}` : view.status);
}
function click(id, callback) {
  byId(id).addEventListener('click', async () => {
    byId(id).disabled = true;
    try { await callback(); await refresh(); } catch (error) { status.textContent = error.message; }
    finally { byId(id).disabled = id === BIND_CONTROL_ID ? selector.disabled : false; }
  });
}
click('connect', async () => { await action({ type: 'connect', url: byId('pairing').value }); byId('pairing').value = ''; });
click(BIND_CONTROL_ID, () => action({ type: 'bind', tabId: Number(selector.value) }));
click('disconnect', () => action({ type: 'disconnect' }));
refresh().catch(error => { status.textContent = error.message; });
import { wire } from './wire.mjs';
const refreshTimer = setInterval(() => refresh().catch(error => { status.textContent = error.message; }), wire.pollMs);
window.addEventListener('unload', () => clearInterval(refreshTimer), { once: true });
