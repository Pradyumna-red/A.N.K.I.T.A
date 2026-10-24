# Focused Chat On Steroids adapter fork

Reference repository: https://github.com/totec448-spec/chat-on-steroids.
Research pin: `34f4b73cc242b63acd4be5ba4e4fb74a5cdb99e5`, package 2.1.34, MIT.
The unchanged upstream license is in `LICENSE`; source hashes and selected functions
are in `source.json`. The original reader pin remains unchanged. The separate app-tag
adaptation is pinned to `532cbeffced7e24a3d8b960cbf93941687f04b19`, package 2.1.45.
The editor filtering, structured app sightings and browser lifecycle principles
were rechecked at `a9c02cc8339ed550862e57e33c54169b9ceedce3` (2.1.45).
Its individual source hashes and adapted concepts are recorded separately.

The fork keeps only composer visibility, committed React Fiber traversal,
conversation identity, evaluated account model choices, public completion evidence and
bounded request identity from the page's existing HTTP/WebSocket response streams.
It excludes the CoS application implementation, overlays, rewriting/hidden prompt helpers, tool execution,
private analysis, broad recording, credentials, native drivers and assets.
ANKITA owns pairing, explicit tab binding, source admission and lifecycle receipts.
Page evidence remains untrusted and cannot carry tools, credentials or host context.

Local adapter patches: standalone namespaces; named scan bounds; no page
message authority channel, no React action callbacks, no baked-in connector
or account/model identifiers. The current bound tab is checked before and after reads.
Compatibility with a live account is a separate gate recorded in the verification doc.

The `usage.js` fork retains only server conversation/request IDs and delta format state.
It makes no network request and retains no prompt, response text, analysis, headers or
credentials. Structured app sightings retain only request ID, app ID/name and tool
name; no message prose. CoS quota/history/deletion/model-send features are excluded.
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
guess. App tags use the explicitly saved app names and automatic-inclusion setting
described below. The typed-shell fork accepts top-level public final items
only when both the item and containing turn complete; nested working prose stays excluded.
An exact public widget may supply its own fallback Markdown, preserving code escapes.
Reload readback carries prior native IDs and baseline only as observation custody.
For an app-dispatched question only, receipt matching tries the raw native text
first, then one measured Markdown storage-escape pass, following the pinned
`content.js` bootstrap comparison. This handles literal backslashes and hard
breaks without rewriting authored input, changing its hash, repeatedly decoding,
or admitting a second Send. Native identity, baseline, binding and ambiguity
checks still apply. Assistant code/fallback rendering uses its separate reader.

`app-mentions.js` adapts `inspectSystemHints`, fetch-hook refresh and `addAppMention`
from 2.1.45. It passively reads the selected page's existing same-origin app catalogue;
it never requests an endpoint, installs an app or invents an app ID. Complete plugin
lists replace partial lists; missing/duplicate names refuse before inserting a prompt.
Only configured native tool groups receive real editor app tags. Adoption is awaited
before the one Send. Saved tag paths support exact reply matching and Stop after reload.
The typed app-link suffix described by Fiber's `withoutAppMentions` is removed only when it
matches those saved tags. Human drafts, unrelated links and attachment ownership remain
protected. Reinjection/DOMContentLoaded reattach passive observation after page hooks
replace fetch; old wrappers cannot duplicate response reads. Users can edit the three
prefilled names or turn automatic inclusion off. This does not import CoS prompt
rewriting, unlimited-access claims, model switching, or its tool execution backend.

The shared authored-text reader excludes actual style/script/noscript/template
elements, including when the element itself is passed. Typed literal markup is
preserved. The host joins a structured app sighting to its own settled native
request before caching an app ID. The cache is scoped to the browser, teammate,
workspace and confirmed chat; changing a tunnel invalidates its old proof.
A complete contradictory catalogue revokes the page's remembered selection.

The built-in browser uses a separate sandboxed Electron session and installs these
same readers before navigation. External Chrome uses the companion and explicit
local discovery. Automatic token provisioning trusts other local processes (as
CoS does); extension-origin checks block ordinary web pages, not a malicious local
program. Native action routes still require capability and request-owner admission.
The external companion also uses a browser-owned periodic alarm, following CoS's
retry lifecycle, so suspension of its MV3 worker cannot lose automatic discovery.
Active work retains its faster timer. An existing alarm is not postponed by each
poll; explicit Disconnect clears it and fences late alarm creation.

The user-requested sign-in handoff separately adapts `sign-in-transfer.ts`,
`host.ts#importSignIn`, the worker's `cos_sign_in_transfer`, and the popup's
gesture-bound optional permission request. Only complete ChatGPT session chunks
may cross the short-lived capability-protected handoff. Credentials go directly
to Electron's browser cookie jar, never model/page messaging or app JSON. The
existing external browser jar is read-only. ANKITA refuses an active destination
sign-in and rolls back a failed import. These are transport checks; only a live
hosted account check proves ChatGPT accepted a transferred session.
