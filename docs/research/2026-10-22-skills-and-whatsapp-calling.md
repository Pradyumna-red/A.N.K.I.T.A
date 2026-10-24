# ANKITA skills and free WhatsApp calling

Checked on 22 October 2026. This is an audit and source review. Calling has not
been added to ANKITA, and no real phone call was placed.

## 1. Can ANKITA use skills that we add?

**Yes. The feature already exists and works in the published Windows app.**

Think of a skill as a small instruction book. ANKITA first sees the book's name
and what it is for. When the book is needed, ANKITA can open its instructions.
The browser book also opens automatically when ANKITA's normal model connection
starts using the browser.

| Kind | What I checked | Result |
| --- | --- | --- |
| Shipped skills | Development help, browser use, bug checks, change review, release notes, web research | All six found and readable |
| An added skill | Created through the real add-skill command in a separate folder | Found by the published desktop app |
| An older added skill | Another installed skill with an older file date | Found just like the new one |
| Delivery | Captured the app's actual requests to a local test model endpoint | All eight complete instruction bodies arrived |
| Restart | Closed and reopened the published app | Both added skills remained available |
| ChatGPT connection | Asked the native Core execution host to read the new skill | Explicit read worked |

The temporary examples were removed afterward. Your usual settings were not changed.

**Available does not mean used on every message.** Most skills wait until the
model chooses them. It would be misleading to say all six run on every chat.
These checks prove instruction delivery, not that every AI will always choose
the right book or obey every line.

### How adding works

The existing `ankita new skill` command asks for a name, intended access and an
example request. A custom installation folder is remembered in the same ANKITA
profile. Reopen or refresh Plugins → Skills to see it. Put your real instructions
in the generated book afterward; the generated text is only a starter.

Simply saving a random skill somewhere on the computer does not install it.
Codex's own plugin skills are also separate from ANKITA's skills. ANKITA validates
the name and description and currently accepts a narrower format than many
third-party skill collections. A downloaded collection may need conversion.
Bundled names take precedence if a custom skill uses the same name.

### One gap in the ChatGPT route

The normal ANKITA model connection gets a list of skill names and descriptions.
The ChatGPT browser route does not send that same instruction list. Its Core
connection exposes a skill reader, and reading a known name works, but its
discovery reply does not list the installed skill names. That makes finding the
right skill less reliable unless the request names it explicitly.

I recorded this gap rather than changing the product during an audit.

## 2. What the WhatsApp project actually does

**It is built for live WhatsApp voice calls in both directions.** You can call
the bot, or its agent can ring you. It uses a separate helper linked to a bot's
WhatsApp account. The project currently expects a separate bot number, a Gemini
API key, and Linux or macOS. Its current release does not include a Windows
helper. [Project overview](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/README.md)

Here is the path in plain words:

1. Your phone rings in WhatsApp.
2. The helper carries the sound between WhatsApp and Google's voice model.
3. The voice model talks and listens. You can interrupt it.
4. When you ask it to do work, it sends that request to Hermes.
5. Hermes uses its own tools and returns the answer for the voice to say.

The helper converts the sound formats and clears waiting speech when you
interrupt. Its voice connection is specifically written for Gemini; changing a
model name does not make a different company's voice service work.
[Audio handling](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/sidecar/src/audio.rs),
[voice connection](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/sidecar/src/gemini.rs)

### Why it works with Hermes

It is not just a skill that teaches Hermes to click a call button. Its Python
plugin registers two real actions: call the owner and check a call. Those actions
talk to the separate helper through a local, password-protected connection.
The plugin also supplies a setup guide, which is only instructions.
[Plugin registration](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/__init__.py),
[call actions](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/tools.py)

Hermes exposes a task service: start work, check whether it finished, get its
answer, or stop it. The helper uses that service during a call. This is how the
talking part can ask the full agent to do real work. Hermes itself does not
supply free phone minutes or the live voice model.
[Helper's Hermes client](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/sidecar/src/hermes.rs),
[Hermes task service](https://github.com/NousResearch/hermes-agent/blob/41dfcf2c1bd7146d4ad46aea08b7dd007900602e/gateway/platforms/api_server_runs.py)

## 3. Can it be free?

**A small personal trial can fit a free tier. Unlimited free calling for all
ANKITA customers is not established.**

| Part | What free means here |
| --- | --- |
| Project code | Both reviewed projects carry MIT licenses; there is no purchase price for their code. Preserve the required notices when reusing it. |
| Voice AI | Google's current pricing lists free input and output for Gemini 3.8 Live. |
| Free usage limit | Google applies project limits. Check the actual allowance in your own AI Studio account; do not assume unlimited minutes. |
| Agent doing work | Depends on the model connected to ANKITA or Hermes. Free speech does not make a paid work model free. |
| WhatsApp line | Needs a separate number for the bot, plus internet. Obtaining that number may cost money. |
| Always available | The helper must stay online. A sleeping laptop cannot provide a dependable always-on service. |

Google's paid audio rates are currently about **$0.005 per input minute** and
**$0.018 per output minute**, with text charged separately. Actual cost depends
on the audio and text processed. The free tier's pricing table also says its
content may be used to improve Google's products; paid-tier handling differs.
[Official pricing](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-live),
[official limits](https://ai.google.dev/gemini-api/docs/rate-limits)

The speech is sent to Google. This is not an offline voice solution. Support
for self-hosted voice models is still an open request.
[Self-hosted voice request](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/issues/14)

## 4. Limits that matter for ANKITA

- **Windows needs work.** The plugin declares Linux and macOS support. Native
  Windows builds, background startup and platform handling remain open work.
  [Windows issue](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/issues/7)
- **It calls its owner only.** There is one configured owner and one active call.
  Arbitrary customers, groups and video are not provided by this version. An
  owner-specific line for each ANKITA user would need account/session separation.
  [Call ownership and call slot](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/sidecar/src/calls.rs)
- **An answered status is not proof of working sound.** An open report describes
  failed iPhone calls even when the helper marked them answered. That reporter
  did get an inbound call working with WhatsApp Desktop while hosting the helper
  under WSL2. This is one user's report, not my own phone test.
  [Open call failure report](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/issues/15)
- **Watch the repeated briefing cost.** The same report describes a growing
  briefing conversation. The reviewed source does reuse a fixed briefing session
  name. Its cost impact needs measurement before copying that behavior.
  [Briefing source](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/sidecar/src/calls.rs)
- **The WhatsApp connection is unofficial.** The project's own warning says
  WhatsApp changes can break it and automated use may put the account at risk.
  That is a material concern for a customer-facing release.
  [Project caveats](https://github.com/ashwanthbalakrishnan5/hermes-whatsapp-voice/blob/e472a47dda4e9986ca44f0ad62cb1b71c893bec0/README.md#caveats)

These are WhatsApp internet calls. The repository does not provide ordinary
telephone-network calling to arbitrary phone numbers.

## 5. What I would reuse for ANKITA

My assessment: **reuse the calling helper and connect its work requests to
ANKITA through an external MCP service.** ANKITA already has the work tools;
copying the whole Hermes assistant would add a second brain and another set of
settings to maintain. This is a proposed integration, not an existing feature.

Keep the parts that already handle ringing, sound, interruptions, owner checks
and call status. Replace the Hermes-specific work connection with a small link
to ANKITA's existing agent. Expose calling and status through MCP so ordinary
chat and scheduled reminders can use the same capability. Keep account keys and
WhatsApp sessions separate for each user.

The first useful proof would be one owner receiving a call, speaking back,
asking ANKITA for a harmless task, hearing the real answer, and ending the call.
Test both sound directions and task cancellation. Then prove a missed call and
a restart. Windows packaging and real Android/iPhone calls must pass before
calling this ready for the ANKITA installer.

A free-tier trial on an existing Linux host, or a carefully tested Linux helper
on Windows, is plausible. A polished Windows release and fully local voice are
additional development work. This review did not install Hermes, link WhatsApp,
read any API key, or contact any person.

## Evidence and limits

The calling source snapshots were pinned to
`hermes-whatsapp-voice e472a47dda4e9986ca44f0ad62cb1b71c893bec0` and
`hermes-agent 41dfcf2c1bd7146d4ad46aea08b7dd007900602e`.

The skill audit used the downloaded published 2.6.0 executable at
`.commandcode/published-2.6.0/unpacked/application/Ankita.exe` in the release
worktree. Reproduction harness: `.commandcode/research/prove-packaged-skills.mjs`
in the primary checkout; its argument selects that owned executable.

Observed packaged trace:

```text
catalogSize=8
modelRequests=9
completeSkillBodiesInRequests=8
nativeCoreSkillCallable=true
nativeCoreReadNewSkill=true
nativeDiscoveryListsSkillNames=false
restoredAfterAppRestart=true
remoteAIUsed=false
normalProfileChanged=false
```

- Primary checkout: focused skills/browser/root suite **31 passed, 1 failed**.
  The failure was a missing installed `@modelcontextprotocol/node` package when
  importing the desktop engine. It is not a successful full-suite result.
- Release worktree: root/scaffold suite **10/10 passed**; desktop browser,
  fixture and contribution tests **11/11 passed**. The browser test executed a
  real page and read back a field, while the model was a local HTTP fixture.
- Primary checkout: bundled contribution checks **6 checked, 0 errors**; golden
  output checks **6 passed, 0 failed**.
- No application-source change, dependency installation, push or release was
  performed. Existing uncommitted work was preserved.
- No hosted AI's independent skill choice, live WhatsApp call, native Windows
  calling helper, or fully local voice backend was verified.

**Assessment confidence: 87/100.** Positive evidence: actual packaged-app
round trip, restart persistence, complete request capture, and pinned source
review checked against official pricing. Deductions from 100: 5 for no real
phone-call proof, 3 for unverified native Windows calling, 3 for the primary
checkout dependency failure, and 2 for unverified hosted ChatGPT skill selection.

## Final decision: on hold / pending

On 22 October 2026, the user chose to leave this idea for now. Keep these
findings for future reference. The WhatsApp calling integration and the remaining
skill-discovery improvements are not scheduled for implementation. Resume only
when the user asks to return to them.
