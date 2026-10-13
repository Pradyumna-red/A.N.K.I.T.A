# Use your existing ChatGPT chat in ANKITA

Choose **ChatGPT Browser** in Settings → Providers and save. This uses your
selected browser conversation and its current model. Your ChatGPT account's
limits still apply. Ordinary chat needs no API chat key or running CoS app.

Click **Connect browser**, then **Open companion folder**. In your existing
Chrome, open Extensions, enable Developer mode, and load that folder. If ANKITA
ChatGPT Companion is already loaded, reload it. Copy the private pairing link
from ANKITA into the companion popup and connect. Select a saved ChatGPT
conversation, then click **Observe this tab**. Keep that tab open.

The companion uses the chat you choose. It does not restart Chrome, copy your
browser profile, or select a different account or model. A blank new-chat page
cannot be selected until it has a saved conversation route.

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
connected to your Core tunnel, it can remain the Core app; use that actual name
in your chat until you choose to rename it.

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
previous accepted or uncertain reply appears as **Resume saved reply**. Resume
reads that reply's original receipt; it does not repeat a tool action. If the
remembered port or secure storage is unavailable, create a new pairing link.
Disconnect is remembered and requires an explicit new connection.

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

Run `npm run desktop:resources` before packaging. It generates the companion
wire/manifest and prepares the pinned official Windows x64 native helper and
full publisher notices. The package includes the extension and helper as real
files outside ASAR; runtime paths come from Electron. Other native helper
platforms are not yet verified.

`scripts/verify-chatgpt-browser.mjs --executable <owned packaged executable>`
exercises actual Electron, OS-encrypted pairing, attachment acceptance, crash
recovery, explicit resume and owned Stop using an isolated native-DOM browser
fixture. That trace is separate from hosted ChatGPT account verification.
See `docs/chatgpt-browser-verification.md` for exact evidence and remaining gates.
