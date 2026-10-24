# CoS browser source review — 23 October 2026

Status: both browser transports implemented locally; native fixtures pass. The
real Chrome sign-in transfer reached an authenticated, Ready built-in window on
24 October. Hosted Send/reply passed in both modes; built-in Core file/command,
job completion and read-only Desktop actions passed. A packaged release remains
a separate gate.

## What was actually checked

Fetched the existing reference clone with `git fetch origin --prune`. Its remote
`main` resolves to
[`a9c02cc8339ed550862e57e33c54169b9ceedce3`](https://github.com/totec448-spec/chat-on-steroids/tree/a9c02cc8339ed550862e57e33c54169b9ceedce3),
package version **2.1.45**. The reference working tree was not switched, and no
upstream application, install script or binary was run. The existing ANKITA
adapter pins and license records were not changed merely by fetching.

## Plain explanation

CoS has two browser choices. Its own browser is Chromium inside its desktop app.
Its normal Chrome option uses an extension. The source does not support the idea
that its Chrome messaging path secretly attaches to any ordinary window over a
debugging port. Its own browser does use Chromium debugging commands for browser
actions, through Electron's debugger interface.

CoS removes manual pairing through automatic local discovery and token setup.
It remembers which plugin belongs to this computer. It waits for the editor to
accept the text and plugin tag before clicking Send, then checks the real new
question to prove delivery. Those pieces matter independently of which browser
opens the page.

## Source evidence

All paths and line numbers below are at the fetched revision above.

| Question | Actual source | Consequence for ANKITA |
| --- | --- | --- |
| What opens the built-in browser? | `src/main/cos-browser/host.ts`: `boot`, lines 238–262, uses a persistent Electron session and loads the bundled companion. `control.createTab`, lines 949–968, creates sandboxed `WebContentsView` pages with background throttling disabled. | A standalone app can own the browser lifetime and install its adapter itself. A customer need not load an unpacked extension for that mode. |
| Can it reopen or reuse a window? | `host.ts`: `open`, `show`, `showSignIn`, lines 335–370; `src/main/browser-startup.ts`: `wakeBrowserUrl`. | Reuse is explicit. Starting an OS browser is guarded by a selected-family absence check; a disconnected extension does not by itself prove Chrome exited. |
| What does CDP do? | `host.ts`: `debuggerAttach` / `debuggerSend`, lines 1034–1058; `src/main/cos-browser/chrome-api.ts`: `debugger.*` handlers. | Built-in browser actions reach Electron's CDP interface. This is separate from the model-message and MCP transports. |
| How does external Chrome start? | `src/main/browser.ts`: `openInPreferredBrowser`, `preferredBrowserCandidates`. | Launches the chosen installed browser using its ordinary profile and companion. It does not launch a general remote-debugging endpoint for ChatGPT messaging. |
| Why no copied pairing link? | `extension/background.js`: `hello` / `discover`, lines 1092–1197; `provision` / `pairOnce`, lines 1286–1358; `src/main/bridge.ts`, lines 2450–2483. | The extension finds a local bridge and obtains/reuses a token automatically. Disconnect has a separate generation so late setup cannot undo it. CoS explicitly documents the local-process trust tradeoff. Do not copy this into ANKITA's action gateway as unauthenticated tool access. |
| How does the first message create a chat? | `extension/content.js`, lines 13544–13558 and 13617 onward; `chatgpt-dom.js`: `send`, lines 2554–2597. | A fresh page may start without a conversation ID. Bind its new ID only with the exact question receipt from that Send. Earlier ANKITA required a saved conversation before starting; the new owned-opening path removes that requirement. |
| How are plugins selected automatically? | `extension/content.js`: `currentCoreMention`, lines 1007–1047; `src/main/connector-identity.ts`: `noteServedRequest`, `noteAppSightings`; `extension/background.js`, lines 275–338. | Prefer an ID proven by this install's own served request and page result; names are a bootstrap fallback. Remembered identity can bridge a fresh page's missing catalogue, but a complete contrary list revokes it. ANKITA's earlier fork only kept the current page's passive name list; proven identity custody is now implemented. |
| Why can typing succeed while Send fails? | `chatgpt-dom.js`: `send`, lines 2671–2739; `content.js`, lines 13441–13472 and 13598–13613. | Wait for editor and Send readiness; recheck ownership after authorization; distinguish a never-clicked Send from an unconfirmed clicked Send. Clicking twice on a timeout is not a fix. |
| What changed upstream today? | [`c31e8923696c86ffb7b66316ea8cad2914f678c1`](https://github.com/totec448-spec/chat-on-steroids/commit/c31e8923696c86ffb7b66316ea8cad2914f678c1): `editorText`, `NOT_PROMPT`, composer reads and related tests. Follow-up `ac9d4747` handles a non-prompt element passed directly to the reader. | Rich-link previews can inject style/script/template nodes inside the editor. Their contents must not count as authored text or break draft matching. This is relevant source evidence, not proof that it caused the user's short `hi` failure. |
| How does sign-in work? | `host.ts`: persistent session, `showSignIn`, Google sign-in handling; `cos-browser/sign-in-transfer.ts`. | Sign-in is an explicit lifecycle. CoS even has a separate browser-assisted flow for Google. A new browser cannot simply inherit an arbitrary Chrome login. |

## Actual ANKITA failures, kept separate

- The installed Chrome companion came from the older `eight-board-ideas`
  checkout, while ANKITA ran newer host code. That copy dropped automatic app
  metadata. Six adapter files were updated in that same extension folder with a
  backup; the user's pairing and tunnel settings were not reset.
- After that update, recent sends still failed with `apps-unobserved` and one
  `app-not-found`. These are recorded failure codes from the actual operation
  ledger. The source comparison explains why repeatedly refreshing is not a
  complete design: ANKITA lacks CoS's remembered proven connector identity.
- The second teammate used the first teammate's single bound conversation.
  ANKITA refused it. Automatically owning one chat per teammate can remove that
  manual selection problem without sharing their execution ownership.
- `Invalid window handle (0x80070578)` is a separate Windows driver target
  failure. Changing Chrome transport does not repair a stale Notepad handle.
  Fresh target observation is required; never replay an uncertain click.

## Implemented change and evidence

See the [managed browser design](../superpowers/specs/2026-10-23-managed-chatgpt-browser-design.md).
Use the same useful principles: app-owned browser lifetime, saved sign-in,
automatic internal connection, one owned chat per teammate, proven app identity,
and receipt-based Send/recovery. Keep ANKITA's existing tool host and three native
MCP surfaces. This is a transport and lifecycle change, not an import of CoS's
entire agent, filesystem/process engine, or application UI.

The approved implementation now includes both choices. The built-in window uses
an isolated persistent Electron session, sandboxed pages and document-start
adapters. Chrome discovers an explicitly opened loopback bridge and provisions
its token without a copied link. Legacy pairings remain supported. Both use one
Send/receipt/Stop contract and the same app-tag and editor readers.

The native Electron fixture initially hung before its first navigation: CDP's
Page.enable waited for a renderer that did not exist. Creating about:blank first,
then installing observers before ChatGPT navigation, fixed that trace. Its next
failure was an overly broad URL-change rejection after the first authorized
Send acquired a real chat. Only that exact dispatched Send can now adopt its
question's real conversation ID. Durable operations keep their original hash.
Random logical tab IDs avoid recycled Electron handles after restart.

The real MV3 fixture reproduced a second poll consuming an already offered Send.
The common pump now uses that same offered operation. Waiting for Chrome's page
readiness happens before queueing; aborting that wait cannot leave a queued Send.
Closing during asynchronous startup cannot revive a late window or bridge.

Exact local trace from `test/desktop/chatgpt-window-native.test.mjs`:
`OWNED_NATIVE_CHAT {sends:1,firstReplyMatched:true,laterReplyMatched:true,teammatesIsolated:true,restoredWithoutReplay:true,nativeStopClicks:1,internalOnly:true,realElectron:true,hostedChatGpt:false}`.
This covers a manager restart in actual Electron, not a hosted account or a
complete operating-system/process restart. `chatgpt-external-native.test.mjs`
uses a real MV3 extension and disposable Chromium profile; its first Send and
matching final pass without manual pairing.

Connector proof joins structured native app metadata to this installation's
settled request receipts. The cache stays within the same browser, teammate,
workspace and confirmed chat. Changing its tunnel or app name invalidates the
selection. Complete contradictory page catalogues refuse old IDs. This stricter
scope avoids guessing that two chats share an account; a new chat still needs
the catalogue that its document-start observer watches. Actual rich-preview CSS
is excluded from authored text; typed literal markup stays intact.

## Verification snapshot — 24 October 2026

- Final affected run after the receipt and MV3 lifecycle fixes: **192/192 passed**
  across 33 files, serially with an isolated `CONFIG_DIR` (116,113 ms). Log:
  OS temp `ankita-browser-final-hgvstI/serial.log`; `result.json` exit code 0.
  Includes actual Electron, actual MV3 worker stop/alarm revival, native HTTP
  tools, encrypted profile vaults, app tags, attachments, Stop and recovery.
  An earlier 112-test confirmation exposed an outdated RPC fixture missing
  `chrome.storage.local`; its mock now includes the identity store and drains
  Disconnect before removing the global Chrome object. The final run includes
  that regression with no asynchronous activity after completion.
- Final `desktop:build`: exit 0, 378 modules; `git diff --check`: exit 0.
  Introduced production timing/identity/grammar literals are named constants;
  generated manifest values follow the shared config. Protocol field names,
  UI copy and isolated test fixtures remain literals intentionally.
- Actual app returned to built-in mode at `ready/accountReady=true`, with zero
  pending replies. Relaunched normally with its saved profile: the new main
  process has the Ankita window and no debug flags; both temporary debugger
  ports are closed. All 15 installed companion files match the checked source.
  The final small Disconnect-race fence loads on the companion's next worker
  restart/reload; its production behavior was exercised in the native fixture.
- Focused browser/native suite (desktop browser, owned-window fixtures, companion,
  send, operation store, native tunnel, managed bridge, opening, sign-in,
  connector identity, app mentions, external MV3): **161 passed, 0 failed**
  (`node --test`, 142 s). Includes `real MV3 companion discovers ANKITA ...`
  (20.7 s) and `NATIVE_LOCAL_ACTION_PROOF ... "exitCode":0`.
- Full serial suite (`node --test --test-concurrency=1`): **1415 tests, 1406
  passed, 8 failed, 1 skipped** (19.6 min). Five failures are the pre-existing,
  separately documented ones: three `test/core/browser-workflow.test.mjs`
  checks that also fail on unchanged HEAD, and two `test/desktop/desktop.test.mjs`
  fixtures that read the user's real provider settings (both pass **8/8** with a
  disposable `CONFIG_DIR`). The other three are load-sensitive:
  - sign-in handoff listener count `3 !== 1`; passed **24/24** for the whole file
    and **6/6** repeats of the single test in isolation.
  - real MV3 fixture missed its first page within 15 s under full-run load;
    passed alone with `EXTERNAL_NATIVE_CHAT` and `EXTERNAL_NATIVE_WAKE`.
  - CLI job test failed only in its `t.after` cleanup with Windows `EPERM` on
    `rmSync` of the temp directory; passed **2/2** in isolation.
  No production assertion failed outside the two documented categories.
- `desktop:build`: TypeScript plus Vite build, exit 0 (378 modules).
- Final reviewed manager/sign-in/real Electron/popup run: **31 passed, 0 failed**.
  The standalone real MV3 fixture also passed. It now uses a disposable wire with
  an ephemeral test-only discovery port, avoiding the user's running app.
- After the profile-vault follow-up and final constant audit, the combined
  affected suite passed **39/39**. The production-entry Electron verifier again
  passed encrypted pairing, attachment, crash/resume, owned Stop and the new
  per-profile vault assertion; `hostedChatGpt=false` for that fixture.
- Complete serial run with an isolated `CONFIG_DIR`: **1,415 tests, 1,411 passed,
  3 failed, 1 skipped, 0 cancelled** (1,105,775 ms). All three failures match the
  previously reproduced `browser-workflow.test.mjs` baseline: two discovery-budget
  assertions and the `fill_form` contract. The full suite is **not green**. Logs:
  OS temp `ankita-managed-final-reviewed-IvGmSN/serial.log`. This run preceded the
  profile-vault follow-up below; unrelated user commits also landed during it.
- Earlier in the same session one run failed the MV3 test while a second suite
  was still using the fixed discovery ports 39661–39665. The failure was
  `Real companion did not reach the expected fixture state` after 57 s; only
  TIME_WAIT remained. It passed twice when run without overlap, so the recorded
  cause is port contention between concurrent test processes, not a code defect.
  Runs must stay serial.
- The native gateway command test now passes its marker through `env` instead of
  embedding quotes in `node -e`. PowerShell 5.1 drops embedded double quotes in
  native arguments, so the old command reached Node as an undefined identifier
  and exited 1. Passing data by environment keeps the test portable across shells
  without changing production behavior.

Remaining: direct Google embedded login (refused by the provider; Chrome transfer
works), other operating systems and a signed installer. A dedicated negative regression
now covers a crash before any real chat URL is durably known: it stays uncertain
and must never repeat Send.
Automatic discovery trusts local programs; origin checks do not protect against
a malicious local process. Native action endpoints remain capability protected.
The separate stale Notepad handle issue is not fixed by this browser work.

## Sign-in transfer follow-up requested by the user

Re-read `cos-browser/sign-in-transfer.ts`, `sign-in.ts`, `host.ts#importSignIn`,
`extension/background.js#cos_sign_in_transfer` and the popup gesture at the same
pin. CoS does copy narrowly allowlisted ChatGPT session cookies after an explicit
extension button and optional permission. It does not copy passwords or the whole
profile. ANKITA now implements that flow with a separate handoff-only bridge,
expiry, cancellation, contiguous chunk validation, destination account protection,
cookie-jar rollback and fixed errors. Unit/real popup checks passed 5/5. The actual
Electron fixture passed `OWNED_SIGN_IN_TRANSFER {actualElectronJar:true,authenticatedHttp:true,sessionOnly:true,appSettingsContainCookie:false,hostedAccount:false}`.
The credential-only review found three Important issues: cancellation after a
jar write, overlapping handoff startup and exclusion of normal ChatGPT root tabs.
Each had a failing regression before its fix. Rollback custody now lasts through
the final synchronous commit; startup coalesces and drains; handoff inventory
accepts the exact ChatGPT origin without granting model/tool binding.

Live on 24 October, Google rejected embedded sign-in with “This browser or app
may not be secure.” The user then reloaded the installed Chrome companion and
clicked its explicit transfer/permission flow. ANKITA's actual built-in window
reached `status=ready, accountReady=true, nativeAppTagsReady=true`; no email login
or pairing link was needed. A temporarily open responsive sidebar correctly
blocked composer detection until dismissed; the reader was not weakened.

The first hosted check then failed **before Send** with “Could not use this saved
secret.” A read-only decrypt probe proved both existing tunnel keys were usable
under `Ankita-dev`, but not the normal `Ankita` encryption profile. Both profiles
had been sharing one encrypted file. Desktop vaults now follow Electron's runtime
`userData` directory and copy a legacy encrypted file only when no profile file
exists; the legacy file remains untouched. A local, private in-memory handoff
re-encrypted only the two existing tool keys for the normal profile:
`{migrated:2,allUsable:true,originalUnchanged:true,profileIsolated:true}`.
No key value was printed or written in plaintext. Regression checks went RED 2/2
(missing profile helper), then GREEN 6/6 with the existing secure-store tests.

The real first Send created a server conversation and included both native app
tags. A transient ChatGPT stream error preceded its final answer. Explicit
observation-only Resume imported the already completed answer; it did not Send
again. Trace: `HOSTED_ANKITA_REPLY {accountReady:true,ended:true,replyContainsMarker:true,savedReplyMatches:true,savedMatchingReplies:1,errors:[],resumedWithoutSend:true,recoverable:0}`.
The model also echoed the appended app names, so this establishes faithful
transport rather than exact compliance with the marker-only wording.

The first Core action check returned `NOT_FOUND: Tunnel-client has not been seen
for 300 seconds`, with no local tool calls. Passive inspection of the installed
Proof app's actual connector response confirmed its original tunnel, different
from the current Core card. Reconnected Core to that verified existing tunnel
using the saved restricted key; no ChatGPT app replacement or new account grant.
The next hosted check passed `write_file`, `edit_file`, `read_file` and
`run_command`, all `isError=false`. The final marker matched exactly. Command
evidence: `job 1: done (exit 0)` with the expected marker in its captured output.
The later Desktop call passed `mcp__ankita-computer__list_windows` and returned
15 windows, without input or a screenshot. This is separate from pointer/click
recovery; the earlier stale Notepad handle is still outside this change.

A longer hosted command passed `run_command`, `job_status` (running), then
`job_wait` (done, exit code 0, expected captured output). Its final answer existed
on ChatGPT, but native question storage had doubled four literal backslashes;
the exact receipt comparison stayed dispatched. CoS's `content.js`, lines
827–907 and 13512 onward, compares raw app-owned bootstrap text first, then one
Markdown storage decode. ANKITA now does the same only for its dispatched
question, retaining native IDs, baseline, scope, ambiguity refusal and immutable
operation arguments. RED one-pass mismatch became GREEN **12/12 Send tests**,
including punctuation, hard breaks, leading spaces, raw entities and distinct
literal paths. Two escape passes remain refused; Send stays single-use.

After the previous app exited, its unresolved operation was already stopped.
The updated reader found that exact old receipt and answer without reviving it:
`{hasReceipt:true,hasAnswer:true,operationStillStopped:true,argumentsUnchanged:true,stopPhase:"confirmed",helpersStarted:0}`.
A fresh quoted command then completed automatically with all three job calls,
exit code 0 and its expected final answer; no manual Resume was needed. Saved
sign-in and per-profile keys survived the actual process restart.

External Chrome initially remained `pairing-required` while normal Chrome had
no open window. CoS's `background.js`, lines 1038–1088 and 5737 onward, explains
that its retry alarm wakes a suspended MV3 worker; ANKITA only had an in-memory
timer. Added a persistent 0.5-minute wake alarm without postponing it on every
active poll. Disconnect clears it; epoch checks also clear a late creation.
Both race regressions went RED then GREEN (**4/4 worker lifecycle tests**).
The actual MV3 fixture also stopped its worker through the service-worker
debugger domain, then observed the browser alarm revive it and restore fresh
readiness: `EXTERNAL_NATIVE_WAKE {realExtension:true,workerStopped:true,alarmRevivedWorker:true,sends:1,hostedChatGpt:false}`.
After the user reloaded the updated installed companion, Chrome automatically
reached `ready/accountReady=true/nativeAppTagsReady=true`. A fresh hosted message
finished with no error and exactly one matching saved assistant reply, using
the same account and no copied pairing link.
