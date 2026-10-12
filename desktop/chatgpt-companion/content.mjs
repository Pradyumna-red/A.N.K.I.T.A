/** Serialized into the MAIN world of one selected tab. Only allowlisted metadata is returned.
 * No page message listener, secret, prompt content, cookies, action callback or private API request.
 */
export function readSelectedPage(conversationId, config, binding) {
  const empty = { conversationId: null, accountReady: false, models: [], selectedModel: null, requestIds: [], observationReason: config.observationReasons.route };
  const readers = globalThis[config.readerGlobal];
  if (location.origin !== config.chatgptOrigin || location.pathname.match(new RegExp(config.conversationPattern, 'i'))?.[1] !== conversationId) return empty;
  const ids = new Set();
  const origins = globalThis[config.originsGlobal];
  const observerReady = origins?.bind(binding, config) === true;
  const streamIds = observerReady ? origins.requestIds(binding) : [];
  const evidence = () => ({ observerReady, streamIds: streamIds.length, domIds: Math.min(ids.size, config.maxRequests) });
  const projectIds = () => [...new Set([...ids, ...streamIds])].slice(-config.maxRequests); // Fresh stream evidence takes precedence over historical DOM capacity.
  const unavailable = (reason, pageReady = false) => ({ ...empty, conversationId, accountReady: pageReady, requestIds: projectIds(), requestEvidence: evidence(), observationReason: reason });
  if (!readers) return unavailable(config.observationReasons.readers);
  let pageReady = false;
  try {
    const composer = readers.composer();
    if (!composer) return unavailable(config.observationReasons.composer);
    // Current-model mode leaves the browser's selection alone; native ownership never depends on picker visibility.
    pageReady = true;
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
    const form = composer.closest(config.composerForm);
    const nodes = [...new Set([...(form?.querySelectorAll(config.formModelTriggers) ?? []), ...document.querySelectorAll(config.modelTriggers)])]
      .filter(node => node.matches(config.modelTriggerRoles) && !node.closest(config.modelTriggerExclusions) && node.getClientRects().length > 0 &&
        node.id !== config.composerPlusId && node.getAttribute(config.testIdAttribute) !== config.composerPlusId);
    if (nodes.length > config.maxPickers) return unavailable(config.observationReasons.budget, pageReady);
    const states = nodes.map(node => ({ node, picker: readers.readPickerSnapshot(node) || readers.readShellPickerSnapshot(node) })).filter(state => state.picker);
    const reported = states.filter(state => state.node.matches(config.modelTriggers));
    const identified = reported.length === 1 ? reported[0] : states.length === 1 ? states[0] : null;
    if (!identified) return unavailable(states.length ? config.observationReasons.ambiguous : config.observationReasons.picker, pageReady);
    const picker = identified.picker;
    const selected = picker.choices.find(choice => choice.bucket === picker.currentBucket);
    return { conversationId, accountReady: true, selectedModel: selected?.id ?? null, selectedEffort: selected?.effort ?? null,
      models: picker.choices.slice(0, config.maxModels).map(choice => ({ id: choice.id, label: choice.label, effort: choice.effort, available: choice.available === true })),
      requestIds: projectIds(), requestEvidence: evidence(), observationReason: null };
  } catch { return unavailable(config.observationReasons.error, pageReady); }
}
