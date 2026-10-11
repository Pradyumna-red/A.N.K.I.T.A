import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_DIR } from '../core/config.mjs';
import { writeTextFile } from '../../tools/shared/_shared.mjs';

export const SKILL_ROOTS_FILE = path.join(CONFIG_DIR, 'skill-roots.json'); // Profile-local discovery roots shared by CLI and desktop.
const SKILL_ROOTS_VERSION = 1; // Persisted registry schema; unknown formats must not be overwritten.
const INVALID_SKILL_ROOTS = 'Invalid skill roots registry'; // Shared validation failure for readers and registration.
const RECORDS_SUFFIX = '.d'; // Append-only sibling directory; independent installs never replace another root.
const RECORD_EXTENSION = '.json'; // Atomic completed records; temporary writes are excluded from discovery.
const JSON_INDENT = 2; // Spaces used for profile records that users can inspect.

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function absoluteRoot(root) { return typeof root === 'string' && path.isAbsolute(root); }

export function registeredSkillRoots(file = SKILL_ROOTS_FILE) {
  let saved;
  try { saved = readJson(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (saved !== undefined && (saved?.version !== SKILL_ROOTS_VERSION || !Array.isArray(saved.roots) || saved.roots.some(root => !absoluteRoot(root)))) {
    throw new Error(`${INVALID_SKILL_ROOTS}: ${file}`);
  }
  const directory = `${file}${RECORDS_SUFFIX}`;
  let entries;
  try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  const records = entries.filter(entry => entry.isFile() && entry.name.endsWith(RECORD_EXTENSION)).map(entry => {
    const recordFile = path.join(directory, entry.name), record = readJson(recordFile);
    if (record?.version !== SKILL_ROOTS_VERSION || !absoluteRoot(record.root) || typeof record.registeredAt !== 'string' || !Number.isFinite(Date.parse(record.registeredAt))) {
      throw new Error(`${INVALID_SKILL_ROOTS}: ${recordFile}`);
    }
    return { ...record, name: entry.name };
  });
  records.sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt) || a.name.localeCompare(b.name));
  return [...new Set([...(saved?.roots ?? []), ...records.map(record => record.root)])];
}

/** Called only by explicit installation; pure scaffolding does not change a user's profile. */
export function registerSkillRoot(root, file = SKILL_ROOTS_FILE) {
  const canonical = fs.realpathSync(root);
  const roots = registeredSkillRoots(file); // Validate existing records and make sequential registrations idempotent.
  if (roots.includes(canonical)) return;
  const directory = `${file}${RECORDS_SUFFIX}`;
  fs.mkdirSync(directory, { recursive: true });
  const record = { version: SKILL_ROOTS_VERSION, root: canonical, registeredAt: new Date().toISOString() };
  writeTextFile(path.join(directory, `${randomUUID()}${RECORD_EXTENSION}`), JSON.stringify(record, null, JSON_INDENT));
}
