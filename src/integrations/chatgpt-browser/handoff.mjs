import { MAX_FINAL_TEXT_CHARS } from '../../../services/chatgpt-bridge/config.mjs';

const MAX_HANDOFF_ITEMS = 50; // Records/section; bounded context summary rather than an unbounded transcript.
const MAX_HANDOFF_ITEM_CHARS = 2000; // Characters/objective, correction or receipt excerpt.
const clip = value => String(value ?? '').slice(0, MAX_HANDOFF_ITEM_CHARS);
export function buildHandoff({ objective, project, completed = [], unresolved = [], corrections } = {}, { transform = value => value } = {}) {
  if (typeof objective !== 'string' || !objective.trim()) throw new Error('Enter the objective for this handoff');
  if (!Array.isArray(completed) || !Array.isArray(unresolved)) throw new Error('Handoff needs saved receipt lists');
  const lines = ['ANKITA context handoff', 'These are saved observations. Verify unconfirmed actions before continuing.', '',
    'Objective:', clip(objective), '', 'Selected project:', project ? `${clip(project.name)}\n${clip(project.workspacePath)}` : 'No project selected', '',
    'Completed actions:', ...completed.slice(-MAX_HANDOFF_ITEMS).map(row => `- ${clip(row.name)}: ${clip(row.result)}`), '',
    'Unresolved receipts:', ...unresolved.slice(-MAX_HANDOFF_ITEMS).map(row => `- ${clip(row.id)} ${clip(row.name)}: ${clip(row.phase)}`), '',
    'User corrections:', clip(corrections) || 'None supplied'];
  if (completed.length > MAX_HANDOFF_ITEMS || unresolved.length > MAX_HANDOFF_ITEMS) lines.push('Older records are omitted. Inspect the saved receipts before repeating any action.');
  const text = String(transform(lines.join('\n')));
  if (text.length > MAX_FINAL_TEXT_CHARS) throw new Error('Handoff exceeds the browser text limit; shorten its objective or corrections');
  return text;
}
