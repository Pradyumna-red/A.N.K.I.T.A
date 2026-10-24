# ChatGPT first-use and browser choice polish

User request: make first-use replies appear without restarting ANKITA, make the
existing Chrome choice easy to find, and fix the confusing recovery UI shown in
the screenshots. This continues the already approved two-browser design.

Evidence: the latest first-opening greeting in the real operation journal is
`uncertain`, with `blockedReason=transport`, no accepted receipt and no final.
The next greeting after restart completed. The bridge returns before recording
receipts whenever a provider notice is present; the runtime rejects the pending
reply on a transient transport notice. Chrome mode exists but is a settings
dropdown, while the disconnected popup omits the necessary browser-mode step.

Keep the existing dark ANKITA theme, Instrument Sans and shared surface/edge/
accent tokens. Use two explicit browser choices and a compact in-chat connection
strip. Recovery belongs beside the composer, with readable status and actions.
Keep tool setup in its existing expandable rows. No new dependencies or redesign
of the transcript, providers or external tool engine.

1. Reproduce first-opening stream-error-then-final in real isolated Electron.
   Add RED regressions for receipt observation and no duplicate Send.
2. Allow observation of the same exact reply across a transient transport notice;
   keep native actions paused and all other provider blocks unchanged. No Send
   retry, account/model switching or automatic tool restart.
3. Make ANKITA window versus existing Chrome visible, preserve selected teammate,
   and replace the misleading extension instructions. Provide in-chat recovery
   and browser settings access without a restart.
4. Cover cold start, a second message, teammate isolation, both modes and compact
   UI interactions. Run affected suites serially, build, inspect the actual UI.
5. Update findings and guide with exact evidence and remaining hosted/platform
   gaps. Preserve unrelated changes and do not publish a release.

Completed 2026-10-24. First-use stream recovery and transport-paused Stop were
reproduced before fixing. The serial affected suite passed 204/204; actual
Electron imported and saved the same first answer without restart, and an
ordinary hosted reply appeared once in the updated app. Two visible choices and
in-chat recovery passed browser UI checks. Build and diff checks passed.
See `docs/findings/2026-10-24-chatgpt-first-use-polish.md` for exact evidence and
the hosted-warning, packaged-app and platform gaps. Unrelated edits were retained.
