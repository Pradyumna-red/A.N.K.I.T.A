import { wire } from './wire.mjs';

const MAIN_WORLD = 'MAIN';
const boundRoute = (url, binding, config) => { try { const parsed = new URL(url); return parsed.origin === wire.chatgptOrigin && parsed.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] === binding.conversationId; } catch { return false; } };
export function prepareSelectedSend(operation, config) { return globalThis[config.deliveryGlobal]?.prepare(operation, config) ?? { ready: false }; }
export function clickSelectedSend(operation, config) { return globalThis[config.deliveryGlobal]?.send(operation, config) ?? { dispatched: false }; }
export function inspectSelectedDelivery(binding, config) { return globalThis[config.deliveryGlobal]?.snapshot(binding, config) ?? null; }
export async function executeBoundSend(chromeApi, operation, { config = wire, authorize, acknowledge } = {}) {
  const binding = operation.binding, { leaseId, epoch, tabId, conversationId } = binding;
  const projected = { id: operation.id, kind: operation.kind, text: operation.text, modelId: operation.modelId, scope: { leaseId, epoch, tabId, conversationId } };
  const inspect = async func => {
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config)) return null;
    const readings = await chromeApi.scripting.executeScript({ target: { tabId }, world: MAIN_WORLD, func, args: [projected, config] });
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config) || readings.length !== 1) return null;
    return readings[0].result;
  };
  try {
    let prepared = await inspect(prepareSelectedSend);
    const deadline = Date.now() + config.sendReadyMs;
    while (!prepared?.ready && prepared?.reason === 'control-pending' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, config.sendReadyPollMs));
      prepared = await inspect(prepareSelectedSend);
    }
    if (!prepared?.ready) return { dispatched: false, reason: prepared?.reason ?? 'page-unavailable' };
    if (await authorize(operation.id, { baselineUserIds: prepared.baselineUserIds }) !== true) return { dispatched: false, reason: 'authorization-spent' };
    const sent = await inspect(clickSelectedSend);
    if (!sent?.dispatched) return { dispatched: false, reason: 'dispatch-unconfirmed' };
    const readings = await chromeApi.scripting.executeScript({ target: { tabId }, world: MAIN_WORLD, func: inspectSelectedDelivery, args: [projected.scope, config] });
    if (boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config) && readings.length === 1 && readings[0].result?.receipt) await acknowledge(readings[0].result.receipt);
    return { dispatched: true };
  } catch { return { dispatched: false, reason: 'delivery-uncertain' }; } // Lost ACK never earns another authorization/Send.
}
