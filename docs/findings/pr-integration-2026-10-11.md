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

At integration code commit `7ba28ce9d2caffcf41cf3f8d4b04d22cbeac4126`,
`npm test` completed serially with **1,208 tests: 1,207 passed, 0 failed,
1 Windows-inapplicable POSIX skip** (682,967.8101 ms). `npm run desktop:build`
exited 0 and built **371 modules**; `git diff --check` exited 0. The complete-entry
desktop checks mounted both main and island surfaces with no renderer errors.
The live startup-profile UI trace reported `report=true refresh=true
existingDisable=true rendererErrors=0 transport=fixture engine=real`.

An independent review inspected the combined MCP conflict resolution and found
no actionable issues. Comparing the driver source/build paths with previously
verified PR #61 commit `4bb52733ab306be99c2f8217b7f568e832986c68` produced no diff.
Final merge/pull receipts are recorded in the PR description and task report.

This documentation update does not change the tested code. These checks do not
establish a fresh packaged UI or physical input round trip. The preserved local
working edits are checked separately after the pull, not included in this suite.
