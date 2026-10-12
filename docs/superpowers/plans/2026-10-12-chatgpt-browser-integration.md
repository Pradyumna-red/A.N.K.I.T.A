# ChatGPT Browser Mode Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Native execution in the current chat is recommended because the runtime, tool policy and receipt interfaces are tightly coupled. Use subagent-driven-development only if the user selects it after reviewing this plan. Steps use checkbox syntax.

**Goal:** Send and receive ANKITA messages through the user's already-open ChatGPT browser conversation and let that conversation use ANKITA's existing tools through native MCP.

**Architecture:** An external local companion controls/observes the selected browser tab using a focused fork of CoS's page adapters. A separate inbound MCP gateway delegates to ANKITA's shared ToolHost. A desktop ChatGPT session runtime maps both channels to existing UI events; the API agent does not run a competing conversation loop.

**Tech Stack:** Existing Node ESM, Electron, React/TypeScript, Playwright test fixtures, external MCP tools and the existing Cua Driver. MCP SDK/tunnel and any new DOM-test dependency require review before installation; none was installed for this plan.

**Spec:** `docs/superpowers/specs/2026-10-12-chatgpt-browser-integration-design.md`.

## Global constraints

- Connect to **the browser already open**; no Chrome restart, profile transfer, replacement chat or global debug port.
- Research pin: CoS `34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5`, package `2.1.34`, MIT. Keep provenance/patches and required notices.
- Existing user edits remain untouched. Implement in an isolated checkout from remote `ankita`; copy only these approved planning documents into it.
- Start with one active browser conversation. Concurrent workers, Goal helper providers and code-mode batching are outside the first shipment.
- Ordinary browser chat uses the signed-in account. Account models, usage restrictions and connection permissions still apply. Never label it unlimited.
- User clarification: first inherit the selected ChatGPT chat's current model. Optional model discovery must not block connection, native request attribution or ordinary delivery; explicit model changes still need evaluated choices. Retain the native MCP proof gate before broad desktop/action work.
- Publish real MCP tools; never execute prose, fabricated function-call JSON or private ChatGPT API requests.
- Share existing execution policies, prepare/recheck, workspace checks, cancellation and computer pointer ownership.
- Named shared constants/config own protocol versions, routes, bounds, polling intervals, profile files and provider identifiers, with units/reasons. No copied inline values or account/model assumptions.
- Node/SDK/native imports remain host-only; preserve renderer CSP and complete-entry startup checks.
- Run Node suites serially on Windows. Every feature has a failing regression and a live path; the final suite/build and packaged run precede shipping.

## Review focus

1. Two similar ChatGPT tabs: only the explicitly bound tab/conversation may send or authorize tools; test in Tasks 2 and 5.
2. A lost acknowledgement after Send or mutation: record uncertain and reconcile; never repeat automatically; test in Tasks 3 and 5.
3. Stop racing Send, remote generation or a local action: no later replay/revival; accepted work is drained or reported uncertain; test in Task 6.
4. Model/account/connector capability changes after discovery: require fresh selection/admission and retain quota/refusal state; test in Tasks 2 and 6.
5. Renderer loads host code or recording captures unrelated tabs/secrets: fail startup/privacy checks and retain only the owned conversation; test in Tasks 2 and 7.

## Shared interfaces

Define wire identifiers in `src/integrations/chatgpt-browser/protocol.mjs` and their TypeScript declarations in `desktop/shared/chatgpt-browser.d.mts`. All APIs below are new proposed interfaces, not claims about existing methods.

```ts
type BrowserBinding = {
  leaseId: string; browserId: string; tabId: number; conversationId: string;
  threadId: string; workspacePath: string; epoch: string;
};
type OperationOutcome = 'queued' | 'claimed' | 'dispatched' | 'accepted' |
  'completed' | 'stopped' | 'rejected' | 'uncertain';
type BrowserOperation = {
  id: string; binding: BrowserBinding; kind: 'send' | 'stop' | 'models';
  text?: string; modelId?: string; outcome: OperationOutcome;
};
type ToolResult = { content: Array<{type: 'text'; text: string} |
  {type: 'image'; data: string; mimeType: string}>; isError: boolean };
type ToolCall = { id: string; name: string; arguments: Record<string, unknown> };
```

`ToolHost({context, mcp, authorize, onEvent})` has `execute(call: ToolCall, {signal, resultMode}) -> Promise<ToolResult>`, `specs(surface) -> schemas`, and `cancel() -> Promise<void>`. Context is built by the host from the selected project/thread, never from MCP arguments. Agent converts its native API call into ToolCall after the existing JSON validation. API serialization remains in Agent; native image/text serialization lives in the host result adapter.

`createToolGateway({hostForLease, resolveRequestOwner, receipts, sdk}) -> Promise<{url, metadata, close}>` serves MCP initialization/list/call and protected-resource metadata. `sdk` is the reviewed upstream-compatible MCP server adapter. `resolveRequestOwner({leaseId, requestId, signal})` returns the exact current binding or refuses ambiguity; it never selects the most recently active tab.

The gateway owns a module-private `AsyncLocalStorage` named `gatewayContext`. Its HTTP adapter admits `{leaseId, surface, requestId, operationId, signal}` before SDK dispatch; `operationId` comes from a durable receipt keyed by authenticated transport/session/RPC identity and argument hash. The injected `receipts` interface has `begin(identity, argumentsHash)`, `settle(id, result)` and `lookup(id)`. Same-identity changed payloads are refused. These fields never come from tool arguments or page-authored text. Test snippets below are test bodies: use explicit temporary contexts, fake handler counters and controlled observations, with no production fixture defaults.

`createCompanionBridge({config, secrets, store, onObservation}) -> Promise<{address, pair, listTabs, bind, enqueue, close}>` runs in the external process. `bind({browserId,tabId,conversationId,threadId,workspacePath})` returns BrowserBinding. `enqueue(operation)` returns its durable ID. The bridge accepts observations/command receipts only from its paired companion and does not execute tools.

`BrowserOperationStore({directory})` has `queue(operation)`, `claim(id,binding)`, `dispatch(id)`, `accept(id,receipt)`, `complete(id,receipt)`, `stop(binding)`, `recover(binding)` and `get(id)`. Each mutating method returns a Promise and commits the transition before acknowledging it. `recover` returns outstanding records; it does not send them.

`ChatGptRuntime({bridge, gateway, store, toolHostForThread, history, onEvent})` has `kind = CHATGPT_BROWSER_PROVIDER`, `send({threadId,text,attachments,signal}) -> Promise<{outcome,text}>`, `cancel(threadId) -> Promise<void>`, `observe(observation)`, `listModels()`, `view()`, `resume(threadId)`, and `close()`. `observe` is called by the authenticated companion event handler; it is not a public renderer/page action. `history` is ANKITA's scrubbed session persistence. `onEvent` uses existing EngineEvent shapes plus the shared browser-connection status event.

## Task 1: Shared ToolHost and a real local MCP protocol proof

**Files:** Create `src/core/tool-host.mjs`, `src/integrations/chatgpt-browser/tool-gateway.mjs`, `protocol.mjs`, `desktop/shared/chatgpt-browser.d.mts`, `test/core/tool-host.test.mjs`, `test/integrations/chatgpt-tool-gateway.test.mjs`. Modify `src/core/agent.mjs`; consult `tools/index.mjs`, `tools/catalog.mjs`, `src/integrations/mcp-manager.mjs`, `desktop/electron/approvals.mjs` without bypassing them.

**Interfaces:** Produces ToolHost and createToolGateway above. Consumes existing registry schemas, tool execution context and connected MCP manager. Initially grant a read-only lease to an explicit temporary proof workspace, not the user's entire profile.

- [ ] Write failing tests for denied writes, wrong workspace/lease, blocked MCP tier, stopped calls, and native text/image results. A cancelled read must not execute its handler:

```js
const controller = new AbortController(); controller.abort();
const host = new ToolHost({ context, mcp, authorize, onEvent });
const result = await host.execute(call, { signal: controller.signal, resultMode: 'mcp' });
assert.equal(result.isError, true);
assert.equal(executed, 0); // Test-only handler counter; context/mcp/call are explicit fixtures.
```

- [ ] Run `rtk proxy node --test --test-concurrency=1 test/core/tool-host.test.mjs test/integrations/chatgpt-tool-gateway.test.mjs`; establish the missing implementation/failed contract.
- [ ] Extract policy/execution from `Agent.runToolCall/runMcpToolCall` into ToolHost while keeping API result/history projection in Agent. Existing state and counters remain per logical request. Include prepare/recheck and never-auto-approve behavior, not just final `tool.run`.
- [ ] Use the reviewed MCP SDK registration/HTTP adapter patterns from CoS `src/main/mcp/server.ts` and `tools-plugins.ts`. Convert native schemas using their actual parameters; serve schema/output content without interpreting prose:

```js
import { AsyncLocalStorage } from 'node:async_hooks';
const gatewayContext = new AsyncLocalStorage();
server.server.setRequestHandler('tools/list', async () => {
  const admitted = gatewayContext.getStore();
  return { tools: hostForLease(admitted.leaseId).specs(admitted.surface) };
});
server.server.setRequestHandler('tools/call', async (request, context) => {
  const admitted = gatewayContext.getStore();
  const owner = await resolveRequestOwner({ leaseId: admitted.leaseId,
    requestId: admitted.requestId, signal: admitted.signal });
  return hostForLease(owner.leaseId).execute({ id: admitted.operationId,
    name: request.params.name, arguments: request.params.arguments ?? {} },
    { signal: admitted.signal, resultMode: 'mcp' });
});
// The admitted HTTP request runs SDK handling inside gatewayContext.run(...).
```

- [ ] Review candidate SDK and tunnel dependencies with the Sonatype skill before installing; pin reviewed versions/receipts. Add bounded bodies, Host/Origin validation, transport auth, protected-resource metadata and drain-on-close using the inspected upstream server contract. Never publish on app startup.
- [ ] Repeat focused tests and `test/core/agent-audit.test.mjs`, `test/core/browser-tool-protocol.test.mjs`, `test/integrations/mcp-tiers.test.mjs`, `test/integrations/mcp-images.test.mjs` serially. Capture proof that API behavior and native image results remain distinct/correct.
- [ ] Create a unique file in an explicit temporary workspace and use the existing `McpClient` HTTP transport to connect to the new SDK-backed read-only surface. Call `read_file`, compare the result with local bytes, then close/drain both client and gateway. This is a real protocol/tool round trip, not a hosted ChatGPT proof. The account proof follows immediately after the companion can establish ownership in Task 2.
- [ ] Commit this independently reviewable host/gateway change and its evidence; keep proof files/secrets out of Git.

## Task 2: Attach to the existing browser and prove native MCP on its current model

**Files:** Create `services/chatgpt-bridge/main.mjs`, `config.mjs`, `server.mjs`, `src/integrations/chatgpt-browser/request-owners.mjs`, `desktop/chatgpt-companion/manifest.json`, `background.mjs`, `content.mjs`, adapter files under `desktop/chatgpt-companion/upstream/`, `vendor/chat-on-steroids/README.md`, `source.json`, `LICENSE`, `test/integrations/chatgpt-companion.test.mjs`, `test/integrations/chatgpt-model-discovery.test.mjs`.

**Interfaces:** Produces createCompanionBridge, BrowserBinding and the single-binding implementation of resolveRequestOwner, later hardened in Task 5. Consumes protocol identifiers and encrypted host-owned pairing material. Output is observed tabs/models/messages/request identity, not executable tool requests.

- [ ] Write fixtures with two same-title tabs, a logged-out page, unavailable model, forged page message, incompatible extension and disconnect during pairing. Assert no launch or observation of the other tab:

```js
await bridge.bind({ browserId, tabId, conversationId, threadId, workspacePath });
assert.deepEqual((await bridge.listTabs()).filter(tab => tab.bound).map(tab => tab.id), [tabId]);
assert.equal(launches, 0); // Test-only launch seam, never a browser-discovery shortcut.
```

- [ ] Run the two new test files serially and capture the failure.
- [ ] Port CoS DOM/model/completion readers from the pinned `extension/chatgpt-dom.js` and read-only Fiber evidence with a reviewed, focused adapter fork. Carry source hashes, patches and tests. Replace CoS-specific connector identity/overlay behavior deliberately; do not copy its whole background/content/bridge runtime or unrelated history capture.
- [ ] Generate manifest and host protocol config from one source. Restrict observation to ChatGPT and the explicitly bound tab; keep debugger/cookies permissions out of ordinary conversation observation. The background worker owns secrets and validates sender.tab before forwarding; page scripts never receive them.
- [ ] Start only the external companion process, pair it over loopback and require fresh selected-page evidence before Ready in current-model mode. Exact native request attribution is independent of model-picker discovery. Explicit-model mode still requires evaluated selection evidence. Reconnection preserves Disconnect intent. Do not use `/models` API metadata or infer GPT-6 access from product names.
- [ ] Repeat offline tests using actual page-adapter code, then load the companion in the already-open browser and verify the selected tab/conversation/model. Record that Chrome was not restarted, no additional profile was created and unrelated tab content was not retained.
- [ ] Implement the exact single-binding request/conversation join using CoS `mcp/inbound.ts` and `session/correlation.ts`. Connect the Task 1 read-only surface through a supported ChatGPT connection and ask the bound conversation to read the unique temporary file. Compare native tool content with local bytes and retain request/turn provenance. If account/custom-MCP/tunnel access or current page compatibility prevents this proof, report the exact blocker before proceeding to Tasks 3–7; do not advertise action mode as ready.
- [ ] Commit the scoped attach/model-discovery deliverable and provenance.

## Task 3: Durable Send and authoritative completion

**Files:** Create `src/integrations/chatgpt-browser/operation-store.mjs`, `delivery.mjs`, `observations.mjs`, `test/integrations/chatgpt-delivery.test.mjs`, `test/integrations/chatgpt-operation-store.test.mjs`; modify the Task 2 companion command/ack path.

**Interfaces:** Produces BrowserOperationStore and receipts consumed by ChatGptRuntime. Bindings have immutable epoch/lease identity; receipt events carry their exact operation and conversation.

- [ ] Write failing tests for interim commentary, missing completion proof, a user Stop, reload, duplicate ack, lost ack after accepted Send and reused request IDs. Silence stays uncertain:

```js
await store.queue(operation); await store.claim(operation.id, operation.binding);
await store.dispatch(operation.id);
const recovered = await store.recover(operation.binding);
assert.equal(recovered[0].outcome, 'uncertain');
assert.equal(sends, 0); // Recovery reports state and never clicks Send on its own.
```

- [ ] Run both new files serially and establish failure.
- [ ] Implement atomic, versioned profile-local transitions and an observation reducer. Reuse CoS's accepted-user-message/turn-completion rules from `session/input.ts`, `continuation.ts`, `finish.ts` and the DOM adapter. Accept a final response only for the bound logical turn; detached/stalled is not completed. Do not infer completion from a quiet timer.
- [ ] The service offers an operation only after durable queue/claim. The extension validates the exact selected composer/model and current epoch before acting; native accepted-message evidence advances accepted. If acceptance cannot be proved, retain uncertain and reconcile the same conversation, with no automatic Send replay.
- [ ] Repeat tests and real-browser send of a unique question. Read back its accepted user message and final answer independently. Reload after dispatch and prove only one accepted message remains; exercise an acknowledgement-loss fixture without another browser send.
- [ ] Commit delivery/recovery and exact receipts.

## Task 4: ANKITA desktop ChatGPT-session mode

**Files:** Create `desktop/electron/chatgpt-browser.mjs`, `src/integrations/chatgpt-browser/runtime.mjs`, `desktop/shared/chatgpt-browser.mjs`, `desktop/renderer/src/components/ChatGptConnection.tsx`, `test/desktop/chatgpt-browser.test.mjs`. Modify `desktop/electron/engine.mjs`, `main.mjs`, `settings.mjs`, `desktop/shared/wire.ts`, `desktop/renderer/src/components/SettingsDialog.tsx`, `ModelPicker.tsx`, and `src/core/bootstrap.mjs` only for an explicit desktop-only-provider error if needed.

**Interfaces:** Produces ChatGptRuntime and the shared status event. Uses existing EngineEvent messages/tool cards and the Task 3 ledger. The configured provider identifier is a shared constant; its display label is ChatGPT Browser.

- [ ] Write a test selecting browser mode without any API credentials; sending must use runtime.send, never Agent.send/createSession or `/chat/completions`. Preserve API-mode events:

```js
await engine.send(threadId, 'Unique browser-mode question');
assert.equal(apiRequests, 0); assert.equal(browserSends, 1);
assert.equal(events.filter(event => event.type === 'turn-end').length, 1);
```

- [ ] Run `test/desktop/chatgpt-browser.test.mjs` and record failure.
- [ ] Implement explicit routing: `runtime.kind === CHATGPT_BROWSER_PROVIDER ? runtime.send(input) : agent.send(input.text, callbacks)`. Build host-owned tool context without creating a fake API client. Publish connection, selected tab, observed model, setup-required, disconnected and blocked states in the existing Settings style.
- [ ] Map owned browser message deltas/final receipts to existing message events and SecretHistory. Correlate tool-call/results from the gateway, not page narration. Mark browser usage as observed/unknown rather than inventing API token/cost numbers. Changing provider/project during unsettled work waits or cancels by explicit intent.
- [ ] Run new tests plus `test/desktop/desktop-settings.test.mjs`, `test/core/provider.test.mjs`, and `test/desktop/desktop-startup.test.mjs` serially; build the renderer and inspect real desktop send/reply, tool cards and reconnect state.
- [ ] Commit the working single-tab desktop conversation mode.

## Task 5: Permitted actions through native MCP with source attribution

**Files:** Create `src/integrations/chatgpt-browser/tool-receipts.mjs`, `test/integrations/chatgpt-tool-ownership.test.mjs`; extend Task 2 `request-owners.mjs`, ToolHost/gateway/runtime; consult CoS `mcp/inbound.ts`, `session/correlation.ts`, `mcp/surfaces.ts`, `mcp/tools-plugins.ts`.

**Interfaces:** Implements resolveRequestOwner, scoped tool receipt storage and live Core/Desktop/Plugins publications. Each surface projects existing host capabilities; arguments cannot replace thread/workspace/lease.

- [ ] Write tests for concurrent ambiguous ownership, missing attribution, stale leases, disabled plugins, identical retry IDs, changed payload under one ID and disconnect after a committed write:

```js
await assert.rejects(resolveRequestOwner({ leaseId, requestId: ambiguousRequestId, signal }), /ambiguous/i);
assert.equal(writes, 0);
await fetch(gateway.url, { method: 'POST', headers: authenticatedFixtureHeaders,
  body: JSON.stringify(originalEnvelope) });
assert.equal(writes, 1); // Only an exact authenticated same-operation retry is deduplicated.
```

- [ ] Run ownership plus gateway tests serially and retain failing evidence.
- [ ] Join native inbound request metadata to paired page observations for the exact owned conversation. Normalize headers using inspected upstream rules, but retain ambiguous repeated request groups rather than guessing. Keep accepted work and receipt delivery independent of socket lifetime.
- [ ] Publish native text/image content with current target refs. Preserve manual Cua connection, the host's pointer session, no per-action desktop prompts and blocked tiers. Existing browser task adapters still own normal task pages; exclude the ChatGPT model tab from general browser discovery/actions to prevent self-control.
- [ ] Run a bounded native-MCP read/edit/readback and a real command in a unique temporary workspace. Exercise both existing isolated and connected-Chrome task adapters using their real/stub contracts; explicitly distinguish results. Verify a desktop screenshot reaches ChatGPT through MCP and its actual subsequent action has a fresh target/readback. Do not call fake-provider fixtures a hosted-model proof.
- [ ] Commit the permitted actions/ownership milestone; it is the first useful shipment once Task 6 Stop is included.

## Task 6: Stop, attachments and explicit context handoff

**Files:** Create `src/integrations/chatgpt-browser/handoff.mjs`, `test/integrations/chatgpt-stop-recovery.test.mjs`, `test/integrations/chatgpt-attachments.test.mjs`; modify runtime, store, bridge and desktop cancel/shutdown paths.

**Interfaces:** Implements runtime.cancel/resume/close and store.stop. Resume consumes retained accepted operations and receipts; it does not create new execution authority.

- [ ] Write failing tests for Stop before claim/Send, during generation, during a local action, after reload, with changed account/model and with a visible rate-limit/refusal. Unknown attachments or image delivery cannot be reported as successfully received:

```js
await runtime.cancel(threadId);
await runtime.observe(lateObservation);
assert.equal(automaticSends, 0);
assert.equal(userBrowserClosed, false);
assert.equal(revivedWork, 0);
```

- [ ] Run Stop/attachments plus delivery tests serially and record failure.
- [ ] Cancel pending browser commands and send Stop only to the owned tab; cancel the scoped ToolHost, drain accepted work and hide/end the existing pointer session as its controller requires. Persist cancelled epoch before acknowledging Stop. Close only owned helper/tunnel processes, never Chrome or launched user apps.
- [ ] Reuse ANKITA attachment bounds, MIME handling and secret scrubbing. Require native composer/upload acceptance for files; preserve MCP image content. Add explicit handoff with objective, selected project, completed actions, unresolved receipts and user corrections. New destination selection requires user intent and native acceptance proof, not quota avoidance.
- [ ] A visible quota, authorization failure, provider refusal or unavailable model yields a blocked/setup-required state and observed reason. Do not switch accounts/models/chats or start a helper provider to override it. Goal continuation is opt-in after this path, with existing budgets/Stop respected.
- [ ] Repeat real Stop while a hosted browser turn and a harmless local fixture command are active; confirm no later action, Chrome/Notepad survives, and the arrow hides. Prove restart recovery, one attachment and explicit resume with readback.
- [ ] Commit Stop/recovery; review the single-tab first-shipment scope before multi-agent work.

## Task 7: Package, regression gate and release evidence

**Files:** Modify `desktop/packaging/electron-builder.yml`, relevant packaging script/config discovered from package.json, `docs/guides/chatgpt-browser.md`, `docs/findings/chatgpt-browser-integration.md`, `test/desktop/desktop-startup.test.mjs`. Add `scripts/verify-chatgpt-browser.mjs` and its fixture target under `scripts/fixtures/`.

**Interfaces:** Packages the companion/service/adapter provenance as resources, resolving paths through runtime discovery. The verifier uses explicit temp workspace/profile parameters and emits redacted receipts.

- [ ] Add a packaged-resource test that fails when the helper or extension is missing, import-graph/CSP checks for main and island, and a privacy fixture proving other tabs/tokens are absent from saved/exported data.
- [ ] Run failing focused checks, package the reviewed resources, and repeat them. Keep localhost credentials, tunnel URLs containing secrets, transcripts, screenshots, build output and dumps outside staged source.
- [ ] Run `rtk proxy node --test --test-concurrency=1`, `rtk proxy npm run desktop:build`, and `rtk proxy git diff --check`. Run the packaged application and repeat the whole existing-Chrome send/native-MCP action/readback/Stop/restart workflow. Record exact exit codes, counts, operation/conversation provenance and before/after failures. No installer/release claim follows from a build alone.
- [ ] Review the complete diff and independent code-review findings. Create issues/PRs for the implementation milestones when authorized; merge into `ankita`, then pull with all user edits preserved. Publish an installer only when requested and after its separate verification.
- [ ] Commit guide/findings/packaging and hand off the evidence-backed first shipment.

## Later upgrades, after the single-tab proof

Concurrent ChatGPT teammates need independent leases, transport attribution and per-project worktrees. Goal/Loop needs an explicit helper-provider choice if porting CoS's model-backed planner. Code-mode batching must call only admitted tools with stable receipts. Add these as separate designs/PRs after the first hosted browser workflow works; they do not grant more quota or account access.

## Planning evidence and execution handoff

Source checkout and pinned code comparison completed. No upstream dependencies were installed, no browser/account was changed, and no application runtime test was executed for this plan. Task 1 proves the local MCP contract; the hosted MCP/account test at the end of Task 2 is the feasibility gate before the full runtime. Review this design/plan before implementation; native execution in this chat is recommended. The existing-browser choice is already settled and must not be asked again.
