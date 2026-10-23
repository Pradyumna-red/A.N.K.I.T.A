# Interactive desktop slash commands

Status: implemented in source and rebuilt on 22 October 2026. Browser, focused tests and native Electron checks pass. The full serial suite has three independently reproduced pre-existing browser-workflow failures.

The later compactness update bounds the menu to 320 CSS pixels, reduces row
spacing, and hides its scrollbar while preserving scrolling and keyboard
navigation. Its new bound failed against the prior layout, then passed all
**31/31** browser and **5/5** native checks. See the
[connection/compactness findings](2026-10-22-chatgpt-connection-upgrade.md) for
evidence and the separate existing suite failures.

## Behavior

Typing `/` at the start of a message, or choosing the visible `/` composer button, opens searchable commands above the composer. Grouped actions have descriptions and a selected-action preview. The list scrolls inside the available conversation area. Small windows hide the preview; reduced motion disables the entrance animation.

Arrow keys navigate, Enter/Tab choose, Escape dismisses, and Backspace from an empty guided picker returns to all commands. Search covers names, aliases, descriptions and abbreviations. IME composition does not submit a command. Ordinary text, multiline messages and attachments retain their behavior.

`/model` uses discovered provider models. `/project` uses active project records, with a no-project choice. The ChatGPT browser route explains that model choice belongs to the selected ChatGPT chat instead of offering fake local switching. `/skill` loads enabled installed skills through the existing palette index and prepares an editable request without starting work. Loading and retry states are explicit.

Navigation commands use existing desktop actions. `/clear` retains confirmation, `/export` retains the protected transcript/save dialog, and `/skills` opens the actual Skills section. Terminal-only commands are not advertised as desktop actions. The global palette shares the same App action handler.

The toolbar saves an ordinary draft while browsing commands. Dismissal, model/project selection and navigation restore it. A skill instruction is added before the saved text. Replacing the command with ordinary text discards the suspended old text. Attachments stay with their original teammate.

## Reproduction and verification

Before implementation, `rtk node scripts/verify-desktop-slash.mjs` failed with:

```text
AssertionError [ERR_ASSERTION]: typing slash must display .slash-menu
0 !== 1
```

Initial evidence is in the OS temp directory `ankita-desktop-slash-h69Jo3`.

| Check | Result |
| --- | --- |
| Catalog/parser/search/runtime choices/drafts/selection unit tests | 7/7 passed |
| Real App in Chromium with isolated IPC fixtures | 31/31 checks, 0 renderer errors |
| Built renderer in native Electron with real preload and DesktopEngine | 5/5 checks, 0 provider chat requests, 0 renderer errors |
| Focused CLI registry/cheat sheet, palette, slash, native computer connection, MCP context/images and crash tests | 62/62 passed |
| Full serial suite | 1,366 tests: 1,362 passed, 3 pre-existing failures, 1 Windows skip; exit 1 |
| Desktop TypeScript and production renderer build | Exit 0, 378 modules transformed |
| Existing desktop workbench interaction/layout verifier | Exit 0; all grouped checks passed, no page errors |
| Source review | No actionable P1/P2 findings; separate live draft-replacement probe passed |

Browser evidence: `C:\Users\anime\AppData\Local\Temp\ankita-desktop-slash-S4IGKm` (`checks.json`, `layouts.json`, nine layout screenshots, retry and ChatGPT guidance screenshots). The matrix covers 1366×768, 640×720 and 900×540 in Graphite, Mono and Slate. Short-window menus stay below the context bar and inside the rounded pane. Extra checks cover replacing a suspended draft, the composer action's Choose command label, and disabling selection with no matches.

Native evidence: `C:\Users\anime\AppData\Local\Temp\ankita-desktop-slash-7SNeTi` (`checks.json`, `native-output.log`, screenshots). Model/project selections persist in the actual teammate store. Skill discovery, attachments, settings and confirmation use real Electron IPC. The initial diagnostic launcher omitted part of the production import graph. The corrected launcher copies the existing bridge and tunnel publisher metadata, and imports main from `app.whenReady().then(...)`. No product startup behavior was changed for this verifier.

## Existing suite failures

The full suite ran serially with log `C:\Users\anime\AppData\Local\Temp\ankita-slash-suite-46b72e2b50ae4ddcb86f6060d36319ec\serial-suite.log` (`duration_ms 560508.5375`). All three failures are in `test/core/browser-workflow.test.mjs`:

- Both managed-browser discovery tests fail at line 39: the browser schema does not fit the remaining tool budget (`budget=21313` / `21212`, `core=16422`).
- The live form-flow test fails at line 139: expected `Filled 2 fields`, received `fill_form needs 1 to 10 fields, each with a ref and text string`.

To establish provenance without changing the user's checkout, a disposable copy retained the pre-existing workspace edits, replaced `src/core/agent.mjs` and `src/palette/index.mjs` with their HEAD versions, and ran that test file. The same three failures, budgets and error text reproduced: **6 tests, 3 passed, 3 failed**. Baseline evidence: `C:\Users\anime\AppData\Local\Temp\ankita-slash-baseline-Soyx2C\baseline.log`. The desktop slash UI is not imported by this test. These adjacent failures are recorded rather than included in the requested diff.

## Literal and boundary review

Desktop action IDs now share `DESKTOP_ACTIONS` between the existing palette, slash catalog and App router. Slash parsing/stage/IPC vocabulary and the viewport gap/IME key code are named constants. Remaining strings are display copy, DOM/ARIA semantics, discriminants or test fixtures; CSS dimensions are intentional presentation values. No production model IDs, endpoints, filesystem paths, OS assumptions or new dependencies were introduced.

Repeat with:

```text
rtk node --test --test-concurrency=1 test/desktop/slash-commands.test.mjs test/desktop/computer-use.test.mjs test/core/palette.test.mjs test/integrations/computer-direct-config.test.mjs
rtk npm run desktop:build
rtk node scripts/verify-desktop-slash.mjs
rtk node scripts/verify-desktop-slash.mjs --native
```

The local install was older than the existing lockfile. Restoring it added six already-declared packages; both dependency files remain unchanged. The Sonatype checker was unavailable, so no Sonatype assessment is claimed.

The existing `scripts/verify-desktop-workbench.mjs` also passed after the final App routing cleanup, covering draft/navigation preservation, project sections, settings, schedules, appearance, focus, reduced motion and four responsive widths. Evidence: `C:\Users\anime\AppData\Local\Temp\ankita-workbench-0bJbk3`. A final build passed after that routing change; the last edit reuses the already-tested browser command handler rather than duplicating its selector and section state.

## Coverage limits

No installer was published/applied and the user's running app was not restarted. The browser fixture checks routing and appearance rather than authenticated website tasks. Native checks use development Electron with the production build and isolated settings, not an installer/ASAR package. Physical screen-reader behavior, macOS/Linux, mixed-DPI monitors and hosted-provider workloads were not exercised. The separately requested crash and its actual Agent/MCP round trip are recorded in [computer-direct-config.md](computer-direct-config.md).
