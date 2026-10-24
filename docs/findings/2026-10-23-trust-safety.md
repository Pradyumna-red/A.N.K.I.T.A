# Undo, audit and skill permission manifests

Implemented in source on 23 October 2026. No installer or release was published
by this change, and the user's real profile was not modified.

## What changed, in simple words

- Deleting, overwriting, editing or moving a file now keeps a copy first. The
  copy lives inside the workspace, and `restore_file` puts the newest one back
  (or lists them with `list: true`).
- Delete and move approval prompts show the size or a bounded list of entries,
  so a destructive action is visible before it runs.
- Every file change and finished command appends one scrubbed line to
  `.ankita_backups/audit.jsonl`. Secrets such as API keys are redacted, and the
  file is owner-only where the filesystem supports it.
- A skill may declare `allowed-tools` and `touches` in its front matter. The
  catalogue shows them as advisory intent; tool approvals remain the enforcement
  boundary. Empty declarations keep legacy skills unchanged.

## Backup isolation bug and fix

Backups were first written as flat files named `<relative path>.<stamp>.bak`.
That makes a path prefix ambiguous: the backups of `foo.txt` also match the
prefix for `foo`. Reproduced before the fix in a disposable workspace:

```text
foo backups: [
  'foo.20261023-233316-210.0c9235ed.bak',
  'foo.txt.20261023-233316-204.a99490a8.bak'
]
foo.txt backups: [ 'foo.txt.20261023-233316-204.a99490a8.bak' ]
```

The consequences were real: `restore_file {"path":"foo"}` could restore the
wrong file over `foo`, and pruning 20 backups of `foo` could delete `foo.txt`
backups. Each original path now has its own hashed directory under
`.ankita_backups`, and filenames contain only the timestamp and a random suffix.
The audit log still lives at the shared `.ankita_backups/audit.jsonl` path, and
the directory name constant is imported instead of duplicated.

The new regression creates `foo.txt` and `foo`, backs both up, restores one and
asserts the sibling is untouched; it also checks that pruning 26 backups of one
path stops at 20 and leaves the other path's single backup intact.

## Skill permission wording

`allowed-tools` and `touches` are parsed, validated and included in the skill
catalogue line and instructions ("prefer those tools and ask before using
others"). They are not a runtime sandbox, matching the scaffolder finding's
contract. An unused `isToolAllowedForSkill` helper was removed so the code and
the release note do not imply enforcement that does not exist.

## Skill discovery in find_tools

Before: `find_tools(query="skills")` returned only the group summary and
"Already loaded: skill", so a model could not see installed names without
calling the reader blindly. Now the same query lists up to 50 installed skills
and 160 characters of each description, capped at 4,000 characters total, and
honors disabled skills and skills-off mode. Full instructions still come only
from the `skill` tool.

## Move undo

`move_file` previously renamed the source without keeping an undo copy, so the
finding's "moving keeps a copy first" claim was not true in code. It now backs
up the source before `rename`, adds the same line to its approval prompt, and
returns the backup path with a ready-to-run `restore_file` command. The
regression moves `undo.txt` into `moved/`, restores from the backup, and
asserts both the original and the destination hold the pre-move bytes.

## Verification

- `node --test test/tools/trust-safety.test.mjs`: **11 passed, 0 failed**.
- `node --test test/core/tool-loading.test.mjs`: **18 passed, 0 failed**.
- `node --test test/core/skills.test.mjs`: **10 passed, 0 failed**.
- `node --check` on every edited module and test: clean.
- `git diff --check`: clean.
- Live round trip with a real directory: moved `dir/sub/a.txt` into
  `moved/dir`, confirmed the source was gone and the copy was intact, ran
  `restore_file {"path":"dir"}`, and read `deep` back from `dir/sub/a.txt`.

## Remaining limits

- Symlink creation can require privileges on Windows; that test skips its
  symlink assertion there rather than failing the suite.
- Audit and backup writes are best effort. A backup larger than 5 MB is skipped,
  and an unwritable backup directory leaves the destructive action to continue
  without an undo copy.
- Permission manifests are advisory. They do not sandbox a skill at runtime and
  do not replace per-tool approval.
