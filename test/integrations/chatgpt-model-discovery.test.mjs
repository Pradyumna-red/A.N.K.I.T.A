import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const adapterPath = new URL('../../desktop/chatgpt-companion/upstream/readers.js', import.meta.url);
function adapter(document) {
  const context = { document, location: { pathname: '/c/owned' }, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) };
  vm.runInNewContext(fs.readFileSync(adapterPath, 'utf8'), context);
  return context.AnkitaPageReaders;
}
const element = fiber => ({ __reactFiber$fixture: fiber, parentElement: null, closest: () => null, getClientRects: () => [{}], getAttribute: () => null });

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
