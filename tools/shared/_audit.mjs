import fs from "node:fs";
import path from "node:path";
import { redactValue } from "../../src/security/secret-scrubber.mjs";

// Audit log location (file name): JSONL inside the workspace so every
// shell/file mutation is reviewable without a database.
export const AUDIT_DIR_NAME = ".ankita_backups";
// Audit file name (JSONL, one scrubbed record per line).
export const AUDIT_FILE_NAME = "audit.jsonl";
// Audit field cap (chars): truncates long commands/output so one record cannot fill the disk.
export const MAX_AUDIT_FIELD_CHARS = 4000;
// File mode (posix bits): audit may contain paths/commands, so restrict to owner.
export const AUDIT_FILE_MODE = 0o600;

function truncate(value, max = MAX_AUDIT_FIELD_CHARS) {
  const text = String(value ?? "");
  return text.length > max ? text.slice(0, max) + `…[truncated ${text.length} chars]` : text;
}

export function auditPath(ctx = {}) {
  const root = path.resolve(ctx.workspacePath || ctx.cwd || process.cwd());
  return path.join(root, AUDIT_DIR_NAME, AUDIT_FILE_NAME);
}

/** Best-effort append-only record. Never throws: audit must not break the tool itself. */
export function audit(ctx = {}, record = {}) {
  try {
    const file = auditPath(ctx);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const clean = redactValue({
      at: new Date().toISOString(),
      ...record,
      command: record.command !== undefined ? truncate(record.command) : undefined,
      output: record.output !== undefined ? truncate(record.output, 1000) : undefined,
    });
    fs.appendFileSync(file, JSON.stringify(clean) + "\n", { mode: AUDIT_FILE_MODE });
    try {
      fs.chmodSync(file, AUDIT_FILE_MODE);
    } catch {}
  } catch {}
}
