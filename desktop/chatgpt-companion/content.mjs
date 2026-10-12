/** Serialized into the MAIN world of one selected tab. Only allowlisted metadata is returned.
 * No page message listener, secret, prompt content, cookies, action callback or private API request.
 */
export function readSelectedPage(conversationId, config) {
  const empty = { conversationId: null, accountReady: false, models: [], selectedModel: null, requestIds: [] };
  const readers = globalThis[config.readerGlobal];
  if (!readers || location.origin !== config.chatgptOrigin || location.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] !== conversationId) return empty;
  try {
    if (!readers.composer()) return { ...empty, conversationId };
    const nodes = [...document.querySelectorAll(config.modelTriggers)].filter(node => !node.closest(config.hidden) && node.getClientRects().length > 0);
    if (nodes.length > config.maxPickers) return { ...empty, conversationId };
    const states = nodes.map(node => readers.readPickerSnapshot(node) || readers.readShellPickerSnapshot(node)).filter(Boolean);
    if (states.length !== 1) return { ...empty, conversationId };
    const picker = states[0];
    const selected = picker.choices.find(choice => choice.bucket === picker.currentBucket);
    const ids = new Set();
    for (const section of [...document.querySelectorAll(config.turns)].slice(-config.maxTurns)) {
      if (section.closest(config.hidden) || section.getClientRects().length === 0) continue;
      const fiber = readers.fiberOf(section);
      const scope = readers.conversationEvidenceOf(fiber);
      if (scope.conflict || scope.conversationId !== conversationId) continue;
      for (const message of (readers.turnMessagesOf(fiber) ?? []).slice(-config.maxRequests)) {
        const id = message?.metadata?.request_id;
        if (typeof id === 'string' && id.length <= config.maxIdChars && new RegExp(config.requestIdPattern, 'i').test(id)) ids.add(id);
      }
    }
    return { conversationId, accountReady: true, selectedModel: selected?.id ?? null, selectedEffort: selected?.effort ?? null,
      models: picker.choices.slice(0, config.maxModels).map(choice => ({ id: choice.id, label: choice.label, effort: choice.effort, available: choice.available === true })),
      requestIds: [...ids].slice(-config.maxRequests) };
  } catch { return { ...empty, conversationId }; }
}
