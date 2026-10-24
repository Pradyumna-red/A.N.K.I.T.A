# DeepInfer and SPACE: useful upgrades for ANKITA

Checked on 22 October 2026.

**My recommendation: use SPACE for a new work room. Borrow DeepInfer's ideas for clearer actions and better checks. Leave running our own large DeepSeek service for later.**

This is a research report. I read both projects and compared them with ANKITA's current app. I did not install or run either platform, and I did not change ANKITA's app code. The upgrades below are proposals, not shipped features.

## 1. What these two projects do

Imagine ANKITA is a helpful person sitting at your desk.

**DeepInfer helps run the person's AI brain on powerful servers.** It handles the hard work of producing the model's answers. Its current public release supports DeepSeek-V4.1-Flash and needs Linux and certain large AI chips. It is not a small Windows add-on. The public release also leaves out parts needed to run a complete shared online service. [DeepInfer overview](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/README.md).

**SPACE gives the person a separate room for doing computer work.** Inside that room, ANKITA could run programs and change the room's files. A small virtual computer separates that work from the machine hosting it. We would choose which files enter and which results leave. This reduces the reach of a bad command, but it does not make every task harmless. [SPACE overview](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/README.md).

| Question | DeepInfer | SPACE |
| --- | --- | --- |
| What would it improve? | Running an AI model on our own servers. | Where ANKITA runs code and makes files. |
| Can we drop it inside the Windows app? | That would be a poor fit. It needs a separate server setup. | Keep the work rooms on a suitable Linux machine; the Windows app can connect. |
| Does it provide a finished ANKITA screen? | No. | No. We would make the simple ANKITA controls. |
| Does it give us GPT-6 or unlimited ChatGPT? | No. It runs a different model. | No. It provides a place to work, not an AI account. |
| My priority for this startup | Learn from it now; consider hosting later. | Best candidate for a useful new product feature. |

The fit and priority ratings in this report are my judgement. They are not benchmark scores from either company.

## 2. What ANKITA already has

ANKITA already has teammates, file work, commands, browser work, Windows computer control, visible tool activity, Stop, and a way to use a selected ChatGPT conversation. It also has speed-measuring tools. We should improve these parts rather than build them again.

Two gaps matter most here:

- ANKITA's normal commands run on the user's machine. File rules help, but they are not a separate computer around every command.
- Command output is kept in a limited in-memory store. ANKITA's saved ChatGPT reply records do not turn every command into a lasting, recoverable work record.

The released app's own [safety notes](https://github.com/akyourowngames/A.N.K.I.T.A/blob/fc59579b46329aac2ff657b6cdea1aea3418626a/docs/guides/audit-verification.md) explain that folder checks are not a full computer boundary. Its [ChatGPT guide](https://github.com/akyourowngames/A.N.K.I.T.A/blob/fc59579b46329aac2ff657b6cdea1aea3418626a/docs/guides/chatgpt-browser.md) explains the existing reply recovery. I kept your separate, unfinished local edits out of the shipped-feature claims.

## 3. Eight upgrades worth considering

### 1. A work room for code and files

**What you would see:** choose a project, send a task, and see “Working in a separate room.”

**Example:** “Use this sales sheet to find the best month and draw a chart.” ANKITA receives a copy of that sheet. Its room does not need your entire Documents folder or your signed-in browser.

**What we reuse:** SPACE's small virtual computers, command running, file access, and room controls. We would connect them to ANKITA through a small separate plug-in.

**Why it matters:** ANKITA can do useful work with a smaller reach into the user's real machine. It also gives different projects separate places to work.

**Work needed:** large for a dependable first version. We must set up the Linux host, file handoff, ownership checks, Stop, limits, and result storage. It is more than copying a folder into the app.

### 2. Turn uploaded data into useful results

**What you would see:** a file goes into the conversation; a chart, cleaned table, or small report comes back with a preview and a download button.

**Example:** “Clean this messy list, remove repeated rows, and show the totals.”

**What we reuse:** SPACE includes a starting room with Python, JavaScript, and data/chart tools. That is useful groundwork. Office document and PDF features would need their own chosen libraries and checks; they are not all ready just because the room exists. [Included work-room software](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/templates/firecracker/recipes/code-runtime/pyproject.toml).

**Why it matters:** users receive something they can keep and use, beyond a chat answer. ANKITA's existing file and review screens give us a place to show it.

**Work needed:** medium after the work room exists. We still need to check file types, sizes, names, and where downloads are saved.

### 3. Try a change on a copy first

**What you would see:** “Here is the result. Here is what changed.”

**Example:** “Fix this website.” ANKITA works on a copy, runs the checks there, and shows a preview. Moving the changes into the real project is a separate step.

**What we reuse:** SPACE's private writable room, plus ANKITA's existing change-review screen. The copy, comparison, and move-back steps are work we must add.

**Why it matters:** experiments can be thrown away without damaging the original project.

**Work needed:** medium to large. We must notice if the original files changed while ANKITA was working. Copying an old result over newer human work would be wrong.

This is not a promise to undo every action. A Windows app edit or an outside message cannot be undone merely by throwing away a Linux room.

### 4. A work record that tells the truth

**What you would see:** clear states such as “Started,” “Still running,” “Finished,” or “Result not confirmed.”

**Example:** the connection drops while a command runs. When you return, ANKITA checks the original job instead of quietly starting it again.

**What we reuse:** SPACE's separate records for rooms, requests, and running programs. We would extend ANKITA's existing work receipts and save command results ourselves.

**The important catch:** SPACE's command stream is live output, not lasting log storage. A reconnect does not replay missed output. A completed program also disappears from its running-program lookup. ANKITA must collect and save the final result when it arrives. [SPACE's output and recovery rules](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/first-sandbox.md).

**Why it matters:** this directly addresses the kind of “it did the work, but could not confirm the ending” problem we have seen.

**Work needed:** medium to large. This should be part of the first work-room release, not left for later.

### 5. Put a project room to sleep and return later

**What you would see:** “Put this room to sleep” and “Open this room again.”

**Example:** stop for the night, then return to the prepared tools and files later.

**What we reuse:** SPACE has ways to pause a room in memory and save a room's state before freeing its active resources. Those two choices behave differently. We should give them plain names and show what is kept. [SPACE's room states](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/architecture.md#lifecycle-and-persistence).

**Why it matters:** less repeated setup and a clearer way to control server use.

**Work needed:** medium to large after basic rooms work. Restoring a saved room depends on compatible server software and saved data. It must be tried before we promise reliable recovery.

Saving a room is not the same as keeping the AI thinking after the desktop closes. That would also need an always-running ANKITA worker on the server.

### 6. Start common tasks faster

**What you would see:** fewer “Preparing your workspace” waits.

**What we reuse:** SPACE can keep ready rooms or start from a saved, already-booted room. When a suitable ready room is missing, it can start normally. [Ready rooms](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/warm-pools.md), [saved starting rooms](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/base-snapshots.md).

**Why it matters:** people feel the wait before work begins. Keeping the usual tools prepared can help.

**Trade-off:** ready rooms use server resources while waiting. Start with a small amount, measure actual waiting and use, and expand only when worthwhile.

**Work needed:** medium once the service is working. This is a later speed improvement, not the first thing to build.

### 7. Make action requests clearer

**What you would see:** fewer failures because an AI left out a needed detail or sent the wrong kind of value.

Think of a request as a form: action, target file, and required details. DeepInfer can make the model fill certain answer shapes. Its actual implementation uses XGrammar for this. [How DeepInfer shapes answers](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/deepinfer/structure_output/compiler.py).

**What we reuse:** the design idea. We would use answer-shape controls offered by the chosen model service and check requests inside ANKITA too. Copying the Python part into ANKITA cannot control how ChatGPT produces its answer.

**Why it matters:** clearer requests can reduce avoidable failures. Correct shape still does not prove the requested file or action is the right one, so existing target and permission checks remain useful.

**Work needed:** medium. Support differs by model service. ANKITA already sends action descriptions and performs checks; this is a stronger shared layer around those existing parts.

### 8. Measure useful work, not just fast text

**What you would see:** a small, repeatable set of everyday tasks used to judge each release.

Use tasks such as saving a new note, editing and reading back a file, making a correct chart, cancelling a job, and recovering after a connection loss.

**What we reuse:** DeepInfer's habit of checking repeatable results and measuring separate parts of a request. Its examples also distinguish reported speed from the assumptions behind that speed. [DeepInfer's measurement notes](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/examples/README.md).

ANKITA already measures some waiting and reply times. Extend that with task success, wrong actions, repeated work, and whether the final result was checked.

**Why it matters:** a fast wrong answer is still a bad result. We need evidence that an upgrade helps users finish work.

**Work needed:** small to medium. This can start before the larger SPACE connection.

## 4. What I would take from DeepInfer now

Take its approach to clear answer shapes, repeatable checks, and careful speed measurement.

I would keep its model-running engine outside the Windows app. Its supported chips and Linux setup make it a server project. DeepSeek's own deployment guide describes large groups of AI chips, along with other service parts that are not fully released. [Deployment explanation](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/doc/inference_deployment_qa.md).

If ANKITA later needs to run its own DeepSeek service, DeepInfer becomes a serious candidate. We would still need a model-service connection, request limits, security, streaming, recovery, and measurements on the hardware we actually use.

It would not make the current ChatGPT website answer faster. We do not run that model's servers.

Two traps to avoid:

- DeepInfer can draft several answer pieces and check them together. That is a model-speed trick. It is not permission to guess several desktop clicks and run them unchecked.
- Its tricks for reusing earlier model calculations are not instructions to throw away ANKITA's task history. They work inside a particular model-running system.

## 5. How I would connect SPACE

Keep ANKITA as the friendly desktop app. Run SPACE on a separate suitable Linux machine. Put a small connector between them that uses ANKITA's existing plug-in system. The connector asks SPACE to create rooms, run work, return files, stop jobs, and save results.

This follows your preference for separate plug-ins doing the actions. SPACE's normal web connection is enough for this approach; we do not need to embed its Rust services inside the Windows app.

Keep two clear places for work:

- **Your computer:** the existing Windows apps and pointer.
- **A work room:** copies of selected files and programs running on Linux.

SPACE's current implemented room system is Linux-based, even though its design has names for other systems. It is not a ready replacement for controlling your existing Notepad, Chrome profile, or other Windows apps. [Current supported environments](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/execution-environments.md).

## 6. The parts that need care

**This is more than a free download.** The code is available, but servers, storage, upkeep, and any AI model use still cost money. I have not measured a monthly price for our workload.

**The server needs special support.** SPACE's documented setup needs Linux and the ability to run small virtual machines. Installing ordinary Docker on every customer's Windows machine is not enough to establish that it works. A server connection would keep this setup out of the normal Windows installer. [Host requirements](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/installation.md#prepare-your-environment).

**Early software can change.** SPACE describes a public baseline before its stable 1.0 promise. Some save-point and rollback controls are still experimental or hidden. We should use a fixed tested version and keep the first feature set small. [Version promises](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/versioning.md).

**A saved file is not always a lasting backup.** SPACE documents that a completed file write is not guaranteed to survive every crash. Important results should be copied into lasting storage and checked before ANKITA says they are safely kept.

**Its compatibility shortcut has limits.** SPACE can work with certain existing E2B Python clients. Its docs do not promise the same coverage for the JavaScript client, and the ready-made MCP option on that compatibility path is explicitly unsupported. Use SPACE's normal connection for our first connector. [Compatibility limits](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/docs/ecw.md).

**A room only protects the work kept inside it.** Sending an email, publishing a site, or controlling Windows still reaches outside. We should not describe those effects as reversible just because some preparation happened in a room.

Both projects publish their main code under Apache 2.0. Reusing code means keeping the required licence and credit notices, marking changes as required, and checking the separate terms of included parts and model files. [DeepInfer licence](https://github.com/deepseek-ai/DeepInfer/blob/9bd9cf243fc53ef9afbf8f04d391d989117d6ab9/LICENSE), [SPACE licence](https://github.com/perplexityai/SPACE/blob/d1abc66fe48bccaaa715e09593f875f7c6c4d11d/LICENSE).

## 7. My recommended build order

1. **Improve the existing foundation:** clearer action requests, lasting command results, and the same small set of real tasks for every release.
2. **Try one SPACE room:** one user, one project, chosen files only, one new output file, a checked ending, and a working Stop button.
3. **Make it useful:** cleaned tables, charts, downloadable results, and changes tried on a copy.
4. **Make returning easier:** sleeping rooms and carefully checked wake-up. Add ready rooms only after measuring the wait and cost.
5. **Consider bigger server work later:** separate rooms for more teammates and, if demand justifies it, our own DeepSeek service using DeepInfer.

The first SPACE trial should prove that the original files stay unchanged, another project cannot see the room, a requested stop really stops work, and a lost connection does not quietly repeat an action. Those checks would tell us whether the connection is worth expanding.

**The first product feature I would choose is: “Give ANKITA a file, let it work in its own room, and get a checked result back.”** It is easy to explain, useful in daily life, and builds on ANKITA's current strengths.

## Research confidence

**Confidence: 89/100.** Plus: I read fixed versions of both projects, their setup and limit notes, relevant implementation, examples, and ANKITA's existing paths. Minus: I did not run SPACE on a suitable Linux machine, run DeepInfer on its required AI chips, or measure hosting cost and real task speed. A small live SPACE trial is the next step that would raise confidence.
