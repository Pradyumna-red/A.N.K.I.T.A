# CoS source re-check and backend choice

The goal remains: type in ANKITA, deliver that message to ChatGPT, show its reply and real
tool activity in ANKITA, and reuse existing MCP connections. The user reports CoS Core
and its tunnel are already configured. No new connection or account setup is assumed.

## What the source actually does

Latest upstream fetched: `9b6d104e958c3b130bf25a92f7b29baa1b422a25` (original adapter pin
remains `34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5`). No upstream package or binary was run.

- Browser scripts deliver messages and record replies. Native Core/optional Desktop/Plugins
  MCP connectors execute tools; these are separate channels.
- `selectModelSettings` returns immediately when both model and effort are absent. The
  authenticated control API sends with `model:null` and `reasoningEffort:null`. A model
  catalog is optional when keeping the existing ChatGPT selection.
- CoS can use external Chrome or its optional built-in Electron browser. External Chrome
  can start minimized; the built-in browser creates hidden windows and reveals them as needed.
- The local control API has authenticated message submission, outbox/delivery receipts,
  session events and queued-input cancellation. Latest upstream also adds event streaming.
  Cancellation is narrower than stopping an already-running ChatGPT generation.

Sources: [model selection](https://github.com/totec448-spec/chat-on-steroids/blob/9b6d104e958c3b130bf25a92f7b29baa1b422a25/extension/chatgpt-dom.js#L3081),
[control actions](https://github.com/totec448-spec/chat-on-steroids/blob/9b6d104e958c3b130bf25a92f7b29baa1b422a25/src/main/control-actions.ts),
[API contract](https://github.com/totec448-spec/chat-on-steroids/blob/9b6d104e958c3b130bf25a92f7b29baa1b422a25/src/shared/control-api.ts),
[setup](https://github.com/totec448-spec/chat-on-steroids/blob/9b6d104e958c3b130bf25a92f7b29baa1b422a25/docs/setup.md).

## Observed local state

Installed CoS is **2.1.34**, configured for its **cos** built-in browser. The local control
API and its action switch are disabled, there is no control endpoint, and no CoS/tunnel
process was running during inspection. No settings, secret or browser profile was changed.
Saved Core/tunnel setup is user-reported; its current live connectivity is not yet checked.

## Two valid routes

**Reuse the existing CoS backend — development alternative.** ANKITA becomes
the interface for CoS's local send/receipt/event API. CoS remains running in the background
and owns the browser, Core connection and tool execution. Bind one explicit CoS session and
approved project; discover supported routes from the installed service instead of assuming
the latest streaming feature. Keep local API credentials out of messages and logs. Verify
queued cancellation separately from actual generation Stop before advertising full Stop.
This reuses more existing code and setup, but browser-mode tools follow CoS's permissions.

**Keep ANKITA's own browser/tool backend — selected for the startup product.** Continue the approved focused companion plus
shared ANKITA ToolHost gateway. The current-model path no longer requires catalog discovery.
It retains ANKITA's tool policy and pointer ownership, but needs its own supported native
MCP connection or deliberate retargeting of an existing connector. Do not run two tunnel
clients on the same tunnel ID: CoS documents calls reaching the wrong connector that way.

The user delegated this decision and clarified that ANKITA will ship as an EXE for startup
customers. Select the standalone ANKITA route: one installer bundles reusable MIT CoS
browser delivery/receipt/MCP components, while ANKITA owns workspace policy, tool execution
and pointer sessions. Users do not need a separate CoS installation. The existing CoS Core
setup is a development reference, not a runtime dependency. Reuse complete components where
their contracts fit, preserving licenses and removing unused CoS-specific owners instead
of maintaining two competing runtimes. Native account connection permissions remain a
separate requirement. No CoS control API adapter/settings change is part of this decision.
