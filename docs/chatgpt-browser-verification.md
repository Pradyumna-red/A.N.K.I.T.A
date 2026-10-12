# ChatGPT browser integration evidence

Approved design: `superpowers/specs/2026-10-12-chatgpt-browser-integration-design.md`.
Plan: `superpowers/plans/2026-10-12-chatgpt-browser-integration.md`.
Branch: `codex/chatgpt-browser`, based on `a31c882` from remote `ankita`.
The original checkout's uncommitted edits are preserved.

## Task 1: execution host and local native MCP

- Baseline: `npm test` exited 0; 1208 tests, 1207 passed, 0 failed, 1 skipped.
- RED: the two new test files failed with `ERR_MODULE_NOT_FOUND` for ToolHost.
  A later native-output bound test failed before text/image sanitization was added.
- GREEN: the new host/gateway tests and existing agent audit, browser protocol,
  MCP tiers and MCP images suites passed **63/63**, 0 failed.
- The extracted ToolHost owns policy, prepare/recheck, workspace context, cancellation,
  search/browser budgets and desktop pointer-session injection. Agent retains API image
  history projection and project/memory refresh. Native results retain bounded text/images.
- A discovered API regression dropped native target metadata. Restoring structured
  content made both existing target-ID regressions pass without weakening assertions.
- `rtk proxy node scripts/verify-chatgpt-gateway.mjs` exited 0:
  `{"protocol":"2025-11-25","tools":["read_file"],"exactFileBytesMatched":true,"writeDenied":true,"hostedChatGpt":false}`.
  This executed the real MCP HTTP client, SDK server and filesystem worker against a
  unique temporary file, then drained/closed both transports. It is a local protocol proof.
- `npm run desktop:build` initially failed because npm omitted the existing TypeScript
  Windows platform package. Restoring that package from the original installation after
  confirming exact version 7.0.2 resolved the environment failure; the subsequent build
  exited 0. No compiler version or dependency declaration was changed.
- HTTP tests reject wrong capability, Host, Origin, missing source request ID, wrong
  lease, oversized body and changed payload on retry. Duplicate calls execute once.
  Protected-resource discovery requires the endpoint capability and does not expose it
  through public discovery. Endpoint URLs/secrets and proof bytes are excluded from Git.
- Production protocol identifiers, limits, versions and routes are named constants.
  Result text and tool names are wire/UI vocabulary; fixture literals stay in tests/scripts.

## Dependencies

Sonatype component tools were unavailable after tool/plugin discovery. This independent
trust scan remains uncovered; it is not substituted with a fabricated rating.
Pinned official TypeScript SDK packages: `@modelcontextprotocol/server@2.3.1` and
`@modelcontextprotocol/node@2.1.1`, Apache-2.0, official MCP SDK repository.
Registry integrity/provenance inspected before installation, lifecycle scripts disabled.
The isolated candidate audit reported **0 vulnerabilities**; `npm audit signatures`
reported **6 verified registry signatures and 6 verified attestations**.
The final production-only dependency audit reported **0 vulnerabilities**.
Root installation reported 10 development dependency findings (8 moderate, 2 high);
the change does not upgrade those existing dependencies. No broad audit fix was applied.
Npm replaced the worktree's dependency junction with an independent installation;
the original checkout's dependency directory was not modified.

## Subsequent regression results

The first full post-extraction run had 1219 tests, 1215 passed, 3 failed, 1 skipped.
It caught a removed browser-classifier import still used by schema discovery and changed
background refusal wording. Restoring the import and explicit background scope made the
unchanged affected suites pass **19/19**. The subsequent full serial suite exited 0:
**1229 tests, 1228 passed, 0 failed, 1 skipped**, 456903 ms.

The final host policy regression then exposed stale config precedence and a missing
standalone approval formatter. Current host approval takes priority over old config;
the real formatter is shared with Agent, and cancellation tests require the approval
callback to run before checking that no mutation occurred. The regression failed before
the correction. The final affected suites, native adapters and complete renderer startup
checks passed **96/96**, 0 failed; `npm run desktop:build` exited 0 after these changes.
The earlier full-suite total predates this final host correction. The final serial run
against commit `10cb119` exited 0: **1231 tests, 1230 passed, 0 failed, 1 skipped**,
435069 ms. The skip is the existing Windows/POSIX fixture branch.

## Task 2: external companion attach checkpoint

- Two new files initially failed against the absent bridge/readers. Offline companion,
  evaluated-model and gateway tests then passed **14/14**.
- Focused MIT DOM/Fiber functions are forked from the pinned CoS source, with SHA-256
  provenance and unchanged license under `vendor/chat-on-steroids`. The fork contains no
  app/overlays/assets, DOM mutation, page message listener, private analysis recording,
  React action callback or private API request. Parser bounds are named and unchanged.
- The generated manifest and wire data share host config. Permissions omit debugger
  and cookies; injection occurs only after an explicit durable conversation binding.
  Popup-origin checks reject website/content-script control messages. Navigation during
  a read discards the observation. Same-title tabs do not substitute for the selected ID.
- Pairing lives only in process RAM and Chrome session storage. A protected secret
  provider is injectable; no plaintext pairing credential is persisted. Disconnect intent
  survives reconnect attempts within the bridge lifecycle; process restart requires new
  manual pairing. Desktop encrypted persistence is part of the gated later runtime.
- `rtk proxy node scripts/verify-chatgpt-companion.mjs` exited 0:
  `{"realHttpPairing":true,"selectedFixtureTab":true,"attributedLocalReadMatched":true,"disconnectRefusedTools":true,"browserRelaunches":0,"hostedChatGpt":false}`.
  This is a real loopback bridge→gateway→filesystem round trip with synthetic tab/model
  observations. It does not establish a browser/account connection.
- Historical request IDs from the first read cannot authorize a new lease. Only subsequent
  exact native request joins can execute. Missing, conflicting or stopped ownership fails
  closed; account/model observations expire. No request argument supplies host context.
- Setup instructions: `chatgpt-companion-setup.md`. One-time owner displays are explicitly
  requested with `--print-pairing`; diagnostic mode prints no credential or MCP capability.

## Remaining live gate

Task 2 must prove the already-open Chrome conversation can call this read-only surface
through a supported native ChatGPT connection, with exact request/conversation attribution.
Account/model availability, custom MCP access, tunnel provisioning and current page
compatibility remain unproved. Tasks 3–7 remain gated by that hosted proof. No desktop
ChatGPT provider is advertised as ready, and no unlimited-model claim is made.
The Chrome relay available to this chat has no targetable Chrome DOM surface; the Windows
computer-use skill forbids handling security/privacy permission prompts. The local
companion is ready for manual loading, pairing and model observation in the existing
Chrome profile. No browser restart or profile transfer was attempted. `cloudflared` was
not found on PATH; no supported HTTPS endpoint/tunnel or account connector is provisioned.
The user handoff is pending. The final fresh branch review and packaged desktop/account
workflow remain later gates; this checkpoint is not a released desktop browser provider.

## Execution rulings and deferred work

- Reused the attached isolated worktree on a new branch, preserving original edits and
  the separate computer-use checkout. Installed Git Bash was used for the plan ledger
  scripts because no `bash` executable was available on PATH.
- Sonatype's service was unavailable; actual registry/provenance/license/integrity,
  signatures/attestations and vulnerability audits were used, with the missing scan
  disclosed. No dependency trust score or account capability is inferred.
- Lifecycle-local MemoryToolReceipts arrived ahead of Task 5 to prove duplicate-call
  handling in Task 1. They are deliberately unsuitable for restart/mutation recovery;
  the gateway gets a new secret URL on each lifecycle.
- Used the real McpClient `callTool` method; `callToolResult` belongs to the manager.
  Native structuredContent is carried optionally to the API adapter to preserve Cua
  target identity, while native publication emits bounded metadata/content.
- Npm omitted the existing Windows compiler platform package. The original exact
  version was restored after OS/architecture/name/version checks; no compiler upgrade
  or manifest change was introduced.
- Proof pairing remains memory-only instead of creating a plaintext credential file.
  Encrypted desktop persistence and deliberate restart/reconnect UX are later tasks.
- Native account proof remains the binding gate. Manual extension/connection permissions
  cannot be performed by this Windows skill, and no public endpoint is provisioned.
  Tasks 3–7 therefore remain pending rather than treating local fixtures as account proof.
- Deferred API interface work: operation-store durability, Send/accept/completion receipts,
  tool receipt persistence, complete native surface publication, full action/image
  aggregate budgets, attachments/Stop/recovery, desktop routing/packaging and final fresh
  review. The current bridge's model-only enqueue identifier is not a durable Send receipt
  and must be replaced at Task 3 before any delivery acknowledgment is exposed.

## Live setup repairs and CoS source re-check

The user reproduced HTTP 409 after repeating Connect and confirmed that Chrome was on a
blank new-chat page. The service was reachable; the extension's new random browser ID on
each Connect caused the ownership conflict. Same-URL reconnect now reuses its session ID
and preserves the binding. An empty picker now explains that a saved conversation is needed
and disables Observe until one appears. These two tests failed before correction.

A subsequent screenshot showed a signed-in, selected saved conversation while the popup
said `logged-out`. Actual bridge observations had no model choices. Missing picker evidence
was wrongly treated as absence of the account, and the picker search included unrelated
page menus. The focused CoS lookup now limits generic menus to the selected composer,
deduplicates explicit native triggers and publishes only safe diagnostic codes. Three
regressions failed before correction. The actual paired Chrome observation subsequently
reported `model-picker-unavailable`; its composer was present. The user confirmed the
corrected explanation in the popup. No further Windows input occurred after physical Escape
stopped Computer Use; screenshot capture had also failed twice.

The user then clarified that ordinary desktop-to-web messaging and the native MCP plugin
are the goal. Latest upstream `9b6d104e958c3b130bf25a92f7b29baa1b422a25` was fetched into the
read-only reference repository, preserving the original adapter checkout/hash pin.
`extension/chatgpt-dom.js`'s `selectModelSettings` returns immediately when no model/effort
is requested. CoS supports an optional built-in Electron browser and external Chrome;
its Core MCP connector and authenticated control API are separate from model discovery.
Current-model mode therefore leaves the browser selection unchanged and its unknown
model name null. Explicit-model mode still requires evaluated selection. Native request
provenance is read independently of the picker; exact binding/lease/nonce ownership and
Disconnect refusal remain required. Three regressions failed before this correction.

Latest affected suites passed **22/22**. The real Chromium popup fixture checks empty-list
recovery and honest page/current-model explanations; this is not the user's Chrome profile.
The final full serial `npm test` exited 0: **1239 tests, 1238 passed, 0 failed, 1 skipped**,
515175 ms. The existing Windows/POSIX skip remains. `npm run desktop:build` exited 0 and
`git diff --check` passed. Both local HTTP proof scripts passed again with exact temporary
file bytes and disconnected-tool refusal; both still explicitly report `hostedChatGpt:false`.

The user reports that CoS Core and its tunnel already exist. Read-only local inspection found
CoS **2.1.34** installed, its selected browser `cos`, no running CoS/tunnel process, no control
endpoint, and both control API switches disabled. No CoS settings, secrets, installation or
browser profile were changed, and the app was not launched. Reusing its existing runtime
would change tool authority from ANKITA's ToolHost to CoS's tools. The user delegated the
choice and clarified the startup/EXE goal; the selected product route remains standalone
ANKITA with bundled reusable CoS components, preserving ANKITA's tools and pointer.
The user's live companion now reports **Connected · using the current model in your
ChatGPT chat**, with `modelMode:current`, an unknown model name and the optional picker
unavailable. Hosted native MCP, full desktop routing, packaging and final whole-branch
review remain pending.

The native proof runner was prepared separately in ignored `.commandcode`. It verifies the
installed tunnel helper against the official OpenAI tunnel-client v0.0.16 Windows archive:
archive SHA-256 `edef7241b0c647fcb30f1a80ff376b6b25c51927960f257a3f01e21b17c2aba6`,
helper SHA-256 `cd0bc49aec24d0d62a37b6e842dad46000f7b401f6167b4cbace4e170819c9a2`.
The audit exited 0 with `installedMatchesPublisher:true`; the helper's executed version
check returned `cloudflared version 2026.8.2`. No dependency or binary was added to the
product. Publisher identity does not replace the unavailable Sonatype scan.

The previous owner terminal had ended. Process inspection returned
`ownerTerminalAlive:false,nodeProcesses:[],listeners:[]`; no process was terminated.
The fresh owner terminal and its Node child are running, with an actual loopback HTTP
check returning `serviceReachable:true,unpairedStatus:401`. Its diagnostic log currently
reports `pairing-required`, so no public tunnel has started. After a fresh companion
binding, the runner will publish only the scratch proof surface, validate native MCP
initialization and `read_file` discovery without executing a tool, then display the
private connection URL in the owner terminal. The user's existing CoS tunnel is untouched.
Actual hosted request attribution/file bytes remain the proof gate.

## Public proof startup repair

The user's actual bound browser started the scratch tunnel, but the first public probe
failed with `TypeError`. Live diagnosis found `/ready` HTTP 200 and one tunnel connection,
while Windows name lookup failed with `ENOTFOUND` (direct DNS queries also returned
`ECONNREFUSED`). Two HTTPS DNS resolvers returned DNS status 0 with two IPv4 answers.
Connecting to the allocated hostname using those answers, with its original TLS hostname
and certificate verification intact, returned HTTP 401 for an invalid endpoint capability.
This proves reachability and rejection, not hosted tool execution.

The optional `services/chatgpt-bridge/public-probe.mjs` fallback is scoped to the explicit
public proof origin and read-only initialization/tool discovery. It never replays
`tools/call`, changes Windows DNS, disables TLS or retries authorization/admission failures.
Resolver input contains only the public hostname; no endpoint path or pairing secret is
sent. DNS and discovery responses are bounded and cancellation is retained.

A transport-only live fixture then reproduced a second startup condition: a new hostname
had no DNS answers initially. Six failed probes were followed by successful MCP discovery
on attempt 7 without another tunnel or browser send. A bounded readiness check now waits
for public DNS/proxy readiness; its next live run returned HTTP 530 on attempt 1 and then
`toolNames:[read_file],attempts:2,protocol:2025-11-25,success:true,executions:0`.
It explicitly reports `hostedChatGpt:false`. Eight regressions were observed RED in two
stages, then passed GREEN. The affected companion/popup/gateway suites passed **30/30**;
the desktop build exited 0. That full serial suite subsequently exited 0: **1247 tests,
1246 passed, 0 failed, 1 existing Windows/POSIX skip**, 590165 ms.

The user also supplied CoS setup screenshots showing its selected built-in browser,
OpenAI Secure MCP Tunnel flow, masked stored key and connected tunnel transport. They do
not prove a completed native tool call or ANKITA ownership. The original standalone
design already prefers Secure MCP Tunnel for the product; this temporary quick-tunnel
proof neither takes over that CoS connector nor copies its stored credentials.

The user's actual re-paired checker then produced the same successful path:
`public-mcp-startup-wait` with HTTP 530 on attempt 1, followed by
`public-read-only-mcp-ready`, `tools:[read_file]`, `attempts:2`,
`publicTransportVerified:true`, `hostedNativeMcp:not-proven`. Safe local diagnostics
confirm that output. The private proof URL is shown only in the owner terminal and
is not recorded here. The public Server URL app setup was rejected by the account UI.
That rejection does not establish that all public Server URL setups are unsupported.

## Secure native tunnel and request attribution repair

The proof moved to the supported OpenAI Secure MCP Tunnel flow shown in CoS. The official
`tunnel-client` executable matched publisher archive member SHA-256
`4226bb74a72388147882881f29f79801b95e285d731a138071812e3aa6766571` and its executed version
was `0.0.16+5f99daabd4aa4a77049e6d81d54a0d8c18335397`. This is a development helper only;
no product binary or dependency was added. CoS's stored credentials/tunnel were untouched.

The integrated runner owns pairing, the temporary read-only workspace and its local MCP
endpoint. It prompts for only the dedicated tunnel ID and hidden restricted key; the user
cannot accidentally substitute a pairing URL as the MCP endpoint. Private input is piped
to the owner process, never placed in argv, diagnostic files or source. Input validation
regressions passed **2/2**; its actual unpaired bridge returned HTTP 409 and started no
native process. The user then paired successfully; local discovery exposed only `read_file`,
and safe health diagnostics reported `localReady:true,openAiPollSeen:true`.

The installed ANKITA Proof app reached `read_file`, but the user's first actual call failed
with **FORBIDDEN: Request owner is unavailable**. The user confirmed the exact conversation
selected in the companion. This proves native request transport, not a successful tool
execution. The focused adapter had omitted CoS `extension/usage.js`: React request IDs can
arrive tens of seconds after the live response stream, outside the bounded ownership wait.
Its `readOrigin` explicitly joins a conversation handoff to a later
`input_message.metadata.request_id` within the same HTTP response. The focused port now
captures that evidence, plus native WebSocket handoff IDs, independently of the model picker.

No private API request, credential/header read, prompt/analysis recording or page message
authority was added. Only the bound page is injected. Scope is fenced by lease, epoch,
tab and exact route before publishing metadata; historical DOM IDs cannot crowd out fresh
stream IDs. Contradictory responses, unknown delta formats/channels, wrong socket chains,
foreign origins, navigation and stale bindings abstain. Safe diagnostics contain source
counts/readiness only. The unchanged exact ownership gate remains mandatory.

Seven new cases first failed for the missing observer, then passed. Latest affected suites
passed **39/39**. An actual isolated Chromium page made an HTTP streaming request; its
React request count stayed zero while the stream supplied one exact ID. A real MCP call
arrived before observation, waited for that join, and read the unique scratch bytes:
`actualIsolatedChromium:true,realHttpStream:true,reactRequestIds:0,streamRequestIds:1,`
`exactJoinReadMatched:true,originalResponsePreserved:true,disconnectedCallRefused:true,`
`elapsedMs:204,hostedChatGpt:false`. The fixture's initial disconnected assertion incorrectly
expected an error result; the real client rejects HTTP 403. That assertion was corrected
without changing production admission. Ignored trace: `.commandcode/verify-request-stream-live.mjs`.

The desktop build exited 0; the new full serial suite is still running. The user reloaded and
paired the new owner runner, reused the installed native app/tunnel, and sent the proof
request in the selected saved conversation. The safe local trace confirms
`requestEvidence:{observerReady:true,streamIds:1,domIds:0}` followed by
`native-request-ownership:{exactJoin:true,elapsedMs:0}` and
`hostedNativeMcp:attributed-file-bytes-matched`. The user returned the unique scratch marker.
**Task 2's real hosted native read gate is now passed.** It uses the account's existing
current model without an observed catalog or an invented model name. Existing
WebSockets opened before attachment are not retroactively observable; additional handoff/recovery,
desktop Send/Stop/attachments/recovery, packaging and final branch review remain uncovered.
