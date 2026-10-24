# Use ChatGPT in ANKITA or Chrome

Choose **ChatGPT Browser** in Settings → Providers and save. This uses your
selected browser conversation and its current model. Your ChatGPT account's
limits still apply. Ordinary chat needs no API chat key or running CoS app.

Choose **ANKITA window** and click **Open ANKITA window**. A small browser window opens.
Sign in there once. Your sign-in stays in ANKITA's own browser storage. You do
not need an extension or a pairing link for this option. **Show ChatGPT** brings
the window back; closing its window hides it while ANKITA remains open.

Already signed in in Chrome? After opening the built-in window, click **Use my
Chrome sign-in** in ANKITA. In Chrome, open **ANKITA ChatGPT Companion**, select
your signed-in ChatGPT tab and click **Bring Chrome sign-in to ANKITA**. Chrome
asks for its optional cookie permission from that click. This is the same kind
of explicit transfer used by CoS. You do not type your email or password again.
The extension must be reloaded once after this update to add that button.

Only the complete ChatGPT session cookie is handed to ANKITA's own browser jar.
No password, unrelated cookie, whole profile or cookie value goes into app
settings, logs, model prompts or MCP results. Chrome's own sign-in is unchanged.
The offer expires after 15 minutes and is cancelled by Stop/disconnect; partial
imports roll back. An already active ANKITA sign-in is not overwritten. The
local credential handoff is not proof that ChatGPT accepted the imported session;
the real signed-in chat must still pass its ordinary readiness and reply checks.

Choose **My Chrome** and click **Use my Chrome** to use Chrome's existing sign-in. Install the bundled
**ANKITA ChatGPT Companion** once using Chrome's Extensions page and Developer
mode. Use ANKITA's **Open companion folder** button to find it. Reload an older
copy after updating. Click **Use my Chrome** in ANKITA: the companion finds the
local app automatically. No link needs copying. If Chrome is already running,
ANKITA reuses it; otherwise it opens installed Chrome. The companion opens a
small chat window in that Chrome profile. It does not copy or reset a profile.
If Chrome has put its companion to sleep, its browser-owned wake alarm checks
again within roughly 30 seconds. Active messages use the normal faster poll.
Disconnect stops both the connection and that wake alarm.

Each teammate and workspace gets its own remembered chat. A new chat starts
without a made-up conversation ID. Its first accepted message supplies the real
ID, then later messages reuse that chat. Changing teammates waits for an active
reply to finish or Stop to be confirmed. The model selected in ChatGPT stays
selected. Use Chrome if your sign-in provider refuses the built-in browser.
Google can reject direct sign-in inside an embedded window. Use **Use my Chrome
sign-in** or **My Chrome** in that case. The Chrome transfer has reached a Ready
signed-in window on Windows. Hosted messages passed in both modes; the built-in
mode also passed file, command, job-status and read-only desktop checks. Other
accounts and platforms still need their own checks. If ChatGPT's sidebar covers the typing box in the compact
window, close that sidebar before sending.

Old explicit pairings still work in the companion's advanced pairing section.
Normal new connections use neither that section nor a public MCP URL.

You can also switch with **Use my Chrome** or **Use ANKITA window** directly
above the message box. **Browser settings** opens the two visible browser
choices and the companion folder. Your typed draft stays in place when you
switch. Finish or stop an unfinished reply first. If another teammate owns it,
**Open other teammate** takes you back to that teammate.

## Let ChatGPT use ANKITA tools

Open **Let ChatGPT use ANKITA's tools** in the connection panel. Connect the
groups you need:

- **ANKITA Core**: files and commands in the selected workspace.
- **ANKITA Desktop**: ANKITA task browsers and your manually connected Computer Use driver.
- **ANKITA Plugins**: the external plugins currently enabled in ANKITA.

For each group, use the panel's Open tunnels and Open API keys links. Create a
dedicated OpenAI tunnel associated with your ChatGPT workspace. Enter its ID
and a restricted key with **Tunnels Read and Use** in that group's card, then
click **Connect tools**. The key is saved through the device's secure storage.

Use a **different tunnel ID for every active group**. Reusing one ID makes the
helpers compete for its channel and can send a Core request to Desktop. ANKITA
rejects reused IDs before saving a key or starting the competing connection,
including simultaneous setup attempts. Disconnect an old group before moving
its tunnel to a different group. If an existing app named ANKITA Proof is already
connected to your Core tunnel, it can remain the Core app. Open Core's compact
row, change **ChatGPT app name** to **ANKITA Proof**, and click **Save app names**.
Your tunnel ID and key stay the same.

For desktop control, first open ANKITA's **Plugins → Computer Use** and click
**Connect**. Then create the Desktop app so ChatGPT reads the connected driver's
current tools.

Use **Open ChatGPT apps** to create the group's MCP app with its displayed
name. Choose **Tunnel**, select that dedicated tunnel, and choose **No
authentication**. Complete ChatGPT's account and tool permission prompts
yourself. A card saying **Connected** in ANKITA confirms the tunnel connection;
the matching app must also appear on ChatGPT's Plugins page and be enabled in
your selected chat. Core's file tools cannot act through the Desktop app.
Desktop actions retain ANKITA's owned pointer and the
existing no-prompt behavior; blocked tool tiers remain blocked.

The three tool cards start as small rows. Open only the one you want to change.
Their app names are already filled in. **Include connected apps automatically**
adds actual ChatGPT app tags when you send from ANKITA, so you do not need to
type plugin names into each message. Only groups you connected are included.
Change a name if your installed ChatGPT app has a different name, then save it.
You can turn automatic tags off and save for chats using ChatGPT's own tools,
such as image creation, which can behave differently when app tags are present.

The shared page observer starts before a new chat loads, so it can read the app
list ChatGPT already fetches. ANKITA can also remember the actual app name and
ID after one of its own native requests proves that identity in the same chat.
For example, a Core app called **ANKITA Proof** can become the saved Core name.
A different tunnel, explicit name change or complete contrary app list revokes
that remembered selection. New chats still need current app evidence. Missing
or duplicate apps refuse before Send; ANKITA does not guess a different app.

**Connection files missing** means setup cannot start yet. Restart the updated
app, then click **Check connection files**. The button becomes available when
the helper files are present; installing a ChatGPT app alone cannot supply them.

For ordinary file and command cards, **Always allow** applies to later browser
actions for that teammate during this app session. Your saved automatic-action
setting also applies to browser tools. Core uses already connected tools;
changing global plugin or MCP connections remains in ANKITA's settings.

If the driver says its session has ended, stop computer control and connect
again yourself. ANKITA does not silently restart a stopped computer session.

Keep pairing links and keys in their setup fields. The local pairing link is
different from a public MCP server URL. You do not need a public URL or a
temporary Cloudflare tunnel for this product path.

## Stop, files and recovery

Stop records cancellation before another Send or action can be admitted. It
cancels owned tools and commands and ends the pointer session. ANKITA leaves
your Chrome and user apps open. Its native ChatGPT Stop targets only the
owned reply. **Waiting for Stop confirmation** means the selected chat has
not supplied a confirmed terminal receipt yet; keep the tab open and check it.

Attachments use the existing desktop size and type limits. Extracted documents
are uploaded as named text files, with page images when available. ANKITA waits
for exact new native attachment tiles and upload readiness before Send. Existing
human drafts or attachments are preserved, and unconfirmed uploads are refused.
Attachment acceptance does not establish how well the selected model understood
an image or document.

On restart, an encrypted saved pairing can reopen its same loopback reader.
It launches no native action helper and sends no saved question again. A
previous accepted or uncertain reply appears beside the message box with a
**Read reply** button (also available as **Resume saved reply** in settings). It
reads that reply's original receipt; it does not repeat a tool action. If the
remembered port or secure storage is unavailable, open the selected browser again.
Disconnect is remembered and requires an explicit new connection.

Recovery also updates while ANKITA stays open. Observing the same chat keeps
its original reply. Before choosing a different chat, resume the unsettled
reply or finish Stop confirmation. If the selected tab temporarily disappears,
ANKITA keeps its receipt and waits for that same tab instead of losing it.
Clear removes the local chat and checklist without forgetting action receipts.

If ChatGPT briefly shows **Error in message stream** after accepting your
question, ANKITA keeps reading that exact reply. A later completed answer can
appear here during the first setup, without restarting or sending it again.
The message box shows **Still checking this reply**, and Stop remains available
for the same generation. Native tool actions pause during the warning; reading
the answer does not restart them. If no answer arrives, use **Show ChatGPT** to
check the original chat. An unsent question reports that it was not sent,
instead of waiting for a reply. Quota and sign-in notices still need attention
in ChatGPT before reading can resume.

ChatGPT quota, authorization, model and refusal notices stop this path. Check
the actual notice in the selected chat before resuming. ANKITA does not switch
accounts, models or chats or start an API provider to work around it. Notice
recognition currently covers bounded English semantic alerts; unknown page
variants can remain unconfirmed.

**Take this context to another chat** copies your objective, selected project,
confirmed action results, unresolved receipts and corrections. Choose the
destination yourself. Its first message still needs native acceptance proof.
Inspect unconfirmed actions before repeating them.

## Development and packaging

`npm run desktop:dev` and `npm run desktop:start` prepare connection resources
automatically before launch. A complete checksum-verified cache avoids another
download. Run `npm run desktop:resources` explicitly to prepare them or before
packaging. It generates the companion
wire/manifest and prepares the pinned official Windows x64 native helper and
full publisher notices. The package includes the extension and helper as real
files outside ASAR; runtime paths come from Electron. Other native helper
platforms are not yet verified.

Desktop encrypted keys follow the app's browser profile. Development and normal
installs keep separate vaults so saving a key in one cannot make it unreadable in
the other. On first use, the old encrypted file is copied without removing or
overwriting it. A key encrypted by another profile may still need to be entered
in the current one; copying encrypted bytes cannot unlock them. Do not delete
the old profile or its key file when investigating that message.

`scripts/verify-chatgpt-browser.mjs --executable <owned packaged executable>`
exercises actual Electron, OS-encrypted pairing, attachment acceptance, crash
recovery, explicit resume and owned Stop using an isolated native-DOM browser
fixture. That trace is separate from hosted ChatGPT account verification.
See `docs/chatgpt-browser-verification.md` for exact evidence and remaining gates.
