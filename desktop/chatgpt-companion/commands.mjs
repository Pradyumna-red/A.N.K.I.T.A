import { wire } from './wire.mjs';

const MAIN_WORLD = 'MAIN';
const boundRoute = (url, binding, config, sentOpening = false) => { try {
  const parsed = new URL(url), conversation = parsed.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] ?? null;
  return parsed.origin === config.chatgptOrigin && (binding.conversationId ? conversation === binding.conversationId : binding.openingId &&
    ((parsed.pathname === '/' && new URLSearchParams(parsed.hash.slice(1)).get(config.openingFragmentKey) === binding.openingId) || (sentOpening && Boolean(conversation))));
} catch { return false; } };
export function prepareSelectedSend(operation, config) { return globalThis[config.deliveryGlobal]?.prepare(operation, config) ?? { ready: false }; }
export function clickSelectedSend(operation, config) { return globalThis[config.deliveryGlobal]?.send(operation, config) ?? { dispatched: false }; }
export function inspectSelectedDelivery(binding, config) { return globalThis[config.deliveryGlobal]?.snapshot(binding, config) ?? null; }
export function prepareSelectedStop(command, config) { return globalThis[config.deliveryGlobal]?.prepareStop(command, config) ?? { ready: false }; }
export function clickSelectedStop(command, config) { return globalThis[config.deliveryGlobal]?.stop(command, config) ?? { confirmed: false }; }
export async function executeBoundStop(chromeApi, command, { config = wire, authorize, acknowledge } = {}) {
  const binding = command.binding, { leaseId, epoch, tabId, conversationId } = binding;
  const scope = { leaseId, epoch, tabId, conversationId, ...(binding.openingId ? { openingId: binding.openingId } : {}) };
  const projected = { id: command.id, phase: command.phase, scope, target: { id: command.target.id, text: command.target.text,
    baselineUserIds: command.target.baselineUserIds, receipt: command.target.receipt, appMentions: command.target.appMentions, scope, outcome: 'uncertain' } };
  const inspect = async func => {
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config)) return null;
    const readings = await chromeApi.scripting.executeScript({ target: { tabId }, world: MAIN_WORLD, func, args: [projected, config] });
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config) || readings.length !== 1) return null;
    return readings[0].result;
  };
  try {
    const prepared = await inspect(prepareSelectedStop);
    if (!prepared?.ready) return { confirmed: false };
    if (command.phase === 'pending') {
      if (await authorize(command.id, prepared.receipt) !== true) return { confirmed: false };
      const stopped = await inspect(clickSelectedStop);
      if (stopped?.confirmed) { await acknowledge(stopped.receipt); return { confirmed: true }; }
      return { confirmed: false };
    }
    if (prepared.finished) { await acknowledge(prepared.receipt); return { confirmed: true }; }
    return { confirmed: false }; // Dispatched/reloaded Stop is observation only, with no second click.
  } catch { return { confirmed: false }; }
}
export async function executeBoundSend(chromeApi, operation, { config = wire, authorize, acknowledge } = {}) {
  const binding = operation.binding, { leaseId, epoch, tabId, conversationId } = binding;
  const projected = { id: operation.id, kind: operation.kind, text: operation.text, modelId: operation.modelId, attachments: operation.attachments, scope: { leaseId, epoch, tabId, conversationId, ...(binding.openingId ? { openingId: binding.openingId } : {}) } };
  if (operation.appNames?.length) projected.appNames = operation.appNames;
  const inspect = async func => {
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config)) return null;
    const readings = await chromeApi.scripting.executeScript({ target: { tabId }, world: MAIN_WORLD, func, args: [projected, config] });
    if (!boundRoute((await chromeApi.tabs.get(tabId)).url, binding, config, func === clickSelectedSend && readings[0]?.result?.dispatched === true) || readings.length !== 1) return null;
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
    if (await authorize(operation.id, { baselineUserIds: prepared.baselineUserIds, attachments: prepared.attachments, appMentions: prepared.appMentions }) !== true) return { dispatched: false, reason: 'authorization-spent' };
    const sent = await inspect(clickSelectedSend);
    if (!sent?.dispatched) return { dispatched: false, reason: sent?.reason ?? 'dispatch-unconfirmed' };
    const readings = await chromeApi.scripting.executeScript({ target: { tabId }, world: MAIN_WORLD, func: inspectSelectedDelivery, args: [projected.scope, config] });
    const receipt = readings[0]?.result?.receipt;
    const observedBinding = receipt?.conversationId && !binding.conversationId && binding.openingId ? { ...binding, conversationId: receipt.conversationId } : binding;
    if (boundRoute((await chromeApi.tabs.get(tabId)).url, observedBinding, config) && readings.length === 1 && receipt) await acknowledge(receipt);
    return { dispatched: true };
  } catch { return { dispatched: false, reason: 'delivery-uncertain' }; } // Lost ACK never earns another authorization/Send.
}
