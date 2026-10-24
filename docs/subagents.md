# Sub-agents

Ankita can hand a self-contained piece of work to a child agent. The child runs
its own tool loop with a fresh context and returns one compressed result, so the
parent's history stays small while independent work happens in parallel.

## Discovery

Delegation is not always-on. The parent calls `find_tools` (query it wants, or
`subagents`) and the `subagents` group becomes callable:

```text
find_tools(query="delegate parallel research")
delegate_task(subagent_type="explore", description="Locate the retry policy", prompt="...")
```

Background jobs, Telegram DMs and child agents never see the group: they have no
`runSubagent` host, so discovery hides it and the schema is filtered out.

## Presets

| Preset | Tools | Concurrency | Use it for |
|---|---|---|---|
| `explore` | read-only (`read_file`, `list_dir`, `search_files`, `glob`, `git` reads, `web_search`, `web_fetch`, `scrape`) | parallel | codebase and web reconnaissance |
| `reviewer` | read-only | parallel | correctness, regression and test-coverage review |
| `worker` | every local tool except parent-only ones | serialized | implementation, tests, commands |

Read-only presets overlap because the parent loop already batches contiguous
read-only tool calls. `worker` is a mutation barrier: one worker runs at a time
across the whole process, keyed by the canonical workspace path (symlinks,
junctions and Windows case variants share one lock).

## The brief

A child sees only `prompt`. It cannot ask questions and cannot delegate. Write
the brief as if handing the task to a competent stranger: goal, absolute paths,
constraints, what "done" means, and the exact shape of the answer you want.
Briefs must never contain secrets; the child writes its transcript to disk.

The result envelope is the only thing the parent receives:

```json
{
  "subagentId": "…", "parentCallId": "…", "subagentType": "explore",
  "description": "…", "status": "completed", "summary": "…",
  "result": "full final answer, capped", "toolsUsed": ["read_file"],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "durationMs": 1234, "transcript": "…/sessions/subagent-<id>.json",
  "depth": 1
}
```

`status` is one of `completed`, `failed`, `timeout`, `cancelled`,
`budget_exceeded`, `rejected`. A `note` explains non-completion. The parent must
verify the report before claiming the work is done.

## Limits and safety

- Depth is capped at one by default: a child cannot spawn grandchildren.
- Per-turn fan-out and concurrent slots are bounded; the extras wait, they do
  not fail.
- Each child has its own tool-step, tool-call, wall-clock and token budgets.
- Children run with `memoryEnabled: false`: pinned personal facts and the memory
  store never enter a child prompt, and `remember`/`recall` are blocked.
- Children have no browser, MCP, connectors, skills, scheduling or project tools.
- Child tool calls keep the parent's approval gate. An approval requested by a
  child is labelled with its type and description.
- Audit records carry `subagent` and `subagentType` attribution.
- Transcripts are written as `subagent-<id>.json` and scrubbed with the same
  secret cleaner as normal sessions; teammate session files are never touched.
- Scheduled jobs, the daemon and one-shot routines force `subagentsEnabled:
  false`; there is no unattended delegation.

## Configuration

Advanced knobs live in `config.env`; the desktop settings UI is unchanged.

| Key | Default | Range |
|---|---|---|
| `SUBAGENTS_ENABLED` | `true` | boolean |
| `MAX_SUBAGENT_DEPTH` | `1` | 0–3 (guard only; children never delegate) |
| `MAX_CONCURRENT_SUBAGENTS` | `8` | 1–16 |
| `MAX_SUBAGENTS_PER_TURN` | `24` | 1–64 |
| `SUBAGENT_MAX_TOOL_STEPS` | `100` | 1–400 |
| `SUBAGENT_MAX_TOOL_CALLS` | `200` | 1–500 |
| `SUBAGENT_TIMEOUT_MS` | `1800000` | 10s–2h |
| `SUBAGENT_MAX_TOKENS` | `1000000` | 1k–10M |
| `SUBAGENT_MAX_RESULT_BYTES` | `48000` | 1k–128k |

`delegate_task` also accepts optional `max_steps` and `timeout_ms`. They can
only tighten the configured cap for that one call, never raise it.

Transcripts are pruned to the newest 200 `subagent-*.json` files per session
store; teammate sessions and unrelated files are never touched.

## Surfaces

- **CLI:** dim `⇢` lines show starts, child tool calls and terminal status;
  `--json` adds a `subagents` array to the turn outcome.
- **Desktop:** a `delegate_task` tool card renders the child's streamed text,
  tool rows, usage and duration. Live activity is ephemeral; after a reload the
  card is rebuilt from the stored result envelope. Child tool rows stop spinning
  when the child ends, and a stopped row never shows a success checkmark.

## Tests

```text
node --test --test-concurrency=1 test/core/subagents.test.mjs \
  test/desktop/subagent-state.test.mjs test/core/tool-loading.test.mjs
```

`test/core/subagents.test.mjs` covers presets, discovery parity, read-only
scoping, envelopes, transcripts, approval attribution, depth/fan-out guards,
parallel overlap, worker serialization (cancellation included), workspace
aliases and the parent batching contract.

## Deferred

Background/async delegation (`spawn`/`check`/`wait`), worktree-isolated parallel
workers, resuming or forking parent context into a child, custom user-defined
agent presets, per-call model overrides, and depth greater than one.
