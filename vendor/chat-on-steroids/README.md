# Focused Chat On Steroids adapter fork

Reference repository: https://github.com/totec448-spec/chat-on-steroids.
Research pin: `34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5`, package 2.1.34, MIT.
The unchanged upstream license is in `LICENSE`; source hashes and selected functions
are in `source.json`.

The fork keeps only composer visibility, committed React Fiber traversal,
conversation identity, evaluated account model choices, public completion evidence and
bounded request identity from the page's existing HTTP/WebSocket response streams.
It excludes the CoS app, overlays, rewriting/hidden prompt helpers, tool execution,
private analysis, broad recording, credentials, native drivers and assets.
ANKITA owns pairing, explicit tab binding, source admission and lifecycle receipts.
Page evidence remains untrusted and cannot carry tools, credentials or host context.

Local adapter patches: standalone namespaces; named scan bounds; no page
message authority channel, no React action callbacks, no baked-in connector
or account/model identifiers. The current bound tab is checked before and after reads.
Compatibility with a live account is a separate gate recorded in the verification doc.

The `usage.js` fork retains only server conversation/request IDs and delta format state.
It makes no network request and retains no prompt, response text, analysis, headers or
credentials. CoS quota/history/deletion/model-send/app-sighting features are excluded.
Projection is pulled directly by the bound companion rather than posted through page
messages. Only opaque lease/epoch/tab/conversation scope enters the page; host workspace
and thread context remain outside it. Late HTTP responses and sockets from an old binding
abstain. Conflicting stream identity poisons that response; channel-zero complete root
events alone supply IDs. Reinjection keeps one observer; disposal cancels bounded clones,
clears metadata and restores transports when they are still owned by the observer.
Socket observation covers native sockets created after attachment; existing sockets cannot
be retroactively intercepted. This remains a live-account/recovery verification gap.

Native delivery now reuses CoS's editor insertion, exact fresh-user receipt, translated
primary-control fallback and terminal-answer rules. `delivery.js` changes only the owned
composer and clicks its unique native Send after host dispatch is committed. There is no
Enter fallback, automatic repeat after an acknowledgement loss, prompt rewriting, model
guess or implicit app mention. The typed-shell fork accepts top-level public final items
only when both the item and containing turn complete; nested working prose stays excluded.
An exact public widget may supply its own fallback Markdown, preserving code escapes.
Reload readback carries prior native IDs and baseline only as observation custody.
