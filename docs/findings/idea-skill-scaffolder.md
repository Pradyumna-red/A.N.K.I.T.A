# Skill creator

Board idea: `ankita new skill` interactive scaffolder.

Run `node chat.mjs new skill` to answer the three questions. For scripts:
`node chat.mjs new skill explain-log --permissions files --example "Explain this log"`.
Use `--directory` to choose an installation root instead of the bundled skills folder.
Successful custom installations remember that folder in the current profile's
`skill-roots.json.d` as an atomic registration record. Existing `skill-roots.json`
registries remain readable and are never rewritten. Independent installs append
separate records, so simultaneous installs retain both roots. Chat, `/skills`, the skill tool and desktop Skills discover them
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
shared discovery were added, the focused scaffold/loader suite passed **20/20**
after the concurrency and storage regressions below were added.
Fresh CLI `/skills`, the actual skill tool and `DesktopEngine.listSkills` all found
the three skills across two roots; a bundled name collision remained unique and
kept its bundled instructions. A failed registration rolls back only the new
skill and preserves the previous registry. Malformed registry data is diagnosed
without hiding bundled skills. Low-level authoring calls do not register roots.
Packaged desktop interaction is not established by the engine-method regression.

The review also found a lost update when two installers read the same registry.
A deterministic two-process filesystem repro failed with only root `one` present
instead of `one` and `two`; a blocked records directory also failed to stop the
old installer. Both regressions pass with independent atomic records. The suite
also covers legacy registry preservation, sequential idempotence, ignoring partial
temporary records, and rejecting malformed completed records without hiding bundled
skills. The storage failure repro uses a file occupying the records directory;
permission-denied and device failure paths have not been separately injected.

### Published-app audit, 2026-10-22

The published 2.6.0 Windows executable was exercised in a disposable profile.
Two real CLI installations, `audit-older-skill` and `audit-new-skill`, registered
an external folder. One file's modification time was moved back a week. The
packaged app listed both alongside all six bundled skills, delivered all eight
complete instruction bodies through its real skill tool into nine captured HTTP
model requests, and found the same catalogue after a full app restart.
The model endpoint was a controlled local fixture, not a remote AI choosing
skills independently. The native Core tool host also read the new skill by name.
The normal user profile was unchanged; temporary profiles and processes were removed.

Trace: `catalogSize=8 modelRequests=9 completeSkillBodiesInRequests=8`
and `nativeCoreReadNewSkill=true restoredAfterAppRestart=true`.
The separate desktop browser test passed with
`modelRequests=4 guideRequests=3 realFieldReadBack=true` and a visible renderer
receipt that cleared on the next turn. The root-registration suite passed 10/10
and desktop/fixture/contribution checks passed 11/11 in the release worktree.

One remaining discovery gap: native `find_tools(query="skills")` advertises the
skill reader but does not enumerate installed skill names/descriptions. Explicit
reads work; automatic skill selection in hosted ChatGPT is not established.
The browser provider forwards the user's prompt without the API Agent's skill
catalogue or automatic instruction insertion. No change to that behavior was made.

The current primary checkout's focused suite was 31/32: the desktop import in
the custom-root test failed because its installed dependencies lack
`@modelcontextprotocol/node`. The same root suite passed in the release worktree,
and the actual published executable passed the round trip above. No dependency
installation or application-source edit was made during this audit.
