# Managed ChatGPT Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer a built-in ChatGPT window and existing Chrome, automatically connected without copying pairing links.

**Architecture:** Reuse ANKITA's browser runtime, durable operation ledger and native MCP gateways. Add an app-owned Electron browser transport and automatic external companion discovery. Share editor, app and receipt rules across both modes.

**Tech Stack:** Existing Node ESM, Electron, React/TypeScript, Chromium fixtures and Node test runner. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-23-managed-chatgpt-browser-design.md` (approved: “Yes, build both like CoS”). Execute directly here as previously requested; review the resulting code independently.

## Global Constraints

- Preserve all existing dirty work, settings, encrypted tunnel keys and spent operations.
- Named constants/config for protocol IDs, selectors, timing and dimensions.
- Keep model pages separate from task browsers; never expose host credentials to a page.
- Exact Send receipts and native ownership; uncertain sends are observation-only.
- Both browser modes share the same Send, Stop and app-tag behavior.
- Windows tests run serially and all verification gaps are recorded.

## Review Focus

- Two app instances or browser candidates must not silently attach the wrong profile.
- A new chat obtains its real ID only from a received native question, including across a crash.
- A stale or renamed app must not route work to somebody else's connector.
- Stop/disconnect racing asynchronous setup must prevent late browser actions.
- Sign-in redirects, popups and closed windows must give a recoverable status rather than false Ready.

### Task 1: Owned window transport and automatic companion connection

**Files:** create `desktop/electron/chatgpt-window.mjs`; modify `services/chatgpt-bridge/{config,server}.mjs`, `desktop/chatgpt-companion/background.mjs`, `desktop/electron/chatgpt-browser.mjs`, `desktop/electron/main.mjs`, shared wire/types and `ChatGptConnection.tsx`; test in new `test/desktop/chatgpt-window.test.mjs` and existing companion/desktop tests.

**Interfaces:** `ChatGptWindow({ companionPath, onChange }).open({ url, reveal })`, `.api`, `.close()` supply a Chrome-compatible selected-tab/script surface owned by the host. `createCompanionBridge({ managedBrowserId })` supplies in-process admission without an HTTP listener or extension impersonation. External discovery/provisioning is gated by explicit host intent and version/origin checks.

- [x] Add failing tests for reusable compact windows, navigation checks, credential-free script projection, one startup, and no HTTP pairing for owned pages.
- [x] Implement the owned transport and one shared command pump over the existing bridge.
- [x] Add failing actual HTTP tests for automatic discovery, incompatible builds, wrong origins, two candidates and disconnected/late provisioning.
- [x] Implement external automatic connection without changing existing token-protected command routes.
- [x] Add browser mode controls, Open/Show actions and honest status; keep legacy pairing recovery.
- [x] Run affected suites and a native Electron fixture for both command paths.

### Task 2: New chat and teammate lifecycle

**Files:** bridge/runtime/operation-store/observation modules, shared page route rules, browser manager and both page transports; tests in browser delivery/ownership and new owned-window integration fixture.

**Interfaces:** A host-owned opening lease distinguishes a page without a server conversation. Adoption must durably bind only its one authorized exact user receipt and preserve operation identity on restart. Teammate/workspace mapping stores only confirmed real conversations.

- [x] Add failing tests for first message from a blank chat, two teammates, navigation to an unrelated chat and a crash between dispatch and acknowledgement.
- [x] Implement opening/adoption and remembered per-teammate chat selection without sharing native execution ownership.
- [x] Ensure Resume/Stop keep original custody and never grant a second Send after an acknowledgement loss.
- [x] Run real page + Electron round trips for first send, later send, switching, reload, Stop and restart.

### Task 3: Current upstream editor and connector identity

**Files:** page reader/app adapters, bridge observation projection and new connector identity state if needed; vendor source records, related tests and setup guide.

**Interfaces:** Shared authored editor text excludes presentation elements. Stable app identity is learned only by joining page sightings with requests served by this install; a complete current catalogue can revoke it.

- [x] Reproduce injected CSS draft mismatches and delayed/absent app catalogues before editing the adapters.
- [x] Adapt the upstream editor reader consistently and add proven connector identity custody/account invalidation.
- [x] Run delayed Send, real native app tags, renamed/missing/duplicate apps, both mode contract fixtures and actual hosted Core/desktop round trips where available.
- [x] Record source pin/hashes/notices, user-facing steps, exact counts and remaining hosted/login/platform limits.
- [x] Run affected suites, desktop build, serial full suite and `git diff --check`; inspect introduced literals and obtain independent code review.

Do not commit unrelated files or call the new flow shipped based only on a typecheck or fixture. Published installers and Vercel deployment are outside this browser change.

## Execution status — 24 October 2026

All three implementation tasks are complete locally. Both hosted message paths
and the available Core/Desktop tool checks passed. Publication, other operating
systems and installer testing remain separate from this plan.

- Task 1: owned window, in-process admission, automatic Chrome discovery and
  provisioning, mode controls and legacy recovery are implemented. Verified by
  `chatgpt-window.test.mjs`, `chatgpt-managed-bridge.test.mjs`,
  `chatgpt-window-native.test.mjs` (real Electron, internal only) and the
  companion suites.
- Task 2: opening lease, exact-receipt adoption, per-teammate chats and
  no-replay restart behavior are implemented. Verified by
  `chatgpt-opening.test.mjs`, `chatgpt-window-native.test.mjs` and the delivery
  fixtures (first send, later send, switching, reload, Stop, restart).
- Task 3: editor text, connector identity custody/invalidation and both-mode
  contract fixtures are implemented and covered by
  `chatgpt-connector-identity.test.mjs`, `chatgpt-app-mentions.test.mjs`,
  `chatgpt-request-origins.test.mjs` and the MV3 external fixture.
- Focused browser suite: **161 passed, 0 failed** (142 s); `desktop:build`
  exit 0. The suite must run serially: a concurrent second run can hold ports
  39661–39665 and starve the MV3 fixture.
- Hosted Chrome transfer reached `ready/accountReady=true`. A real first Send
  received a real conversation ID and both native app tags. ChatGPT briefly
  reported a stream error, then completed the answer; observation-only Resume
  imported that final once, with no second Send. Saved text matched the emitted
  reply and no recoverable operation remained.
- Final reviewed serial suite: **1,415 tests; 1,411 passed, 3 failed, 1 skipped**.
  Failures are the three previously reproduced browser-workflow baseline cases.
  This run preceded the small profile-vault follow-up; it is not a green suite.
- Live verification exposed a shared dev/normal vault encrypted under different
  Electron profiles. Per-profile vault selection now preserves the legacy file.
  Its RED regressions became GREEN; final combined affected checks **39/39**.
  The production-entry verifier passed OS-encrypted pairing, separate vault
  location, restart/resume, attachment and owned Stop. Build passed 378 modules.
  A narrow independent review found no issues in this follow-up.
- Hosted Core now passed create/edit/read plus a shell command; Desktop passed
  its native read-only window list (15 windows). A longer command passed separate
  job_status/job_wait and final exit code 0. Native Markdown storage escaping
  initially hid its receipt; the one-pass owned-question fix passed a fresh
  hosted quoted command and automatically returned its final answer.
- External Chrome reached Ready after the companion reload and returned one
  matching saved reply without a pairing link. Added CoS-style MV3 alarm wake;
  timers alone cannot wake a suspended extension worker. Explicit Disconnect
  and asynchronous alarm-creation cancellation have RED/GREEN regressions.
- Final affected suite after all code changes: **192/192 passed**, 33 files
  serially in an isolated config (116,113 ms). The actual MV3 fixture stops its
  worker and observes alarm-driven revival without a repeated Send. Final build
  passed (378 modules), whitespace check passed, and all 15 installed companion
  files match the source. Built-in mode returned Ready with no pending reply;
  normal app restart removed both temporary debugger ports.
- Open gates: direct Google embedded login (provider refusal; Chrome transfer
  works), other operating systems and a signed installer. A dedicated negative test covers the
  unknown-first-chat crash: remain uncertain and never repeat Send.
