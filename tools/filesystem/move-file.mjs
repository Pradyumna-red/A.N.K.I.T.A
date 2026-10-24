import fs from "node:fs";
import path from "node:path";
import { resolvePath, assertNotWorkspaceRoot } from "../shared/_shared.mjs";
import { backupPath } from "../shared/_backup.mjs";
import { audit } from "../shared/_audit.mjs";

export const name = "move_file";
export const description = "Move or rename a file or directory. Refuses to overwrite an existing destination.";

export const parameters = {
  type: "object",
  properties: {
    source: { type: "string", description: "Existing path, absolute or relative to the working directory." },
    destination: { type: "string", description: "New path. Must not already exist." },
  },
  required: ["source", "destination"],
};

export function approval(args, ctx) {
  const src = resolvePath(args.source, ctx);
  let detail = "";
  try {
    const stat = fs.statSync(src);
    detail = stat.isDirectory() ? `  (${fs.readdirSync(src).length} top-level entries)` : `  (${stat.size}b)`;
  } catch {}
  return `move  ${src}${detail}\n  to  ${resolvePath(args.destination, ctx)}\nA backup of the source is kept; restore with restore_file.`;
}

export function run(args, ctx = {}) {
  if (!args.source || !args.destination) throw new Error("source and destination are required.");
  const src = resolvePath(args.source, ctx);
  const dst = resolvePath(args.destination, ctx);
  if (!fs.existsSync(src)) throw new Error(`no such file or directory: ${src}`);
  assertNotWorkspaceRoot(src, ctx);
  if (fs.existsSync(dst)) throw new Error(`destination already exists: ${dst} (delete it first or pick another name)`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const backup = backupPath(src, ctx);
  fs.renameSync(src, dst);
  audit(ctx, { tool: name, source: src, destination: dst, backup });
  return `Moved ${src} to ${dst}${backup ? `\nBackup: ${backup}\nRestore with restore_file {"path": ${JSON.stringify(args.source)}}` : ""}`;
}
