import fs from "node:fs";
import { resolvePath } from "../shared/_shared.mjs";
import { listBackups, restoreBackup } from "../shared/_backup.mjs";
import { audit } from "../shared/_audit.mjs";

export const name = "restore_file";
export const description =
  "Undo a destructive change. Lists backups for a path, or restores the most recent backup. Use after delete_file/write_file/edit_file/move_file.";

export const parameters = {
  type: "object",
  properties: {
    path: { type: "string", description: "Original path that was changed, absolute or relative to the working directory." },
    list: { type: "boolean", description: "List backups instead of restoring. Default false." },
    index: { type: "integer", description: "Backup index to restore (0 = oldest). Default -1 = most recent." },
  },
  required: ["path"],
};

export function approval(args, ctx) {
  const p = resolvePath(args.path, ctx);
  if (args.list) return `list backups for ${p}`;
  return `restore  ${p}  (from backup)`;
}

export function run(args, ctx = {}) {
  const p = resolvePath(args.path, ctx);
  if (args.list) {
    const all = listBackups(p, ctx);
    if (!all.length) return `No backups for ${p}`;
    return `${p}\n${all.map((b, i) => `${i}: ${b}`).join("\n")}`;
  }
  const src = restoreBackup(p, ctx, args.index ?? -1);
  audit(ctx, { tool: name, path: p, backup: src });
  return `Restored ${p}\nFrom: ${src}`;
}
