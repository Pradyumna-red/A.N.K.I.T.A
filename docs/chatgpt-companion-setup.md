# Connect the existing Chrome conversation

This is the read-only attach checkpoint on `codex/chatgpt-browser`. ANKITA's desktop
ChatGPT provider, sending and actions are not enabled yet. The approved plan requires
a real native ChatGPT MCP read before those are built. Normal account limits apply.

1. In **your already-open Chrome**, open its Extensions page and load the local unpacked
   folder `C:\Users\anime\.codex\worktrees\eight-board-ideas\copilot-chat\desktop\chatgpt-companion`. Chrome must allow this extension;
   no profile is copied, no browser restart/debugging port is required.
2. Run `rtk proxy node "C:\Users\anime\.codex\worktrees\eight-board-ideas\copilot-chat\services\chatgpt-bridge\main.mjs" --proof --print-pairing`.
   It creates an empty temporary proof workspace with one unique text file. Paste the
   one-time local pairing URL into the companion popup. Keep that URL private; do not
   paste it into ChatGPT or diagnostic logs. It expires when the process stops.
3. Choose an **existing ChatGPT conversation** in the popup and click **Observe this tab**.
   The popup must show `ready` and an observed model. If it shows logged-out, observing
   or model-unavailable, stop at that state; no account/model availability is assumed.
4. The process then displays a read-only local MCP endpoint. Hosted ChatGPT cannot
   directly reach a loopback URL. A supported native connection and reviewed HTTPS/tunnel
   setup are still required; no tunnel is published automatically. Do not paste a
   loopback URL into ChatGPT expecting it to work or claim the proof has passed.

The companion asks for ChatGPT and loopback host access plus tabs/scripting/session
storage. It has no debugger/cookies permission and no automatic page-wide content script.
Only the selected tab is read; unrelated page text, cookies, API keys and private analysis
are excluded. Page messages cannot request tools or change host workspace/thread context.
Disconnect clears the binding and stops polling. Restart needs a new manual pairing;
pairing material is not persisted as plaintext.

The Windows computer-use skill prevents the agent from handling extension/security
permission setup. The installation and any account connection permissions are a manual
handoff. After those are ready, the actual native read can be tested before Tasks 3–7.
