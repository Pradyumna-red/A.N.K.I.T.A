import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { readSelectedPage } from '../../desktop/chatgpt-companion/content.mjs';
import { browserWire } from '../../services/chatgpt-bridge/config.mjs';

const adapterPath = new URL('../../desktop/chatgpt-companion/upstream/readers.js', import.meta.url);
function adapter(document) {
  const context = { document, location: { pathname: '/c/owned' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context);
  return context.AnkitaPageReaders;
}
const element = fiber => ({ __reactFiber$fixture: fiber, parentElement: null, closest: () => null, getClientRects: () => [{}], getAttribute: () => null });

function selectedPage({ picker = true, unrelatedMenus = 0, withRequest = false } = {}) {
  const conversationId = crypto.randomUUID();
  const choice = { bucket: 1, modelSlug: 'account-model', category: { modelLane: 'instant', shortLabel: 'Account model', modelVersion: 'family' }, availability: { status: 'available' } };
  const trigger = element({ memoizedProps: { composerIntelligencePickerState: {
    bucketSelections: [choice], currentBucket: 1, selectedVersionEntry: { id: 'family' }, currentSelection: choice,
  }, modelsData: { versions: [{ id: 'family', displayTextForIntelligence: 'Family', enabled: true }] } } });
  trigger.matches = () => true;
  const menus = Array.from({ length: unrelatedMenus }, () => ({ ...element({ memoizedProps: {} }), matches: () => true }));
  const form = { querySelectorAll: selector => selector === 'button[aria-haspopup="menu"]' && picker ? [trigger] : [] };
  const editor = { ...element({ memoizedProps: {} }), closest: selector => selector === 'form' ? form : null };
  const turn = element({ memoizedProps: { conversationId, turn: { messages: [{ metadata: { request_id: 'owned-current-request' } }] } } });
  const document = { querySelectorAll: selector => {
    if (selector === '#prompt-textarea') return [editor];
    if (selector.includes('button[aria-haspopup="menu"]')) return [...menus, ...(picker ? [trigger] : [])];
    if (selector.includes('[data-codex-intelligence-trigger]')) return picker ? [trigger] : [];
    if (selector.includes('conversation-turn')) return withRequest ? [turn] : [];
    return [];
  } };
  const context = vm.createContext({ document, location: { origin: 'https://chatgpt.com', pathname: `/c/${conversationId}` },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) });
  vm.runInContext(fs.readFileSync(adapterPath, 'utf8'), context);
  const read = vm.runInContext(`(${readSelectedPage.toString()})`, context);
  return JSON.parse(JSON.stringify(read(conversationId, browserWire)));
}

test('unrelated sidebar menus cannot hide the selected composer model or exceed its picker budget', () => {
  const actual = selectedPage({ unrelatedMenus: 20 });
  assert.equal(actual.accountReady, true);
  assert.equal(actual.selectedModel, 'account-model');
  assert.equal(actual.models.length, 1);
  assert.equal(actual.models[0].available, true);
});

test('a visible chat editor with unreadable model controls keeps page evidence and reports the missing picker', () => {
  const actual = selectedPage({ picker: false });
  assert.equal(actual.accountReady, true, 'missing model evidence is not a logged-out account');
  assert.equal(actual.selectedModel, null);
  assert.deepEqual(actual.models, []);
  assert.equal(actual.observationReason, 'model-picker-unavailable');
});

test('native request evidence is read from its exact conversation even when the model picker is unavailable', () => {
  const actual = selectedPage({ picker: false, withRequest: true });
  assert.deepEqual(actual.requestIds, ['owned-current-request']);
  assert.equal(actual.selectedModel, null);
});

test('actual focused Fiber reader discovers only account-evaluated choices and selected model', () => {
  const node = element({ memoizedProps: { composerIntelligencePickerState: { bucketSelections: [
    { bucket: 1, modelSlug: 'account-model', category: { modelLane: 'instant', shortLabel: 'Account model', modelVersion: 'family' }, availability: { status: 'available' } },
    { bucket: 2, modelSlug: 'unavailable-model', category: { modelLane: 'instant', shortLabel: 'Unavailable', modelVersion: 'family' }, availability: { status: 'unavailable' } },
  ], currentBucket: 1, selectedVersionEntry: { id: 'family' }, currentSelection: { modelSlug: 'account-model', category: { modelLane: 'instant' } } },
    modelsData: { versions: [{ id: 'family', displayTextForIntelligence: 'Family', enabled: true }] } } });
  const reader = adapter({ querySelectorAll: () => [] });
  const actual = reader.readPickerSnapshot(node);
  assert.ok(actual);
  assert.equal(actual.choices.find(choice => choice.id === 'account-model').available, true);
  assert.equal(actual.choices.find(choice => choice.id === 'unavailable-model').available, false);
});

test('unknown or contradictory Fiber state and a logged-out DOM fail closed', () => {
  const reader = adapter({ querySelectorAll: () => [] });
  assert.equal(reader.readPickerSnapshot(element({ memoizedProps: {} })), null);
  assert.equal(reader.composer(), null);
  assert.equal(reader.conversationEvidenceOf({ memoizedProps: { conversationId: 'one' }, return: { memoizedProps: { conversationId: 'two' } } }).conflict, true);
});

test('completion evidence excludes commentary, private analysis and unfinished responses', () => {
  const reader = adapter({ querySelectorAll: () => [] });
  const final = { author: { role: 'assistant' }, channel: 'final', end_turn: true, status: 'finished_successfully' };
  assert.equal(reader.finalMessage(final), true);
  assert.equal(reader.finalMessage({ ...final, channel: 'commentary' }), false);
  assert.equal(reader.finalMessage({ ...final, channel: 'analysis' }), false);
  assert.equal(reader.finalMessage({ ...final, end_turn: false }), false);
});

test('native shell items expose exact user/final identities while excluding nested working prose and reasoning', () => {
  const reader = adapter({ querySelectorAll: () => [] });
  const turnId = crypto.randomUUID(), userId = crypto.randomUUID(), finalId = crypto.randomUUID();
  const entry = { id: turnId, turn: { status: 'complete', items: [
    { type: 'user-message', messageId: userId, serverMessageId: userId, message: 'authored question' },
    { type: 'chatgpt-reasoning-group', items: [{ type: 'assistant-message', phase: 'final_answer', content: 'private interim', completed: true }] },
    { type: 'assistant-message', messageId: finalId, phase: 'final_answer', completed: true, content: 'public final' },
  ] } };
  const messages = reader.shellTurnMessages({ memoizedProps: { entry } }, turnId, 1000);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].id, userId);
  assert.equal(messages[1].id, finalId);
  assert.equal(reader.finalMessage(messages[1]), true);
  assert.equal(JSON.stringify(messages).includes('private interim'), false);
  assert.equal(reader.shellTurnMessages({ memoizedProps: { entry } }, 'another turn', 1000).length, 0);
  entry.turn.status = 'running';
  assert.equal(reader.finalMessage(reader.shellTurnMessages({ memoizedProps: { entry } }, turnId, 1000)[1]), false);
});

test('native shell final widgets use only their exact owned public fallback and preserve code escapes', () => {
  const reader = adapter({ querySelectorAll: () => [] });
  const turnId = crypto.randomUUID(), messageId = crypto.randomUUID();
  const item = { type: 'assistant-message', messageId, phase: 'final_answer', completed: true,
    content: '::chatgpt-content-reference{index=0}', contentReferences: [{ type: 'dil', source_message_id: messageId,
      model_dil_v2: { fallbackMarkdown: '2\\^10 = 1024 \\[ok\\] and `x\\_y`' } }] };
  const entry = { id: turnId, turn: { status: 'complete', items: [item] } };
  const messages = reader.shellTurnMessages({ memoizedProps: { entry } }, turnId, 1000);
  assert.equal(messages[0].content.parts[0], '2^10 = 1024 [ok] and `x\\_y`');
  item.contentReferences[0].source_message_id = 'foreign answer';
  assert.equal(reader.shellTurnMessages({ memoizedProps: { entry } }, turnId, 1000)[0].content.parts[0], '', 'an unresolved widget reference is not the public answer');
});

test('native search-unit turn.items projects only exact user and public terminal assistant rows', () => {
  const reader = adapter({ querySelectorAll: () => [] });
  const userId = crypto.randomUUID(), finalId = crypto.randomUUID();
  const turn = { status: 'complete', items: [
    { type: 'user-message', messageId: userId, serverMessageId: userId, message: 'search-unit question' },
    { type: 'assistant-message', messageId: crypto.randomUUID(), phase: 'analysis', content: 'private analysis', completed: true },
    { type: 'chatgpt-reasoning-group', items: [{ type: 'assistant-message', phase: 'final_answer', content: 'nested private final' }] },
    { type: 'assistant-message', latestMessageId: finalId, phase: 'final_answer', content: 'owned public final', completed: true },
  ] };
  const fiber = { memoizedProps: { turn } };
  const messages = reader.turnMessagesOf(fiber);
  assert.ok(messages, 'the search-unit model uses turn.items, not entry.turn.items or turn.messages');
  assert.deepEqual(Array.from(messages, message => message.id), [userId, finalId]);
  assert.equal(reader.finalMessage(messages[1]), true);
  assert.equal(JSON.stringify(messages).includes('private'), false);
  turn.status = 'in_progress';
  assert.equal(reader.finalMessage(reader.turnMessagesOf(fiber)[1]), false);
  turn.items[0].serverMessageId = crypto.randomUUID();
  assert.equal(reader.turnMessagesOf(fiber).length, 0, 'contradictory provider identities stay unread');
});

test('search-unit widget answers resolve only their own public fallback and remain unread until it is available', () => {
  const reader = adapter({ querySelectorAll: () => [] }), id = crypto.randomUUID();
  const item = { type: 'assistant-message', latestMessageId: id, phase: 'final_answer', completed: true,
    content: '::chatgpt-content-reference{index=0}', contentReferences: [{ type: 'dil', source_message_id: id,
      model_dil_v2: { fallbackMarkdown: 'owned \\[public\\] reply' } }] };
  const fiber = { memoizedProps: { turn: { items: [item], status: 'complete' } } };
  assert.equal(reader.turnMessagesOf(fiber, 1000)[0].content.parts[0], 'owned [public] reply');
  assert.equal(reader.turnMessagesOf(fiber, 5)[0].content.parts[0], '', 'over-budget text cannot be presented as a truncated final');
  item.contentReferences[0].source_message_id = crypto.randomUUID();
  assert.equal(reader.turnMessagesOf(fiber, 1000)[0].content.parts[0], '');
  item.contentReferences = [];
  assert.equal(reader.turnMessagesOf(fiber, 1000)[0].content.parts[0], '');
});
