# Session recap overhaul: design

Status: proposed, for critique. Built on the [pipeline audit](./01-pipeline-audit.md) (findings F1 to F26) and the [scenario baseline](./02-scenario-baseline.md). Nothing here is built.

## The change in one paragraph

Today the model writes three unrelated lists (what you asked, what the agent did, asked but not addressed) and is trusted on all of them. The overhaul replaces the first and third with one list of **requests**, each with a status the host owns. The model proposes requests and status changes and must point at the message, edit, command or commit that justifies each one. The host checks that pointer and applies the change, or drops it. What the host already knows without a model (whether the turn is still running, which files were edited, which commands ran, what the user answered, what the user ticked) is used directly and is given to the model as evidence. A request is called "not addressed" only when the turn after it has ended, the model judged it open on evidence it could see, and no signal says otherwise. It stays on the same single pipeline for every agent and surface.

## Root causes

| #   | Root cause                                                                                                                                                                                 | Findings               | Where it shows in the baseline                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Status is not a property of the request. "Not addressed" is a separate free-text item; it leaves only when the model names its id; the user cannot remove it.                              | F1, F2, F7, F21        | `partly-addressed-then-finished`, `declined-with-a-reason`; the same mechanism on action items in `action-done-by-user` and `many-asks-in-one-long-turn`; the [resolve probes](./02-scenario-baseline.md#resolve-probes): an addressed request stays listed in 33% of samples                                                            |
| R2  | Evidence is read once. A wrong, empty or half-parsed reply is final.                                                                                                                       | F3, F11                | `model-reply-not-json`, `model-failure-then-next-turn`, every miss in the resolve probes                                                                                                                                                                                                                                                 |
| R3  | The model sees prose only, clipped. Edits, commands, commits and question-tool answers never reach it.                                                                                     | F4                     | `addressed-with-no-prose`, `addressed-by-commit-and-pr`, `question-tool-answered`, `question-tool-waiting`, `ask-in-the-middle-of-a-long-message`, `subagent-result-is-the-answer`                                                                                                                                                       |
| R4  | The host does not use what it knows: turn state, activity, the user's own answers.                                                                                                         | F5, F6, F12, F15       | `mid-turn-refresh`, `mid-turn-first-look`, `mid-turn-automatic-recap`, `many-asks-in-one-long-turn`, `action-done-by-user`, `question-answered`, `terse-confirmations`                                                                                                                                                                   |
| R5  | The reply format asks a small model for nested lists, three operations and id bookkeeping, and the parser hides the result. Requests go unrecorded and open ones are almost never flagged. | F8, F9, F10, F13       | `addressed-same-turn` (request missing), `addressed-next-turn`, `addressed-several-turns-later`, `multiple-asks-one-deferred`, `partly-addressed-stays-open`, `terse-ask-skipped`, `withdrawn-ask`, `changed-ask`, `non-english-session`, `long-session-first-recap`, `restart-mid-session`; the open probes: flagged in 1 of 56 samples |
| R6  | Scheduling: the turn-end pass is throttled, a failed pass is not retried, there is no fallback on timeout or server error, ended sessions are skipped.                                     | F6, F14, F15, F16, F26 | `addressed-later-user-looks-at-once`, `session-ends-right-after-its-turn`, `model-timeout`, `model-server-error`, `model-rate-limited`                                                                                                                                                                                                   |
| R7  | Coverage: two agents have no recap; remote sessions are recapped twice with separate ticks.                                                                                                | F18, F19, F20          | Not a suite failure: Copilot and OpenCode cannot be run at all, and the remote runs fail only on R5. Found by reading the code and in the remote app run.                                                                                                                                                                                |
| R8  | The UI shows lists, not requests with outcomes, and has no stale state.                                                                                                                    | F7, F21, F22, F23, F25 | The in-app baseline specs                                                                                                                                                                                                                                                                                                                |

## Data model

`SessionRecap` version 2. `asked` and `ignored` are replaced by `requests`. Everything else keeps its meaning.

```ts
type RecapRequestStatus = 'open' | 'addressed' | 'partly' | 'declined' | 'withdrawn'

type RecapRequest = {
  id: string // host-assigned, kept for life
  text: string // the model's one-line summary
  source: RecapQuote // the user's own words, checked against the transcript
  turn: number // index of the user turn it was made in
  at: number
  status: RecapRequestStatus
  statusBy: 'model' | 'signal' | 'user'
  statusAt: number
  evidence: RecapEvidence[] // why it has this status, newest last, at most 4
  note?: string // what is left (partly) or why (declined)
  supersededBy?: string // the request that replaced it (changed)
  standing?: true // a rule for the whole session ("never touch generated/"), has no status
}

type RecapQuote = { messageId: string; quote: string }

type RecapEvidence =
  | { kind: 'said'; messageId: string; quote: string; by: 'agent' | 'user' }
  | { kind: 'edit'; messageId: string; path: string }
  | { kind: 'command'; messageId: string; command: string; ok: boolean | null }
  | { kind: 'commit'; messageId: string; sha: string; subject: string }
  | { kind: 'pr'; messageId: string; url: string }
  | { kind: 'answer'; messageId: string; quote: string } // the user's reply to a question
```

Also on the recap:

- `turnsSettled: number`: how many user turns have a finished agent turn after them. The host sets it from the registry status and the transcript; no model.
- `questions` and `actions` items gain `status: 'open' | 'answered' | 'done'` and `evidence`, with the same rules as requests, so an answered question stays visible with its answer instead of vanishing.
- `did` items gain optional `requestId` and `evidence`, filled by the host when the model's work item cites the same evidence as a request's status. This is the link between a request and the work.

**What is shown is derived, not stored.** `recapRequestDisplay(request, recap, session)` in the shared view code returns one of:

| Display                                | When                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| In progress                            | status `open` and the request's turn has not settled (`request.turn >= turnsSettled`), or the session is working                                    |
| Checking                               | status `open`, the turn settled, and the recap is older than the session's last activity                                                            |
| Not addressed                          | status `open`, the turn settled, the recap is current, the last pass judged it with its evidence window complete, and no activity signal matches it |
| Open                                   | status `open` otherwise (for example: an edit touched a file the request names, but the model did not call it done)                                 |
| Partly done, Done, Declined, Withdrawn | the status                                                                                                                                          |

Only "Not addressed" is a claim that something was missed, and it is the only one that counts toward attention. Every other open state is neutral.

## Who decides what

The rule: **the model proposes, the host checks and applies.**

### Decided by the host alone

| Signal             | Source                                                                                                                                                                                                            | Effect                                                                                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn state         | registry status, transcript turn boundaries                                                                                                                                                                       | In progress versus settled; never "not addressed" during a turn. Replaces the still-working sentence.                                                                                                                         |
| Staleness          | Messages beyond the recap's cursor. Today's test, `lastActivityAt` against `updatedAt`, also fires after a relaunch with nothing new (F26); it stays as the cheap first test and is confirmed against the cursor. | "Checking" instead of a stale claim, on panel, bar and badge.                                                                                                                                                                 |
| Question answered  | question-tool call and its result; a user message right after an agent turn that ended on a question                                                                                                              | The question becomes `answered` with the answer as evidence.                                                                                                                                                                  |
| Where it stands    | which turn it was written in, and whether mid-turn                                                                                                                                                                | Text written mid-turn is dropped when the turn ends unless the turn-end pass writes a new one.                                                                                                                                |
| User marks         | `sessionRecap.mark`                                                                                                                                                                                               | Status set with `statusBy: 'user'`. Never changed by a later pass; only the user reopens.                                                                                                                                     |
| Activity           | tool calls in the transcript                                                                                                                                                                                      | Per agent turn: files edited, commands run with exit state, commits (sha and subject from the command), PR links. Used as evidence lines and as a veto on "not addressed" when a path or name in the request's quote matches. |
| Same request twice | same source message, or near-identical text after normalising                                                                                                                                                     | Merged; a reminder adds the later message to the same request and never makes a second one.                                                                                                                                   |

Activity is read with the existing tool readers (`toolFilePath`, `toolInputCommand`, `isEditToolName`, `isCommandToolName` in `src/shared/native-chat/tools/`), which already work for Claude, Codex and journal transcripts. No new per-agent parser.

### Proposed by the model, checked by the host

- **A new request.** Must cite a user message in this pass's new messages and a quote from it. The host checks the tag exists, the role is user, and the quote is found in that message (case and whitespace ignored). Failing that, the request is dropped and counted.
- **A status for an open request.** Must cite evidence. The host checks by status:
  - `addressed`, `partly`: an agent message or an activity line, later than the request. `partly` also needs a note.
  - `declined`: a quote from an agent message later than the request.
  - `withdrawn`: a quote from a _user_ message later than the request. A changed request also names the request that replaces it.
  - A status with no evidence that checks out is dropped; the request stays as it was.
- **Reopening.** `addressed` goes back to `open` only on a later user message (they say it is not done, or ask again). The model cannot reopen on its own reading of the agent's words.
- **Work, decisions, where it stands, title, goal.** As today, but each work item must cite an agent message or activity line.

The model never deletes anything and never handles ids for new items.

## The pass

### Two small requests instead of one large one

1. **Read** (every pass): new messages only, no ids. Returns new requests (each with the status visible in the same messages), work, questions, action items, decisions, where it stands.
2. **Judge** (only when something was open before the pass): the open requests, questions, action items and in-progress work with their ids, and the conversation since the oldest of them. Returns one verdict per id.

The baseline is the reason for the split. The default model keeps "not addressed" empty on a clean turn in 64 of 64 samples and records work well, but it fails at the bookkeeping: 33% of addressed requests stay listed, 47% of replies do not have the asked-for shape, and 71% of first passes record no request. Each new request has one job and a flat reply. Most passes have nothing open and stay at one request.

Judging re-reads the evidence each pass while a request is open, so a miss is corrected on the next pass instead of being permanent (R2). The window is the conversation since the oldest open item, newest kept, at most one chunk. A request open for more than 20 turns stops being re-judged and is shown as Open, not as Not addressed.

### What the model sees

Per turn, as now, plus one activity line per agent turn:

```
[m7] USER: also document the --dry-run flag in docs/import.md
[m8] AGENT: Done.
[m8] ACTIVITY: edited docs/import.md; ran "pnpm test scripts/import" (ok); committed 3f2a91c "docs: dry-run flag"
```

- Agent prose is clipped per message, not per turn, so what a long turn reports in the middle survives (F4).
- User messages keep 4,000 + 2,000 characters instead of 1,000 + 500.
- Commands are clipped to 120 characters and pass through the same redactor as prose. Tool output, file contents and reasoning are still never sent. Sending tool names, paths and command lines is new and is [decision 3](#decisions-for-brian).
- Subagent work: the launch and the subagent's final message count as activity of the parent's turn.

### Reply shape

Flat, no nesting, no operations. Read:

```json
{
  "requests": [
    {
      "from": "m7",
      "quote": "document the --dry-run flag",
      "text": "Document --dry-run in docs/import.md",
      "status": "addressed",
      "because": { "ref": "m8", "quote": "edited docs/import.md" }
    }
  ],
  "work": [{ "text": "Documented --dry-run", "state": "done", "ref": "m8" }],
  "questions": [],
  "actions": [],
  "decisions": [],
  "standing": "Docs updated; tests pass.",
  "goal": null,
  "title": null
}
```

Judge:

```json
{
  "verdicts": [
    {
      "id": "r4",
      "status": "addressed",
      "because": { "ref": "m12", "quote": "README now says Account" }
    },
    { "id": "q2", "status": "open" }
  ]
}
```

### Prompt

Two system texts, each short, each with one worked example in the reply shape. Drafts of the rules; workstream B tunes the wording against the probes.

Read:

```
You read a few new messages of a coding session and list what they contain. Return one JSON object.
- requests: each thing the USER asks the agent to do. "from" is the tag of the user's message and
  "quote" is the user's exact words for it. One entry per request, even when a message holds several.
- For each request give "status":
    "addressed" if a later AGENT message or ACTIVITY line in these messages shows it done,
    "partly" if only part is done ("note" says what is left),
    "declined" if the agent refused or advised against it and said why,
    "open" otherwise.
  Unless the status is "open", "because" must give the tag and the exact words that show it.
- work: what the AGENT did, from AGENT and ACTIVITY lines only.
- questions: what the agent asks the user and is still waiting on.
- actions: what the agent says the USER must do themselves. Never the agent's own remaining work.
- Use only what the messages say. An empty list is a good answer.
```

Judge:

```
These items from a coding session were open. Below is the conversation since.
For each id, say what the conversation shows. Return {"verdicts": [...]} with one entry per id.
- "addressed", "partly" (with "note"), "declined": cite the AGENT message or ACTIVITY line.
- "withdrawn": the USER took it back or replaced it; cite the USER message.
- "answered" (questions) or "done" (actions): cite the USER message.
- "open": nothing in the conversation settles it. No citation.
"because" gives the tag and the exact words. If you cannot quote it, the answer is "open".
```

The rules the current prompt needs and these do not: never repeat an item, how to use `update` and `resolve`, what ids look like, and the still-working note.

- The parser is strict: an unknown key, a list in the wrong place or a missing verdict is a failed reply. A code fence around the JSON is accepted (the fallback model fences every reply).
- A failed reply gets one retry with the error. If that fails, the read step falls back to nothing and **the cursor does not move**; the span is read again on the next trigger. After two failed passes over the same span the host records the user's lines as requests with status `open` (shown as Open, never Not addressed) and marks the span for the next rebuild.
- A reply cut at the output cap is retried on half the chunk rather than repaired. Chunks drop from 24,000 to 12,000 characters and the cap rises from 1,000 to 1,500 tokens.
- The first request is no longer carried as `firstRequest`; it is an ordinary new message (F9).
- JSON mode is not documented for either model on Workers AI. Workstream B tests `response_format` once; the design does not depend on it.

## Incremental update and full recompute

- **Incremental** is the default: read from the cursor, judge what is open.
- **First recap of a long session** reads up to three chunks, oldest first, instead of the newest one only, so requests and their outcomes are met in order. History before that stays outside the recap, as today, and requests there are unknown rather than open.
- **Full recompute** happens on Refresh when nothing is new, when the transcript shrank or a chat was cleared, when a span is marked failed, and once per session when the stored version is 1. It runs lazily, when the session is next active or opened. User marks carry over by text (`carryRecapMarks` does this today).
- A recompute never shows an empty recap: the old one stays visible, marked as updating, until the new one is whole.

## Scheduling and failure

| Today                                                                  | Proposed                                                                                                                                |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Turn-end pass waits out a 4-minute interval                            | Runs 2.5 s after every turn end. Turns that end within 20 s of each other share one pass. The interval applies to mid-turn passes only. |
| Opening the recap starts a pass only if the last is over 60 s old      | Starts one whenever the recap is behind and none is running. Meanwhile the view says "checking".                                        |
| A pass started by the user mid-turn has no idea the turn is unfinished | Turn state is a host signal on every pass.                                                                                              |
| A failed pass waits for new activity                                   | Retried after 30 s, 2 min, 10 min. After a pause, a timer for the pause's end.                                                          |
| Fallback model only on plan or model-not-found errors                  | Also on timeout, server error, and a reply that fails the strict parser twice. In `UtilityModelService.run`, for every caller.          |
| A session that ends is skipped                                         | One last pass when a session ends with unread transcript.                                                                               |
| One queue for all sessions                                             | One pass at a time per session, three at once overall.                                                                                  |

## Caching

- **Reply cache.** Key: hash of model, prompt version and request text. Value: the parsed reply. Persisted beside the store, least-recently-used, about 500 entries. Serves Refresh on an unchanged session, recompute after a restart, and re-judging when nothing in the window changed.
- **Turn digests** (prose and activity per turn) are kept in memory per session so the judge window is not re-read from disk each pass.
- **Invalidation.** Store version 2; a version 1 recap is rebuilt lazily. A prompt change alters the cache key. Transcript shrink, `/clear` and a failed span force a recompute. The 300-recap cap and move-on-resume stay.

## Compatibility

The recap crosses three boundaries that can be on different versions: the saved file, a phone paired with a desktop or server, and a desktop talking to a server. The schema says a recap of another version does not parse (`src/shared/session-recap/session-recap-schemas.ts:35-37`), so a bare version bump would blank the recap on every older phone.

- **Saved file.** A version 1 store is read, kept, and each recap rebuilt lazily. Nothing is deleted until its replacement is whole.
- **Older client, newer host.** `sessionRecap.get` gains an optional `accepts` version. A client that sends none gets a version 1 recap derived from the ledger: `asked` is every request, `ignored` is the requests shown as Not addressed. Marks from an older client keep working on questions and action items.
- **Newer client, older host.** The shared view accepts a version 1 recap and draws its `asked` and `ignored` items as rows without evidence or actions.
- **Platforms and workspaces.** Activity matching compares paths after normalising separators and case as the platform requires; nothing else is platform-specific. Commits and PR links are optional evidence, so a folder workspace with no git loses nothing but those two kinds.

Workstream A owns the wire shape and the derived version 1; workstream C owns drawing a version 1 recap.

## Model and cost

Measured in the baseline, on today's prompt:

|                                                      | glm-4.7-flash (default) | gemma-4-26b (fallback) |
| ---------------------------------------------------- | ----------------------- | ---------------------- |
| Neurons per request                                  | 8.2                     | 10.1                   |
| Addressed request still listed after the pass        | 17 of 52 (33%)          | 1 of 26 (4%)           |
| Reply has the asked-for shape (a code fence allowed) | 91 of 172 (53%)         | 73 of 86 (85%)         |
| Reply with content the parser silently drops         | 33 of 172 (19%)         | 1 of 86                |
| Agent's work filed as a to-do for the user           | 18 of 172               | 0 of 86                |
| Goal set on a first pass                             | 48%                     | 98%                    |
| First pass records a request                         | 29%                     | 13%                    |

Neither model flags a request that is really open (1 of 56 and 0 of 28). That is the prompt and the format, and the judge step is built to fix it.

Recommendation: workstream B runs the same probes on the new prompts with both models and picks per step on the thresholds below. On today's evidence gemma is the better judge.

Cost: a pass is one request, or two when something was open, at 8 to 10 neurons each. 300 turn ends in a day with a judge step on half of them is about 4,500 neurons, inside the 6,000-neuron tier for automatic passes (`session-recap-budget.ts:21-23`) and the free 10,000 a day. Ten busy sessions can end more than 500 turns a day and would pass that tier; after it, a recap updates only when opened. Raising the tiers past the free allowance costs about $0.011 per 1,000 neurons, so cents a day. The tiers stay and count both steps; where to set them is part of [decision 6](#decisions-for-brian).

## UI

One section, **Requests**, replaces "What you asked" and "Asked but not addressed", on desktop and mobile.

- Each row: a status chip, the request, and on expand the user's words (jump to the message), the evidence (file, command, commit, PR link, or the agent's words with a jump) and the note.
- Order: Not addressed, Partly done, Open and In progress, Declined, then Done and Withdrawn folded behind a count.
- Row actions: **Mark done** and **Dismiss** on anything open, partly done or declined; **Not done** on anything done. These call the existing `sessionRecap.mark`, extended to requests.
- A recap that is behind shows "Checking the last turn" in the panel header, the bar and the row badge, and shows no "Not addressed" chip until the pass lands.
- Whether the recap is behind travels on the session row with the turn state, so a panel that is already open shows it without being read again (F25). Showing the panel counts as a visit.
- One function, `recapAttention`, gives the count for bar, badge and mobile: open questions, open action items, and requests shown as Not addressed (see [decision 5](#decisions-for-brian)).
- Desktop and mobile render rows built by the shared view code (`src/shared/session-recap/session-recap-view.ts`), so folds, counts and empty states cannot differ. Components only draw.
- A failed refresh or a jump that finds nothing says so. Workstream C checks that a jump from a chat's recap lands in the pane, since the recap reads the journal and the pane reads the transcript file (F23).
- Tokens from `main.css` and the `Badge` primitive, per `docs/STYLEGUIDE.md`. No new colour.

## Test strategy

The regression suite is the scenario suite in this PR ([how to run it](./README.md)): 52 scenarios, 135 runs, recorded real-model replies, no network.

- **Ratchet.** `baseline.json` lists the checks that fail today. The suite fails when a check that passed starts failing, and when a listed check starts passing until it is removed from the list. A builder PR shrinks the list; nothing may grow it.
- **Done means:**
  - No scenario shows a request as not addressed that was addressed, declined with a reason, withdrawn or still in progress, on any surface (today: 6 failing checks in 2 scenarios, plus every timing scenario).
  - Categories `addressed-*`, `partly-addressed`, `withdrawn-or-changed`, `declined`, `question-*`, `mid-turn`, `session-end`, `restart-resume`, `multiple-asks`, `duplicate-asks`: every run passes. `long-session`, `non-english-terse`, `model-failure`, `tool-heavy`, `subagent`: at least 80%. Overall at least 90% of runs (today 24%).
- **Sampling.** One recording per request hides variance, so the probe set from the baseline becomes part of the suite: each probe request recorded at least 4 times on the default model and 2 on the fallback. Thresholds over all samples:
  - a request addressed in the window is shown as Not addressed after the pass: 0 samples;
  - a clean turn produces a Not addressed request: 0 samples;
  - a request that is really open is shown as Not addressed once its turn has settled: at least 70% (today 2%);
  - strict parse succeeds first time: at least 95%; after one retry: at least 99%;
  - a first pass records the request: at least 95% (today 29%).
- **Unit tests**, one layer each, only where a revert would fail them: the request state machine (what evidence each transition needs), activity lines per transcript kind, the strict parser, scheduler timing (turn-end pass not throttled, retry, last pass on end), the shared view rows.
- **E2E.** The baseline specs in `tests/e2e/session-recap-baseline-*.spec.ts` are marked as expected failures today. Each flips to a plain passing test when its behaviour is fixed.
- **Recording** needs a Workers AI credential on the builder's machine or in a manual CI job ([decision 4](#decisions-for-brian)). Replay in normal CI needs none.

## Workstreams

Four, each with files only it edits. A lands its types first; B and C then work in parallel against them; D starts once PR #54 is in.

### A. Requests ledger and evidence (host, no model)

- `src/shared/session-recap/session-recap-types.ts`, `session-recap-schemas.ts`: version 2 types and schemas. **First commit, reviewed alone**, since B and C build on it.
- New `src/main/session-recap/session-recap-requests.ts`: the state machine (evidence checks, transitions, duplicates, user marks).
- New `src/main/session-recap/session-recap-activity.ts`: activity lines from tool calls, using the readers in `src/shared/native-chat/tools/`.
- `session-recap-transcript.ts`: turns, per-message clipping, activity in the digest, the judge window.
- `session-recap-merge.ts`: apply checked proposals; remove `RESOLVABLE` and the `ignored` paths.
- `session-recap-store.ts`: version 2, lazy rebuild of version 1, marks on requests.
- `src/main/runtime/rpc/methods/live-sessions/session-recap.ts`, `src/shared/rpc-contract/session-recap-params.ts`: marks on requests.
- Unit tests for the state machine and activity lines; scenario fixtures gain tool-call steps where a scenario depends on them.

### B. Model pass and scheduling

- `session-recap-prompt.ts`, `session-recap-delta.ts` (becomes the two strict reply schemas), `session-recap-engine.ts`, `live-session-recaps.ts`, `session-recap-budget.ts`.
- New `src/main/session-recap/session-recap-reply-cache.ts`.
- `src/main/utility-model/utility-model-service.ts`: fallback on timeout, server error and unusable replies.
- `src/main/session-recap/scenarios/**`: re-record every cassette on the new prompts, add multi-sample recording and the probe thresholds, shrink `baseline.json`.
- `docs/session-recap.md`: rewritten for the new pipeline.

### C. Recap UI, desktop and mobile

- `src/shared/session-recap/session-recap-view.ts`: rows, display state, `recapAttention`.
- `src/renderer/src/components/session-recap/**`, `mobile/src/seal/session-recap/**`.
- Strings: the session-recap keys in the renderer and seal-overrides `en.json`, and `mobile/src/seal/session-recap/session-recap-copy.ts`.
- Component fixtures (`pnpm fixtures:shot`) for each display state; flip the E2E baseline specs.
- Touches `LiveSessionRow.tsx` only for the badge count, after W3 lands (see overlap).

### D. Coverage and remote (after PR #54)

- Copilot and OpenCode sessions through the registry sources from PR #54, read with the journal reader. No recap code changes: once they are registry rows with a readable transcript, the pipeline picks them up. Add both as surfaces in the scenario suite.
- Reader parity: the `/clear` floor in `journal-session-transcript.ts`, and `continues` for Codex in `transcript-summary.ts`.
- Remote: for a session held on a Seal server, the desktop asks the server for the recap instead of making its own (`use-session-recap.ts` target, the server's `sessionRecap.*` methods already exist), so desktop and phone show one recap and share marks ([decision 7](#decisions-for-brian)).

## Overlap with open work

| PR                                                                 | Shared files                                                                                                                                                                                                                                       | How to avoid a collision                                                                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| #54 registry sources (`cursor/registry-sources-5879`)              | `live-session-registry.ts`, `live-session-service.ts`, `live-transcript-reader.ts`, `live-transcript-streams.ts`, `session-transcript.ts`, `live-session-types.ts`, `live-session-recaps.test.ts`, `LiveSessionPane.tsx`, seal-overrides `en.json` | D waits for it. A and B do not edit the readers or the registry. B rebases `live-session-recaps.test.ts` on it.                                      |
| #53 multi-pane (`cursor/multi-pane-workspace-906c`)                | `LiveSessionRow.tsx`, `LiveSessionPane.tsx`, `live-session-tabs-store.ts`, renderer `en.json`                                                                                                                                                      | C keeps the recap panel's mount point and props unchanged and adds strings under the session-recap keys only.                                        |
| #55 SSH server install (`cursor/ssh-server-install-a228`)          | renderer `en.json`                                                                                                                                                                                                                                 | Strings only; C rebases.                                                                                                                             |
| #56 / W3 sidebar session rows (`cursor/sidebar-session-rows-dfb0`) | `LiveSessionRow.tsx`, renderer `en.json`                                                                                                                                                                                                           | W3 owns the row. C exports `recapAttention` and the badge component; the row keeps calling the badge. If W3 changes what the badge shows, C follows. |

## What is deleted

- The `ignored` section, `resolve`, `update` and `add` in the delta, the lenient parser's per-field catches, `recapFallbackDelta`, the `firstRequest` carry, the still-working sentence.
- The parallel list drawing in `SessionRecapPanel.tsx` and `SessionRecapSheet.tsx`, replaced by rows from the shared view.
- Nothing is added beside the existing pipeline: no second summarizer, no per-agent recap code.

## Decisions for Brian

1. **Which claim to prefer when unsure.** The design shows "Not addressed" only when the turn is over, the model judged it open on evidence it could see, and nothing contradicts it; anything less certain is "Open". This will miss some genuinely skipped requests. Recommended, since the complaint is false alarms. The alternative is to flag every open request once the turn ends.
2. **Model for the recap.** Keep glm-4.7-flash for both steps, use gemma-4-26b for the judge step, or move the recap to gemma entirely. Recommended: decide on workstream B's probe numbers; start with gemma as the judge.
3. **Sending activity to the model.** Today only prose leaves the machine, and `docs/session-recap.md` says so. The design also sends file paths, command lines (redacted, clipped) and commit subjects. Without them, work done silently by tools cannot be matched to a request. Recommended: send them. The alternative keeps them on the host as a veto only, which fixes false alarms but not the "done" evidence.
4. **A Workers AI credential for builders and for a manual CI job**, to record replies. This audit had none on the VM and relayed about 360 requests through the Cloudflare MCP tool by hand. Without one, workstream B cannot re-record 135 runs in reasonable effort.
5. **Does "Not addressed" raise the row badge?** Today the badge counts open questions and action items only. Recommended: yes, once the thresholds above hold; it is the thing the user most needs to see. It changes W3's row.
6. **Turn-end passes without the 4-minute wait, and the daily budget.** One pass per turn instead of at most one per four minutes, so the recap is right when you look. With many busy sessions this passes today's 6,000-neuron automatic tier, after which recaps update only when opened. Recommended: remove the wait and raise the tiers, accepting cents a day beyond the free allowance.
7. **Remote sessions: one recap or two.** Recommended: the server's recap is the only one for sessions it holds, which removes the double cost and the split ticks. It means no recap for a server session while the server has no utility model configured, which is how a server is installed today (F20); the alternative keeps the desktop's recap as the fallback for that case.
8. **Copilot and OpenCode.** Recommended: after PR #54, as workstream D. The alternative is to hold the overhaul until they are in.

## Appendix: every failing scenario and what fixes it

The 40 scenarios that fail in the baseline. The other 12 pass today and must keep passing.

| Scenario                                | Cause  | What fixes it                                                                                                                             |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `action-done-by-user`                   | R1, R4 | Action items have a status; the judge step settles them on the user's own message.                                                        |
| `addressed-by-commit-and-pr`            | R3     | Activity lines carry the commit and the PR link.                                                                                          |
| `addressed-later-user-looks-at-once`    | R5, R6 | Read step records the open request; the turn-end pass is not throttled; a recap that is behind shows "checking".                          |
| `addressed-next-turn`                   | R5     | Read step records every request with a status; judge step settles it next turn.                                                           |
| `addressed-same-turn`                   | R5     | The first request is an ordinary new message, not a carried field.                                                                        |
| `addressed-several-turns-later`         | R5     | As `addressed-next-turn`; the request is re-judged each pass while open.                                                                  |
| `addressed-with-no-prose`               | R3     | Activity lines: the command and the commit are the evidence.                                                                              |
| `ask-in-the-middle-of-a-long-message`   | R3     | User messages keep 6,000 characters.                                                                                                      |
| `changed-ask`                           | R1, R5 | `withdrawn` with `supersededBy`, on the user's message; the question is recorded by the read step.                                        |
| `compaction-before-first-recap`         | R5     | Flat read reply; one entry per request.                                                                                                   |
| `compaction-between-ask-and-work`       | R5     | Open request recorded and re-judged across the compaction.                                                                                |
| `declined-with-a-reason`                | R1     | Status `declined` with the agent's words as evidence; never shown as not addressed.                                                       |
| `duplicate-reminder`                    | R5     | Open request recorded; the reminder merges into it.                                                                                       |
| `long-session-first-recap`              | R5     | First recap reads three chunks oldest first; standing rules are requests with `standing`.                                                 |
| `many-asks-in-one-long-turn`            | R1, R4 | Turn state from the host: nothing of a running turn is an action for the user or not addressed; judge step settles each item at turn end. |
| `mid-turn-automatic-recap`              | R4     | "Where it stands" written mid-turn is dropped at turn end unless the turn-end pass writes one.                                            |
| `mid-turn-first-look`                   | R2, R4 | In-progress work is judged again at turn end.                                                                                             |
| `mid-turn-refresh`                      | R4, R6 | Turn state on every pass, whoever started it; turn-end pass not throttled.                                                                |
| `model-failure-then-next-turn`          | R2     | The cursor does not move past a span no reply was read for.                                                                               |
| `model-rate-limited`                    | R6     | A timer for the end of the pause.                                                                                                         |
| `model-reply-not-json`                  | R2     | Strict parse, retry, cursor held; fallback model on a second unusable reply.                                                              |
| `model-server-error`                    | R6     | Fallback model on server error.                                                                                                           |
| `model-timeout`                         | R6     | Fallback model on timeout; retry with backoff.                                                                                            |
| `multiple-asks-one-deferred`            | R5     | One entry per request, each with its own status.                                                                                          |
| `non-english-session`                   | R5     | Quotes are the user's own words in any language; status words are fixed.                                                                  |
| `partly-addressed-stays-open`           | R5     | Status `partly` with a note; stays until judged otherwise.                                                                                |
| `partly-addressed-then-finished`        | R1     | Status moves `partly` to `addressed` on evidence; there is no second list to fall out of step.                                            |
| `question-answered`                     | R4     | A user message after a turn that ended on a question is the answer, set by the host.                                                      |
| `question-tool-answered`                | R3, R4 | The question tool's question and answer are read by the host.                                                                             |
| `question-tool-waiting`                 | R3, R4 | As above; the open question is listed from the tool call.                                                                                 |
| `remote-server-session`                 | R5     | Same pipeline; fixed with the read and judge steps.                                                                                       |
| `remote-ssh-session`                    | R5     | Same pipeline; fixed with the read and judge steps.                                                                                       |
| `restart-mid-session`                   | R5     | Open request recorded; a reworded repeat merges into it.                                                                                  |
| `resumed-under-a-new-id`                | R5     | Open request recorded; the ledger moves with the recap.                                                                                   |
| `session-ends-after-doing-the-open-ask` | R5     | Open request recorded; settled by the last pass.                                                                                          |
| `session-ends-right-after-its-turn`     | R6     | One last pass when a session ends with unread transcript.                                                                                 |
| `subagent-result-is-the-answer`         | R3     | A subagent's final message is activity of the parent's turn.                                                                              |
| `terse-ask-skipped`                     | R5     | One entry per request; a skipped one stays `open` and is shown once the turn settles.                                                     |
| `terse-confirmations`                   | R4     | A one-word reply to a question is an answer, set by the host, not a request.                                                              |
| `withdrawn-ask`                         | R1, R5 | Open request recorded; `withdrawn` on the user's message.                                                                                 |
