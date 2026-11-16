# Session recap: pipeline audit

What the recap does today on `seal/all` (7a6dc74d5d2), end to end, and every bug and design weakness found. Line numbers are for that commit. Evidence for each finding is either the code cited, a scenario in the [baseline](./02-scenario-baseline.md), or both.

The reported problem, "asked but not addressed shows things that were addressed", is findings [F1](#f1-not-addressed-is-a-free-text-list-with-no-link-to-the-ask-and-no-evidence) to [F6](#f6-a-recap-opened-right-after-a-turn-is-up-to-four-minutes-old-and-does-not-look-it). The rest are other faults in the same pipeline.

## 1. The pipeline

```
registry event ─► LiveSessionRecaps (scheduler) ─► SessionRecapEngine.pass
                                                     │ read transcript since the recap's cursor
                                                     │ digestTranscript: user text + agent prose only
                                                     │ chunk (24,000 chars), newest kept
                                                     │ recapPrompt: recap so far + new messages
                                                     │ utility model ─► parseRecapDelta ─► applyRecapDelta
                                                     ▼
                                                SessionRecapStore (recaps.json) ─► view / brief ─► panel, bar, badge
```

One pipeline serves every agent and surface: `createLiveSessionRecaps` (`src/main/session-recap/session-recap-install.ts:24`) is installed once by the session-summaries host (`src/main/session-summaries/session-summaries-host.ts:104-116`) on the shared session core from PR #50.

### 1.1 When a pass runs

`LiveSessionRecaps.observe` (`src/main/session-recap/live-session-recaps.ts:78-116`):

| Trigger                        | Rule                                                                                                                                                                                                                          | Where                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Turn settles                   | Status `waiting-input`, `your-turn`, `idle`, `waiting-subagent` or `waiting-task` (`src/shared/live-sessions/live-session-status.ts:93-99`), session `alive` and readable. Pass after `max(2.5 s, lastPassAt + 4 min - now)`. | `live-session-recaps.ts:92,100-115,237-250`     |
| While working                  | Status `working` or `running-shell`. A check every 60 s once 4 min have passed since the turn began or the last pass; the pass runs only with 1,200 characters of new prose, or after 10 min with any.                        | `:93-98,258-294`, constants `:39-49`            |
| User opens the recap           | `sessionRecap.get` with `look`. A pass only if the recap is stale or missing and the last pass is more than 60 s old.                                                                                                         | `:152-173`                                      |
| User presses Refresh           | A pass now; if nothing was new, a rebuild from recent history.                                                                                                                                                                | `:188-198`                                      |
| Model comes back after a pause | Sessions that settled meanwhile are scheduled again.                                                                                                                                                                          | `:119-125`, `session-summaries-host.ts:304-308` |

Passes for all sessions share one queue (`session-recap-engine.ts:117-136`): one runs at a time.

A server (`orcad`) installs the same pipeline with `recapEagerly: false` (`src/main/orcad/host-runtime/orcad-session-summaries.ts:19-26`): it writes a recap only once a client has opened one (`live-session-recaps.ts:238-240,259-261`).

### 1.2 What a pass reads

- **Window.** With a recap: the transcript from the recap's `coveredTo` cursor (`session-recap-engine.ts:227-236`). Without one, or on rebuild: pages of 200 messages back from the end, up to 8 pages or 72,000 characters of prose (`:238-258`, constants `:25-30`).
- **Digest.** `digestTranscript` (`session-recap-transcript.ts:84-133`) keeps two things: the user's messages and the agent's prose. Tool calls, tool output, reasoning, system rows, subagent messages, slash commands and other agents' messages are left out (`:102-117`). The only trace of a tool call is the path of an edited file, kept as a reference (`:60-78`), which the model never sees.
- **Clipping.** A user message keeps its first 1,000 and last 500 characters (`:25-26,127`). All of an agent's prose in one turn is joined into one entry and keeps its first 600 and last 1,200 characters (`:28-29,94`).
- **Chunks.** Entries are packed into chunks of 24,000 characters from the newest back. A first automatic pass sends one chunk; any other pass up to three. Entries that do not fit are dropped, oldest first (`session-recap-engine.ts:181-182`, `session-recap-transcript.ts:136-161`).
- **Per surface.** Claude and Codex CLI sessions are read from their transcript file, locally or over SSH (`src/main/live-sessions/transcripts/live-transcript-reader.ts:58-77,116-140`). In-app chats are read from the chat journal (`src/main/live-sessions/transcripts/session-transcript.ts:27-52`, `journal-session-transcript.ts:41-54`): root rows only, and while a turn runs the newest row and running rows are held back (`journal-session-transcript.ts:28-54`). A chat held on a server appears on the desktop as an external file session and is read from the file.

### 1.3 The prompt and the schema

`recapPrompt` (`session-recap-prompt.ts:77-106`) sends a system text (`:16-43`) and one user message: the recap so far as JSON, then the new messages tagged `[m1] USER:` / `[m2] AGENT:`.

The recap so far (`carriedRecap`, `:46-64`) is: title, goal, standing, the last 10 asked, open work plus the last 8 done, all questions, all ignored, all actions, the last 8 decisions. While the recap has no goal it also carries `firstRequest`, the session's registry title (`:56`), which is the first 80 characters of the first prompt.

The model answers with a delta (`session-recap-delta.ts:20-29`): `title`, `goal`, `standing`, `add` (six lists: `asked`, `did`, `questions`, `ignored`, `actions`, `decisions`), `update` (by id) and `resolve` (ids). Output is capped at 1,000 tokens and 60 s (`session-recap-prompt.ts:8-10`). A pass made while the agent works adds one sentence telling the model the turn is unfinished (`:74-75`), only for passes of kind `working` (`session-recap-engine.ts:194`).

### 1.4 How "asked" and "addressed" are decided

Entirely by the model, in one step, with no check by the host:

- An **ask** exists when the model puts a line in `add.asked`. Nothing ties it to the user message beyond an optional `ref`.
- An ask is **not addressed** when the model puts a line in `add.ignored`. This is a separate item with its own id and its own wording; it is not linked to the `asked` item (`session-recap-merge.ts:141-152`).
- It becomes **addressed** only when a later reply lists that `ignored` item's id in `resolve` (`session-recap-merge.ts:29,123,129`). Nothing else removes it: not a `did` item, not an edit to the file it names, not the user.
- Work the agent did is whatever the model puts in `add.did`, with the state the model gives.

### 1.5 Parsing, merging, caching

- `parseRecapDelta` (`session-recap-delta.ts:107-156`) takes the text between the first `{` and the last `}`. The reply is accepted if it is a JSON object with at least one of the six top-level keys (`:94,121`). Every field that is wrong, misplaced or misspelt is dropped on its own (`.catch` on each, `:55-91`).
- One retry: an unreadable reply is sent back with the error (`session-recap-engine.ts:262-269`, `session-recap-prompt.ts:109-122`). If that fails too, the host writes a fallback delta: each user message's first line as an ask and nothing else, and marks the recap `degraded` (`session-recap-merge.ts:190-215`, `session-recap-engine.ts:197-213`).
- `applyRecapDelta` (`session-recap-merge.ts:118-170`): resolves ids in `questions`, `ignored`, `actions`; applies updates; adds new items unless one with the same text (ignoring case and punctuation) exists (`:47-54,141-144`); caps each list (`:12-19`). Ids are assigned by the host.
- The store (`session-recap-store.ts`) keeps one recap per session id in `userData/session-recaps/recaps.json`, at most 300 (`:36`). There is no cache of model replies and no invalidation other than: the transcript shrank (`session-recap-engine.ts:229`), the user pressed Refresh, or the session was resumed under a new id, when the recap moves with it (`live-session-recaps.ts:83-85`, `session-recap-store.ts:112-120`).
- After any pass that reaches the store, `coveredTo` moves to the end of what was read (`session-recap-engine.ts:211`), whatever the model made of it.

### 1.6 Model, fallback, budget

`UtilityModelService.run` (`src/main/utility-model/utility-model-service.ts:168-216`) tries the configured model, then the fallback, only for errors of kind `plan-unavailable` or `model-not-found`, or errors the provider marks as scoped to the model (`:204-212`). A timeout, a 5xx or a bad response is thrown at once. A rate limit pauses the provider for 60 s, or until the next UTC day after three in a row (`:262-279`). Recap spending is counted against daily tiers of 3,000, 6,000 and 9,000 neurons for working, automatic and user-asked passes (`session-recap-budget.ts:21-23`).

### 1.7 Agents and surfaces

|                          | Claude                                                  | Codex           | GitHub Copilot | OpenCode |
| ------------------------ | ------------------------------------------------------- | --------------- | -------------- | -------- |
| In-app chat              | journal                                                 | journal         | no recap       | no recap |
| CLI in a Seal pane       | transcript file                                         | transcript file | no recap       | no recap |
| CLI started outside Seal | transcript file                                         | transcript file | no recap       | no recap |
| On an SSH machine        | file read over SSH, recap made on the desktop           | same            | no recap       | no recap |
| On a Seal server         | file read through the server, recap made on the desktop | same            | no recap       | no recap |

Copilot and OpenCode sessions never become rows of the live-session registry, so the recap pipeline never sees them: the provider list is Claude and Codex (`src/shared/live-sessions/live-session-types.ts:9-15`), panes of other agents are dropped (`src/main/live-sessions/seal-panes/seal-pane-sessions.ts:168-172`), discovery matches only those two binaries (`src/main/live-sessions/discovery/agent-processes.ts:26-54`), and the file reader has no other decoder (`live-transcript-reader.ts:116-121`). Their ACP chats do write journals the journal reader could digest.

### 1.8 UI

Desktop `SessionRecapPanel.tsx` and mobile `SessionRecapSheet.tsx` draw the same sections from shared view code (`src/shared/session-recap/session-recap-view.ts`): goal, where it stands, since you last looked, questions for you, your action items, asked but not addressed, what you asked, what the agent did, decisions, references. Questions and action items can be ticked or dismissed. The row badge counts open questions and action items (`live-session-recaps.ts:139-144`). The desktop always asks its own main process for the recap (`src/renderer/src/components/session-recap/use-session-recap.ts:10,44-45`).

## 2. Findings

Severity: **A** produces a wrong statement in the recap; **B** loses or delays information; **C** limits coverage or maintainability.

### Not addressed, wrongly

#### F1. "Not addressed" is a free-text list with no link to the ask and no evidence

**A.** `ignored` is its own list. An item there has no reference to the `asked` item it is about, to the work that would address it, or to anything the host can check (`session-recap-merge.ts:141-152`, `src/shared/session-recap/session-recap-types.ts:20-30`). Whatever the model writes there is shown under "Asked but not addressed" as fact.

Recorded examples from the real model:

- `partly-addressed-then-finished`, the turn that finishes the work. The user says "do customers too", the agent replies that `/customers` is paginated with its own test. The model's reply adds, under `ignored`, the text of an earlier _work_ item, "Leave /customers for follow-up due to helper", with a `state` and a work item's id as `ref`. The recap now lists it as asked but not addressed, in the same pass that records the work as done.
- `declined-with-a-reason`. The agent explains why it will not delete the migrations and offers an alternative. The request is listed as not addressed, as if overlooked.

#### F2. An item leaves "not addressed" only if a small model remembers to name its id

**A.** The only exit is `resolve` holding the item's exact id (`session-recap-merge.ts:123,129`). The baseline measured how often the model does that when the ask is plainly addressed in the new messages: see [the resolve probes](./02-scenario-baseline.md#resolve-probes). Every miss is permanent, because of F3.

The merge also undoes a correct resolve. It removes the resolved items first and then compares each new item only with what is left (`session-recap-merge.ts:128-144`), so a reply that resolves an item and lists the same request again under `ignored` puts it straight back under a new id. The default model did this in 4 of 52 samples.

Replies that tried to resolve and failed, all accepted as valid deltas:

- `"resolves": ["t12"]`: a misspelt key, dropped (`many-asks-in-one-long-turn`, final pass, sample 2).
- `"resolve": ["a1","a2","a3","a4","a5"]`: ids of `asked` items, which cannot be resolved, while the open action item stays (same pass, sample 1).
- `"resolve": ["w2"]`: a work item's id (`partly-addressed-then-finished`).

#### F3. Evidence is read once; a wrong or empty reply is never revisited

**A.** The cursor moves past a span after one pass (`session-recap-engine.ts:211`) even when the reply was empty, malformed in a way the parser tolerates (F8), or the host's fallback. Later passes carry only the lists, not the messages. An ask the model failed to settle in the pass that held the evidence can only be settled if the agent happens to mention it again.

#### F4. The model does not see what the agent did, only what it said

**A/B.** Tool calls, edits, commands, commits and their output are removed before the model sees anything (`session-recap-transcript.ts:102-117`). The question tool's question and the user's answer are removed too. A turn that does the work and says "Done." gives the model nothing to tie to the ask. The baseline shows the effect on work items (`addressed-with-no-prose`: the run-and-commit turn is recorded as "in progress"; `addressed-by-commit-and-pr`: commit, push and PR are missing; `question-tool-answered`: neither the chosen region nor the work appears).

Clipping removes more: an agent turn longer than 1,800 characters loses its middle (`:94`), where a long turn reports the earlier items of a list, and a user message longer than 1,500 characters loses its middle (`:127`; `ask-in-the-middle-of-a-long-message`: the second request is never recorded).

#### F5. A recap made mid-turn can file the agent's unfinished work against the user or as overlooked

**A.** A pass started by the user opening or refreshing the recap while the agent works has kind `asked`, so it does not carry the still-working sentence (`session-recap-engine.ts:194`), and the prompt asks for "requests from the user that the agent has not addressed" (`session-recap-prompt.ts:29`). Nothing in the pipeline knows the turn is not over. Even with the sentence, in `many-asks-in-one-long-turn` two of four samples of the second mid-turn pass put the agent's own remaining items ("Update docs/orders.md", "Open PR") under `actions`, the list of things the _user_ must do, which raises the row badge. After the turn ended, three of four samples failed to clear it (F2).

#### F6. A recap opened right after a turn is up to four minutes old and does not look it

**A/B.** When a turn ends less than four minutes after the last pass, the next pass waits out the interval (`live-session-recaps.ts:242`). Opening the recap starts a pass only if the last one is more than 60 s old (`:170`). Until then the panel shows the previous recap. The only sign is one line of note text in the panel (`session-recap-copy.ts:88-90`); the bar and the badge show nothing, and each item looks current. An ask done in the turn that just ended is still listed as open (`addressed-later-user-looks-at-once`, `mid-turn-refresh`: "right after the turn ends" checks; [E2E evidence](./02-scenario-baseline.md#in-the-app)).

#### F7. The user cannot correct it

**A.** Rows under "Asked but not addressed" have no tick and no dismiss, on desktop (`SessionRecapPanel.tsx:231-239`) or mobile (`SessionRecapSheet.tsx:196-202`). The host would accept a mark for them (`session-recap-store.ts:86-97`). A wrong entry stays until the model resolves it, which F2 and F3 make unlikely.

### Lost or wrong content

#### F8. The reply format is beyond what the model reliably produces, and the parser hides it

**A/B.** The delta has three operations, six lists nested under `add`, and ids of six kinds. Recorded replies from the default model include: lists at the top level instead of under `add` (dropped); `firstRequest` echoed back as a key; an agent's question filed under `asked` (`changed-ask`, `terse-confirmations`); a work item whose text is "Test not added", later flipped to done (`addressed-next-turn`); replies wrapped in a code fence; a reply of only `{"resolve": [...]}` with nothing recorded for the turn. The parser accepts any object holding one known key and silently drops the rest (`session-recap-delta.ts:55-91,94,121`), so none of these count as a failure, none is retried, and the recap is not marked degraded. [Measured rates](./02-scenario-baseline.md#how-much-the-model-varies).

#### F9. The first request is usually missing from "What you asked"

**B.** While the recap has no goal, the prompt carries the first request inside the recap JSON as `firstRequest` (`session-recap-prompt.ts:56`) and tells the model never to repeat what the recap already has (`:39`). The model then leaves the first request out of `asked` (`addressed-same-turn`, `addressed-next-turn`, `addressed-several-turns-later` and most first passes in the baseline). The same rule suppresses the open ones: a request made and skipped in the first turn was listed as not addressed in 1 of 56 samples of the default model and 0 of 28 of the fallback.

#### F10. Long sessions lose their beginning, and long replies are cut

**B.** A first automatic pass reads one chunk, the newest 24,000 characters (`session-recap-engine.ts:27,181`); the panel calls this "recent history only" but the early requests and standing rules are gone until the user presses Refresh. A later pass with more than three chunks of new prose drops the oldest (`session-recap-transcript.ts:149-151`) and still moves the cursor. On a full chunk the reply hits the 1,000-token cap mid-list, is not valid JSON, and goes to the repair retry (`long-session-first-recap`: the rebuild's first reply was cut at the cap; a standing rule the user gave at the start is never recorded).

#### F11. A degraded pass is not redone

**B.** When both the reply and the retry are unreadable, the host's fallback records user lines only, and the cursor still advances (`session-recap-engine.ts:197-213`). The next good pass clears the `degraded` mark, but the agent's work in that span is never recorded (`model-reply-not-json`).

#### F12. "Where it stands" goes stale

**B.** `standing` changes only when the model returns one (`session-recap-merge.ts:166`). After a mid-turn pass set it to "Converting catalog routes…", the end-of-turn reply omitted it, and the finished session still reads as converting (`mid-turn-automatic-recap`, `many-asks-in-one-long-turn`).

#### F13. Duplicates are caught only when the text is identical

**B.** `sameText` compares text after removing case and punctuation (`session-recap-merge.ts:47-54`). A request reworded by the model on a later pass is a second item (`restart-mid-session`: "Track reorder button clicks in analytics" and "Add tracking for reorder button clicks").

### Scheduling and failure

#### F14. No fallback model on timeout or server error, and no retry

**B.** Only plan and model-not-found errors move on to the fallback model (`utility-model-service.ts:204-212`). A timeout or a 5xx fails the pass (`model-timeout`, `model-server-error`). A failed pass is not scheduled again: the stamp that scheduled it is unchanged (`live-session-recaps.ts:110-113`), so nothing happens until the session has new activity or the user opens it (`model-timeout`: "a pass that failed is tried again on its own" fails). A rate-limit pause is lifted only when something next reads the provider's health (`utility-model-service.ts:83,113,283-288`); the scheduler sets no timer for the end of the pause, so the session waits for new activity or a visit (`model-rate-limited`: no recap after the pause).

#### F15. A session that ends gets no recap

**B.** Automatic passes need `session.alive` (`live-session-recaps.ts:92`). A CLI session whose process exits right after its last turn, before the 2.5 s delay, is never recapped until the user opens it (`session-ends-right-after-its-turn`).

#### F16. One queue for every session

**C.** Passes run one at a time across all sessions (`session-recap-engine.ts:117-134`). A request that waits out its 60 s timeout delays every other session's recap.

#### F17. Nothing is cached

**C.** There is no cache of model replies by request. Refresh on a recap that is already current re-reads up to three chunks and pays for them again (`live-session-recaps.ts:193-195`), and a desktop and a server watching the same session each pay for their own recap (F20).

### Coverage

#### F18. Copilot and OpenCode get no recap

**C.** See 1.7. This is registry admission, which PR #54 (registry sources) changes; see the [design](./03-overhaul-design.md#overlap-with-open-work).

#### F19. Differences between the journal reader and the file readers

**C.** The chat view hides everything before a `/clear` (`src/shared/agent-session/agent-session-context-clear.ts:64-68`); the journal reader the recap uses does not, so cleared history still feeds the recap (`journal-session-transcript.ts:41-53`). Codex sessions never report what they continue (`src/main/live-sessions/discovery/transcript-summary.ts:189`), so a resumed Codex session does not carry its recap over.

#### F20. Remote sessions are recapped twice and ticks are not shared

**C.** The desktop recomputes recaps for sessions on a server and never asks the server (`use-session-recap.ts:10,44-45`); a phone paired with the server gets the server's own recap. Ticks and dismissals live in whichever store the client talked to (`docs/session-recap.md:315-316`). Measured in the app: 3 model requests on the desktop and 3 on the server for the same two turns, and an item ticked on the desktop is not ticked on the server ([evidence](./evidence/e2e/remote-server-session-through-orcad-the-desktop-recaps-it-the-server-only-once-a/where-the-recap-was-computed.json)). A newly installed server has no utility model: the default provider is Cloudflare Workers AI, whose account is saved on the desktop (`src/shared/utility-model/utility-model-selection.ts:26-30`), so until one is configured on the server its own clients get no recap.

### UI

#### F21. No link between a request, its status and the work

**B.** The panel shows three unrelated lists. Nothing says which work answered which request (`session-recap-types.ts:20-30`).

#### F22. Counts and empty states disagree

**C.** The desktop bar's "N new" counts `ignored` items (`session-recap-view.ts:14-15,38-49`); the badge does not (`live-session-recaps.ts:139-144`). `recapHasContent` ignores `ignored`, `decisions` and `references`, so a recap holding only those draws no sections (`session-recap-view.ts:86-95`). Desktop folds "What you asked" to 6, mobile shows all; desktop hides the bar when recaps are unavailable, mobile keeps its banner (`SessionRecapBar.tsx:62-63`, `SessionRecapBanner.tsx:31-32`).

#### F23. Failures are silent

**C.** RPC errors in the recap hooks are swallowed (`use-session-recap.ts:56,92`). A jump to a message that cannot be found does nothing visible.

#### F25. An open panel does not learn that its recap went stale

**B.** `stale` is computed when the recap is read (`live-session-recaps.ts:162`). The pane reads it when it mounts, when the window gets focus, and when the row's `rev` or `updating` changes (`use-session-recap.ts:62-78`, mounted in `LiveSessionPane.tsx:299`). A turn that ends while the panel is open changes none of these, so the panel keeps the old recap with no note until the next pass lands, up to four minutes later (F6). Showing or hiding the panel on an open session is not a visit, so it starts no pass either. When the note does show, the footer beside it still reads "Updated just now" if the last pass was seconds ago. Seen in the app: [mid-turn-refresh](./evidence/e2e/mid-turn-refresh-on-an-external-Claude-CLI-session-Refresh-mid-turn-shows-the-wo/right-after-the-turn-ends.png), [addressed-later](./evidence/e2e/addressed-later-user-looks-at-once-on-an-external-Claude-CLI-session-the-recap-o/right-after-turn-2.png).

### Restart

#### F26. A relaunch disturbs a recap that was up to date

**B.** Seen in the app on a chat ([evidence](./evidence/e2e/restart-mid-session-in-a-chat-the-recap-survives-a-relaunch-without-a-model-requ/)); the causes below the first were not traced further than the lines given.

- The recap survives and no model request is made, which is right. But the panel shows "The session has moved on since this was written" although nothing was said: `stale` compares the session's last activity with the recap's time (`live-session-recaps.ts:162`), and the relaunch moves the former.
- The session's title becomes its latest prompt. That title is what the next request carries as `firstRequest` (`session-recap-prompt.ts:56`): after the relaunch the model was told the first request was "add the tracking now" (`observed.json`).
- The first turn after the relaunch was recapped about 225 s after it ended. The pass at relaunch finds nothing new and still sets `lastPassAt` (`live-session-recaps.ts:302`), so the next turn waits out the interval (F6).

### Tests

#### F24. Nothing tested what the model actually says

**C.** Before this audit the recap had unit tests on hand-written deltas and one E2E spec with a scripted reply that always lists one ask, one piece of work and one decision (`tests/e2e/fixtures/session-services-claude-stub.cjs`). No test ran a real model reply through the pipeline, and no test had an `ignored` item in it beyond the merge unit test. The [scenario suite](./README.md) added here is the first.
