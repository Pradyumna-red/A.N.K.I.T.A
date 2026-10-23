import fs from "node:fs";
import { resolvePath, assertNotWorkspaceRoot } from "../shared/_shared.mjs";
import { backupPath } from "../shared/_backup.mjs";
import { audit } from "../shared/_audit.mjs";

// Preview cap (count): bounds directory listing in the approval prompt.
const PREVIEW_ENTRIES = 20;

export const name = "delete_file";
export const description =
  "Delete a file, or a directory with recursive:true. Refuses the working directory itself.";

export const parameters = {
  type: "object",
  properties: {
    path: { type: "string", description: "Path to delete, absolute or relative to the working directory." },
    recursive: { type: "boolean", description: "Delete directories and their contents. Default false." },
  },
  required: ["path"],
};

export function approval(args, ctx) {
  const p = resolvePath(args.path, ctx);
  let detail = "";
  try {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(p).slice(0, PREVIEW_ENTRIES);
      detail = `  (${entries.length} top-level entries${entries.length ? ": " + entries.join(", ") : ""})`;
    } else {
      detail = `  (${stat.size}b)`;
    }
  } catch {}
  return `delete  ${p}${args.recursive ? "  (recursive)" : ""}${detail}\nA backup is kept; restore with restore_file.`;
}

export function run(args, ctx = {}) {
  if (!args.path || typeof args.path !== "string") throw new Error("path is required.");
  const p = resolvePath(args.path, ctx);
  if (!fs.existsSync(p)) throw new Error(`no such file or directory: ${p}`);
  assertNotWorkspaceRoot(p, ctx);
  const stat = fs.statSync(p);
  const backup = backupPath(p, ctx);
  if (stat.isDirectory()) {
    if (!args.recursive) throw new Error(`${p} is a directory; pass recursive:true to delete it.`);
    fs.rmSync(p, { recursive: true, force: true });
  } else {
    fs.unlinkSync(p);
  }
  audit(ctx, { tool: name, path: p, recursive: Boolean(args.recursive), backup });
  return `Deleted ${p}${backup ? `\nBackup: ${backup}\nRestore with restore_file {"path": ${JSON.stringify(args.path)}}` : ""}`;
}
