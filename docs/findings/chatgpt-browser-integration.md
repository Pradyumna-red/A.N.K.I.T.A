# Browser integration findings

The product uses ANKITA's own runtime and tool host. CoS contributes focused
MIT browser reader/composer patterns; the official OpenAI native tunnel helper
provides transport. A running CoS app or its credentials are not required.

The actual hosted account has already proven an exact native file read and an
ANKITA desktop Send/public reply/history round trip. The current model can be
used without a readable model picker. Missing native request origins and
search-unit/public-widget reply projection were reproduced and repaired.

The new local native Core/Desktop/Plugins route, durable action receipts,
no-prompt pointer ownership, scoped browser protection, Stop, uploads,
encrypted reconnect and explicit resume have regression and live fixture
coverage. The Windows app directory builds and its actual Electron process
passes the isolated lifecycle check. The actual hosted Desktop gate now also
passes against the real Cua driver: the selected model read a six-digit number
from a picture, entered it with a fresh target, clicked Apply once and read back
the verified result. The number was absent from the prompt and initial text
metadata. Eight native calls returned five images with zero errors or approval
requests. Hosted Stop/upload/restart gates also passed against the actual
packaged app. Stop terminated its real waiting command and ended its owned
pointer session while the original Chrome process and test window survived.
One uploaded text file produced its exact content once in saved history.
Abrupt restart retained the original accepted question; explicit Resume imported
its correlated reply once with no new operation or native helper launch.
The final serial suite passed 1344/1345 with one existing skip and zero failures.
Independent whole-branch review found six important follow-ups, all corrected
and independently rechecked. The final 2.6.0 package matched 15 source modules,
both publisher binaries and five notices; its lifecycle and actual hosted
no-card Core checks passed. PR #65 and #66 are merged, and the exact-commit
Windows release workflow passed. The published installer also passed content,
checksum and native lifecycle checks; see
[published 2.6.0 verification](../releases/2.6.0-verification.md).

Known boundaries:

- One explicitly selected conversation/teammate/workspace; no concurrent browser agents.
- Exact native request joins are required; an ambiguous or stale join is refused.
- Connections to sockets created before the observer attached may lack request origins.
- A disappearing Stop button alone is insufficient. A missing owned terminal receipt leaves Stop pending.
- Unknown/localized native notices and upload tile layouts can remain unconfirmed.
- Operation and native receipt journals are bounded and refuse capacity rather than forget spent work. Retained attachment bytes count toward the profile byte limit.
- OS-encrypted saved pairing needs the same free remembered loopback port and valid workspace. Failure requires explicit pairing.
- Journal serialization is process-local. Atomic fsync/replacement handles process restart; it is not a universal power-loss or concurrent-profile-process guarantee.
- Receipt deduplication applies to an exact full native HTTP call token and RPC ID. A provider request with a different full token is a separate admission; it is not a universal business-action idempotency key.
- Native helper packaging currently verifies Windows x64 only. Publisher checksum matching is proven; independent vulnerability scanning was unavailable.
- Ready requires recent page evidence. Several live Send/Resume attempts were refused before any new dispatch when readiness expired between the displayed status and runtime admission. A later explicit attempt succeeded. No automatic retry or weaker freshness guard was introduced; improving this transient refusal requires a separate traced change.
- Windows 2.6.0 is published; additional helper platforms remain unverified.

Live native routing finding: the account configured the same tunnel ID for Core,
Desktop and Plugins. Durable receipts showed `find_tools` and `run_command`
arriving on Desktop and being refused. Disconnecting the competing owned helpers
left Core connected; subsequent hosted `write_file` and `edit_file` receipts
settled successfully on Core. Duplicate-ID and simultaneous-setup regressions
failed before the guard and passed after it. The account now has three distinct
tunnel IDs.

Native multi-call finding: a safe ingress-shape trace measured the same generation
root and RPC ID (0) for `list_dir` and `run_command`, with different full native
request tokens. The gateway had collapsed those into one receipt. Ownership
still uses the generation root; admission now hashes the full native token and
RPC ID. Distinct calls, intentional repeated arguments, exact retry reuse and
changed-payload refusal all pass. Old generation-wide admissions refuse upgrade
replay and require a fresh explicit request. No old question is resubmitted.
The focused desktop/gateway/ownership set passed 27/27. The rebuilt hosted Core
gate subsequently created, edited and read its unique file, ran its harmless
command, and obtained its actual final exit code 0 and exact output through
native job status/wait. Seven tool calls completed with no gateway errors.

Native ownership freshness finding: job status arrived while the selected page
was briefly awaiting its next observation. The known request was refused before
the companion could refresh it. The resolver now waits within its existing
bound for that same binding to become ready; a changed binding or blocked page
still refuses, and historical requests cannot authorize a new lease. The
freshness/bridge/gateway/ownership set passed 42/42, including the unchanged
skill-scaffold rollback check.

Native discovery finding: Core's finder advertised Desktop interfaces that its
MCP app could not publish. Discovery now uses the host's same private callable
interface set as execution. Core cannot load Desktop or Plugins tools. Focused
host checks passed 25/25; the ordinary API discovery/browser/MCP suites passed
106/106. At that checkpoint the change had not yet been packaged.

Account setup finding: three connected ANKITA tunnel cards did not mean three
installed ChatGPT MCP apps. The account had only ANKITA Proof (Core). The user
created the separate Desktop app, and its native list_windows call reached the
actual driver with zero approval prompts. A test window launched hidden was
corrected in the ignored fixture. A later driver session reported ended; it was
left stopped until the user explicitly reconnected it. The later hosted
vision/action gate above resolved this setup checkpoint.

Accepted-execution lifetime finding: the first hosted Stop attempt failed before
Stop was invoked. Two harmless waiting commands finished normally with exit code
0; neither was stopped. One admitted command had already been recorded as an
error even though its approval later allowed it to execute. A real SDK HTTP
disconnect during pending ToolHost approval reproduced that false terminal
receipt. Admission now retains the actual execution promise independently of
the socket, and gateway teardown drains it before closing the SDK. The new
regression failed before the correction, then all 35 host/gateway/ownership/Stop
checks passed. It also proves that an exact retry after gateway restart returns
the durable actual result with one write/approval. The subsequent rebuilt
hosted Stop gate passed as recorded above; different provider call tokens
remain distinct calls.

Driver lifecycle finding: the actual driver publishes strict `list_windows`
without a session argument, while window-state/actions accept a named session.
Live inspection proved the owned pointer session existed and the attached
implicit discovery session returned ended. Creating only a new pointer did not
initialize discovery. Connection/new-owned-work preparation now explicitly
initializes that attached lifecycle before reserving the separate pointer. The
existing-pointer fast path remains unchanged: an ended existing pointer is never
silently revived. The external-protocol regression reproduced the same ended
discovery refusal before correction, then the affected controller/host/native
ownership set passed 44/44. A rebuilt actual packaged app then completed the
hosted screenshot/action/readback gate above. Its 11 inspected source files,
both publisher binaries and five notices matched; its existing encrypted
browser binding restored with no Send or native helper launch on startup.

The first final serial suite reported 1324 tests, 1320 passes, three failures and
one skip. Two failures came from unconditional URL lookup added to unprotected
Playwright targets. Conditional protection restored both existing contracts.
The unchanged process-preview test's failure did not recur in the affected
serial rerun: all 60 tests passed, including the new tunnel guards, real isolated
browser protection and the connected-Chrome contract fixture. The second full
serial run reported 1328 tests, 1326 passes, one failure and one skip. Only the
unchanged skill-scaffold rollback test failed; it passed on the focused rerun.
Its failure under load remains a finding, and the final full suite must be rerun
after the discovery change. That next run reported 1331 tests, 1330 passes, zero
failures and one skip, 835255 ms. It predates the subsequent driver-lifecycle
correction, which requires another affected/full check.

Exact command counts and redacted traces are recorded in
`docs/chatgpt-browser-verification.md`. No private URLs, keys, account transcripts,
screen captures, generated helper binaries or dumps belong in the source diff.
