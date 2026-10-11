# Local Windows computer use

Goal: let ANKITA use the user's current Windows desktop through the existing Cua Driver MCP service.

Architecture: discover the installed driver's machine-readable manifest instead of embedding install paths or versions. Keep one stdio connection for the desktop process. Reuse MCP discovery, cancellation, approval tiers, and the current browser system. Only expose native desktop tools from an explicit capability list. Pass bounded screenshot content to vision models; text-only models use accessibility observations.

Constraints: the initial integration adds no dependencies or second input/capture engine, silent installer or driver upgrade, network control endpoint, or automatic desktop activation on app startup. The user's later native-menu layering request authorizes a reviewed source correction to the existing external driver, with pinned provenance and unchanged locked dependencies. Connected native desktop actions run without approval prompts; explicit blocks and other-service/CLI policies remain. The Stop button aborts connection startup and disconnects the MCP transport. Existing personal files and unfinished branches stay untouched.

Tasks:
- [x] Add regressions for native tool filtering, screenshot delivery/error handling/limits, manifest discovery, repeated connection reuse, cancellation, and stop.
- [x] Implement MCP capability filtering and bounded multimodal result delivery, with computer-use instructions only when the native service is connected.
- [x] Add the main-process controller and a Computer Use section in Plugins with driver detection, explicit path override, connect, health check, and stop.
- [x] Run focused tests, serial suite, desktop build, live installed-driver MCP discovery/observation, and a harmless controlled app round trip where available. Document exact results and uncovered paths.
- [x] User-approved follow-up: enable the driver's animated arrow by default, persist the Show pointer choice and end its session on Stop. Keep replacement transports private until setup completes and cancel all pending native startup paths.
- [x] User-requested styling: match the desktop palette/type, group actions, add a status badge and styled pointer switch, and provide responsive layout, keyboard focus and reduced-motion support.
- [ ] User-requested global popup fix: correct native window-family/band selection inside the external driver, build it reproducibly, prove menu layering and saved-file readback, then leave the desktop using that service.

Completion evidence is recorded in [the computer-use guide](../../guides/computer-use.md), including the hosted model's Notepad readback and fresh-identifier delivery through final reply/context limits. No dependency was added or upgraded. The local configuration cleanup is private and excluded from the source change.

Review focus: stale screenshots after actions, unknown or text-only model capabilities, missing driver/PATH in packaged Electron, stop racing connect, reconnect accidentally widening tools, errors mistaken for success, and request cancellation leaving a child process behind.

Ruling: execute directly in this session; the user already asked to add the feature. Native tool selection keeps driver browser tools out because ANKITA already manages browser tabs and refs. Cua Driver 0.20.0 is installed; advertised capabilities are authoritative, so do not assume tools from newer documentation exist.
