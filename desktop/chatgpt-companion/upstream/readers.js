/* Focused MIT fork; provenance and full license: vendor/chat-on-steroids. */
var AnkitaPageReaders = (() => {
  const MAX_CLIMB = 80; // Fiber ancestors/read: upstream runaway guard, not a shape assumption.
  const MAX_ROOT_DEPTH = 2048; // Fiber root levels/read: current committed-tree limit from upstream.
  const MAX_TEXT = 200; // Characters/identity: only opaque allowlisted metadata leaves the page.
  const OWN_SURFACES = '.clf-stream, .clf-stage, .clf-composer, .clf-boot'; // Excludes upstream-owned DOM if co-installed.
  const safe = (fn, fallback) => { try { return fn() ?? fallback; } catch { return fallback; } };
  const MAX_VERSIONS = 20; // Account-evaluated version groups/read; upstream parser bound.
  const MAX_LANES = 12; // Account-evaluated lanes/read; upstream parser bound.
  const MAX_LABEL_CHARS = 80; // Characters/native model label or group identity; never arbitrary account state.
  const MAX_SIBLING_NODES = 4096; // Nodes/committed-path check; cycle/runaway budget from the source reader.
  const MAX_SHELL_CLIMB = 16; // Fiber ancestors/native typed exchange, upstream shell-source bound.
  const MAX_SHELL_ITEMS = 400; // Typed items/exchange, upstream row bound.
  const ONLY_CONTENT_REFERENCES = /^\s*(?:::chatgpt-content-reference\{[^}\n]*\}\s*)+$/; // Native public-widget reference grammar.
  const ROOT_TAG = 3; // React host-root tag used by the upstream committed-tree proof.
  const FIBER_PREFIX = '__reactFiber$'; // React's DOM-owned opaque Fiber key prefix.
  const MODEL_ID = /^[a-zA-Z0-9._-]{1,80}$/; // Characters/native model slug, same upstream bound as labels.
  const GROUP_ID = /^[\p{L}\p{N}._ -]{1,80}$/u; // Characters/localized native group name; not an execution slug.
  let currentPaths = null; // Cache only within one synchronous read; no retained React tree.
  function onKeptPage(node) {
    for (let page = node?.closest?.('[data-app-shell-page-surface]'); page;
      page = page.parentElement?.closest('[data-app-shell-page-surface]')) {
      if (getComputedStyle(page).display === 'none') return true;
    }
    return false;
  }

  function composerCssVisible(node) {
    return safe(() => {
      if (!node || onKeptPage(node)) return false;
      for (let parent = node; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      }
      return true;
    }, false);
  }

  function composer() {
    return safe(() => {
      const classic = [...document.querySelectorAll('#prompt-textarea')].filter(composerCssVisible);
      if (classic.length) return classic.length === 1 ? classic[0] : null;
      // The current rich editor can remount before its surrounding form regains
      // data-chatgpt-composer. Accept that stable editor identity, but only while
      // the visible candidate remains unique.
      const candidates = [...document.querySelectorAll(
        'form[data-chatgpt-composer] [contenteditable="true"][role="textbox"], ' +
        'form [data-composer-markdown][contenteditable="true"][role="textbox"]'
      )]
        .filter(node => !node.closest(`${OWN_SURFACES},[data-turn-key],.markdown,[hidden],[aria-hidden="true"],[inert]`) &&
          composerCssVisible(node));
      return candidates.length === 1 ? candidates[0] : null;
    }, null);
  }

  function str(value) {
    return typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_TEXT) : null;
  }

  function committedPath(fiber) {
    const path = [], seen = new Set();
    let at = fiber, base = null, paired = false;
    const view = (node, parent) => ({ memoizedProps: node.memoizedProps,
      memoizedState: node.memoizedState, updateQueue: node.updateQueue, return: parent });
    const remember = (node, value) => {
      currentPaths?.set(node, value);
      if (node.alternate) currentPaths?.set(node.alternate, value);
    };
    while (at && path.length < MAX_ROOT_DEPTH) {
      if (seen.has(at)) return null;
      seen.add(at);
      const cached = currentPaths?.get(at);
      if (cached && cached.root.current === cached.current) { base = cached; break; }
      paired ||= !!at.alternate;
      if (at.tag === ROOT_TAG) {
        const root = at.stateNode, current = root?.current;
        if (!current || (current !== at && current !== at.alternate)) return null;
        base = { root, current, node: current, view: view(current, null) };
        remember(at, base);
        break;
      }
      path.push(at); at = at.return;
    }
    // Older unpaired owner facades have no root bookkeeping. A double-buffered
    // or actual React tree must prove its committed root, including on unmount.
    if (!base) return !paired && !at && path.every(node => typeof node.tag !== 'number') ? fiber : null;
    let budget = MAX_SIBLING_NODES;
    for (let index = path.length - 1; index >= 0; index--) {
      const wanted = path[index];
      let selected = null;
      // Walk only this parent's child list, never an arbitrary subtree or cache.
      // Return links can still name the previous parent after a React bailout.
      for (let child = base.node.child; child; child = child.sibling) {
        if (--budget < 0) return null;
        if (child !== wanted && child !== wanted.alternate) continue;
        if (selected) return null;
        selected = child;
      }
      if (!selected || base.root.current !== base.current) return null;
      base = { root: base.root, current: base.current, node: selected, view: view(selected, base.view) };
      remember(wanted, base);
    }
    return base.view;
  }

  function fiberOf(node) {
    for (const key in node) {
      if (key.startsWith(FIBER_PREFIX)) return committedPath(node[key]);
    }
    return null;
  }

  function turnMessagesOf(fiber) {
    let at = fiber;
    for (let up = 0; at && up < MAX_CLIMB; up++, at = at.return) {
      const props = at.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      const turn = props.turn;
      if (turn && typeof turn === 'object' && Array.isArray(turn.messages)) return turn.messages;
      if (Array.isArray(props.allMessages)) return props.allMessages;
    }
    return null;
  }

  function unescapeFallbackMarkdown(markdown) {
    let fence = null;
    return markdown.split('\n').map(line => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence) {
        if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) fence = null;
        return line;
      }
      if (marker && !(marker[0] === '`' && line.slice(line.indexOf(marker) + marker.length).includes('`'))) { fence = marker; return line; }
      let out = '';
      for (let at = 0; at < line.length;) {
        const char = line[at];
        if (char === '\\' && /[!-\/:-@[-`{-~]/.test(line[at + 1] || '')) { out += line[at + 1]; at += 2; continue; }
        if (char === '`') {
          const run = /^`+/.exec(line.slice(at))[0];
          const close = new RegExp(`(?<!\`)${run}(?!\`)`).exec(line.slice(at + run.length));
          if (close) { const end = at + run.length + close.index + run.length; out += line.slice(at, end); at = end; continue; }
          out += run; at += run.length; continue;
        }
        out += char; at++;
      }
      return out;
    }).join('\n');
  }
  function shellItemText(item, maxChars) {
    const content = typeof item?.content === 'string' ? item.content : '';
    if (!ONLY_CONTENT_REFERENCES.test(content)) return content;
    const id = str(item.messageId);
    const own = (Array.isArray(item.contentReferences) ? item.contentReferences : []).slice(0, MAX_SHELL_ITEMS).filter(reference =>
      reference?.type === 'dil' && id && reference.source_message_id === id && typeof reference.model_dil_v2?.fallbackMarkdown === 'string' && reference.model_dil_v2.fallbackMarkdown.trim());
    return own.length === 1 && own[0].model_dil_v2.fallbackMarkdown.length <= maxChars ? unescapeFallbackMarkdown(own[0].model_dil_v2.fallbackMarkdown) : content;
  }
  function shellTurnMessages(fiber, turnId, maxChars) {
    let entry = null;
    for (let at = fiber, up = 0; at && up < MAX_SHELL_CLIMB; up++, at = at.return) {
      if (Array.isArray(at.memoizedProps?.entry?.turn?.items)) { entry = at.memoizedProps.entry; break; }
    }
    if (!entry) return null; // No typed shell: the classic turn reader may still apply.
    if (!turnId || entry.id !== turnId || entry.turn.items.length > MAX_SHELL_ITEMS) return [];
    const messages = [], seen = new Set();
    for (const item of entry.turn.items) {
      if (item?.type !== 'user-message' && item?.type !== 'assistant-message') continue;
      const user = item.type === 'user-message', id = str(item.messageId) || (user ? str(item.serverMessageId) : null);
      if (!id) continue;
      if (seen.has(id) || (user && item.serverMessageId && item.messageId && item.serverMessageId !== item.messageId)) return [];
      seen.add(id);
      const final = !user && item.phase === 'final_answer';
      if (!user && !final) continue; // Working groups and interim/private prose are outside delivery history.
      const text = user ? item.message : shellItemText(item, maxChars);
      const completed = final && item.completed === true && entry.turn.status === 'complete';
      messages.push({ id, author: { role: user ? 'user' : 'assistant' }, content: { content_type: 'text', parts: [typeof text === 'string' ? text : ''] },
        channel: user ? null : 'final', end_turn: completed, status: completed ? 'finished_successfully' : 'in_progress', metadata: {} });
    }
    return messages;
  }

  function conversationEvidenceOf(fiber) {
    let found = null;
    const conversations = new Map();
    let at = fiber;
    for (let up = 0; at && up < MAX_CLIMB; up++, at = at.return) {
      const props = at.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      const turn = props.turn && typeof props.turn === 'object' ? props.turn : null;
      // The mounted conversation.id can be a local WEB identity, not the /c id.
      // Its serverId$ signal is the read-only durable identity used by that same
      // conversation object. Read it once per object; never equate the local id
      // with the page route or infer ownership from the URL itself.
      const conversation = props.conversation && typeof props.conversation === 'object' ? props.conversation : null;
      if (conversation && !conversations.has(conversation)) {
        let serverId = null;
        try {
          const value = typeof conversation.serverId$ === 'function' ? conversation.serverId$() : null;
          if (typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)) serverId = value;
        } catch { /* Unresolved signal carries no durable identity. */ }
        conversations.set(conversation, serverId);
      }
      const values = [props.clientThreadId, props.conversationId, conversation && conversation.id,
        Array.isArray(props.entry?.turn?.items) ? props.entry.conversationId : null,
        conversations.get(conversation), turn && turn.clientThreadId, turn && turn.conversationId];
      for (let index = 0; index < values.length; index++) {
        const value = str(values[index]);
        if (!value || value.startsWith('WEB:') || value.startsWith('local-chatgpt:')) continue;
        if (found && found !== value) return { conversationId: null, conflict: true };
        found = value;
      }
    }
    return { conversationId: found, conflict: false };
  }

  function readPickerSnapshot(node) {
    let fiber = node && fiberOf(node);
    for (let up = 0; fiber && up < MAX_CLIMB; up++, fiber = fiber.return) {
      // The September composer retains the unmounted menu as dropdownContent.
      // Read that exact native child too; opening it is unnecessary for observation.
      const owner = fiber.memoizedProps;
      const props = owner?.composerIntelligencePickerState ? owner : owner?.dropdownContent?.props;
      const state = props?.composerIntelligencePickerState, data = props?.modelsData;
      if (!state || !Array.isArray(data?.versions)) continue;
      if (data.versions.length > MAX_VERSIONS || !Array.isArray(state.bucketSelections) || state.bucketSelections.length > MAX_LANES) return null;
      const id = value => typeof value === 'string' && MODEL_ID.test(value) ? value : null;
      // Native version groups may have spaces; execution slugs retain their strict contract.
      const groupId = value => typeof value === 'string' && value.length <= MAX_LABEL_CHARS && /^[\p{L}\p{N}._ -]+$/u.test(value) && value.trim() === value && value.trim() ? value : null;
      const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_LABEL_CHARS ? value.trim() : null;
      const effortOf = choice => choice.category?.modelLane === 'pro' ? 'pro'
        : ['auto', 'instant'].includes(choice.category?.modelLane) ? 'none'
        : choice.thinkingEffort === 'max' && choice.modelConfig?.isWorkModeModel === true ? 'max'
        : ({ min: 'low', standard: 'medium', extended: 'high', max: 'xhigh', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', ultra: 'ultra' })[choice.thinkingEffort] || null;
      const choices = state.bucketSelections.map(choice => {
        const name = label(choice.category?.shortLabel);
        // Native navigation groups may contain spaces or localized names. Those
        // are not execution ids: retain the exact provider slug for such families.
        const familyId = id(choice.category?.modelVersion) || id(choice.modelSlug);
        const family = data.versions.find(version => version.id === choice.category?.modelVersion);
        return { bucket: choice.bucket, id: id(choice.modelSlug),
          label: name && (/^\d/.test(name) ? `GPT-${name}` : name), effort: effortOf(choice),
          familyId, familyLabel: label(family?.displayTextForIntelligence) || label(choice.modelConfig?.title) || (name && (/^\d/.test(name) ? `GPT-${name}` : name)),
          available: choice.availability?.status === 'available' && !props.modelSwitcherDenialsBySlug?.[choice.modelSlug] };
      });
      const versions = data.versions.filter(version => version.enabled === true).map(version => ({ id: groupId(version.id), label: label(version.displayTextForIntelligence) }));
      if (!versions.length || versions.some(v => !v.id || !v.label) || choices.some(c => !Number.isInteger(c.bucket) || !c.id || !c.label || !c.effort) ||
          new Set(versions.map(v => v.id)).size !== versions.length || new Set(choices.map(c => c.bucket)).size !== choices.length) return null;
      const version = groupId(state.selectedVersionEntry?.id), currentBucket = state.currentBucket;
      if (!versions.some(v => v.id === version) || !choices.some(c => c.bucket === currentBucket)) return null;
      const selected = state.currentSelection;
      const chosen = choices.find(c => c.bucket === currentBucket);
      if (selected?.modelSlug !== chosen.id || effortOf(selected) !== chosen.effort) return null;
      return { version, currentBucket, versions, choices };
    }
    return null;
  }

  function shellProExecutionModel(value) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^(?:pro|(?:gpt-?)?\d+(?:[.-]\d+)?-pro)$/.test(normalized);
  }

  function shellLaneTransportEffort(value) {
    return ({ none:'none', minimal:'minimal', low:'low', medium:'medium', high:'high', xhigh:'xhigh', max:'xhigh' })[value] ?? null;
  }

  function readShellPickerSnapshot(node) {
    for (let fiber = node && fiberOf(node), up = 0; fiber && up < MAX_CLIMB; up++, fiber = fiber.return) {
      const p = fiber.memoizedProps;
      if (!Array.isArray(p?.powerSelections)) continue;
      const selected = p.selectedPowerSelection ?? p.selectedLabelCandidate, options = p.modelListConfig?.options;
      if (!selected || !Array.isArray(options) || options.length > MAX_VERSIONS || p.powerSelections.length > MAX_LANES) return null;
      const id = value => typeof value === 'string' && MODEL_ID.test(value) ? value : null;
      const group = value => typeof value === 'string' && GROUP_ID.test(value) && value.trim() === value ? value : null;
      const label = value => typeof value === 'string' && value.trim() && value.length <= MAX_LABEL_CHARS ? value.trim() : null;
      const effort = value => ({ none:'none', instant:'none', minimal:'minimal', min:'low', low:'low', standard:'medium', medium:'medium', extended:'high', high:'high', xhigh:'xhigh', 'extra high':'xhigh', max:'max', ultra:'ultra', pro:'pro' })[value] || null;
      // The machine reasoningEffort is a lane's transport setting, not its identity: the
      // Pro and Extra High lanes still report medium/max. The lane's visible label is what
      // the picker offers, matching readPickerSnapshot's modelLane/thinkingEffort mapping.
      // A translated label ("Sehr hoch") falls back to that transport value, where max is Extra High.
      const laneEffort = c => shellProExecutionModel(c?.model) ? 'pro' :
        effort(String(c?.labels?.effort ?? c?.sliderLabel ?? '').trim().toLowerCase()) ??
        ((c?.labels?.effort ?? c?.sliderLabel) ? shellLaneTransportEffort(c?.reasoningEffort) : effort(c?.reasoningEffort));
      const current = options.filter(o => o?.selected === true);
      if (current.length !== 1) return null;
      const version = group(current[0].id);
      const versions = options.filter(o => o && o.disabled !== true).map(o => ({ id: group(o.id), label: label(o.label) }));
      // The shell names older models by number alone ("5.6"); the September picker's own rule
      // names them in full, so the list reads GPT-6, GPT-5.6, GPT-5.5 alike.
      const modelName = value => { const name = label(value); return name && /^\d/.test(name) ? `GPT-${name}` : name; };
      const choices = p.powerSelections.map(c => ({ bucket: c?.powerSettingIndex, id: id(c?.model),
        label: modelName(c?.modelLabel), familyId: id(c?.model), familyLabel: modelName(c?.modelLabel), effort: laneEffort(c),
        available: p.modelSelectionDisabled !== true && c?.disabled !== true &&
          (!c?.availability || c.availability.status === 'available') && !p.modelSwitcherDenialsBySlug?.[c?.model] }));
      if (!version || !versions.length || versions.some(v => !v.id || !v.label) || !choices.length ||
          choices.some(c => !Number.isInteger(c.bucket) || !c.id || !c.label || !c.effort) ||
          new Set(versions.map(v => v.id)).size !== versions.length || new Set(choices.map(c => c.bucket)).size !== choices.length || !versions.some(v => v.id === version)) return null;
      // One model's Instant and thinking lanes are separate slugs under one name (gpt-6 and
      // gpt-6-thinking, both "GPT-6"; observed 2026-10-07). They are one family, as the September
      // picker had them, so the effort control offers Instant, Medium and High together. Lanes join
      // only under one name in this version and with distinct efforts: a mixed group never merges.
      // GPT-6's Instant lane is ChatGPT's automatic `gpt-6`, which its server may answer with the
      // thinking lane; the fixed `gpt-6-instant` exists but no native view offers it (2026-10-08).
      for (const name of new Set(choices.map(c => c.label))) {
        const lanes = choices.filter(c => c.label === name);
        if (lanes.length < 2 || new Set(lanes.map(c => c.effort)).size !== lanes.length) continue;
        const shared = lanes.map(c => c.id).reduce((a, b) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return a.slice(0, i); })
          .replace(/[-._]+$/, '');
        const family = id(shared) && /\d/.test(shared) ? shared : lanes[0].id;
        for (const lane of lanes) lane.familyId = family;
      }
      const matches = choices.filter(c => c.id === id(selected.model) && c.effort === laneEffort(selected));
      if (matches.length !== 1 || (selected.powerSettingIndex !== undefined && selected.powerSettingIndex !== matches[0].bucket)) return null;
      return { version, currentBucket: matches[0].bucket, versions, choices };
    }
    return null;
  }
  const finalMessage = message => message?.author?.role === 'assistant' && message.channel === 'final' &&
    message.end_turn === true && message.status === 'finished_successfully';
  return { composer, fiberOf, turnMessagesOf, shellTurnMessages, conversationEvidenceOf, readPickerSnapshot, readShellPickerSnapshot, finalMessage };
})();
