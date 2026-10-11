# Skill creator

Board idea: `ankita new skill` interactive scaffolder.

Run `node chat.mjs new skill` to answer the three questions. For scripts:
`node chat.mjs new skill explain-log --permissions files --example "Explain this log"`.
Use `--directory` to choose an installation root instead of the bundled skills folder.
Successful custom installations remember that folder in the current profile's
`skill-roots.json`. Chat, `/skills`, the skill tool and desktop Skills discover it
through the same loader, including after restart. The existing desktop refresh or
reopening Skills reads new installations. Explicit directory reads used by authoring
checks stay confined to that directory. Bundled skills take precedence over duplicate
names; otherwise the first registered root wins. Missing folders are skipped.
The output includes instructions, an advisory access declaration, documentation and
an exact offline fixture. Existing folders are never overwritten. Invalid names,
unknown access domains and empty examples fail before any folder is written.

This runs before login and makes no model or network call. Permission declarations
describe intent; they do not enforce a runtime sandbox or replace tool approvals.

Verification: the real CLI originally rejected `--permissions`. After implementation
the CLI round trip creates a loadable skill with a passing fixture. The four checks
cover that path, all three interactive questions, rejection and collision behavior.

PR #54 review fix (2026-10-11): the original CLI reported success for a custom root
while the default catalogue returned no new skills. The new real-process regression
first failed with `actual: []` versus three created skills. After registration and
shared discovery were added, the focused scaffold/loader suite passed **16/16**.
Fresh CLI `/skills`, the actual skill tool and `DesktopEngine.listSkills` all found
the three skills across two roots; a bundled name collision remained unique and
kept its bundled instructions. A failed registry write rolls back only the new
skill and preserves the previous registry. Malformed registry data is diagnosed
without hiding bundled skills. Low-level authoring calls do not register roots.
Packaged desktop interaction is not established by the engine-method regression.
