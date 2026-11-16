# Session recap: scenario baseline

How the recap on `seal/all` (7a6dc74d5d2) behaves before any fix. Three kinds of run:

1. **Pipeline runs.** 52 scenarios on up to four surfaces, 135 runs, through the real recap pipeline with recorded replies from the real model. [Results](#pipeline-runs).
2. **Model variance.** 258 extra samples of the real models on 43 requests taken from those scenarios, to measure how often each outcome happens rather than whether it happened once. [Results](#how-much-the-model-varies).
3. **In the app.** Thirteen of the scenarios in the built app with the recap panel open, on chat, Claude CLI, Codex CLI, SSH and a Seal server. [Results](#in-the-app).

How to run them again: [README](./README.md).

## Summary

- **33 of 135 pipeline runs pass (24%).** 102 fail.
- **The reported bug is reproduced.** A request listed as "asked but not addressed" that the agent then plainly does stays listed after the pass in **17 of 52 samples (33%)** of the default model. It stays for good: nothing reads those messages again. In the app it looks like [this](./evidence/e2e/partly-addressed-then-finished-in-a-chat-nothing-stays-under-asked-but-not-addre/after-turn-2.png): "Where it stands" says `/customers` is paginated with tests, the work list shows it done, and "Asked but not addressed" still lists it.
- **The list is wrong in the other direction far more often.** A request the agent really skipped is listed as not addressed in **1 of 56 samples**. In the pipeline runs, 52 of the 53 checks that expect an open request to be listed fail.
- So today the list is mostly empty, and what does get into it tends to stick. Neither state can be trusted.
- The rest of the recap has its own faults: the first request of a session is missing from "What you asked" in 71% of first passes; about half of the default model's replies do not have the shape the prompt asks for, and the parser accepts them and drops the misplaced parts; a recap opened right after a turn is stale; a failed pass is not retried.

A caveat on the 33%: the model so rarely lists an open request by itself that the resolve probes start from a recap with the open request already in the list, as it would be after a pass that did list it. I had no access to real recaps from Brian's sessions, so which of the mechanisms in the [audit](./01-pipeline-audit.md) produced the entries he saw is inferred, not observed.

## Pipeline runs

Every run is in [evidence/matrix.md](./evidence/matrix.md) (expected recap, actual recap, result, failing checks) and [evidence/matrix.json](./evidence/matrix.json).

Surfaces: Claude CLI transcript file (51 runs), Codex CLI transcript file (42), in-app chat journal (41), Claude on an SSH host read through the remote reader (1). The server case runs the pipeline as a headless server does (`eager: false`). Copilot and OpenCode have no surface: they never reach the pipeline ([audit 1.7](./01-pipeline-audit.md#17-agents-and-surfaces)).

Each model request in a run is answered by a reply recorded from `@cf/zai-org/glm-4.7-flash`, or from `@cf/google/gemma-4-26b-a4b-it` where the scenario makes the pipeline fall back. A recording is one sample, so a run that passes here can fail on another sample and the reverse; the next section measures that.

### By category

A scenario can be in more than one category.

| Category             | Pass | Fail |
| -------------------- | ---: | ---: |
| addressed-same-turn  |    9 |    3 |
| addressed-later-turn |    1 |   18 |
| addressed-implicitly |    3 |    6 |
| partly-addressed     |    0 |    9 |
| multiple-asks        |    6 |   12 |
| withdrawn-or-changed |    0 |    6 |
| declined             |    3 |    3 |
| question-answered    |    3 |   18 |
| question-open        |    6 |    3 |
| long-session         |    0 |    6 |
| restart-resume       |    0 |    5 |
| session-end          |    0 |    6 |
| tool-heavy           |    9 |    3 |
| subagent             |    3 |    3 |
| non-english-terse    |    0 |    9 |
| duplicate-asks       |    3 |    3 |
| mid-turn             |    0 |   11 |
| model-failure        |    1 |    5 |
| agent-surface        |    5 |   11 |
| remote               |    0 |    3 |

By surface: Claude CLI 12 of 51 pass, Codex CLI 11 of 42, chat 10 of 41, Claude over SSH 0 of 1. Every scenario passes or fails the same way on every surface it runs on. The transcript readers are not where the faults are.

### By kind of check

The 600 checks across all runs (186 fail), grouped by what they assert:

| What the check asserts                                   | Fail |  Of |
| -------------------------------------------------------- | ---: | --: |
| A request that is still open is listed as not addressed  |   52 |  53 |
| Nothing is wrongly listed as not addressed               |    6 | 183 |
| A request is recorded under what you asked               |   24 |  49 |
| Nothing is listed as a request that is not one, or twice |    3 |  31 |
| Work is recorded, with the right state                   |   49 | 145 |
| The work list is not padded with repeats                 |    0 |   3 |
| An open question for the user is listed                  |   12 |  18 |
| No stale question is listed                              |    0 |  36 |
| Nothing is wrongly listed as an action for the user      |    9 |  17 |
| An action for the user is listed                         |    0 |   6 |
| A decision is recorded                                   |    7 |   7 |
| "Where it stands" or the goal is right                   |    9 |  13 |
| The recap is written, is current, or says why not        |   15 |  32 |
| Model requests stay within a count                       |    0 |   7 |

### By scenario

| Scenario                                                                                                             | Categories                                     | Surfaces | Result   | What fails                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action-done-by-user`<br>The agent hands the user a task and the user says it is done                                | question-answered                              | 3        | **fail** | the user did it                                                                                                                                                                                                                                                  |
| `addressed-by-commit-and-pr`<br>Commit, push and PR done by commands; the reply is only a link                       | addressed-implicitly                           | 3        | **fail** | the commit, push and PR are recorded as done                                                                                                                                                                                                                     |
| `addressed-implicitly-by-edit`<br>Half of the ask is done by an edit the agent never mentions                        | addressed-implicitly, tool-heavy               | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `addressed-in-the-middle-of-a-long-turn`<br>Three asks done in one long turn; the middle one is reported mid-turn    | addressed-same-turn, multiple-asks, tool-heavy | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `addressed-later-user-looks-at-once`<br>The user opens the recap seconds after the turn that did the open ask        | addressed-later-turn                           | 3        | **fail** | the documentation is asked for and not written yet; what the user opens is up to date with the session; the documentation is recorded as done                                                                                                                    |
| `addressed-next-turn`<br>An ask the agent skips in one turn and does in the next                                     | addressed-later-turn                           | 3        | **fail** | the ask is recorded; the test was asked for and not written yet                                                                                                                                                                                                  |
| `addressed-same-turn`<br>One ask, done in the same turn                                                              | addressed-same-turn                            | 3        | **fail** | the request is recorded                                                                                                                                                                                                                                          |
| `addressed-several-turns-later`<br>An ask left open for three turns, then done                                       | addressed-later-turn                           | 3        | **fail** | the rename is recorded as asked; the README update is recorded as asked; the README is asked for and not done yet; the README is still not done                                                                                                                  |
| `addressed-with-no-prose`<br>A turn that does the work with tools and says nothing                                   | addressed-implicitly, tool-heavy               | 3        | **fail** | running the formatter and committing is recorded as done                                                                                                                                                                                                         |
| `ask-in-the-middle-of-a-long-message`<br>A second ask sits in the middle of a long message with a pasted stack trace | multiple-asks                                  | 3        | **fail** | the row-limit request in the middle of the message is recorded; the 500 is recorded as asked                                                                                                                                                                     |
| `changed-ask`<br>The user changes what they asked for after the agent asks a question                                | withdrawn-or-changed, question-answered        | 3        | **fail** | the agent is waiting on an answer; the request as the user changed it is recorded                                                                                                                                                                                |
| `compaction-before-first-recap`<br>The first recap is written over a transcript that was compacted mid-turn          | long-session, agent-surface                    | 2        | **fail** | the second request is recorded                                                                                                                                                                                                                                   |
| `compaction-between-ask-and-work`<br>The agent compacts its context between an open ask and the turn that does it    | long-session, agent-surface                    | 3        | **fail** | /healthz is asked for and not added yet                                                                                                                                                                                                                          |
| `declined-then-agreed`<br>The agent pushes back, offers another way, and the user takes it                           | declined, question-answered                    | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `declined-with-a-reason`<br>The agent refuses to do what was asked and says why                                      | declined                                       | 3        | **fail** | the agent answered the request with a refusal; it did not overlook it; where things stand says the migrations were kept                                                                                                                                          |
| `duplicate-asks-paraphrased`<br>The same request in three different wordings over three turns                        | duplicate-asks                                 | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `duplicate-reminder`<br>The user reminds the agent of something it skipped; it then needs the user                   | duplicate-asks, question-answered              | 3        | **fail** | the schema docs are asked for and not updated                                                                                                                                                                                                                    |
| `injected-reminders`<br>Text the agent's harness adds to the user's turn                                             | agent-surface                                  | 2        | pass     |                                                                                                                                                                                                                                                                  |
| `long-session-first-recap`<br>A long session gets its first recap after the fact                                     | long-session                                   | 1        | **fail** | LOG_LEVEL was asked for at the start and never added; the recap covers the session from its start; the rule about customer emails is recorded                                                                                                                    |
| `many-asks-in-one-long-turn`<br>Five asks in one message, worked through in one long turn with recaps on the way     | multiple-asks, mid-turn                        | 3        | **fail** | what the agent has left to do is not a to-do for the user; the documentation is recorded as done; the pull request is recorded as done; where things stand says the list is finished; the docs were the agent's job and are done; nothing is waiting on the user |
| `mid-turn-automatic-recap`<br>A long turn gets an automatic recap while the agent is still working                   | mid-turn                                       | 3        | **fail** | where things stand says the migration is finished                                                                                                                                                                                                                |
| `mid-turn-first-look`<br>The user opens a session that has no recap yet while its first turn is running              | mid-turn, multiple-asks                        | 3        | **fail** | the backup codes are recorded as done                                                                                                                                                                                                                            |
| `mid-turn-refresh`<br>The user presses Refresh while the agent is in the middle of its turn                          | mid-turn                                       | 2        | **fail** | the work under way is in progress; the recap is brought up to date when the turn ends; the work is done                                                                                                                                                          |
| `model-failure-then-next-turn`<br>A pass fails and the session goes on                                               | model-failure                                  | 1        | **fail** | the request from the turn whose pass failed is recorded                                                                                                                                                                                                          |
| `model-not-found-fallback`<br>The primary model is gone and the fallback model writes every recap                    | model-failure, addressed-later-turn            | 1        | pass     |                                                                                                                                                                                                                                                                  |
| `model-rate-limited`<br>The provider rate-limits the request                                                         | model-failure                                  | 1        | **fail** | the recap is written once the pause is over; the fix is recorded as done                                                                                                                                                                                         |
| `model-reply-not-json`<br>The model answers in prose twice, so the pass falls back to the bare requests              | model-failure                                  | 1        | **fail** | the work of the turn the model failed on is recorded; the new work is recorded                                                                                                                                                                                   |
| `model-server-error`<br>The primary model answers HTTP 500                                                           | model-failure                                  | 1        | **fail** | the fallback model writes the recap when the primary errors; the fallback model answered                                                                                                                                                                         |
| `model-timeout`<br>The primary model does not answer in time                                                         | model-failure                                  | 1        | **fail** | the fallback model writes the recap when the primary times out; the fallback model answered; a pass that failed is tried again on its own                                                                                                                        |
| `multiple-asks-all-done`<br>Three small asks in one message, all done                                                | multiple-asks, addressed-same-turn             | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `multiple-asks-one-deferred`<br>Four asks in one message; three done, one held back with a reason                    | multiple-asks                                  | 3        | **fail** | the logging is the open one                                                                                                                                                                                                                                      |
| `non-english-session`<br>A session held in Spanish                                                                   | non-english-terse, addressed-later-turn        | 3        | **fail** | the translation is asked for and not done yet; the translation is recorded as done                                                                                                                                                                               |
| `partly-addressed-stays-open`<br>One of three jobs is never migrated and the talk moves on                           | partly-addressed                               | 3        | **fail** | reindex was asked for and is still not migrated                                                                                                                                                                                                                  |
| `partly-addressed-then-finished`<br>Two endpoints asked for, one done, the other a turn later                        | partly-addressed                               | 3        | **fail** | the /customers half is not done; nothing the user asked for is left unaddressed                                                                                                                                                                                  |
| `question-answered`<br>The agent asks which provider to use and the user answers                                     | question-answered                              | 3        | **fail** | the agent is waiting on the user; the emails are recorded as done; the choice of SES is recorded                                                                                                                                                                 |
| `question-ask-answered`<br>A question to the agent, answered in the same turn                                        | addressed-same-turn                            | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `question-dismissed-by-user`<br>The user dismisses a question in the recap and the session goes on                   | question-open                                  | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `question-left-open`<br>The agent asks a question and the user moves on without answering                            | question-open                                  | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `question-tool-answered`<br>The user answers through the agent's question tool                                       | question-answered, agent-surface               | 3        | **fail** | the region the user picked is recorded; the workflow is recorded as done                                                                                                                                                                                         |
| `question-tool-waiting`<br>The agent asks through its question tool and waits                                        | question-open, agent-surface                   | 3        | **fail** | the question asked through the agent's question tool is waiting on the user                                                                                                                                                                                      |
| `remote-server-session`<br>A session on a headless Seal server, which recaps only what a client opens                | remote, addressed-later-turn                   | 2        | **fail** | the documentation is asked for and not written yet; the documentation is recorded as done                                                                                                                                                                        |
| `remote-ssh-session`<br>A Claude session on an SSH host, read through the host's shell                               | remote, addressed-later-turn                   | 1        | **fail** | the documentation is asked for and not written yet; the documentation is recorded as done                                                                                                                                                                        |
| `restart-mid-session`<br>The app restarts between an open ask and the turn that does it                              | restart-resume                                 | 3        | **fail** | tracking is asked for and not done yet; no request is listed twice                                                                                                                                                                                               |
| `resumed-under-a-new-id`<br>The session is resumed, which gives it a new id and a new transcript file                | restart-resume                                 | 2        | **fail** | the restore command is asked for and not written yet                                                                                                                                                                                                             |
| `session-ends-after-doing-the-open-ask`<br>The last turn does the open ask and then the session ends                 | session-end, addressed-later-turn              | 3        | **fail** | the rollback section is asked for and not written yet                                                                                                                                                                                                            |
| `session-ends-right-after-its-turn`<br>The agent finishes and its process exits at once                              | session-end                                    | 3        | **fail** | a session that ended still gets a recap; the sitemap is recorded as done                                                                                                                                                                                         |
| `subagent-does-the-work`<br>The agent hands the job to a subagent and reports its result                             | subagent, agent-surface                        | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `subagent-result-is-the-answer`<br>The answer is in the subagent's result and the agent only points at it            | subagent                                       | 3        | **fail** | the finding is recorded as what the agent did                                                                                                                                                                                                                    |
| `terse-ask-skipped`<br>A terse second ask the agent silently skips                                                   | non-english-terse, partly-addressed            | 3        | **fail** | tests were asked for and not written; the tests are still not written; the node bump is recorded as done                                                                                                                                                         |
| `terse-confirmations`<br>One-word and one-letter messages from the user                                              | non-english-terse, question-answered           | 3        | **fail** | the agent is waiting on a yes or no; the push is recorded as done                                                                                                                                                                                                |
| `tool-heavy-one-word-reply`<br>Twelve tool calls and a one-word reply                                                | tool-heavy                                     | 3        | pass     |                                                                                                                                                                                                                                                                  |
| `withdrawn-ask`<br>The user takes back an ask the agent had not started                                              | withdrawn-or-changed                           | 3        | **fail** | dark mode is asked for and not started                                                                                                                                                                                                                           |

## How much the model varies

43 requests were taken from the scenario runs and sent again to the real models: 4 times each to the default model (172 samples), 2 times each to the fallback (86). Requests, replies and scores are in [evidence/variance/](./evidence/variance/). Each reply was parsed by the product parser and, for the resolve probes, merged by the product merge.

Three kinds of probe:

- **Open** (14): the pass over a turn in which the agent skipped or deferred one of the requests. Right: the request is added to "not addressed".
- **Clean** (16): the pass over a turn in which everything asked was done, declined with a reason, or is still being worked on. Right: nothing is added to "not addressed".
- **Resolve** (13): the pass over the turn that does a request which the recap already lists as not addressed. Right: after the merge, the list is empty.

|                                                               | glm-4.7-flash (default) | gemma-4-26b (fallback) |
| ------------------------------------------------------------- | ----------------------- | ---------------------- |
| Open: the skipped request is listed                           | 1 of 56 (2%)            | 0 of 28                |
| Clean: nothing is listed                                      | 64 of 64                | 32 of 32               |
| Resolve: the addressed request is still listed after the pass | **17 of 52 (33%)**      | 1 of 26 (4%)           |
| of which: resolved and added back in the same reply           | 4                       | 0                      |
| of which: `resolve` names another kind of id, or nothing      | 13                      | 1                      |
| First pass records at least one request                       | 37 of 128 (29%)         | 8 of 64 (13%)          |
| First pass sets the goal                                      | 61 of 128 (48%)         | 63 of 64 (98%)         |
| Adds the agent's own work as an action for the user           | 18 of 172 (10%)         | 0 of 86                |
| Reply rejected by the parser                                  | 9 of 172                | 0 of 86                |
| Reply has the asked-for shape (a code fence allowed)          | 91 of 172 (53%)         | 73 of 86 (85%)         |
| Reply with lists or keys the parser silently drops            | 33 of 172 (19%)         | 1 of 86                |
| `resolve` holds an id that cannot be resolved                 | 57 of 172               | 12 of 86               |
| Neurons per request                                           | 8.2                     | 10.1                   |

### Resolve probes

Samples in which the addressed request is still listed after the pass:

| Probe (the scenario it comes from)      | glm-4.7-flash | gemma-4-26b |
| --------------------------------------- | ------------- | ----------- |
| `addressed-next-turn`                   | 0 of 4        | 0 of 2      |
| `addressed-several-turns-later`         | 1 of 4        | 0 of 2      |
| `addressed-later-user-looks-at-once`    | 0 of 4        | 0 of 2      |
| `compaction-between-ask-and-work`       | 1 of 4        | 0 of 2      |
| `duplicate-reminder`                    | 1 of 4        | 0 of 2      |
| `non-english-session`                   | 2 of 4        | 0 of 2      |
| `partly-addressed-then-finished`        | 1 of 4        | 0 of 2      |
| `restart-mid-session`                   | 2 of 4        | 0 of 2      |
| `resumed-under-a-new-id`                | 2 of 4        | 0 of 2      |
| `session-ends-after-doing-the-open-ask` | 1 of 4        | 0 of 2      |
| `withdrawn-ask`                         | 1 of 4        | 0 of 2      |
| `changed-ask`                           | 3 of 4        | 0 of 2      |
| `declined-then-agreed`                  | 2 of 4        | 1 of 2      |

What the misses look like (default model):

- `"resolve": ["a2"]`, `["w1"]`, `["a5","w3"]`: the id of the request under "what you asked" or of the work item, not of the not-addressed item. The merge ignores them.
- `"resolve": ["i5"]` together with `"ignored": [{"text": "Track clicks on reorder button in analytics"}]`: resolved and added back, reworded or word for word.
- No `resolve` at all; the work is recorded as done and the list is left alone.

### One long turn, sampled

The three requests of `many-asks-in-one-long-turn` (five requests and a PR in one message; passes at four minutes, eight minutes and the end of the turn), 4 samples each: [samples](./evidence/variance/many-asks-in-one-long-turn-samples.json).

- First pass: 1 of 4 replies is well-formed. One records no request, one is empty, one is in a code fence.
- Eight minutes in: 2 of 4 put the agent's remaining items ("Update docs/orders.md", "Open PR") under actions for the user.
- End of turn: all 4 replies are malformed (lists at the top level, `resolves`, ids of requests in `resolve`). The action item for the user survives in 3 of 4.

## In the app

Thirteen scenarios were driven through the built app (Electron, hidden window) with the recap panel open, on five surfaces. Each test replays the recorded replies of the real model for its scenario, checks the recap the panel reads against the scenario's expectations, checks that the panel lists exactly what the recap holds, and saves a screenshot and the recap JSON at every checkpoint under [evidence/e2e](./evidence/e2e).

In the app the utility model is the scripted `claude` stub that E2E specs already use, answering with the recorded Workers AI replies. The Workers AI adapter itself is not exercised here; its fallback and error handling are covered by the pipeline runs.

**All 13 show at least one wrong or missing statement.** Each is marked `test.fail`, so the spec passes today and a test starts failing when its scenario is fixed. In no test did the panel list anything other than the recap it was given: the faults are in the recap, not in the drawing of it.

| Scenario                           | Surface            | Expected                                                                                              | Actual                                                                                                                                                                                                                                                            | Result | Evidence               |
| ---------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------- |
| partly-addressed-then-finished     | Claude chat        | After turn 1 `/customers` is open. After turn 2 nothing is left under "Asked but not addressed".      | After turn 1 nothing is open. After turn 2, which does `/customers`, "Asked but not addressed" lists "Leave /customers for follow-up due to helper" next to a work list that shows it done.                                                                       | fail   | [after turn 2][e-pc]   |
| partly-addressed-then-finished     | Claude CLI         | Same.                                                                                                 | Same. The pass for turn 2 came 240 s after turn 2 ended.                                                                                                                                                                                                          | fail   | [after turn 2][e-pe]   |
| addressed-same-turn                | Claude chat        | The request is under "What you asked", the fix under done.                                            | The fix is listed; the request is not.                                                                                                                                                                                                                            | fail   | [after turn 1][e-as]   |
| declined-with-a-reason             | Claude chat        | A request the agent refused, with its reason, is not listed as overlooked.                            | "Delete the old migrations folder" is under "Asked but not addressed". "Where it stands" is empty.                                                                                                                                                                | fail   | [after turn 1][e-dc]   |
| declined-with-a-reason             | Codex CLI          | Same.                                                                                                 | Same.                                                                                                                                                                                                                                                             | fail   | [after the turn][e-dx] |
| addressed-later-user-looks-at-once | Claude CLI         | Turn 1 leaves the documentation open; turn 2 writes it; the user opens the recap right after turn 2.  | Opened seconds after turn 2: the recap of turn 1 with the note "The session has moved on since this was written". The next pass came about four minutes later and still does not record the documentation as written.                                             | fail   | [on opening][e-al]     |
| mid-turn-refresh                   | Claude CLI         | Refresh while the agent works shows the work as in progress; the recap is current when the turn ends. | After Refresh no work is listed. When the turn ends the recap stays as it was, with no note that it is behind, until the pass 240 s after the Refresh; that pass records the work as done.                                                                        | fail   | [after Refresh][e-mt]  |
| question-tool-waiting              | Claude CLI         | A question asked through the agent's question tool is under "Questions for you".                      | No question is listed. The work list has one item, "Proposed setting up staging deploy workflow", as blocked.                                                                                                                                                     | fail   | [while waiting][e-qt]  |
| session-ends-right-after-its-turn  | Claude CLI         | A session that ends right after its turn still gets a recap.                                          | A minute after it ended there is no recap and no request was made. The row moves under "Recently finished" (folded); a recap is written only when the user opens the session.                                                                                     | fail   | [a minute later][e-se] |
| summarizer failure                 | Claude chat        | A failed pass is tried again without the user.                                                        | The panel shows "The last update failed: …" and nothing else. No request follows in 90 s of idle. Refresh recovers it.                                                                                                                                            | fail   | [after idle][e-sf]     |
| restart-mid-session                | Claude chat        | The recap survives a relaunch with no model request; turn 2 clears the open request.                  | The recap survives and no request is made (correct). The open request was never listed as open, and after turn 2 the same request is under "What you asked" twice in different words. The relaunch also marks the recap as behind and delays the next pass (F26). | fail   | [after turn 2][e-rs]   |
| remote-ssh-session                 | Claude over SSH    | As addressed-later, for a session on an SSH machine.                                                  | Same faults. The recap is made on the desktop (3 model requests) from the file read over SSH, and is stale right after turn 2.                                                                                                                                    | fail   | [after the pass][e-rh] |
| remote-server-session              | Claude on a server | One recap for the session, whichever side shows it.                                                   | Two recaps: the desktop makes its own (3 requests) and the server makes another once a client opens it (3 requests, 0 before). An item ticked on the desktop is not ticked on the server. Same recap faults on both.                                              | fail   | [where computed][e-rv] |

[e-pc]: ./evidence/e2e/partly-addressed-then-finished-in-a-chat-nothing-stays-under-asked-but-not-addre/after-turn-2.png
[e-pe]: ./evidence/e2e/partly-addressed-then-finished-on-an-external-Claude-CLI-session-once-turn-2-fin/after-turn-2.png
[e-as]: ./evidence/e2e/addressed-same-turn-in-a-chat-the-request-is-listed-under-what-you-asked-and-its/after-turn-1.png
[e-dc]: ./evidence/e2e/declined-with-a-reason-in-a-chat-a-request-the-agent-refused-with-a-reason-is-no/after-turn-1.png
[e-dx]: ./evidence/e2e/declined-with-a-reason-on-an-external-Codex-CLI-session-a-refused-request-is-not/after-the-turn.png
[e-al]: ./evidence/e2e/addressed-later-user-looks-at-once-on-an-external-Claude-CLI-session-the-recap-o/right-after-turn-2.png
[e-mt]: ./evidence/e2e/mid-turn-refresh-on-an-external-Claude-CLI-session-Refresh-mid-turn-shows-the-wo/mid-turn-after-refresh.png
[e-qt]: ./evidence/e2e/question-tool-waiting-on-an-external-Claude-CLI-session-a-question-asked-through/while-the-agent-waits.png
[e-se]: ./evidence/e2e/session-ends-right-after-its-turn-on-an-external-Claude-CLI-session-a-session-wh/a-minute-after-the-session-ended.png
[e-sf]: ./evidence/e2e/summarizer-failure-in-a-chat-the-failed-recap-is-written-without-new-chat-activi/after-idle.png
[e-rs]: ./evidence/e2e/restart-mid-session-in-a-chat-the-recap-survives-a-relaunch-without-a-model-requ/after-turn-2.png
[e-rh]: ./evidence/e2e/remote-ssh-session-over-SSH-the-documentation-is-asked-but-not-addressed-after-t/after-the-next-automatic-pass.png
[e-rv]: ./evidence/e2e/remote-server-session-through-orcad-the-desktop-recaps-it-the-server-only-once-a/where-the-recap-was-computed.json

Not run in the app:

- **Copilot and OpenCode.** Their sessions never become rows the recap can attach to ([audit 1.7](./01-pipeline-audit.md#17-agents-and-surfaces)), so there is no panel to open.
- **Codex in-app chat.** The E2E stub scripts the `claude` binary only. The chat journal has the same form for both agents, and the pipeline runs cover it.
- **Mobile.** The sheet draws the same view model as the desktop panel; it was read, not run.
- **The remaining 43 scenarios.** They run in the pipeline suite only. A two-turn scenario takes five minutes in the app, because the pass after the second turn waits out the four-minute interval (finding F6).

The requests the app sent were the pipeline's, to the character, with three exceptions that left the new messages unchanged: the `firstRequest` after a relaunch (F26), the same field cut with an ellipsis in `mid-turn-refresh`, and the parser's error text in a repair request. `session-ends-right-after-its-turn` has no recording for the request made when the user opens the ended session, so that screenshot shows only that a recap gets written.

Also seen in the app:

- An open panel is not told that its recap went stale, and showing the panel is not a visit ([F25](./01-pipeline-audit.md#f25-an-open-panel-does-not-learn-that-its-recap-went-stale)).
- A relaunch marks a current recap as behind, renames the session to its latest prompt and delays the next pass ([F26](./01-pipeline-audit.md#f26-a-relaunch-disturbs-a-recap-that-was-up-to-date)).
- In the chat screenshots the conversation beside the recap is empty. The session pane reads only the transcript file, and the scripted chat writes none; the recap is written from the chat journal. Whether a recap item's jump lands in a real chat's pane was not tested ([F23](./01-pipeline-audit.md#f23-failures-are-silent)).
- Outside the recap: an agent process of another OS user is listed as a session titled "cwd (readlink: Permission denied)", visible in several screenshots. The discovery script takes `lsof`'s error text as the working folder (`src/main/live-sessions/discovery/discovery-script.ts:58-60`). Such a row has no transcript and gets no recap.

## Cost of this baseline

About 360 model requests, 3,260 neurons in total, on the account's Workers AI allowance. No resource was created on the account. The VM had no Workers AI credential; requests were relayed through the Cloudflare MCP tool.
