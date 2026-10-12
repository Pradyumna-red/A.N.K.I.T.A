const byId = id => document.getElementById(id);
const status = byId('status'); const selector = byId('tabs');
async function action(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (response.error) throw new Error(response.error);
  return response.value;
}
async function refresh() {
  const view = await action({ type: 'status' });
  selector.replaceChildren(...(view.tabs ?? []).map(tab => {
    const option = document.createElement('option'); option.value = String(tab.id);
    option.textContent = `${tab.title || 'ChatGPT'} · ${tab.conversationId}`; option.selected = tab.bound; return option;
  }));
  status.textContent = view.selectedModel ? `${view.status} · ${view.selectedModel}` : view.status;
}
function click(id, callback) {
  byId(id).addEventListener('click', async () => {
    byId(id).disabled = true;
    try { await callback(); await refresh(); } catch (error) { status.textContent = error.message; }
    finally { byId(id).disabled = false; }
  });
}
click('connect', async () => { await action({ type: 'connect', url: byId('pairing').value }); byId('pairing').value = ''; });
click('bind', () => action({ type: 'bind', tabId: Number(selector.value) }));
click('disconnect', () => action({ type: 'disconnect' }));
refresh().catch(error => { status.textContent = error.message; });
import { wire } from './wire.mjs';
const refreshTimer = setInterval(() => refresh().catch(error => { status.textContent = error.message; }), wire.pollMs);
window.addEventListener('unload', () => clearInterval(refreshTimer), { once: true });
