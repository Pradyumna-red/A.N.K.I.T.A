# Compact settings and automatic ChatGPT app tags

Implemented locally on 22 October 2026. No installer or release was published by
this task, and the user's running app/profile was not restarted or reconfigured.

## What changed, in simple words

- Tool setup is now three small rows. Open only the row you need.
- The command menu is smaller. Scrollbars are hidden, while scrolling and
  keyboard controls still work.
- The setup buttons were disabled because this checkout did not have its
  connection helper files. Normal development/start commands now prepare and
  check those files before opening ANKITA. A valid saved copy avoids a download.
- App names are already filled in. ANKITA adds real ChatGPT app tags when you
  send a message, so you do not need to type those names each time.
- Existing app names can be saved. For example, Core can use an app already
  called ANKITA Proof without replacing its tunnel.
- Automatic tags can be switched off. Missing or duplicate app names produce
  a clear reason before Send instead of selecting a different app.
- Reply recovery and Stop retain the saved app tags after a reload or a lost
  acknowledgement. A reload does not permit a second Send.

See the [setup guide](../guides/chatgpt-browser.md) for the one-time extension
reload and selected-tab refresh. Existing pairing and tunnel IDs stay valid.

## CoS source comparison

The existing reference clone was fetched and advanced with a fast-forward from
`34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5` to
[`532cbeffced7e24a3d8b960cbf93941687f04b19`](https://github.com/totec448-spec/chat-on-steroids/tree/532cbeffced7e24a3d8b960cbf93941687f04b19),
version **2.1.45**. No CoS application or dependencies were installed or launched.

| Source finding | ANKITA change | Why it helps |
| --- | --- | --- |
| `chatgpt-dom.js` uses native app-mention spans and waits for editor adoption. | Focused MIT adaptation in `app-mentions.js`, used before one authorized Send. | Text that merely looks like an app name does not reliably attach that app. |
| `usage.js` passively observes the page's app catalogue and refreshes network hooks. | Observe only same-origin catalogue responses already fetched by the selected conversation. Reattach when page instrumentation replaces fetch. | Uses real installed app IDs without guessing or making private API requests. |
| `fiber.js` describes stored app links in user text. | Remove only expected saved tag suffixes during receipt matching; preserve other authored links. | Tagged messages still match the correct reply and Stop target. |
| Native app tags can affect ChatGPT's own tools, including image creation. | Visible automatic-inclusion switch and editable saved names. | Users can choose plain ChatGPT chat when needed. |

The original reader import pin remains unchanged. New import hashes, functions
and licensing are recorded separately in
[source.json](../../vendor/chat-on-steroids/source.json) and the
[vendor notes](../../vendor/chat-on-steroids/README.md). Broader prompt rewriting,
CoS's tool backend, model selection and unrelated upstream features were not
imported. ChatGPT account limits continue to apply.

## Root fixes and evidence

### Missing helper files

The development resource directory was absent, reproducing the screenshot's
disabled setup. The new readiness regression initially failed because no
readiness function existed; it now checks both helper hashes and required notices,
including missing/modified files. It is a startup/build check rather than a hash
operation on each settings status poll.

The existing pinned publisher download path was run successfully:

```text
publisherArchiveMatched:true primaryMatched:true forwardingHelperMatched:true notices:5 binariesExecuted:false
```

Then the real `npm run predesktop:start` hook returned:

```json
{"event":"chatgpt-resources-ready","companion":true,"nativeTarget":"win32-x64","cached":true,"primaryMatched":true,"forwardingHelperMatched":true,"notices":5,"binariesExecuted":false}
```

Missing files still prevent connection. The UI explains why and provides
**Check connection files**. Availability enables the button; styling does not
bypass the helper check. Packaged resource paths remain outside ASAR.

### Native tags, page loading and recovery

Controlled Chromium reproductions cover real editable DOM tags and native
React-shaped user/final receipts. The new response-hook regression reproduced
`apps-unobserved` after fetch replacement. Another held-response regression
failed when a refresh discarded an in-flight catalogue response. Refresh now
retains those responses and deduplicates their identities with a WeakSet.

The tagged lost-acknowledgement/reload/Stop regression reproduced a missing Stop
target when tag metadata was omitted. Send, reply readback and Stop now carry the
same saved tag metadata. The ledger requires the corresponding exact native app
witness before dispatch, including when an authorization omits its witness.
Aliases and automatic inclusion are saved through the owner-window settings IPC.

### Compact controls

The slash menu's new 320 CSS-pixel bound failed against the old layout before the
CSS change. It now passes at three viewport sizes and in all three themes.
Settings cards start closed, their names are prefilled, and Save app names stores
the edited alias and toggle. Hidden-scrollbar styles retain overflow scrolling.

## Verification

- Final focused serial run: **142 passed, 0 failed, 0 skipped**. Includes all
  ChatGPT integration/desktop tests, shipped-CSP startup and slash-command tests.
- Independent reviewer: **19 passed, 0 failed**, covering the final metadata,
  Send/Stop and app-witness regressions; no remaining actionable findings.
- Slash browser checks: **31/31** across Graphite, Mono and Slate at
  1366×768, 640×720 and 900×540. Evidence:
  `C:\Users\anime\AppData\Local\Temp\ankita-desktop-slash-TcAR6B`.
- Actual Electron slash checks: **5/5**, no provider requests, no renderer errors.
  Evidence: `C:\Users\anime\AppData\Local\Temp\ankita-desktop-slash-mONsvq`.
- `npm run desktop:build`: exit **0**, TypeScript and Vite, **378 modules**.
- Actual Electron lifecycle fixture: one initial Send/final/history match,
  attachment acceptance, OS-encrypted pairing, crash recovery without replay,
  one owned Stop, browser preserved, **0 renderer errors**. Uses an isolated
  browser DOM fixture, not a signed-in ChatGPT account. Final output also reports
  `nativeAppPreferencesPersisted:true` and `nativeConnectionFilesPresent:true`.
- Native local HTTP MCP fixture: real write/edit/readback and completed command,
  **exitCode:0**. This does not prove hosted ChatGPT delivery or the real Cua driver.
- `git diff --check`: clean. Introduced literals reviewed: bounds and file IDs
  are named constants; UI copy/serialized keys and CSS presentation dimensions
  are intentional. Browser and host adapters independently validate the reviewed
  native app format at their separate execution boundaries. No new dependency,
  hardcoded user account, tunnel ID, model name or production workspace path.

Commands:

```text
rtk proxy node --test --test-concurrency=1 "test/integrations/chatgpt*.test.mjs" "test/desktop/chatgpt*.test.mjs" test/desktop/desktop-startup.test.mjs test/desktop/slash-commands.test.mjs
rtk proxy npm run desktop:build
rtk proxy npm run predesktop:start
rtk proxy node scripts/verify-desktop-slash.mjs
rtk proxy node scripts/verify-desktop-slash.mjs --native
rtk proxy node scripts/verify-chatgpt-browser.mjs
rtk git diff --check
```

## Full-suite findings outside this change

The full serial run recorded **1365 passed, 5 failed, 1 skipped** (1371 tests)
during this task. The final focused run above also includes later regressions.

- Three `test/core/browser-workflow.test.mjs` failures: two tool-budget checks
  (`budget=21313/21212, core=16422`) and one form fixture (`fill_form needs 1 to
  10 fields`). All three reproduce in an archived HEAD checkout with only the
  workspace's pre-existing core/tool edits copied in and none of this update's
  connection changes. Unchanged HEAD passes those three checks.
- Two `test/desktop/desktop.test.mjs` failures: old API fixtures read the user's
  saved ChatGPT provider settings because they omit a settings path. Both also
  fail on unchanged HEAD. With a disposable `CONFIG_DIR`, that file passes
  **8/8**. The user's real profile was not changed to make tests pass.

These findings are recorded rather than expanding this update into unrelated
tool-schema or test-isolation work.

## Remaining limits

The user's hosted ChatGPT account and three installed apps have not been tested
with these new tags. ChatGPT can change its editor/app metadata format; unknown
variants refuse rather than guessing. Refreshing the selected tab once is needed
to observe a fresh app catalogue after the extension update. Actual tags do not
create/install/enable ChatGPT apps or replace account-side permissions.

No new installer/ASAR application was built or applied; native verification uses
development Electron with the production renderer and isolated settings. Only
Windows x64 helper resources were checked. Other operating systems, physical
screen readers and a real Cua driver action were not exercised by this change.

**Confidence: 88/100.** +142 focused checks, +31 browser/5 native UI checks,
+checksum-verified resources and actual Electron recovery. −6 hosted-account
check outstanding, −3 newly installed package untested, −3 existing suite failures.
