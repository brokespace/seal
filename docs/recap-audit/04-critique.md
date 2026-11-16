# Session recap overhaul: critique

An independent review of [the audit](./01-pipeline-audit.md), [the baseline](./02-scenario-baseline.md) and [the design](./03-overhaul-design.md), made before any builder starts. No product code is changed.

It adds to the suite: 27 scenarios ([what was added](#scenarios-added)), blind labels for all 79 with a tune and a held-out split ([the suite, restructured](#the-suite-restructured)), and one command that measures each candidate judge against the labels, Clef included ([judge candidates](#judge-candidates-glm-gemma-and-clef)). The measurement itself has not been run: it needs the credential on `kessel-ml` ([what to run](#what-to-run-on-kessel-ml)).

Code references are to `seal/all` at 337b623c08a, which has no recap change since the audit's 7a6dc74d5d2. "Design :N" is a line of `03-overhaul-design.md` at 24250c0e454.

The eight decisions at the end of the design are settled: Brian took every recommended default. This review does not reopen them. It lists, per decision, what would make it backfire as the design is written ([the eight decisions](#the-eight-decisions)).

## Verdict

The audit's mechanisms are real and its line references hold. The design's direction is right: status belongs on the request, the host owns it, and the turn state comes from the host.

As written, though, the design does not yet guarantee the thing Brian asked for, and in the most common case it makes the guarantee weaker than today's:

- Today a request shows as not addressed only when the model volunteers it, which it does in 1 of 56 samples. In the design every request has a status, the status starts as open, and it leaves open only when the model produces a citation that the host accepts. Every failure of that chain (a wrong tag, a paraphrased quote, a background subagent, a reply the strict parser refuses) now ends on the open side, where "Not addressed" lives.
- The recorded replies say that chain fails often. In the 355 recorded replies, 29 of the default model's 113 requests cite an agent message or no message at all. The design drops such a request (design :93).
- The headline number the design is built on, "33% of addressed requests stay listed", is measured on recaps seeded by hand. None of those 26 requests can be produced by the pipeline from the scenarios. Nobody has looked at a recap from Brian's machine.

Scored against Brian's decision-model-design skill, the judge has three more faults of the kind the skill ranks highest: the alarm is raised on a bundled verdict, no threshold was measured on data it was not tuned on or tied to a model, and there is no must-keep set, with eight named cases the design would lose ([the scoring](#scored-against-the-decision-model-design-checklists)).

Seventeen changes are needed before builders start. None of them changes the direction or any of the eight decisions.

## Required changes

"Must" blocks the builders: without it the design either still shows addressed requests as not addressed, or two workstreams cannot proceed in parallel. "Should" can be settled inside a workstream.

### Must

|     | Change                                                                                                                                                                                                                                                                                                     | Why, in one line                                                                                                           | Evidence                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| M1  | "Not addressed" needs an explicit judge verdict of open, made after the request's turn ended, with no rejected proposal for that request in the same pass. A request the read step returned as open, or one nobody judged, is "Open". Store what the rule needs on the request.                            | The default flipped from "silent unless the model flags it" to "flagged unless the model proves it".                       | [The default flips](#the-default-flips)                                             |
| M2  | A failed host check degrades, it does not drop. A request whose quote is found in another user message of the pass is attached there; a status whose tag is valid and whose quote is not found holds the request at "Open". Add a threshold: the host rejects under 5% of proposals on the probes.         | 26% of the default model's request tags are wrong today.                                                                   | [Citations at today's accuracy](#citations-at-todays-accuracy)                      |
| M3  | Say what "the turn has settled" is for every status. `waiting-subagent`, `waiting-task` and `needs-permission` are not settled; a user message sent mid-turn belongs to the running turn.                                                                                                                  | The scheduler treats a turn parked on a subagent as ended and runs the turn-end pass.                                      | [Background work](#what-the-audit-missed)                                           |
| M4  | Complete the state machine: transitions out of `declined`, `withdrawn` and `partly`; reopening only when the user says it is not done, never because they ask about it or mention it; one user message withdrawing several requests; withdrawing a standing rule.                                          | Four of the new scenarios have no defined outcome in the design.                                                           | [Gaps in the state machine](#gaps-in-the-state-machine)                             |
| M5  | Delete the host rule "a user message right after an agent turn that ended on a question answers it" (design :83). Keep the question-tool result as the only host-alone answer.                                                                                                                             | It breaks `question-left-open`, which passes today.                                                                        | [Gaps in the state machine](#gaps-in-the-state-machine)                             |
| M6  | Two requests are the same when they come from the same message and the same quote, not the same message (design :87).                                                                                                                                                                                      | One message with five requests would become one request.                                                                   | [Gaps in the state machine](#gaps-in-the-state-machine)                             |
| M7  | The judge closes a request of any age. The 20-turn limit (design :113) only stops "Not addressed" from being shown. Say what the judge sees for a request older than its window, and redo the cost figure with a full window.                                                                              | A request done after turn 20 stays open for good, and a judge request costs three to four times the design's figure.       | [Long sessions](#long-sessions)                                                     |
| M8  | Failure handling: the fallback on an unusable reply is the engine's choice of model, passed as a call option, not a rule inside `UtilityModelService.run`; retries of a held span are bounded; the two-failures path reuses `recapFallbackDelta` and its requests merge with the model's when it recovers. | `run` returns text and cannot know a reply is unusable; a held cursor with no wait is a loop.                              | [When the model fails](#when-the-model-fails)                                       |
| M9  | Never answer the read step from a cache. A cache is right for the judge only, keyed on the request and the conversation it is asked about.                                                                                                                                                                 | Refresh on an unchanged session would return the same recap, which is when the user presses it.                            | [Size and reuse](#size-and-reuse), [running it](#6-running-it)                      |
| M10 | One additive interface commit from A before anything else, with the proposal types, the display function and the stored fields in it. `session-recap-transcript.ts` moves to B. One owner for the suite's check vocabulary. Assign the 25 files nobody owns.                                               | A and B import each other's files; A's first commit as described breaks typecheck for B, C, the suite and the E2E helpers. | [Ownership](#ownership)                                                             |
| M11 | Negotiate the version by client capability, not by an `accepts` parameter. Change the brief only by adding fields.                                                                                                                                                                                         | The recap methods take strict params: an older host rejects the new key.                                                   | [Ownership](#ownership)                                                             |
| M12 | Scheduling: one pass per turn end, not per registry stamp; do not run three passes at once against one account; the budget is per provider.                                                                                                                                                                | Three rate limits in a row pause the provider until the next UTC day, for session summaries too.                           | [Decision 6](#6-a-pass-at-every-turn-end-and-higher-tiers)                          |
| M13 | The judge asks one question per criterion about one request and the conversation after it. Each question has its own action and its own threshold, and code combines the answers. "Not addressed" has its own question; it is not what is left when the others say no.                                     | Today's design raises the badge on the answer the model gives when it is unsure.                                           | [The scoring](#scored-against-the-decision-model-design-checklists)                 |
| M14 | Replace the sample thresholds (design :290-295) with: thresholds set on the tune split of the labelled suite, results reported on the held-out split, and both pinned to the model and the wording they were measured with. A rate limit must not move the judge to a model with no pinned thresholds.     | "0 of 78 samples" fails more than half the time at a true rate of 1%, and proves little when it passes.                    | [Calibration](#5-calibration-and-measurement), [the suite](#the-suite-restructured) |
| M15 | Each of the eight must-keep cases is either fixed or held at "Open" by a host rule, with a scenario that shows it. A request whose evidence the host knows to be incomplete is never "Not addressed".                                                                                                      | These are requests that were done and that the design would list.                                                          | [Must-keep cases](#must-keep-cases-the-design-loses)                                |
| M16 | Reader work goes into a workstream: a recap cursor that survives a fork or resume; background subagent results; current Codex tool calls; rows that are not requests kept out of the user's lines. "A and B do not edit the readers" (design :341) goes.                                                   | Three of the eight must-keep cases are in the readers.                                                                     | [What the readers lose](#what-the-readers-lose)                                     |
| M17 | Write the policy for the four cases the labels had to settle: a compound ask half done; an ask the agent declined whose alternative the user took; an ask waiting on the user's answer; "don't touch X" said mid-turn.                                                                                     | Labels follow policy. Until it is written, the judge is tuned to this review's choices.                                    | [Labelling rules](./labelling-rules.md#where-the-rules-had-to-choose)               |

### Should

|     | Change                                                                                                                                                                           | Evidence                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| S1  | Before B tunes a prompt, read one real `session-recaps/recaps.json` from Brian's machine with the transcripts of two sessions where he saw the fault.                            | [The headline number](#the-headline-number-is-not-from-the-pipeline)   |
| S2  | "0 samples" needs enough samples to mean something: 300 clean-turn samples, not 64.                                                                                              | [Test strategy](#test-strategy)                                        |
| S3  | The suite's checks run against the version 1 recap the design already derives for old clients, so no scenario file is rewritten.                                                 | [Test strategy](#test-strategy)                                        |
| S4  | First recap of a long session: say which three chunks, and do not read less than Refresh reads today.                                                                            | [Long sessions](#long-sessions)                                        |
| S5  | User marks carry over by the request's source message, not by its text.                                                                                                          | [Size and reuse](#size-and-reuse)                                      |
| S6  | Cut from the first version: the in-memory turn digests, `did.requestId`, status and evidence on questions and action items.                                                      | [Size and reuse](#size-and-reuse)                                      |
| S7  | The remote switch of decision 7 does not need PR #54's registry sources. Take it out of workstream D's queue, and settle it before B finalises the scheduler.                    | [Overlap with open PRs](#overlap-with-open-prs)                        |
| S8  | Build activity lines, turn boundaries, question handling and concurrency on the code that already does them, and fix `sameText` for non-ASCII text before it decides duplicates. | [Size and reuse](#size-and-reuse)                                      |
| S9  | Extend the redactor for command lines before any is sent, and say in the design that the guarantee is best effort.                                                               | [Decision 3](#3-send-paths-redacted-command-lines-and-commit-subjects) |
| S10 | `tests/e2e/session-services-chat-summary-recap.spec.ts` and its stub change in the same PR as the prompt. It runs in daily CI and asserts the version 1 recap.                   | [Test strategy](#test-strategy)                                        |
| S11 | A person reads the 59 labels that are not `done` or `working` before any threshold is used to ship.                                                                              | [The suite](#the-suite-restructured)                                   |

## Root causes

### What holds

Every finding I re-read against the code is as the audit says. The ones the design leans on most:

- A not-addressed entry leaves only when the model names its id (`session-recap-merge.ts:118-170`, `RESOLVABLE` at :29), and the user can only hide it.
- The model sees prose only: a message that is a tool call, a command or an agent start is skipped (`session-recap-transcript.ts:115`).
- The turn-end pass waits out four minutes since the last pass (`live-session-recaps.ts:242`), and opening the recap starts a pass only when the last one is over 60 seconds old (:170).
- The parser accepts a reply that has any one known key (`session-recap-delta.ts:94`, :121) and drops the rest in silence.
- The cursor advances whatever the reply was (`session-recap-engine.ts:211`).

### The headline number is not from the pipeline

The design's root-cause table opens with "an addressed request stays listed in 33% of samples" (design :13) and gives it again as the reason for the two-step pass (design :111). That number comes from the resolve probes. The baseline says so in a caveat (`02-scenario-baseline.md:19`): the model so rarely lists an open request that the probes start from a recap with the request already put in the list by hand.

I checked how far that goes. None of the 26 resolve-probe requests equals a request in any cassette, so no scenario reaches that state through the pipeline. In the pipeline, with the real replies:

- an open request is listed in 1 of 56 default-model samples and 0 of 28 on the fallback (`evidence/variance/summary.json`);
- the entries that do get into the list are a request the agent declined (`declined-with-a-reason`; two of four further samples tried to list it too and were saved only because the lists were in the wrong place), deferred work filed under the wrong heading (`partly-addressed-then-finished`), and one correct listing.

So the recorded evidence for how a wrong entry appears on Brian's screen is thinner than the design suggests, and it points at declined and deferred requests and at passes made mid-turn at least as much as at a missed `resolve`. The design covers those too. But builders will tune prompts against the probes, and the probes weight the wrong mechanism. S1 is cheap: the store is one JSON file under `userData/session-recaps/`.

### What the audit missed

Each of these changes what the design has to specify. The first two are reproduced by scenarios added here and fail today.

**A reply with its lists in the wrong place is taken as an empty recap.** The audit records that such replies lose content (F8 to F10). It does not record the worst case: the model answers a clean first turn with `"asked"`, `"did"` and the rest at the top level and `"resolve": ["firstRequest"]`. This is a real reply, sample 56 of the variance set. `resolve` is a known key, so the reply is accepted; nothing under `add` exists, so nothing is recorded. The pass reports `updated`, the recap is ready, not behind, and empty. Lists at the top level are 30 of 172 default-model replies (`summary.json`). Scenario: `reply-lists-in-the-wrong-place`.

**After activity with no prose, the recap is behind for good.** A compaction, or any record that carries no prose, moves `lastActivityAt`. The pass that follows reads nothing to summarise, moves the cursor and returns `current` without touching `updatedAt` (`session-recap-engine.ts:155-173`). The recap is behind while `lastActivityAt > updatedAt` (`live-session-recaps.ts:162`), so it stays behind until the next prose arrives, and every time the user opens it more than a minute later another pass runs and changes nothing (:170). F26 has this for a relaunch only. The design's "behind means messages beyond the cursor" (design :82) fixes it, but the design also makes "behind" suppress every chip and show "Checking" on the row (design :275), so the definition has to be right on every host, including one that never runs a pass by itself ([decision 7](#7-the-servers-recap-is-the-only-recap)). Scenario: `nothing-said-since-the-recap`.

**Background work counts as the turn being over.** `isSettledLiveSessionStatus` is true for `waiting-subagent` and `waiting-task` (`live-session-status.ts:83-99`). The scheduler therefore runs the turn-end pass, kind `auto`, 2.5 seconds after the agent parks on a subagent (`live-session-recaps.ts:100-115`), and only a `working` pass carries the still-working sentence (`session-recap-engine.ts:194`). A probe of the scheduler confirms it: working, then `waiting-subagent` at 20 s, gives an `auto` pass at 22.5 s. `needs-permission` is neither running nor settled, so it clears `workingSince` (:100-106) and the turn looks new when the user approves. The design's turn state mentions only "the session is working" (design :65, :81).

**The model treats `firstRequest` as an id.** `"resolve": ["firstRequest"]` appears in the sample above. `resolve-wrong-id` is the commonest fault in the set: 57 of 172 replies (`summary.json`). The design removes `firstRequest` and ids from the read step, which is right. The judge step still gets ids, so the same fault has to be counted there.

**The budget is in Workers AI neurons whatever the provider.** `estimateRecapNeurons` knows two models and charges any other at the dearer rate of each side (`session-recap-budget.ts:9-15`). The tiers (:21-23) then stop passes on a provider that has no such allowance: OpenRouter, an OpenAI-compatible host, or the agent CLI provider, which starts a CLI process per request. The design keeps the tiers and raises them (design :266).

**The compaction summary is not read.** For Claude the summary a compaction writes is not a message the digest keeps, so a request made before a compaction and not yet in the recap is lost with the history. No cassette contains a compaction summary. The design does not say whether the judge window crosses a compaction.

### What the readers lose

Found by running the transcript readers on the recordings in the repository. The first three can each produce a false "not addressed". The design fixes none of them and rules out the work ("A and B do not edit the readers", design :341).

- **A forked or resumed Claude session skips its first new turn.** A fork folds the old file into the new one and the recap moves with its cursor unchanged (`live-session-recaps.ts:83-85`, `session-recap-store.ts:112-120`). The cursor is a byte offset into the old file (`session-recap-engine.ts:211`, :228). In the repository's own pair of recordings, `claude-2.1.325-fork-of-errored.jsonl` copies the history without three metadata lines, so every offset shifts: after a pass on the original the cursor is 5302, and reading the fork from 5302 returns nothing, although the fork's new request is at 4622 and its answer at 5196. The request and the work are never read. The design keeps "move-on-resume" (design :235) and extends it to Codex (design :334). The suite passes because its `resume` step copies the file byte for byte.
- **A background subagent's result is in nothing the recap reads.** The parent's tool result is "Async agent launched successfully". The result arrives later in a task-notification record, which the decoder drops (`transcript-line-decoders-claude.ts:121-128`, :159-180), and the subagent's own file is never read. "The launch and the subagent's final message count as activity of the parent's turn" (design :128) works for a foreground agent only.
- **Rows that are not requests reach the model as the user's lines.** A bare `[Request interrupted by user]`, a `!` shell command (`USER: !git status`) and an image-only prompt are all digested as user messages. Each is a request nobody will address. The status code already filters the interrupt (`claude-transcript-phase.ts:51`, :60-61); the recap's reader does not.
- **A chat's recap changes key on `/clear` and on rewind.** The row id is built from the provider session id, which a clear or rewind replaces (`claude-structured-session-id.ts:4-18`). The recap and the user's dismissals stay under the old key, and the new one reads the same journal again. The design's `/clear` floor (design :334) stops the re-read and not the lost marks.
- **A request given through a slash command, or inside a code fence, is lost.** `/fix-issue 412 and also add a regression test` is removed whole, arguments included (`live-transcript-cleanup.ts:11`, :48-57). A message that is only a fenced block gives no entry, and an unclosed fence takes the rest of the message with it (`session-summary-text.ts:9`, :12-23). These lose requests; they do not raise a false alarm.
- **Activity lines cannot be built for current Codex from the readers the design names.** Every tool call in the 0.162.1 and 0.166.0 recordings is a `custom_tool_call` named `exec` holding JavaScript. `toolFilePath` and `toolInputCommand` return nothing for it, `isEditToolName` is true for `exec`, `shell` and `local_shell`, and `isCommandToolName` is false for `exec`. The file and command are in `item_completed` records the live decoder ignores (`transcript-line-decoders-codex.ts:157-159`). A failed command is invisible on Codex: the exit code is inside text.

## Does the design remove the false "not addressed"?

### The default flips

Today the only way onto the list is for the model to put a request there. On a clean turn it does not: 64 of 64 samples (design :111). That is the one thing the current recap gets right, and it gets it right by saying nothing.

The design gives every request a status. A new request is `open` unless the same reply also proposes `addressed` with a citation the host accepts (design :93-98, :108). It is then displayed as "Not addressed" when the turn has settled, the recap is current, "the last pass judged it with its evidence window complete" and no activity matches (design :67).

For the commonest case, a request made and done in one turn, the request is new in that pass, so the judge step does not run for it (design :109: "only when something was open before the pass"). Its status comes from the read step alone. If the read step returns it without a status, or with a citation the host rejects, the design as written can call it "Not addressed": the turn is settled, the recap is current, and whether a read-step status counts as "judged" is not said. The 64 of 64 does not carry over, because it measures a model that almost never uses the list.

M1 closes this by construction instead of by threshold: only an explicit `open` verdict from the judge step, on a pass after the turn ended, can produce "Not addressed". A new request waits one judge step. The cost is one more request on turns that leave something open, which are the minority.

The display rule also needs data that clients do not have. `recapRequestDisplay(request, recap, session)` runs on the phone, which has no transcript, so "judged with its window complete" and "no activity matches" have to be stored on the request. The data model does not list them (design :22-59).

### Citations at today's accuracy

The design's host checks are: the tag exists, the role is right, the quote is found (design :93-98). A request that fails is dropped; a status that fails is dropped and "the request stays as it was", which is open.

The current prompt already asks for a `ref` tag on every item, so the recorded replies measure the first two checks. Over the 258 variance samples and the 97 cassette replies, items under `add`:

|                                                         | Default model (glm-4.7-flash) | Fallback (gemma-4-26b) |
| ------------------------------------------------------- | ----------------------------- | ---------------------- |
| Request cites a user message                            | 84 of 113                     | 17 of 20               |
| Request cites an agent message                          | 26                            | 3                      |
| Request cites a tag that does not exist, or none        | 3                             | 0                      |
| Work item cites an agent message                        | 223 of 274                    | 107 of 110             |
| Work item cites a user message, an unknown tag, or none | 51                            | 3                      |

So at today's accuracy the host would drop 26% of the default model's requests and 19% of its work items before any quote is compared. The quote check is new and comes on top. The design's own threshold, "a first pass records the request: at least 95%" (design :295), cannot be met while a wrong tag drops the request.

Two things follow. A wrong tag with a quote that is found in another message of the pass is recoverable, and the host should recover it (M2). And a status proposal that fails its check is a sign the model thinks the request was handled: it must hold the request at "Open" for that pass, never let it fall through to "Not addressed".

Quotes will also fail for reasons that are not the model's: the digest clips a long agent turn to its first 600 and last 1,200 characters (`session-recap-transcript.ts:25-29`), the redactor rewrites secrets, and whitespace is normalised. The check has to run against the text the model was shown, not against the transcript.

### Gaps in the state machine

The design defines how an open request gets a status and how `addressed` goes back to open (design :93-99). The scenarios below have no defined outcome.

- **Declined, then the user insists.** The judge step takes "the open requests" (design :109). A declined request is not open, so nothing moves it when the agent then does the work. `declined-then-user-insists`.
- **Withdrawn, then asked again.** Same: no transition out of `withdrawn`. The re-ask is a new request by the read step, or a duplicate of the withdrawn one by the merge rule (design :87), and the design does not say which wins. `withdrawn-then-asked-again`.
- **Partly done, the rest finished without being named.** Whether `partly` is judged again is not said. `rest-of-a-partly-done-ask-finished-in-passing`.
- **Reopening.** "`addressed` goes back to `open` only on a later user message (they say it is not done, or ask again)" (design :99). "Ask again" covers a user who asks whether it was done, or mentions finished work while asking for the next thing. Reopened, with no new work by the agent, it becomes "Not addressed": the reported fault, produced by the rule meant to prevent it. `user-asks-whether-it-was-done`, `finished-work-mentioned-again`.
- **One message withdraws everything.** "Forget the rest" names no request. One user quote has to justify `withdrawn` on several ids. `user-drops-everything-open`.
- **A question the user walks past.** The host rule at design :83 marks a question answered by whatever the user says next. `question-left-open` has the user reply "btw what's the node version in CI?" and expects the question to stay open. It passes today and would fail (M5).
- **Several requests in one message.** "Same source message" as the duplicate test (design :87) contradicts the prompt's own "one entry per request, even when a message holds several" (design :179) and `many-asks-in-one-long-turn` (M6).
- **A standing rule taken back.** A request with `standing` "has no status" (design :41), so it cannot be withdrawn.
- **A second ask sent while the agent works.** Its turn is the running turn. With `request.turn >= turnsSettled` (design :65) a message queued mid-turn can be counted as a later turn than the one that handles it. `second-ask-sent-while-the-agent-works`.

### Long sessions

**The 20-turn limit strands requests.** "A request open for more than 20 turns stops being re-judged and is shown as Open" (design :113). The read step has no ids (design :108), so it cannot close an old request either. A request put off at the start and done at turn 23 stays open for good; when the user asks again, the read step records a second request and the first stays behind. The limit should stop "Not addressed" being shown, not stop the judge from closing. `open-ask-done-after-many-turns`.

**The window is one chunk for all open items.** "The conversation since the oldest open item, newest kept, at most one chunk" (design :113). With one old request and one new one, the window is the newest 12,000 characters and the old request's own message is not in it. "Window complete" has to be per request, and the judge needs each request's source lines as well as the window.

**A full window costs more than the design says.** The cost section takes "8 to 10 neurons" per request (design :266), measured on scenario conversations of a few hundred characters. A 12,000-character window is about 3,400 tokens at the budget's own 3.5 characters per token: 18.9 neurons of input on the default model and 31.2 on the fallback, before the reply (`session-recap-budget.ts:9-15`). The design starts with the fallback as the judge. With one request left open, every pass pays that. The design's day of 300 turn ends with a judge step on half comes to roughly 7,500 neurons, not 4,500, and passes the 6,000 tier.

**The first recap reads less than Refresh does today.** Today a rebuild reads the newest three chunks of 24,000 characters (`session-recap-engine.ts:181-182`, `MAX_CHUNKS`, `RECAP_CHUNK_CHARS`). The design reads "up to three chunks" of 12,000 (design :208, :215). `long-session-first-recap` is about 32,200 characters of digest before any activity line is added, against 36,000. The scenario the design lists as fixed by this (design :382) is at the edge of the arithmetic.

### When the model fails

- **Where the fallback lives.** "Also on timeout, server error, and a reply that fails the strict parser twice. In `UtilityModelService.run`, for every caller" (design :227). `run` returns the reply as text (`utility-model-service.ts:196-199`); only the engine knows it could not be parsed. Falling back on a bad reply, and a model per step (decision 2), both need an option on `UtilityModelClient.complete`, which today takes a request and a signal (`utility-model-host.ts:85-92`).
- **Timeout and server error for every caller.** A timeout is a plain `network` error and a Cloudflare 5xx is `bad-response`; neither is model-scoped, so `run` rethrows (`utility-model-service.ts:205-212`). The OpenAI-compatible provider already marks 408 and 5xx as model-scoped (`openai-compatible-utility-provider.ts:96`). Reusing that flag is the right change, but a model-scoped failure rests the model for 60 seconds (`utility-model-service.ts:47`, :267-272), and that is the model session summaries and reply-asks run on. It must be B's first commit, alone, with its own test.
- **A held cursor with no wait is a loop.** "The cursor does not move; the span is read again on the next trigger" (design :207). With the four-minute wait gone, the next trigger is the next registry stamp. Say how many times a span is retried and how far apart.
- **The two-failures path is `recapFallbackDelta` again.** After two failed passes "the host records the user's lines as requests" (design :207). That is what `recapFallbackDelta` does today (`session-recap-merge.ts:190-215`), and the design deletes it (design :348). Reuse it. When the model recovers and reads the span again, its requests must merge with the host's, by source message. `model-fails-twice-then-recovers`.
- **Strictness.** "An unknown key ... or a missing verdict is a failed reply" (design :206). A missing verdict for one id out of six should leave that one unjudged, not throw away five good verdicts.

### Scenarios added

All are in `src/main/session-recap/scenarios/__fixtures__/scenarios/`, in the suite's own format. The suite now has 79 scenarios and 194 runs.

**Run today, on replies the real model gave** (3 scenarios on 3 surfaces, 9 runs, in `baseline.json`):

| Scenario                          | Today                       | What it pins down                                                                                                                                                              |
| --------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `reply-lists-in-the-wrong-place`  | fails, 2 checks per surface | A real reply with its lists at the top level is accepted as a recap that is ready and empty. The cassette holds variance sample 56 under the request of `addressed-same-turn`. |
| `nothing-said-since-the-recap`    | fails, 2 checks per surface | A compaction at rest leaves the recap behind for good, and each opening runs a pass that changes nothing.                                                                      |
| `dismissed-entry-stays-dismissed` | passes                      | A guard for two things the design could break: a dismissed entry survives a rebuild, and Refresh asks the model again (M9).                                                    |

**Waiting for recordings** (24 scenarios, 50 runs). There is no model credential on this VM, so these carry `pending: true`: each runs up to its first model request and stops. [The command for kessel-ml](#what-to-run-on-kessel-ml) records them with today's prompt and removes the mark. Once a scenario has recordings the suite fails until `pending` is removed and its checks are in the baseline or pass.

The first eleven probe a clause of the design:

| Scenario                                        | The design clause it probes                                                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `subagent-still-running-when-the-agent-stops`   | Turn state on `waiting-subagent` (M3).                                                                                                               |
| `second-ask-sent-while-the-agent-works`         | A message sent mid-turn and `turnsSettled` (M3).                                                                                                     |
| `addressed-later-by-tools-on-other-files`       | An open request closed by activity lines alone, when no path in the request matches the files edited, so the activity veto (design :86) cannot help. |
| `rest-of-a-partly-done-ask-finished-in-passing` | `partly` to done without the request being named (M4).                                                                                               |
| `declined-then-user-insists`                    | A transition out of `declined` (M4).                                                                                                                 |
| `withdrawn-then-asked-again`                    | A transition out of `withdrawn`, and the duplicate rule (M4).                                                                                        |
| `user-drops-everything-open`                    | One user quote withdrawing several requests (M4).                                                                                                    |
| `user-asks-whether-it-was-done`                 | Reopening on "or ask again" (M4).                                                                                                                    |
| `finished-work-mentioned-again`                 | The read step filing a mention of finished work as a new request (M4).                                                                               |
| `open-ask-done-after-many-turns`                | The 20-turn limit and the judge window (M7).                                                                                                         |
| `model-fails-twice-then-recovers`               | The held cursor, the host's own requests, and their merge when the model returns (M8).                                                               |

The other thirteen fill the rare standings, which the suite had too few of to hold out a split ([the suite, restructured](#the-suite-restructured)). Declined, partly done and withdrawn each get the ways they are said in practice:

| Scenario                                           | What happens                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `declined-for-safety-with-an-alternative`          | The agent will not force-push and does the safe half of the message.                  |
| `declined-as-out-of-reach`                         | The agent cannot rotate a key it has no access to, and says so.                       |
| `declined-in-a-terse-reply`                        | A two-word ask gets a one-line refusal, and the user lets it stand.                   |
| `declined-then-replaced-by-what-the-agent-offered` | The agent declines, offers something else, and the user takes the offer.              |
| `partly-done-with-a-failing-step`                  | The first half lands; the second fails and the agent says so.                         |
| `partly-done-and-the-agent-says-which-part`        | Two of three get done and the agent names the third.                                  |
| `partly-done-with-the-rest-blocked`                | One of two languages is translated; the other waits on something the agent lacks.     |
| `partly-done-across-three-turns`                   | Partly, still partly after "keep going", then done.                                   |
| `partly-done-by-a-subagent`                        | A subagent does the finding half of a find-and-fix ask; the fixing waits on the user. |
| `withdrawn-by-a-change-of-plan`                    | The user replaces the request with a different approach.                              |
| `withdrawn-because-someone-else-does-it`           | "marketing will do the notes", said in passing while asking for something new.        |
| `withdrawn-in-spanish`                             | The same, in another language.                                                        |
| `withdrawn-while-the-agent-works`                  | Taken back mid-turn; the agent undoes what it began.                                  |

**Format extensions**, in the suite's fixture files:

- `pending: true` on a scenario, as above. `RECAP_SCENARIOS_PENDING=<file>` still writes these scenarios' requests, so they can be relayed like any other.
- `open: true` on an item check: leave out what the user ticked or dismissed.
- A `mark` step can land on a not-addressed entry, and a `status` step can report `waiting-subagent`.
- A check pattern that is not a regular expression is refused when the scenario loads, instead of throwing mid-run.

## Scored against the decision-model-design checklists

Brian's decision-model-design skill (`plugins/decision-models/skills/decision-model-design/SKILL.md` in `brokespace/claude-skills`) is written for another repository's decision models. Its rule carries over unchanged: **one criterion, one question, one state; code combines the answers.** Its review rule: an unchecked box is a finding. High is an action taken on a bundled verdict, a must-keep item the design can drop, or thresholds never measured on held-out data. Med is a state carrying fields its question does not judge, or a criterion code could decide. Low is wording.

The design's judge is scored below, box by box. The boxes about that repository's own plumbing (its call wrapper, its prompt store, its concurrency setting) are scored on what they are for.

Three High findings, each a required change:

- **The alarm is raised on a bundled verdict** (M13). One reply gives each id one of six statuses, for four kinds of item at once (design :109, judge prompt). "Not addressed" and the badge follow from `open`, which the prompt defines as the answer for everything else: "nothing in the conversation settles it", and "if you cannot quote it, the answer is open". So the one status with a cost to the user is the model's answer when it is unsure. The skill's own experiment with bundled questions measured an AUC of 0.76 and lost must-keep items; one question per criterion did not.
- **No threshold was measured on data it was not tuned on, and none is tied to a model** (M14). B "tunes the wording against the probes" and the thresholds are "over all samples" of the same probes (design :290-295). Decision 2 lets either model end up as the judge, since each is the other's fallback.
- **There is no must-keep set, and the design loses eight named cases** (M15, [below](#must-keep-cases-the-design-loses)).

### 1. Fit: what the model decides and what code decides

| Box                                                                               | Design |          | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything deterministic is code                                                  | Partly | Med      | Turn state, staleness, user marks and activity are code, which is right. The model still handles two catalog facts: the id of each item it judges, and the tag of the message it cites. Both are the commonest faults on record: a wrong id in 57 of 172 replies, a wrong tag on 26% of requests ([citations](#citations-at-todays-accuracy)). One call per request needs no id, and code can find which message holds a quote.                                                                                                                                              |
| A decision that reads wording goes to the model, not to word overlap or a pattern | No     | Med      | Three host rules decide meaning by string: "same request twice: near-identical text after normalising" (design :87), the activity veto "when a path or name in the request's quote matches" (design :86), and "a user message right after an agent turn that ended on a question" answers it (design :83, M5). The first runs on `sameText`, which reduces any non-ASCII text to nothing, so two different Russian or Chinese requests are equal (`session-recap-merge.ts:47-54`). The veto can only suppress the alarm, so it is the safe direction; the other two are not. |
| Each criterion is written down with its action                                    | No     | **High** | M13. The design has statuses, not criteria. Which judgement leads to which action (list it, raise the badge, close it, hide it) is spread over the status rules and the display table.                                                                                                                                                                                                                                                                                                                                                                                       |
| The action fits the remedy                                                        | No     | Med      | "Not addressed" covers three situations with three remedies. Of the 30 labelled open requests-at-a-check, 5 were passed over in silence, 17 the agent said it would do later, and 8 wait on an answer from the user. The last group is already listed as a question, which already raises attention. Showing it as "Not addressed" too tells the user the agent missed something when the agent is waiting on them. Decision 1 stands; this is which open requests it applies to (M17).                                                                                      |

### 2. Questions

| Box                                                                            | Design |          | Finding                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One criterion per question                                                     | No     | **High** | M13.                                                                                                                                                                                              |
| The question names the state fields it judges                                  | No     | Low      | "These items", "the conversation".                                                                                                                                                                |
| The question asks for the defect itself                                        | No     | Med      | The alarm's criterion is the absence of every other finding. A direct question, "is `request` still waiting to be done at the end of `conversation`?", can be scored and given its own threshold. |
| Each side of the criteria is one concrete condition                            | No     | Low      | The read prompt's "open otherwise".                                                                                                                                                               |
| A per-item variable is passed in; the calibrated wording stays fixed           | Yes    |          | The prompts are fixed and the items travel as data.                                                                                                                                               |
| Yes/no for a judgement, a choice among a bounded pool, sameness asked pairwise | No     | Med      | Sameness of two requests is not asked of a model at all (see Fit). If the string rule goes, it is one pairwise question against each open request.                                                |
| The wording is versioned outside code                                          | Partly | Low      | A prompt version is in the cache key (design :233). The measurement needs the same hash on the thresholds (M14).                                                                                  |

### 3. State

| Box                                                                    | Design |          | Finding                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The state holds only what the question needs                           | No     | Med      | The judge sees every open request, question, action item and piece of work, with ids, and the conversation since the oldest of them (design :109, :113). Each verdict is given in the presence of all the others.                |
| Minimal is not missing: every fact the criterion turns on is there     | No     | **High** | M15, M16. The conversation the judge sees lacks work it would need to see: a background subagent's result, tool-only work on current Codex, anything before the 12,000-character window, the span a forked session skips.        |
| Questions share a state only when it is the same state                 | No     | Med      | The same criterion is judged in two places with two states: the read step gives a new request its status from the new messages (design :108), the judge step from the window. Only one of them can be the one that was measured. |
| Context only when the criterion needs it                               | Yes    |          |                                                                                                                                                                                                                                  |
| The state is the words a reader would see, and the rendering is tested | Partly | Low      | `[m7]` tags and ids are internals. The design lists a unit test for activity lines; the rest of the rendering has none.                                                                                                          |
| Well under the size limit; shrink once, then fail                      | Partly | Low      | The window is one chunk and a cut reply is retried on half (design :208). A decision model truncates a long state without saying so ([Clef](#clef)), so the host has to clip, keeping the end.                                   |

### 4. Combining answers

| Box                                                          | Design |          | Finding                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combination is code, written down                            | Yes    |          | The display rule (design :60-68).                                                                                                                                                                                                                                    |
| Each criterion has its own threshold                         | No     | **High** | M13, M14. A chat model's verdict is a category: nothing can be traded between a missed alarm and a false one, per status or at all. The citation check is the only gate, and it fails in the wrong direction ([the default flips](#the-default-flips)).              |
| A failed call takes the safe default, and the run records it | Partly | **High** | The model failing twice is handled as it should be: open, "never Not addressed" (design :207). A failed citation check is not: the request stays open and can be shown as Not addressed (M1, M2). A missing verdict for one id throws away the others (design :206). |
| The reason shown names the criterion and its score           | No     | Low      | "Done" shows its quote. "Not addressed", the only claim with a cost, shows no reason.                                                                                                                                                                                |

### 5. Calibration and measurement

| Box                                                                                                            | Design |          | Finding                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ground truth is a blind, stratified, labelled sample with a reason per label, following the product's policy   | No     | **High** | PR #58 has no labels. A scenario's checks were written by the person who wrote the scenario and then read the model's replies, and `baseline.json` records what fails, not what is true. Supplied here ([the suite, restructured](#the-suite-restructured)). The policy has four gaps the labels had to fill (M17). |
| Held out                                                                                                       | No     | **High** | M14.                                                                                                                                                                                                                                                                                                                |
| Each question scored against the labels for its own reason; one that answers the same for everything is broken | No     | Med      | The design's thresholds are rates of end results. When one is missed, nothing says which judgement failed.                                                                                                                                                                                                          |
| Operating point set for a bounded loss                                                                         | No     | **High** | "0 samples" on 64 and 78 samples (design :291-292). At a true rate of 1%, 78 samples show at least one failure in 54% of runs: the gate is a coin.                                                                                                                                                                  |
| Must-keep guard, with each loss named                                                                          | No     | **High** | M15.                                                                                                                                                                                                                                                                                                                |
| Small samples are flagged                                                                                      | No     | Med      | S2.                                                                                                                                                                                                                                                                                                                 |
| Thresholds are tied to the model they were calibrated on                                                       | No     | **High** | M14, and [decision 2](#2-the-model-per-step-starting-with-gemma-as-the-judge).                                                                                                                                                                                                                                      |

### 6. Running it

| Box                                                     | Design |     | Finding                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------ | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One path for every call                                 | Yes    |     | `UtilityModelService`. The Workers AI provider speaks only chat messages (`cloudflare-workers-ai-provider.ts`); a decision model needs a second request shape there, in B's files.                                |
| Answers are cached on a content hash                    | Partly | Med | This refines M9. A judge's answer about an unchanged request and conversation should come from a cache. The read step's reply must not, or Refresh does nothing. The design has one cache for both (design :233). |
| Spend is reserved before a miss runs                    | Partly | Med | The budget knows two models' rates and charges any other at the dearer of each side (`session-recap-budget.ts:9-15`). Clef's input costs four times the default model's and its output nothing.                   |
| Every call is logged with its model, cost and cache hit | No     | Low | Faults are "dropped and counted" (design :93); calls are not logged.                                                                                                                                              |
| Cost is estimated before a full run                     | Partly | Med | The design's daily figure is low by the judge window ([long sessions](#long-sessions)).                                                                                                                           |

### Must-keep cases the design loses

The must-keep rule for the recap: **a request that really was addressed is never listed as not addressed.** Each case below is one where the design, as written, would list it.

|     | A request that was done…                                             | Why the design lists it                                                                                                                            | Scenario                                                                    |
| --- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | in the same turn, when the read step's citation fails the host check | The request stays open, its turn is over, and no judge has looked ([the default flips](#the-default-flips)). A wrong tag is 26% of requests today. | `addressed-same-turn`, `reply-lists-in-the-wrong-place`                     |
| 2   | by a subagent, while the parent turn is parked on it                 | `waiting-subagent` counts as the turn being over (M3).                                                                                             | `subagent-still-running-when-the-agent-stops`, `partly-done-by-a-subagent`  |
| 3   | by a background subagent                                             | Its result arrives in a record the reader drops ([what the readers lose](#what-the-readers-lose)).                                                 | None yet: the suite has no step for it                                      |
| 4   | in the first turn after a fork or resume                             | The cursor is a byte offset into the old file and skips the turn.                                                                                  | None yet: `resume` copies the file byte for byte                            |
| 5   | more than 20 turns after it was asked, or outside the window         | Not judged again (design :113). It stays "Open", and a second copy is recorded when the user asks again.                                           | `open-ask-done-after-many-turns`                                            |
| 6   | by tool calls alone, on current Codex                                | No activity line can be built from a code-mode `exec` call with the readers the design names.                                                      | `addressed-later-by-tools-on-other-files` covers the older Codex shape only |
| 7   | and then asked about, or mentioned, by the user                      | "Or ask again" reopens it (design :99), with no new work to close it.                                                                              | `user-asks-whether-it-was-done`, `finished-work-mentioned-again`            |
| 8   | when a rate limit moves the judge to the other model                 | Its thresholds, if it has any, are not the ones that were checked.                                                                                 | `model-not-found-fallback`                                                  |

Two more lose the status without raising the alarm: declined and then done after the user insists (`declined-then-user-insists`), and partly done with the rest finished in passing (`rest-of-a-partly-done-ask-finished-in-passing`).

Cases 3, 4 and 6 need reader work, which the design rules out ("A and B do not edit the readers", design :341). Until a reader can see the work, the safe default is the skill's: a request whose evidence the host knows to be incomplete is "Open", never "Not addressed".

## The suite, restructured

The scenario suite in PR #58 checks the pipeline against its author's expectations. To measure a judge it needs ground truth made without sight of the pipeline. This PR adds it. Nothing in the existing scenarios, cassettes or baseline changes.

**Labels.** Every scenario has a file in `__fixtures__/labels/`: the requests in the user's own words, what is not a request, the standing rules, and where each request stands at each check, with a sentence naming the step that decides it. The six standings are `working`, `done`, `partly`, `declined`, `withdrawn` and `open`. [The rules](./labelling-rules.md) are in this folder.

**Blind.** The labellers were given the scenarios rendered as scripts and the rules, and nothing else: no checks, no recorded replies, no baseline, no design. A second labeller did 35 of the 79 scenarios independently, including all 13 new ones, and agreed on all 101 labels, with no request found by one and not the other.

The labellers were instances of the model that wrote this review, not people. Same rules and same model means the agreement measures whether the rules are clear, not whether the labels are right. A person should read the 30 `open` labels and the 29 `partly`, `declined` and `withdrawn` ones before a threshold is trusted. Each is one sentence beside one script.

**Stratified, with a held-out split.** Scenarios are grouped by the rarest standing they reach and each group is divided about three to two. Scenarios that open with the same user message stay on one side, so no conversation is on both. The 13 new scenarios exist to fill the rare groups: before them the held-out side had one declined request, two withdrawn and three partly done.

| Scenarios by rarest standing | Tune   | Held out |
| ---------------------------- | ------ | -------- |
| withdrawn                    | 5      | 4        |
| declined                     | 5      | 2        |
| partly                       | 6      | 4        |
| working                      | 4      | 2        |
| open                         | 12     | 8        |
| done                         | 17     | 10       |
| **All**                      | **49** | **30**   |

A judge is asked about one request at one check. The 79 scenarios hold 153 requests and 267 such labels; scenarios that tell one story under different conditions give the same request and conversation, which counts once, leaving 217:

| Requests-at-a-check      | Tune | Held out |
| ------------------------ | ---- | -------- |
| done (the must-keep set) | 71   | 74       |
| open                     | 17   | 13       |
| partly                   | 6    | 4        |
| declined                 | 5    | 3        |
| withdrawn                | 7    | 4        |
| working (mid-turn)       | 5    | 8        |

**Must-keep set.** All 145 `done` items. The bound is zero on both splits: a model that would list any of them as not addressed, at its own thresholds, is named in the report with the items. The 29 partly, declined and withdrawn items are reported the same way as other false alarms. The 13 mid-turn items are never shown to the user as anything but "In progress", because turn state is the host's; they are scored for what the judge would say if the host got the turn state wrong (M3).

**What the numbers can and cannot show.**

- Zero losses on 74 held-out items bounds the true loss rate at about 4%, and on all 145 at about 2%, at 95% confidence. A measurement of this size cannot show "never". The structural rules do that (M1, M2, M3); the measurement picks the model and the thresholds.
- The rare groups are small. With 3 declined, 4 withdrawn and 4 partly on the held-out side, one item moves a rate by 25 to 33 points. The report says so beside each figure.
- The suite over-samples hard cases and has no weights back to real sessions, because nobody has counted how often each case occurs in one. Its rates are rates on the suite. S1 is still owed.
- A scenario's conversation is a few hundred characters at the median (370; the longest is 23,000). Real sessions are longer.

**The suite enforces it.** `recap-judge.test.ts` fails when a scenario has no labels, when a quote is not in a user message, when a label names a check the scenario does not have, when a group is missing from a split, or when one request and conversation is on both sides or has two standings.

## Judge candidates: GLM, Gemma and Clef

**Nothing here has been measured.** The VM has no Workers AI credential. What exists is the harness, checked end to end against a stand-in for the API, and one command to run on `kessel-ml`. The table at the end of that run is the result this section is missing.

### What is measured

One question per criterion, each about one request and the conversation that followed it (`recap-judge-questions.test-fixture.ts`):

| Question                                                                                           | Yes means | Its action                                     | Loss allowed when set |
| -------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------- | --------------------- |
| `done`: has the agent carried out everything `request` asks for in `conversation`?                 | done      | Show as done                                   | 2% of the rest        |
| `did_part`: has the agent carried out one part of `request` and left another part not carried out? | partly    | Show as partly done                            | 2%                    |
| `declined`: did the agent refuse `request` or advise against it, and not carry it out afterwards?  | declined  | Show as declined                               | 2%                    |
| `withdrawn`: did the user take `request` back?                                                     | withdrawn | Show as withdrawn                              | 2%                    |
| `left_undone`: is `request` still waiting to be done at the end of `conversation`?                 | open      | List under "Not addressed" and raise the badge | none                  |

- **State.** `request` is the user's words. `conversation` is what a reader would see after them: what each side said, the files the agent edited, the commands it ran, what a subagent reported. No ids, tags, statuses or tool output (`recap-judge-state.test-fixture.ts`). Over 24,000 characters it keeps the start and the end.
- **Code decides the rest.** Whether the turn is over is not asked. The answers combine by precedence: withdrawn, declined, done, partly; "Not addressed" only when `left_undone` fires and none of the others does; a failed call is "Open".
- **Thresholds.** Each question's threshold is set on the tune split, at the point where it fires on no more than its allowed share of the items it should not fire on. For `left_undone` that share is zero: on the tune split it fires on nothing that is not open.
- **Reported** per model, on the held-out split: AUC per question against its own standing, with a question that answers the same for everything marked broken; what each threshold catches and what it fires on wrongly; the must-keep items lost, by name; a table of true standing against what the recap would show; tokens, cost, and median and 95th-percentile latency.
- **Pinned.** The answers are saved, keyed on a hash of the model and the request. The thresholds are saved per model with the hash of the question wording. From then on the offline suite fails if the saved answers stop giving the saved thresholds, so a change of wording, state or model is a new run and not a silent change.
- **Chat models** have no probability to return. They are asked for a whole number from 0 to 100 per question in one JSON object. Expect coarse scores with ties; AUC counts a tie as half.

### Clef

Clef is Cloudflare's own decision model, on Workers AI since 1 October 2026 ([announcement](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/), [model page](https://developers.cloudflare.com/workers-ai/models/clef/)). It does not write text. It takes a state and a set of typed questions and returns a probability for each answer.

|                         | Model id                        | Size | Price per million input tokens | Output |
| ----------------------- | ------------------------------- | ---- | ------------------------------ | ------ |
| Clef                    | `@cf/cloudflare/clef`           | 27B  | $0.24                          | free   |
| Clef-flash              | `@cf/cloudflare/clef-flash`     | 9B   | $0.038                         | free   |
| GLM, today's default    | `@cf/zai-org/glm-4.7-flash`     |      | $0.06                          | $0.40  |
| Gemma, today's fallback | `@cf/google/gemma-4-26b-a4b-it` |      | $0.10                          | $0.30  |

How it is called, on the same endpoint and with the same token as the chat models:

```
POST https://api.cloudflare.com/client/v4/accounts/<account>/ai/run/@cf/cloudflare/clef
{
  "model": "clef",
  "state": { "request": "…", "conversation": "…" },
  "questions": {
    "left_undone": {
      "type": "noul",
      "instructions": "Is `request` still waiting to be done at the end of `conversation`?",
      "criteria": { "true": "…", "false": "…" }
    }
  }
}
```

The reply holds `answers.left_undone.noul`, the probability of yes, and the input tokens used. A request can hold up to 64 questions. Besides `noul` there are `choice` (one of a set, with a probability per option) and `score` (an ordered rubric).

What I could and could not establish from here:

- **Found and documented: yes.** The request shape above is from the model page, and the account's model catalog returned Clef's schema.
- **Called: no.** The one tool on this VM that can reach the account refused to send a request to it, and I did not work around that. Whether the account may run Clef is the first thing the command finds out. If it may not, the report says "not callable" with Cloudflare's message, and the other models are still measured.
- **Published latency**, after a speed-up on 9 October: a median of 152 ms and a 95th percentile of 351 ms at about 800 input tokens, 305 and 531 ms at about 3,400, and 1,635 and 1,805 ms at about 16,000. One request with the five questions is about 700 tokens on average, by a character count. Both models take 64K tokens.

What follows from Clef being a decision model, whatever it scores:

- **It can only be the judge.** The read step writes text: requests, work, where things stand. Clef cannot. The read step stays on a chat model.
- **It cannot quote.** The design's guard on a status is a quote the host can find (design :93-98). Clef returns a number. The guard becomes the threshold and the must-keep measurement, and the evidence shown beside "Done" has to come from the host's activity lines or be left out.
- **It truncates a long state without saying so.** The work that closes a request is at the end of the conversation. The host must clip, keeping the end; the harness does.
- **Cost.** At about 700 input tokens per request judged, Clef is roughly 15 neurons, Clef-flash 2.4, GLM 5 and Gemma 7 including their replies. On a 3,400-token window Clef is 74 neurons against GLM's 19. Clef-flash is the cheapest of the four and Clef the dearest by a wide margin; the tiers in decision 6 were sized for neither.
- **The provider** has no request shape for it, and the budget no rate ([running it](#6-running-it)).

### What to run on kessel-ml

In a Seal checkout with dependencies installed, on this branch:

```
git fetch origin cursor/recap-critique-1248 && git checkout cursor/recap-critique-1248
node config/scripts/session-recap/record-and-measure-recap-models.mjs
git add src/main/session-recap/scenarios docs/recap-audit/evidence
git commit -m "Record the waiting recap scenarios and measure the judge candidates"
git push
```

The credential is `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` when both are set, otherwise `~/.config/seal/cloudflare-ai.json`. The command prints which of the two it used and never the value. Cloudflare's error text is written with the account id replaced.

What the one command does, in order:

1. Sends one small request with the credential. If Cloudflare turns it down, it stops there and nothing is written.
2. Records the model's replies for the 24 scenarios that have none, with today's prompt, and updates `baseline.json` and the evidence matrix. Scenarios that already have recordings are replayed, not re-recorded.
3. Asks each of the four models the five questions about each of the 217 labelled items: 868 requests, four at a time. A model the account cannot call is asked once.
4. Removes `pending` from the scenarios that now have recordings, and replays the whole suite with no network.
5. Prints the summary table, one row per model, and the files to commit.

Cost and limits, estimated from the request sizes and the published prices, not measured:

- About $0.08 in all, or about 7,600 neurons: Clef 3,300, Gemma 1,700, GLM 1,200, Clef-flash 500, and under 1,000 for the scenario recordings. **On the free allowance of 10,000 neurons a day that is most of a day**, on the account Seal's own recaps and summaries use. To leave Clef for a second day: `RECAP_JUDGE_MODELS=clef-flash,glm-4.7-flash,gemma-4-26b-a4b-it node config/scripts/…`, then the same command without it.
- The judge run stops before its first request if the estimate is above `RECAP_JUDGE_MAX_USD` (default 1).
- Ten to fifteen minutes, by my estimate.
- It can be run again at any point. Every answer received is on record, so a second run asks only for what is missing. If a request to the recap model goes unanswered after four tries, the run fails and leaves the baseline and the matrix as they were.

The result is `docs/recap-audit/evidence/judge/report.md`. What to read in it, in this order: the must-keep column (anything but 0 rules the model out at these thresholds); "Not addressed, caught", which is how many of the 13 held-out open requests the model would list; then cost and latency. A model with no must-keep loss that catches few open requests is safe and not useful; that is the trade the thresholds make visible.

## Size, reuse and ownership

### Size and reuse

- **The reply cache (design :233) should go.** Its three uses do not hold up. "Refresh on an unchanged session" is a full recompute by design :216, and a cache keyed on the request text answers it with the reply that produced the recap the user is refreshing. "Recompute after a restart" is already served by the store. "Re-judging when nothing in the window changed" is a pass the scheduler should not start. `dismissed-entry-stays-dismissed` expects a second model request on Refresh.
- **Turn digests in memory (design :234).** A pass already reads from the cursor. Keep this out until a profile asks for it.
- **`did.requestId`** "filled by the host when the model's work item cites the same evidence as a request's status" (design :59) is a fuzzy join that no display rule depends on. Cut it from the first version.
- **Status and evidence on questions and action items** (design :58) double the state machine. The complaint is about requests. Do requests first.
- **Marks carry over by text** (design :216). A request's text is the model's choice of quote and can differ between two runs over the same message. A dismissed false alarm that returns after a rebuild is the complaint again. Carry by the source message, with the text as the tie-break.
- **Reuse that the design gets right:** the tool readers in `src/shared/native-chat/tools/` for activity, `carryRecapMarks`, the single pipeline for every agent. Reuse it misses: `recapFallbackDelta` (above); the redactor (`sessionProse` already passes prose through `redactString`, `session-summary-text.ts:4`, :11-13), which is where command lines should go too rather than a new one; and the client-capability pattern for version negotiation (below).

**Already in the repository, and not named by the design.** Brian's rule is to reuse. Of fifteen things the design builds, nine exist:

| The design builds                                              | Use instead                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Files edited per turn                                          | `nativeChatTurnDiffs` (`native-chat-turn-diffs.ts:50`), `editFilesFromToolPair` (`native-chat-edit-normalize.ts:197`): every file of a patch, failed edits left out. `toolFilePath` gives the first file only and nothing for a patch envelope. |
| Commands, with exit state                                      | `nativeChatFullCommand` (`native-chat-tool-input-text.ts:38`), `nativeChatToolRunOutcome` (`native-chat-tool-run-outcome.ts:16`). `toolInputCommand` is a preview clipped to 80 characters, so the design's 120 cannot come from it.            |
| PR links                                                       | `nativeChatTurnOpenedPullRequests` (`native-chat-opened-pull-requests.ts:300`). The private copy of the link parsers in `session-recap-transcript.ts:32-58` should go.                                                                          |
| Commits, "sha and subject from the command" (design :86)       | Nothing exists, and it cannot be built as written: the sha is only in the tool's output.                                                                                                                                                        |
| Turn boundaries and `turnsSettled`                             | `nativeChatTurnMembership` (`native-chat-turn-membership.ts:242`), shared by desktop and mobile.                                                                                                                                                |
| The question tool and its answer                               | `parseAskFromToolInput`, `createPendingAskScanner` (`native-chat-ask.ts:122`, :228), `nativeChatReceiptAnswers`. Reading the answer out of a CLI transcript is new.                                                                             |
| "The turn ended on a question"                                 | `replyAskOf` and `LiveSessionReplyAsks` (`live-session-reply-asks.ts:46-155`), which already set the row's status. A rule in recap code would be a third detector that can disagree with the row.                                               |
| The reply cache                                                | `SessionSummaryCache` (`session-summary-cache.ts:23-57`), already used twice.                                                                                                                                                                   |
| One pass per session, three overall                            | `PrioritySemaphore`; the engine already returns the pass in flight per session (`session-recap-engine.ts:113-115`).                                                                                                                             |
| Duplicate requests by text                                     | `sameText` (`session-recap-merge.ts:47-54`), after fixing it: it reduces non-ASCII text to nothing.                                                                                                                                             |
| Path comparison, "case as the platform requires" (design :244) | `normalizeRuntimePathForComparison` (`cross-platform-path.ts:53`). The repository's rule is path syntax, never the client's OS, and for a remote session the host's OS is the wrong answer.                                                     |

The recap's `standing` sentence and the row summary are also nearly the same sentence, written by two model calls per turn end (`session-recap-view.ts:81`, `live-session-types.ts:156-157`). Worth one line in the design on why both stay.

### Ownership

"Four, each with files only it edits" (design :302) does not hold as written.

- **A and B import each other.** A's `session-recap-merge.ts` imports `RecapDelta`, `recapLine` and `RECAP_ITEM_MAX_CHARS` from B's `session-recap-delta.ts` (`session-recap-merge.ts:9`). B's engine calls A's `applyRecapDelta`, `recapFallbackDelta`, `carryRecapMarks` and `digestTranscript`. Nobody owns the type that replaces `RecapDelta`.
- **A's first commit breaks everyone unless it only adds.** Removing `asked` or `ignored` from `RECAP_SECTIONS` (`session-recap-types.ts:10-18`) fails typecheck in B's parser and prompt, C's view and both panels, the suite's fixtures and the E2E helper (`tests/e2e/helpers/recap-baseline.ts:12-13`).
- **`session-recap-transcript.ts` is given to A but decides B's request text.** Any change to the clip sizes (:25-29) or to the digest changes every request, and one unrecorded request fails the suite. Nothing that changes the bytes of a model request can merge outside B's re-record, so the file belongs to B; A supplies pure functions for activity.
- **The suite has two owners.** B owns `scenarios/**` (design :320) and A is told to add tool-call steps there (design :313). Those steps already exist and 51 of the 52 scenarios use them. What nobody is given is the real job: 117 checks in 46 scenario files say `"in": "asked"` or `"in": "ignored"`.
- **`recapRequestDisplay` and `recapAttention` are given to C** (design :325) but B's scheduler needs them to fill the brief (`live-session-recaps.ts:139-144`) and the suite needs them to check "shown as Not addressed". They belong in A's interface commit.
- **Version negotiation.** The recap methods take strict params (`src/shared/rpc-contract/session-recap-params.ts:6-25`), and the renderer hook already works around that (`use-session-recap.ts:48`). An `accepts` key (design :242) is rejected by an older host, and it is proposed for `get` only while `refresh` and `mark` return the same view. The existing pattern is a client capability: `LIVE_SESSION_STATUS_V2_CLIENT_CAPABILITY` and `liveSessionSnapshotForClient` (`src/shared/live-sessions/live-session-status-compat.ts:12-22`, :43-51). It covers all three methods and the brief on the row.
- **The brief** (`LiveSessionRecapBrief`, `session-recap-types.ts:102-110`) is read by older phones (`mobile/src/seal/live-sessions/LiveSessionRow.tsx:43-44`). Add fields; do not change what `questions` and `actions` mean.
- **Files in no workstream** that must change: `session-recap-install.ts`, `session-summaries-host.ts` (builds the scheduler, :104-117), `orcad-session-summaries.ts`, three more files under `src/main/utility-model/`, six unit test files, the E2E stub (it recognises a recap request by the prompt's first sentence, `tests/e2e/fixtures/session-services-claude-stub.cjs:110`, and answers in the old format), two passing E2E specs that assert the `asked` section, the mobile row and its schema, `mobile/src/i18n/seal-overrides/en.json`, and the settings sentence "Only your messages and the agent's replies are sent, never tool output" (`SessionSummariesSettingsPane.tsx:133-136`), which decision 3 makes false.

A split that works:

|                                                                 | Files                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interface commit (A, alone, typecheck green with no other edit) | Version 2 types and schemas beside version 1. A new file with the read proposal, the judge verdict, the digest turn and activity-line shapes, and the signatures of the functions that replace `applyRecapDelta`, `recapFallbackDelta` and `carryRecapMarks`. `recapRequestDisplay`, `recapAttention` and the stored fields they need. The brief's new optional fields. The client capability. |
| A                                                               | `session-recap-requests.ts`, `session-recap-activity.ts`, `session-recap-merge.ts`, `session-recap-store.ts`, their tests, the RPC method and params, the derived version 1 view.                                                                                                                                                                                                              |
| B                                                               | Prompt, parser, engine, scheduler, budget, `session-recap-transcript.ts`, `session-recap-install.ts`, the recap lines of `session-summaries-host.ts`, `src/main/utility-model/`, all of `scenarios/**`, the E2E stub, their tests, `docs/session-recap.md` last.                                                                                                                               |
| C                                                               | The view rows, both component folders, the recap strings in both `seal-overrides/en.json` files, the settings sentence, the mobile row, the baseline specs and `recap-baseline.ts` after B's re-record, one edit in `LiveSessionPane.tsx`.                                                                                                                                                     |
| D                                                               | The desktop skip for server-held sessions, the server target behind an interface in C's hook, `orcad-session-summaries.ts`, reader parity, the new surfaces.                                                                                                                                                                                                                                   |
| Cleanup (A, after A, B and C merge)                             | Remove version 1: `asked`, `ignored`, `RESOLVABLE`, the old delta.                                                                                                                                                                                                                                                                                                                             |

### Overlap with open PRs

None of #53 to #56 is in `seal/all`. The design's table (design :339-344) has the right files for the most part and the wrong conclusions for three of the four.

**#54 registry sources** changes what the scheduler reads, not only files D touches.

- A chat row becomes `alive` only while Seal owns its process (`structured-session-record.ts:133` on the PR). The scheduler skips a row that is not alive (`live-session-recaps.ts:92`), so a chat at rest can lose its turn-end pass. "One last pass when a session ends" (design :228) has to be defined on ended-ness, not on `alive`.
- `surface` and `capabilities` become required on `LiveSession`. The scenario runner builds a row without them (`recap-scenario-runner.test-fixture.ts:70-99`): typecheck fails when #54 merges.
- It adds `liveSessions.transcriptSince`, described on the PR as "what a paired desktop's recap of a chat here reads". That is the opposite of decision 7. After #54 the desktop makes its own recap of a server's chat unless B's scheduler skips server rows.
- The server's brief reaches the desktop row through federation frames, parsed with a schema that drops what it does not know. That is a fourth version boundary the compatibility section (design :237-246) does not list.

**#53 multi-pane** mounts several panes at once, some hidden. The recap hook sends `sessionRecap.get {look: true}` on mount and on every window focus (`use-session-recap.ts:62-67`) whether or not the pane is visible. Today the 60-second rule limits that. The design removes it (design :224), so each window focus starts a pass for every mounted pane that is behind. "Showing the panel counts as a visit" (design :276) needs the hook to know the panel is open, which is an edit to `LiveSessionPane.tsx`, the file three PRs change, and contradicts "mount point and props unchanged" (design :342).

**#55 SSH server install** provisions no utility model on the server and makes the server never idle-exit. Both matter to [decision 7](#7-the-servers-recap-is-the-only-recap).

**#56 sidebar rows** keeps the badge line as it is, so the row needs no edit for decision 5; "it changes W3's row" (design :358) and C's `LiveSessionRow.tsx` item (design :329) can go. What #56 does edit is two fixture files inside C's own folder (`SessionRecap.fixture.tsx`, `SessionRecapJump.fixture.tsx`), which the table misses.

## Test strategy

The suite is the right tool and it is fast: a full replay is 15 seconds wall clock, the recap's main-process unit tests 15 seconds, the renderer and shared recap tests 25 seconds, `pnpm tc` 5 seconds warm. The in-app specs are the expensive part: about ten minutes, because the app has no test clock and the scheduler waits four minutes (`README.md`).

What will waste builders' time as the design stands:

- **Every cassette goes stale on every prompt edit.** The cassette key is a hash of the model and the messages. Each wording change in B's prompt, and each change to the digest, invalidates all 97 recordings, and the suite fails on the first unrecorded request. B must not iterate on the full suite. Tune on a fixed probe subset, freeze the prompt, then re-record once.
- **The E2E specs replay the same cassettes** through the stub. If C flips them before B's prompt is frozen, C flips them again after.
- **The 117 `asked` and `ignored` checks.** Rewriting 46 scenario files while the data model moves is churn. The design already has to derive a version 1 recap for older clients, where `asked` is every request and `ignored` is the requests shown as Not addressed (design :242). Run the existing checks against that derived recap: no scenario file changes, the ratchet keeps its meaning across the change of model, and the compatibility path is tested by 171 runs. New states (declined, withdrawn, in progress) get one new check kind.
- **"0 samples" on 64 samples proves little.** The thresholds "a clean turn produces a Not addressed request: 0 samples" and "addressed ... shown as Not addressed: 0 samples" (design :291-292) are the acceptance test for the complaint. With 16 clean probes at 4 samples, zero failures still allows a true rate near 5%, which at Brian's volume is several false alarms a day. Clean-turn probes are short, about 8 neurons each: 300 samples is about 2,400 neurons and bounds the rate near 1%.
- **A recording is a sample.** With a credential, a builder who gets an unlucky recording can record again until the check passes, and the ratchet goes green on luck. Rule: a scenario is re-recorded only together with all others, on a prompt version; a check that passes on some samples and fails on others belongs in the probe set with a threshold, not in the ratchet.

- **`pnpm check:changed` fans out.** By the CI import graph, a change to `session-recap-types.ts` selects 3,495 test files, and one to `session-recap-merge.ts`, `live-session-recaps.ts` or `utility-model-service.ts` about 2,075. A change to a shared tool reader selects 4,951. It is required before every push, so a workstream pushes once, not per commit. Not run here; the count is from the graph.
- **About 14 of every 15 seconds of `pnpm test` is startup.** Put every path in one invocation.
- **The in-app specs run in no CI lane.** `RECAP_E2E` is set in no workflow, so nothing requires a flip per fix (design :297). Their length is seven waits of five and a half minutes for the second automatic pass (`tests/e2e/helpers/recap-baseline.ts:103`), which the design removes.
- **One spec the design misses does run, daily.** `tests/e2e/session-services-chat-summary-recap.spec.ts` asserts one recap request and the version 1 sections, against a stub that recognises the recap by the prompt's first sentence (`session-services-claude-stub.cjs:110`). The daily suite on main goes red on B's merge unless both change with it (S10).
- **The judge is tuned on saved answers, not on re-recordings.** A probe pins its input, so it depends on no earlier reply and its answers can be saved. A change of wording re-asks the labelled items once, about 900 small requests in parallel for four models, and the thresholds are then read from the saved answers offline. That is what `recap-judge.test.ts` does. One full re-record of the scenarios, estimated at 460 to 540 requests under the design, happens once, after the wording is frozen.

The plan per workstream, with one in-app round at the end:

|                        | On every intermediate head                                                                                                                                     | Never before the end                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| A                      | Unit tests for the state machine and activity lines; `pnpm test src/main/session-recap --maxWorkers=2`; `pnpm tc:node`.                                        | Any E2E; any recording.                          |
| B                      | The probe subset against the live model while tuning; then the scenario replay. One full re-record per frozen prompt version.                                  | The in-app specs.                                |
| C                      | `pnpm fixtures:shot` for each display state; the renderer and shared recap tests.                                                                              | The in-app specs, until B's re-record is merged. |
| Integration head, once | The three `session-recap-baseline-*` specs and the two `session-services-*` specs that touch the recap. With the four-minute wait gone they no longer need it. |                                                  |

## The eight decisions

All eight stand. Each entry says what makes it backfire as the design is written, and which required change removes the risk.

### 1. "Not addressed" only when sure, otherwise "Open"

The rule is right. The design does not yet implement it: a request can reach "Not addressed" without a judge ever calling it open ([the default flips](#the-default-flips)), a rejected citation leaves it open ([citations](#citations-at-todays-accuracy)), a turn parked on a subagent counts as over ([background work](#what-the-audit-missed)), and a user asking about finished work reopens it ([gaps](#gaps-in-the-state-machine)). Blocking: M1, M2, M3, M4, and M13 to M16: the rule is only as good as the judgement behind "the model judged the request open", which today is the model's answer when it is unsure, measured on nothing.

### 2. The model per step, starting with gemma as the judge

- The model is the user's setting, one choice per task: provider, model, fallback (`utility-model-selection.ts:11-23`), read on every call (`utility-model-host.ts:85-92`). A judge on gemma either overrides what the user chose or needs a second setting. On OpenRouter, an OpenAI-compatible host or the agent CLI there is no gemma.
- Either model can serve either step, because each is the other's fallback. The thresholds have to hold for both models on both steps, or a rate limit on one silently moves the judge to the model that failed the threshold.
- The budget knows two models' rates (`session-recap-budget.ts:9-15`), and gemma's input costs 65% more than the default's. The judge is the step with the large input ([long sessions](#long-sessions)).

- **Starting with gemma is a guess until the measurement is in.** The numbers decision 2 refers to do not exist for a judge asked one question at a time, and a third candidate, Clef, is now on the table ([judge candidates](#judge-candidates-glm-gemma-and-clef)). The decision's own rule, pick from the numbers, is the right one; the starting point should be whichever model the held-out table favours.
- **Thresholds belong to a model.** If the judge can fall back to another model, that model needs its own pinned thresholds, or the request waits (M14).

Blocking: the per-step pick applies only on Workers AI and only when the user has not chosen a model; M7's cost figure; M8's call option; M14.

### 3. Send paths, redacted command lines and commit subjects

- The settings pane and `docs/session-recap.md` both say only messages are sent, never tool output. They must change in the same PR as the first request that carries a command line.
- The evidence kinds `commit` (with a sha) and a PR link, and "ran ... (ok)" (design :50, :86, :122), are not in the command: the sha, the exit state and the PR URL are in the tool's result. The design has to say that the host reads results locally and sends only those derived facts, or drop those kinds.

- **The redactor was built for prose.** Passed command lines, it leaves `mysql -u root -phunter2`, `psql postgres://admin:s3cret@db/app`, `docker login --password hunter2` and `aws configure set aws_secret_access_key …` as they are (`redactor.ts:32`, :92-116). It also replaces the whole value of any `NAME=value` prefix, so `RECAP_SCENARIOS_LIVE=1 pnpm test` loses the part that is evidence. The decision was taken on "the same redactor as prose" (design :127), which does not give the protection that sentence suggests.
- **For current Codex there is nothing to send** until a reader exists ([what the readers lose](#what-the-readers-lose)).

Blocking: S9 before the first command line is sent; M16.

### 4. Builders get a Workers AI credential

- If it is Brian's own account, recording competes with his recaps. Today's 97 recordings cost about 960 neurons and the 258 probe samples about 2,500; with two steps, more scenarios and the sample sizes above, one full round is roughly half the free 10,000 a day. A daily-limit refusal pauses the provider until the next UTC day (`utility-model-service.ts:273-277`), for his session summaries as well. Use a separate account or token.
- It makes re-rolling a recording free ([test strategy](#test-strategy)).

- **A full measurement run is most of a free day's allowance**, about 7,600 of 10,000 neurons by estimate ([what to run](#what-to-run-on-kessel-ml)). On the account the app itself uses, a run that exhausts the day stops Brian's own recaps and summaries until the next UTC day.
- The live path now checks the credential with one request before it rewrites anything, never prints it, and does not let an outage into the recordings or the baseline.

Blocking: the recording rule in the test strategy; a separate token or a paid plan for recording.

### 5. "Not addressed" raises the row badge

- It raises the price of every false alarm from a line in a panel to a badge in the sidebar. The design says "once the thresholds above hold" (design :358) but names no switch. `recapAttention` should leave requests out behind one constant until the probe thresholds are met on the frozen prompt.
- The badge count travels in the brief, which older phones read as `questions` and `actions`. Add a field; an older client then shows the old count, not a wrong one (M11).
- A host that recaps only what was opened never raises it ([decision 7](#7-the-servers-recap-is-the-only-recap)).

### 6. A pass at every turn end, and higher tiers

- **The trigger is not a turn end.** The scheduler runs when the pair of status and `lastActivityAt` changes (`live-session-recaps.ts:110`). `lastActivityAt` moves on a compaction, a hook record, a task notification; a turn with background work passes through `waiting-subagent` and back. The four-minute interval is the only thing that makes those one pass today. With activity lines a span of tool calls is no longer empty, so each of these becomes a model request.
- **Three passes at once can end the day's recaps.** "Three at once overall" (design :229). Three account rate limits in a row, with no success between, pause the provider until the next UTC day (`utility-model-service.ts:51`, :273-277). Three passes in flight that are each refused are three in a row. The pause holds every background request of that provider (:108-113), and session summaries run on the same service.
- **The cost figure is low** by the judge window ([long sessions](#long-sessions)).
- **Other providers.** The tiers are neurons. On the agent CLI provider every pass starts a CLI process, and two per turn end with no interval is a real load on the user's machine and their agent quota.

Blocking: M12, M7.

### 7. The server's recap is the only recap

- **A server makes a recap only for a session someone opened.** It is installed with `recapEagerly: false` (`orcad-session-summaries.ts:19-26`), and the scheduler returns early for a session with no recap when not eager (`live-session-recaps.ts:238-240`). With this decision a server session nobody opened has no recap and no badge on any client, so decision 5 does nothing there.
- **A server has no utility model** after an install, and #55 does not add one. The design accepts "no recap for a server session" (design :360). The panel must then say why, with the way to fix it, not show an empty recap.
- **#54 builds the other path**: the desktop reading a server chat's transcript to make its own recap. Without a skip in the desktop's scheduler both recaps exist, and the desktop's overwrites the server's brief on the row (`live-session-recaps.ts:148`).
- **Desktop and server on different builds.** A newer desktop on an older server gets a version 1 recap with no request rows to mark; an older desktop on a newer server sends no capability. Both have to draw (M11).

Blocking: decide eager or lazy on the server; the desktop skip; the empty state. All three are small and none depends on #54's registry sources (S7).

### 8. Copilot and OpenCode after #54

Low risk. The one assumption to check when D starts is "no recap code changes" (design :333): activity lines depend on the tool readers recognising those agents' tool names, and a paired server's chat is readable on the desktop only when the server's scan supplied a transcript path.

## How this was checked

- Read the three documents and every file they cite on `seal/all`; re-ran the suite (135 runs as committed, 194 with the additions, of which 50 wait for recordings).
- Scored the `ref` tags of all 355 recorded replies against the role of the message each tag names, using the requests stored beside the replies in `evidence/variance/probes.json` and the cassettes.
- Compared each of the 26 resolve-probe requests with every cassette request.
- Diffed #53 to #56 against `seal/all` for files and symbols the recap uses.
- Ran the scheduler and the transcript readers on the recordings in the repository with small scripts outside it; nothing from them is committed.
- Read the decision-model-design skill and its findings file in full and scored the design against each checklist box.
- Had every scenario labelled blind, and 35 of the 79 labelled twice.
- Ran the whole kessel-ml command against a stand-in for Workers AI: a refused credential (stops, writes nothing, prints no secret), one model the account cannot call (asked once, reported, the rest measured), and requests that fail twice before answering (asked again, nothing lost). Everything that run wrote was discarded: no fabricated answer, threshold or recording is committed.

Not done:

- **No model was asked anything.** Every figure about a judge's accuracy is missing until the command is run on `kessel-ml`. The cost and run-time figures for it are estimates.
- **Clef was not called**, only looked up.
- The labels were not read by a person.
- No recap from a real session was read (S1).
- The in-app specs were not run. This PR changes test fixtures, a script and documents only; `pnpm check:changed` passes against its base.
