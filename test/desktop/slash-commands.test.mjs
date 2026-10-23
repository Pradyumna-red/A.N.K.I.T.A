import test from 'node:test';
import assert from 'node:assert/strict';

const load = () => import('../../desktop/shared/slash-commands.mjs');

test('slash query opens only for a leading command, with guided argument stages', async () => {
  const { slashQuery } = await load();
  assert.deepEqual(slashQuery('/'), { stage: 'commands', query: '' });
  assert.deepEqual(slashQuery('/MODEL fast'), { stage: 'model', query: 'fast' });
  assert.deepEqual(slashQuery('/project '), { stage: 'project', query: '' });
  assert.deepEqual(slashQuery('/skill research'), { stage: 'skill', query: 'research' });
  for (const text of ['hello /model', 'https://example.invalid', '/tmp/file', '/model\nhello', ' /']) assert.equal(slashQuery(text), null, text);
});

test('desktop catalog describes supported actions and aliases, excluding terminal-only commands', async () => {
  const { commandEntries, searchSlashEntries } = await load();
  const entries = commandEntries();
  assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
  for (const command of ['/model', '/project', '/skill', '/clear', '/export', '/schedule', '/review', '/browser']) assert.ok(entries.some(entry => entry.slash === command), command);
  assert.equal(searchSlashEntries(entries, 'config')[0].slash, '/settings');
  assert.equal(searchSlashEntries(entries, 'routines')[0].slash, '/schedule');
  assert.equal(entries.some(entry => ['/exit', '/cd', '/auto', '/bg'].includes(entry.slash)), false);
});

test('search finds names, descriptions and fuzzy command abbreviations without discarding command order', async () => {
  const { commandEntries, searchSlashEntries } = await load();
  const entries = commandEntries();
  assert.deepEqual(searchSlashEntries(entries, ''), entries);
  assert.equal(searchSlashEntries(entries, 'mdl')[0].slash, '/model');
  assert.equal(searchSlashEntries(entries, 'transcript')[0].slash, '/export');
  assert.deepEqual(searchSlashEntries(entries, 'no-such-command-zzzz'), []);
});

test('guided model entries use runtime models, preserve active selection and filter names or vendors', async () => {
  const { modelEntries, searchSlashEntries } = await load();
  const models = [{ id: 'alpha', name: 'Quick model', vendor: 'Fixture' }, { id: 'beta', name: 'Deep model', vendor: 'Other' }];
  const entries = modelEntries(models, 'beta');
  assert.equal(entries.length, models.length);
  assert.equal(entries.find(entry => entry.value === 'beta').active, true);
  assert.equal(searchSlashEntries(entries, 'Other')[0].value, 'beta');
  assert.deepEqual(modelEntries([], ''), []);
});

test('guided projects include no-project, omit archived records and search runtime folder names', async () => {
  const { projectEntries, searchSlashEntries } = await load();
  const entries = projectEntries([{ id: 'work', name: 'Current work', path: '/fixture/garden', archived: false }, { id: 'old', name: 'Archived', archived: true }], 'work');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].value, null);
  assert.equal(entries.find(entry => entry.value === 'work').active, true);
  assert.equal(searchSlashEntries(entries, 'garden')[0].value, 'work');
});

test('installed skills become editable drafts and never inherit runnable scheduled jobs', async () => {
  const { skillEntries, skillDraft } = await load();
  const entries = skillEntries([{ id: 'skill:research', source: 'skill', skill: 'research', title: 'research', hint: 'Find reliable sources' }, { id: 'job:daily', source: 'job', title: 'Daily job' }]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, 'draft');
  assert.equal(skillDraft(entries[0]), 'Use the research skill. ');
  assert.equal(skillDraft({ ...entries[0], title: 'Compare products' }), 'Use the research skill. Compare products. ');
});

test('selection wraps and stays valid when a query has no matches', async () => {
  const { moveSlashSelection } = await load();
  assert.equal(moveSlashSelection(0, -1, 3), 2);
  assert.equal(moveSlashSelection(2, 1, 3), 0);
  assert.equal(moveSlashSelection(0, 1, 0), 0);
});
