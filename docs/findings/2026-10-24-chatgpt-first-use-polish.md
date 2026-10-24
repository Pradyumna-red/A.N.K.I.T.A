# First-use ChatGPT replies and browser choice

## Report and cause

The first greeting received an answer in ChatGPT but no answer in ANKITA.
A greeting after restarting worked. Read-only inspection of the operation
journal found the first opening marked uncertain with a transport notice,
without an accepted receipt or terminal answer. The bridge returned before
recording delivery whenever a notice appeared. The runtime also rejected the
original waiter, so later passive observation could not complete that live turn.

The Chrome option already existed, but a dropdown hid it. The disconnected
extension said to open ChatGPT first even while ANKITA was using its internal
window, which has no external discovery listener.

## Change

- A transient transport notice pauses native actions while exact receipt and
  final-answer observation of the already sent question continues. No resend,
  replacement chat, model change or automatic tool-helper restart is introduced.
- Before-dispatch warnings report an unsent question rather than leaving a
  waiter running forever. Explicit read-only Resume can read through a stream
  notice; other provider blocks retain their existing refusal.
- Explicit native Stop can pass a fresh transport warning only for its exact
  owned receipt. Wrong receipts, repeated Stop and other provider blocks remain
  refused. New Send still requires Ready.
- Two visible choices, ANKITA window and My Chrome, replace the dropdown.
  A compact strip above the composer offers browser switching, Show ChatGPT,
  Browser settings, Read reply and a link back to the owning teammate.
- Drafts survive a switch. Unfinished replies prevent another Send and browser
  switching. The header says Check reply instead of Ready when recovery is
  needed. The extension explains the precise My Chrome setup step.

## Reproduction and evidence

The real isolated Electron fixture sends its first question, observes an
English stream-error alert and an in-progress native answer, then completes
that same answer without restarting. Before the fix it returned the transport
error instead of the final. After the fix:

```text
OWNED_FIRST_USE_STREAM_RECOVERY {"firstSetup":true,"restart":false,"finalMatched":true,"error":null}
OWNED_TRANSPORT_PAUSED_STOP {"confirmed":true,"clicks":1,"message":"Browser reply cancelled by user","transportPaused":true}
```

The fixture also checks one Send, the next question, separate teammate chats,
manager restart without replay and session-only sign-in transfer. It uses real
Electron with local ChatGPT-shaped pages, not a hosted account.

Bridge regressions reproduced the missing first receipt, unsent waiter and
transport-paused Stop refusal before their fixes. Runtime tests cover read-only
Resume without helper restart. Browser-rendered UI checks exercise settings,
the full ChatPane and Composer, Chrome switching with a retained draft, Read
reply, owner navigation, Stop availability and a narrow viewport. The companion
popup checks the new setup instruction. A rendered recovery panel was visually
inspected at desktop size.

Final checks on 2026-10-24:

- Serial affected suite: **204/204 passed**, 35 files, 0 failures, skips or
  cancellations. Includes desktop browser, MV3 extension/wake, ownership,
  recovery/Stop, provider settings, credentials, startup and slash commands.
  The first run caught an optional runtime-map access in the new pending view;
  its focused regression and the complete rerun passed after the guard.
- `npm run desktop:build`: exit 0; TypeScript and Vite, 379 modules.
- `node scripts/verify-chatgpt-browser.mjs`: actual Electron transcript and saved
  history both matched after the first stream warning, one Send, one turn-end,
  no renderer errors and no restart before completion. The later attachment,
  crash/read-only resume and exact native Stop checks also passed.
- Actual saved ChatGPT account in the built-in browser: `matched:true`,
  `assistantCopies:1`, `errors:0`, `status:ready`, `pending:false`,
  `recoverable:0`. The first fresh send after launch appeared in the ANKITA
  transcript; the real in-chat Use my Chrome button was visible.
- The app was relaunched normally after that check. Its new main process had
  no inspector or remote-debugging flags. No credential value was printed.
- Three changed companion files were backed up and copied to Chrome's already
  configured extension folder; all 15 files matched the source afterward.
  One Chrome extension Reload loads the updated worker instruction. No new
  permission, pairing or tunnel setup is required.
- `git diff --check`: passed. New browser labels/instructions are shared;
  transport reason is a named protocol constant. Native status literals follow
  the existing wire grammar, UI copy stays display-only, and fixture URLs,
  timing and account markers remain test/script data. No new production path,
  port, model or account assumption was introduced.

Evidence logs and inspected screenshots are local temporary diagnostics;
generated captures are not release/source changes. Independent read-only review
found the transport-paused Stop authorization gap; its RED regression, exact
witness/duplicate refusal checks and real native one-click Stop passed after
the fix. No other new actionable finding was reported.

## Remaining limits

This follow-up has not forced the transient warning in a live hosted ChatGPT
account, checked the updated path in a packaged installer or used another
operating system. An ordinary hosted built-in reply passed; first-use warning
recovery uses the same native observer and bridge code in the real Electron
fixture. The real MV3 extension suite passed against local native pages; this
follow-up did not repeat a hosted Chrome send. Unknown warning text may stay unconfirmed.
A permanently failed generation cannot produce a terminal answer; inspect that
same chat and explicitly stop it. An extension update needs one Reload in Chrome.
The wider repository's three known browser-workflow baseline failures are
separate from this affected-suite check; the full repository suite is not claimed
green. No release, package or deployment is part of this follow-up.
