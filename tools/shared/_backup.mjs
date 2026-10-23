import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Backup location (dir name): kept inside the workspace so undo works
// without config and never writes outside the workspace boundary.
export const BACKUP_DIR_NAME = ".ankita_backups";
// Per-file backup cap (count): bounds disk use while keeping recent undo steps.
export const MAX_BACKUPS_PER_FILE = 20;
// Per-file backup cap (bytes): files larger than this are not copied (preview still shows them).
export const MAX_BACKUP_BYTES = 5_000_000;
// Timestamp format: filesystem-safe, sortable (YYYYMMDD-HHMMSS-mmm).
function stamp(now = Date.now()) {
  const d = new Date(now);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${pad(d.getMilliseconds(), 3)}`;
}

export function backupRoot(ctx = {}) {
  const root = path.resolve(ctx.workspacePath || ctx.cwd || process.cwd());
  return path.join(root, BACKUP_DIR_NAME);
}

function safeRelative(root, p) {
  const rel = path.relative(root, path.resolve(p));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Path is outside the workspace boundary.");
  return rel.split(path.sep).join("__");
}

export function listBackups(originalPath, ctx = {}) {
  const root = path.resolve(ctx.workspacePath || ctx.cwd || process.cwd());
  const dir = backupRoot(ctx);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() || e.isDirectory());
  } catch {
    return [];
  }
  const prefix = `${safeRelative(root, originalPath)}.`;
  return entries
    .map((e) => e.name)
    .filter((n) => n.startsWith(prefix))
    .sort()
    .map((n) => path.join(dir, n));
}

function prune(originalPath, ctx) {
  const all = listBackups(originalPath, ctx);
  while (all.length > MAX_BACKUPS_PER_FILE) {
    const oldest = all.shift();
    try {
      fs.rmSync(oldest, { recursive: true, force: true });
    } catch {}
  }
}

/** Copy a file or directory to the backup store before a destructive write. Returns backup path or null. */
export function backupPath(originalPath, ctx = {}) {
  let stat;
  try {
    stat = fs.lstatSync(originalPath);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return null;
  if (stat.isFile() && stat.size > MAX_BACKUP_BYTES) return null;
  const root = path.resolve(ctx.workspacePath || ctx.cwd || process.cwd());
  const dir = backupRoot(ctx);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  const name = `${safeRelative(root, originalPath)}.${stamp()}.${randomUUID().slice(0, 8)}.bak`;
  const dest = path.join(dir, name);
  try {
    if (stat.isDirectory()) fs.cpSync(originalPath, dest, { recursive: true });
    else fs.copyFileSync(originalPath, dest);
  } catch {
    return null;
  }
  prune(originalPath, ctx);
  // Return the newest backup for this path (the one just created, modulo clock skew).
  const all = listBackups(originalPath, ctx);
  return all.length ? all[all.length - 1] : dest;
}

/** Restore the most recent (or indexed) backup over the original path. */
export function restoreBackup(originalPath, ctx = {}, index = -1) {
  const all = listBackups(originalPath, ctx);
  if (!all.length) throw new Error(`No backups for ${originalPath}`);
  const pick = index < 0 ? all.length + index : index;
  const src = all[pick];
  if (!src) throw new Error(`Backup index out of range: ${index}`);
  const stat = fs.lstatSync(src);
  try {
    fs.rmSync(originalPath, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(path.dirname(path.resolve(originalPath)), { recursive: true });
  if (stat.isDirectory()) fs.cpSync(src, path.resolve(originalPath), { recursive: true });
  else fs.copyFileSync(src, path.resolve(originalPath));
  return src;
}
