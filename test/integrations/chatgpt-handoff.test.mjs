import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoff } from '../../src/integrations/chatgpt-browser/handoff.mjs';

test('explicit handoff includes objective, selected project, actual actions, unresolved receipts and corrections', () => {
  const result = buildHandoff({ objective: 'Finish the private-key report', project: { name: 'Chosen project', workspacePath: 'host-selected-workspace' },
    completed: [{ name: 'read_file', result: 'Read confirmed file bytes.' }], unresolved: [{ id: 'owned-receipt', name: 'write_file', phase: 'uncertain' }],
    corrections: 'Use the current selected chat.' }, { transform: value => value.replaceAll('private-key', '[redacted]') });
  assert.match(result, /Finish the \[redacted\] report/); assert.match(result, /Chosen project/);
  assert.match(result, /Read confirmed file bytes/); assert.match(result, /owned-receipt.*uncertain/);
  assert.match(result, /Use the current selected chat/); assert.match(result, /Verify unconfirmed/);
  assert.throws(() => buildHandoff({ objective: '', completed: [], unresolved: [] }), /objective/i);
});
