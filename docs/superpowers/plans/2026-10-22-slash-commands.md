# Interactive desktop slash commands

**Goal:** Typing `/` or choosing the composer command button opens discoverable, interactive desktop commands. User requested direct implementation and supplied the existing graphite desktop as the visual reference.

**Architecture:** A renderer-safe shared catalog describes actual desktop actions. Composer owns keyboard/focus state and drafts; a separate menu renders results and previews. App routes actions through existing handlers. Installed skills load through the existing palette query, and model/project choices come from live props.

**Constraints:** Preserve existing workspace changes. No new dependencies, terminal-only commands presented as working desktop actions, automatic skill submission, or changes to approval rules. Reuse existing theme tokens and reduced-motion behavior. Work in the requested checkout so existing unpublished work remains present.

- [x] Add behavioral tests for slash parsing, filtering, live choices, aliases and skill drafts; capture the missing-menu browser failure.
- [x] Implement the shared catalog, accessible menu, keyboard selection, guided choices, loading/retry states and App action routing.
- [x] Verify the real renderer and isolated native Electron, themes, small windows, attachments and ordinary chat; run focused tests, serial suite, desktop build and diff checks.
- [x] Record exact results and limits in the desktop guide.

Results: 62/62 focused tests, 31/31 browser checks, 5/5 native checks; production build passes. The 1,366-test serial suite reports 1,362 pass, three pre-existing browser-workflow failures and one Windows skip. A disposable baseline with this task's Agent/palette edits removed reproduces the same three failures. Evidence and limits are in `docs/findings/desktop-slash-commands.md`.

The separately requested `COMPUTER_DIRECT_CONFIG` crash is investigated with its own reproduction, regression and findings document. It does not change the menu contract.

Visual choices: existing graphite/mono/slate tokens, existing companion font, quiet borders, gold selection marker, compact icons, grouped rows and a useful selected-command preview. Motion only answers opening/selection. Small windows omit the preview to preserve readable rows.
