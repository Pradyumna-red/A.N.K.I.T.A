# Reviewed PR integration

PRs #52–#59 and #61 are being integrated into `ankita`. Earlier unmerged closures
were reversed; reopening alone does not establish that a change was merged.

PR #54 now persists custom installation roots for shared CLI, chat, skill-tool and
desktop discovery. See `idea-skill-scaffolder.md` for the reproduced discovery bug,
simultaneous installer lost update, storage rollback and **20/20** focused result.

The combined startup-profiler and Computer Use changes conflicted in MCP connection
setup. The resolution preserves private pending clients, host setup, filtered tool
capabilities, cancellation and teardown. Plugin timing includes host setup and only
reports `ready` after the connection is exposed successfully. The real local HTTP
handshake regression checks successful host setup, a host-setup failure and transport
failure; the startup/cancellation suite passed **7/7**. Stop still leaves a launched
test app running while ending its MCP driver.

Combined full-suite and desktop-build results will be recorded after execution.
These checks do not establish a fresh packaged UI or physical input round trip.
