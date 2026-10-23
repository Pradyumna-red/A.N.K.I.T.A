# Connected Computer Use prompt crash

Status: fixed in source; focused Agent/MCP and desktop engine checks pass.

## Cause and change

`buildSystemPrompt` reads the shared `COMPUTER_DIRECT_CONFIG` key only when the native Computer Use MCP server appears in the connected-server summaries. The symbol was exported by `src/integrations/computer-use.mjs` and imported by the desktop engine and tool host, but omitted from the Agent import.

Consequently, connecting Computer Use caused initial Agent construction or a later prompt refresh to throw before the provider request. Importing the existing constant in `src/core/agent.mjs` fixes that reference without changing approval policy.

## Reproduction and verification (2026-10-22)

An isolated temporary `CONFIG_DIR`, a connected native-server summary, and the real prompt builder/Agent produced this before the fix:

```text
buildSystemPrompt: ReferenceError: COMPUTER_DIRECT_CONFIG is not defined
    at buildSystemPrompt (.../src/core/agent.mjs:269:95)
Agent constructor: ReferenceError: COMPUTER_DIRECT_CONFIG is not defined
    at buildSystemPrompt (.../src/core/agent.mjs:269:95)
    at new Agent (.../src/core/agent.mjs:427:34)
```

The same isolated reproduction after the import change produced:

```text
buildSystemPrompt: PASS
Agent constructor: PASS
```

The new `test/integrations/computer-direct-config.test.mjs` ran before the production edit: **0/5 passed, 5 failed**, each with the same `ReferenceError`. After the fix, this command passed:

```text
rtk proxy node --test --test-concurrency=1 test/integrations/computer-direct-config.test.mjs test/integrations/mcp-images.test.mjs test/integrations/mcp-context.test.mjs
tests 32
pass 32
fail 0
```

Coverage includes native connections with explicit desktop authorization, explicit approval-based authorization, and an unset flag; constructor, clear, rebase, and refresh; connecting after Agent creation and disconnecting again. Global automatic approval remains disabled in the authorization cases.

The live round trip uses a real loopback HTTP provider fixture, the real `Agent.send`, and the existing native MCP fixture through the real stdio transport. The first provider response calls `get_window_state`, the second request contains `Observed fixture state`, and the final Agent reply is `Observed fixture desktop.`. This contacts no external provider and manipulates no user applications.

## Desktop follow-up and remaining coverage

The first desktop run completed with **6/8 passed**. Two tests could not import the desktop engine because the local install was older than the existing lockfile:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@modelcontextprotocol/node'
imported from .../services/chatgpt-bridge/server.mjs
```

The parent restored the already-declared lockfile dependencies (six packages; no manifest or lockfile change). A fresh serial run covering `test/desktop/computer-use.test.mjs`, `test/core/palette.test.mjs`, `test/desktop/slash-commands.test.mjs` and the new crash regression passed **22/22**, including all **8/8** desktop computer-use tests. The production desktop build also passed, and isolated native Electron menu checks passed **5/5** through real preload and DesktopEngine IPC. The actual provider-to-Agent-to-stdio-MCP observation round trip remains the direct behavioral check of this crash fix.

Installer/ASAR packaging and physical desktop-control verification remain uncovered. No user applications were manipulated. Full-suite results and unrelated findings are recorded with [the slash-command verification](desktop-slash-commands.md).
