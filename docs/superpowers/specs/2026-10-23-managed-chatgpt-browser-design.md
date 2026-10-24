# Managed ChatGPT browser for ANKITA

Date: 23 October 2026. Status: approved. The user explicitly answered
“Yes, build both like CoS.” Preserve direct implementation in this chat.
This updates the browser transport choice in the approved 12 October design.
The existing runtime, tool policy and native MCP surfaces remain the foundation.

## What the user wants

Send a message in ANKITA and have it work without copying a pairing link, loading
an extension by hand, choosing a browser conversation for every teammate, or
typing plugin names in each message. Open a compact browser if one is needed,
reuse it next time, keep sign-in saved, and show the reply and real tool activity
in ANKITA. The user asked that CoS's source be examined before implementation;
the [source review](../../findings/2026-10-23-cos-browser-source-review.md)
records that completed step at a fixed fetched commit.

## Keep both choices, as CoS does

The user's correction is correct: CoS offers both its own Chromium window and
the person's external browser. ANKITA should retain that choice instead of
asking the user to permanently discard one. Proposed default is the built-in
window; the default is the builder's recommendation, not a claimed user choice.

1. **Built-in compact Chromium window, following CoS's owned-browser design.**
   Recommendation: reuse ANKITA's bundled Electron runtime, persistent browser
   session and debugger interface. No separate Chrome installation or exposed
   debug port. Google login needs an explicit supported sign-in flow; do not
   promise that embedded login always works.
2. **The existing Chrome browser, using the companion as CoS does.** Preserve
   the user's current signed-in browser and existing adapter. Replace manually
   copied pairing links with explicit Connect followed by automatic local
   discovery and token setup. The extension is still required in this mode;
   the built-in mode loads its adapter automatically. Reuse an owned ChatGPT
   page or open a compact window through the connected companion. Start the
   chosen browser on explicit work only when it is confirmed absent.

These are the two CoS-style modes. External Chrome does not require a third,
separate managed CDP browser engine: CDP actions in the built-in mode use
Electron's debugger. If the user requires direct CDP attachment to external
Chrome specifically, that is a different transport choice and needs a browser
started with debugging enabled. Do not claim normal Chrome can be attached
that way automatically. No arbitrary Chrome profile copying, cookie extraction
or restarting the user's normal Chrome.

## What the user sees

- A small choice between **In ANKITA** and **In Chrome**, then a single
  **Open ChatGPT** action in Settings. No pairing link in the normal flow.
  If sign-in is required, the compact window opens for the user to sign in.
- Clear states: opening, sign-in needed, ready, replying, connection lost,
  and reply needs checking. “Connected” requires fresh editor evidence.
- Each teammate gets a separate remembered ChatGPT chat. Switching teammates
  reuses the correct owned page. One active model generation at a time in the
  initial release; show a short busy message when another is still replying.
- A **Show chat** button brings the exact owned page forward. Closing its window
  has a defined effect: keep it hidden while active work runs, and offer an
  explicit Disconnect to end its lifecycle. Quitting ANKITA closes owned browser
  resources. Never close another application or the user's normal browser.
- Native app names remain prefilled/editable. Once a real installed identity is
  known, it survives a page reload. Missing apps show which setup is needed,
  without a loop of “refresh the extension” instructions.
- Existing native tunnel IDs and encrypted keys remain usable. Browser login,
  installed ChatGPT MCP apps and local Computer Use readiness are separate states.

## Builder decisions and shared architecture

These are recommendations from the source review, not claims of user approval.

### Browser ownership and connection

Create one app-owned browser manager. It owns only pages/windows it creates,
uses a persistent profile/session under the discovered ANKITA data directory,
and starts on explicit Open or a new authored Send. There is no background launch
merely because saved settings exist. Repeated Open calls share one startup.

Connect that manager directly to the existing delivery/runtime contract inside
the host. Keep the extension bridge for external Chrome users and preserve its
legacy explicit-pairing state during migration. The owned transport gets an
explicit internal admission path, never a
fake Chrome extension ID. No page gets the bridge token, native tunnel key,
workspace authority or arbitrary host execution API.

Browser observers install before loading ChatGPT so the page's first response
metadata is not missed. An event wakes delivery immediately; a bounded read-only
heartbeat maintains freshness and detects disconnects. Do not claim a measured
speed improvement until before/after timing exists.

External automatic discovery has its own explicit host Connect intent. Use
shared configured candidate ports with a cached successful address; origin and
protocol checks precede token setup. A token remains required for command and
observation routes. Only companion traffic participates; no webpage may obtain
host action authority. Preserve explicit Disconnect across reload, restart and
late provisioning responses. Describe the local-process trust tradeoff in the
setup guide. Do not turn the native MCP action gateway into an unauthenticated
endpoint. Verify stale build identity rather than trusting the manifest alone.

### Teammate and chat ownership

Persist the mapping from teammate plus canonical workspace to the confirmed
ChatGPT conversation. Before first Send, a new page is owned by an opaque local
opening operation. Its later conversation ID is accepted only together with the
exact new question receipt. Never invent a server conversation ID or reuse an
unrelated existing chat by title or last focus.

Reuse the current operation ledger and exact native request joins. Changing
teammate cannot inherit another teammate's pending action or tool receipts.
An unresolved Send stays on its original page until explicit Resume or confirmed
Stop; opening another teammate must not replay or retarget it. Reuse the existing
workspace guard and protect model pages from ordinary task-browser actions.

### Text, apps and one Send

Adapt the reviewed CoS editor text reader, excluding actual style, script,
noscript and template elements while preserving literal text containing those
words. Apply one reader consistently to insertion, unchanged-draft checks,
app-token checks, Send readiness and receipt matching. Keep attachments scoped
to the exact draft.

Add a bounded connector identity store. Bootstrap from actual installed apps
observed in the owned account; learn stable surface identities only by joining
an app's page result with an exact request served by this ANKITA instance.
Remembered names are labels, not sole routing authority. Account/workspace
changes invalidate the cache. A fresh complete list can revoke a missing app;
duplicate or conflicting evidence abstains. Never guess an app ID or switch a
same-named app to another tunnel. Surface readiness does not by itself install
or enable an app in ChatGPT.

Wait for a writable editor, insert only into the owned draft, wait for app-token
adoption and a ready native Send control, commit dispatch once, then click once.
Accept a response only after the exact new user-message receipt. No Enter-key
fallback or timeout-based second click. A known never-clicked operation may
report safely retryable; an uncertain clicked Send must use observation-only
recovery. Preserve Stop's exact target and native action cancellation.

### Existing installations and failures

Do not delete legacy pairing state, operation journals, chats or tunnel keys.
Switch modes only after outstanding work is settled, and show the new sign-in
requirement plainly. Keep API providers unchanged. A failed owned-browser launch
reports its actual safe reason; it does not silently send through another model
or attach to a random Chrome process.

The Windows invalid-window-handle problem remains a separately traced driver
fix. Refresh window discovery and element evidence before another authored
action; do not mask it as a browser error or automatically repeat the click.

## Validation required before “working”

1. Failing regressions for first Send without a saved conversation, delayed Send
   readiness, late app catalogue, renamed proven app, two teammates, Stop and
   lost acknowledgement. Each must pass after the corresponding root fix.
2. Real owned browser fixture: open, send, exact public reply, refresh/reconnect,
   switch teammate, Stop, close/reopen with saved sign-in state, no duplicate
   Send, no user-browser interference. Use actual Chromium and the selected
   native transport, not just mocked methods. Also exercise actual companion
   discovery/provisioning, two host candidates, incompatible versions and an
   explicit Disconnect racing an old Connect. Exercise both modes' shared Send,
   receipt and Stop contract.
3. Actual Electron window and production renderer entrypoint check, build and
   focused tests; serial full suite with unrelated failures reported precisely.
4. A signed-in ChatGPT round trip and a native Core read/write/command round
   trip whose final command exit code and output are collected. A local fixture
   does not establish compatibility with the current hosted account.
5. Documentation for the chosen login path and compact controls, source pins,
   upstream MIT notices and any packaging additions. No new dependency without
   checking the repository's dependency instructions.

## Deliberately outside this change

### User-requested sign-in addendum

After seeing the real built-in sign-in screen, the user asked to use CoS's
extension-based sign-in transfer instead of entering an email again. Source
inspection confirmed its explicit popup gesture, optional cookies permission,
complete ChatGPT-only token chunks, short-lived process-local offer and
transactional cookie-jar import. Implement the same boundaries: no whole-profile
copy, no arbitrary cookie disclosure, no overwrite of an active built-in account,
no cookie values in durable app state/logs/page scripts, and cancellation/rollback.
A separate capability-protected discovery bridge carries only that explicit
handoff; it cannot bind a model chat or execute tools. Validate actual Electron
cookie storage with disposable credentials before asking for the user's one-time
Chrome permission. Hosted authentication remains a separate live gate.

No import of CoS's full desktop app, goal engine, filesystem/process runtime or
permissions. No quota bypass, fabricated model availability or “unlimited”
claim. No parallel browser-agent engine. No promise to permanently tolerate
every future ChatGPT DOM change. Keep failure reasons visible and keep the
original action identity when the page is uncertain.
