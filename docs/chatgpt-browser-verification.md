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

## Remaining live gate

Task 2 must prove the already-open Chrome conversation can call this read-only surface
through a supported native ChatGPT connection, with exact request/conversation attribution.
Account/model availability, custom MCP access, tunnel provisioning and current page
compatibility remain unproved. Tasks 3–7 remain gated by that hosted proof. No desktop
ChatGPT provider is advertised as ready, and no unlimited-model claim is made.
