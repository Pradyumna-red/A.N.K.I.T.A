# Desktop UI polish — 2026-10-24

Status: implemented and covered by UI tests; packaged-desktop screenshot review
remains open.

## Problems observed

- Engine failures printed the transport string verbatim, including
  `Error invoking remote method 'engine:invoke'` and the listening port, in the
  floating error toast. The text was not actionable and covered the composer.
- Connection state used at least ten different dot treatments (bare dots, halos,
  coloured text, pills) across the chat header, sidebar, jobs, browser stage,
  plugins, review runs and ChatGPT settings.
- Providers stacked every action as a separate full-width-looking button.
  ChatGPT settings mixed browser choices, teammate selection, setup, session
  actions and native-tool setup without a stable reading order.
- Settings forms mixed the old beige accent with the graphite/slate accent,
  used native selects with a different height from inputs, and the privacy
  toggle used `window.confirm`.

## Changes

- `desktop/shared/error-notices.mjs` humanizes IPC, scheduler, network, auth,
  quota, disk and permission failures. The raw string and the hint live in an
  anchored `Details` popover; the visible card stays two lines tall.
  `cleanErrorMessage()` is now shared by Plugins, Skills, browser plugins,
  Settings and ChatGPT settings instead of three copy-pasted regexes.
- `NoticeCard` + `.notice-stack` replace the toast: compact dismissible cards
  (icon, title, two-line detail, `Details`) in a 340px top-right stack below the
  update banners. The popover is bounded to 320×260 with its own scroll and
  closes on Escape or an outside click, so technical text never stretches the
  card across the chat. Secret confirmations auto-dismiss; errors do not.
- **Capture bridge conflicts are no longer engine failures.**
  `desktop/electron/capture-actions.mjs` runs every `CAPTURE_ACTIONS` request
  through one boundary: a remembered-port conflict returns
  `{ unavailable }` for setup and inert values (`[]`/`false`) for polling,
  registration, cancellation and acknowledgement instead of rejecting
  `engine:invoke`. `BrowserHelperSetup` explains that result with the shared
  humanizer. Passive mascot hover/focus refreshes are quiet, and neither mascot
  tooltip prints capture messages, so the old raw bubble has no source.
- **Island failures use the same human copy.** `useIslandChat` and the island
  error card pass engine, send, cancel and scheduled-job failures through
  `describeErrorNotice`, so the floating companion no longer prints transport
  prefixes either.
- **Dev shutdown owns the process tree.** `desktop/scripts/process-tree.mjs`
  terminates the whole task tree on Windows (`taskkill /T /F`) and signals the
  detached process group on POSIX; `dev-server.close()` awaits that before
  releasing Vite. `dev.mjs` handles `SIGINT`, `SIGTERM`, `SIGBREAK` and `SIGHUP`,
  so an interrupted `npm run desktop:dev` no longer leaves an Electron host
  holding the persisted capture port and scheduler lock.
- `StatusPill` is the single state language (`live`, `busy`, `warn`, `error`,
  `idle`) for the conversation header, ChatGPT connection and tool cards,
  channel status and sidebar phase. Remaining bare dots share the same 6px dot
  and 3px halo geometry.
- Providers: one calm provider column with radio cards, grouped browser choices,
  one setup action row (`primary` + `secondary`), a separated session row with a
  destructive text action, and one save bar. Inputs and selects share height,
  radius, focus ring and token colours.
- Settings: inline danger confirmation for secret scrubbing (`alertdialog`),
  switch rows for Telegram/privacy, tokenized banners, navigation, modal shell,
  theme cards, About page, success/error notices and focus states.
- Chat chrome: unified header pill, gold rail active indicator, composer focus
  ring, tokenized update and version-mismatch banners, shared focus-visible ring.
- Chat chrome, final pass (screenshot feedback):
  - The composer adds a `:focus-visible` override for its textarea
    (`desktop/renderer/src/workbench.css`), so the rounded shell border and
    accent glow are the only focus frame. The global blue ring no longer draws a
    second square rectangle around the text box.
  - The green `Ready` / `Working` pill is gone from the conversation header.
    Blocked-reply state still disables Send and explains itself through the send
    button tooltip, which existing tests assert.
  - The `↗` browser-helper badge is removed from the mascot corner. The setup
    moved to the header `Conversation options` menu → `Browser helper`, which
    opens the same `BrowserHelperSetup` in a bounded dialog. Pairing remains
    reachable in the main window and in the island's Settings view.
  - The mascot drag hint now says `Pair Chrome/Edge in Browser helper first`
    instead of pointing at the removed corner menu.

## Verification

- `npm run desktop:build` (tsc `--noEmit` + Vite production build): passed.
- Final header/composer pass:
  - `test/desktop/companion-capture-ui.test.mjs` asserts the focused textarea
    computes `outline-style: none`, `.conversation-state` and
    `.companion-helper-toggle` both render zero times, and helper setup still
    opens from `Conversation options` → `Browser helper` with the same human
    unavailable copy.
  - `test/desktop/chatgpt-first-use-ui.test.mjs` waits on the Send button's
    disabled state instead of the removed pill; blocked replies still preserve
    the draft and show the Settings/Providers title.
  - Serial run of the three affected UI suites: **3/3 passed**
    (`companion-capture-ui`, `chatgpt-first-use-ui`, `error-notice-ui`).
  - `tsc --noEmit -p desktop/tsconfig.json`: passed.
  - Headless screenshots at 1280×800 confirm the rounded composer border with
    no square outline, a header without the green pill or corner badge, and the
    helper dialog fitting inside the viewport.
  - `scripts/verify-desktop-workbench.mjs` was updated to open the helper from
    the header menu and measure `.helper-dialog`; the script was syntax-checked,
    not re-run (it needs the live desktop bridge).
- `test/desktop/error-notices.test.mjs`: 6/6 passed (copy mapping and technical
  preservation).
- `test/desktop/error-notice-ui.test.mjs`: 1/1 passed with a real `App` render:
  the card measures under 80px, raw transport text is absent until `Details` is
  opened, the anchored popover stays under 340px wide and does not grow the card,
  Escape closes it, dismissal works, no page errors.
- `test/desktop/capture-actions.test.mjs`: 5/5 passed. Covers a synthetic
  `engine:invoke` rejection, inert values for all background actions, action
  dispatch with the calling window identity, helper-folder isolation, and a live
  two-`CompanionCapture` conflict on the remembered port (real HTTP, no
  rejection).
- `test/desktop/companion-capture-ui.test.mjs`: 1/1 passed with a real `App`
  render: hovering the mascot while setup rejects leaves no
  `.companion-capture-toast`, the tooltip contains no transport/port text, and
  both rejection and `{ unavailable }` helper results render the human notice
  without offering a pairing code.
- `test/desktop/process-tree.test.mjs`: 1/1 passed with real Node processes; a
  spawned parent's `setInterval` descendant is gone after shutdown.
- `test/desktop/desktop-dev.test.mjs`: 3/3 passed after switching shutdown to
  `terminateProcessTree`.
- Focused serial run across capture, notices, dev, island, mascot, layout and
  provider suites: **54/54 passed**.
- `npm run desktop:build`: passed (tsc `--noEmit` + Vite production build, 383
  modules).
- `test/desktop/settings-providers-ui.test.mjs`: 1/1 passed — provider cards
  share one column, browser choices and setup actions share rows, selects match
  field height, one save bar, no horizontal overflow, no page errors.
- `test/desktop/chatgpt-connection-ui.test.mjs` and
  `test/desktop/chatgpt-first-use-ui.test.mjs`: 1/1 each passed after the layout
  change, preserving every existing accessible name and payload.
- `desktop-settings`, `desktop-channels`, `desktop-layout` and `desktop-plugins`:
  34/34 passed.
- Headless screenshots at 1000×768 (`chat-notice`, `chat-notice-details`,
  `companion-helper-unavailable`) plus the earlier 1200×820 set were reviewed.
  The compact card measures about 64px tall, its `Details` popover stays inside
  a 320×260 box and does not resize the card, and the helper status reads as a
  human sentence. The notice stack still sits below the version banner.
- Full serial suite (`node --test --test-concurrency=1`): **1,429 passed, 5
  failed, 1 skipped, 1,435 total** (`duration_ms 1705264`). All five failures are
  pre-existing and unrelated to this diff; details below. The run stalled once
  in `test/tools/developer-tools.test.mjs` waiting for its disposable
  `setInterval` child, which survived `kill_process`; ending that child let the
  remaining suite finish.

## Existing suite failures (not caused by this diff)

- `test/core/browser-workflow.test.mjs` — the same three baseline failures
  recorded on 2026-10-22/23/24: both managed-browser discovery tests miss the
  tool budget (`budget=21313` / `21212`, `core=16422`) and the live form flow
  receives `fill_form needs 1 to 10 fields…` instead of `Filled 2 fields`.
- `test/desktop/desktop.test.mjs:105` and `:146` — these engine tests omit
  `settingsFile` and `sessionsDir`, so `DesktopEngine` reads the real
  `%CONFIG_HOME%\desktop-settings.json`. On this machine that file selects
  `chatgpt-browser`, so the injected `FakeAgent` is bypassed and both tests fail
  with `Connect your existing ChatGPT conversation in Settings before sending.`
  They reproduce in isolation and are a test-isolation gap, not renderer code.

## Remaining

- Run the packaged Windows build and review the same screens live, including
  the native select popup and window chrome.
- The two-process conflict was reproduced with real bridge instances and the UI
  path with a rejected stub, not by launching the packaged app alongside a
  second dev instance on a desktop session. That final manual check remains.
- No light theme exists; contrast was checked on graphite, and token-level
  overrides for mono/slate only by construction.
