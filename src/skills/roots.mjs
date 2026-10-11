import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../core/config.mjs';
import { writeTextFile } from '../../tools/shared/_shared.mjs';

export const SKILL_ROOTS_FILE = path.join(CONFIG_DIR, 'skill-roots.json'); // Profile-local discovery roots shared by CLI and desktop.
const SKILL_ROOTS_VERSION = 1; // Persisted registry schema; unknown formats must not be overwritten.
const INVALID_SKILL_ROOTS = 'Invalid skill roots registry'; // Shared validation failure for readers and registration.

export function registeredSkillRoots(file = SKILL_ROOTS_FILE) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (saved?.version !== SKILL_ROOTS_VERSION || !Array.isArray(saved.roots) || saved.roots.some(root => typeof root !== 'string' || !path.isAbsolute(root))) {
    throw new Error(`${INVALID_SKILL_ROOTS}: ${file}`);
  }
  return [...new Set(saved.roots)];
}

/** Called only by explicit installation; pure scaffolding does not change a user's profile. */
export function registerSkillRoot(root, file = SKILL_ROOTS_FILE) {
  const canonical = fs.realpathSync(root);
  const roots = registeredSkillRoots(file); // Re-read immediately before writing to preserve existing installations.
  if (roots.includes(canonical)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeTextFile(file, JSON.stringify({ version: SKILL_ROOTS_VERSION, roots: [...roots, canonical] }, null, 2));
}
