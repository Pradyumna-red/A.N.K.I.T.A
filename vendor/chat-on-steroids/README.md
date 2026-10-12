# Focused Chat On Steroids adapter fork

Reference repository: https://github.com/totec448-spec/chat-on-steroids.
Research pin: `34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5`, package 2.1.34, MIT.
The unchanged upstream license is in `LICENSE`; source hashes and selected functions
are in `source.json`.

The fork keeps only composer visibility, committed React Fiber traversal,
conversation identity, evaluated account model choices and public completion evidence.
It excludes the CoS app, overlays, rewriting/hidden prompt helpers, tool execution,
private analysis, broad recording, credentials, native drivers and assets.
ANKITA owns pairing, explicit tab binding, source admission and lifecycle receipts.
Page evidence remains untrusted and cannot carry tools, credentials or host context.

Local adapter patches: standalone read-only namespace; named scan bounds; no page
message listener, no React action callbacks, no DOM mutation, no baked-in connector
or account/model identifiers. The current bound tab is checked before and after reads.
Compatibility with a live account is a separate gate recorded in the verification doc.
