# Session status

What each agent session is doing, said in one of ten status codes. Home, the Active agents sidebar,
Machines, the session view, mobile, the CLI and the Home chat tools all read the same field
(`LiveSession.status`), so a session reads the same everywhere.

- Model: `src/shared/live-sessions/live-session-status.ts` (groups, order, tones) and
  `live-session-types.ts` (the codes).
- Detector: `src/main/live-sessions/discovery/` (one scan of a machine) and
  `src/main/live-sessions/live-session-registry.ts` (hold, summaries, events).
- Labels: `live-session-presentation.ts` on desktop and on mobile, from the `status` block of the
  Seal locale overrides.

## Status codes

| Code               | Label                         | Dot          | Whose move      | Meaning                                                              |
| ------------------ | ----------------------------- | ------------ | --------------- | -------------------------------------------------------------------- |
| `needs-permission` | Waiting for approval          | amber, halo  | Yours, now      | A permission prompt or a dialog holds a tool call until you answer.  |
| `waiting-input`    | Asking you a question         | orange, halo | Yours, now      | It asked through its question tool, or its turn ended on a question. |
| `errored`          | Error                         | red, halo    | Yours, now      | The turn failed (API error, crashed tool run).                       |
| `working`          | Working                       | blue spinner | The agent's     | It is generating, or a tool call is in flight.                       |
| `running-shell`    | Running shell                 | solid blue   | The agent's     | A foreground shell command it started is still running.              |
| `waiting-subagent` | Waiting on N subagents        | blue ring    | The agent's     | It waits for subagents it launched, in its turn or after it.         |
| `waiting-task`     | Waiting on N background tasks | blue ring    | The agent's     | Its turn ended, but background commands it started still run.        |
| `your-turn`        | Waiting on you                | green        | Yours, whenever | It finished its turn and told you the result. Nothing runs.          |
| `idle`             | Idle                          | grey         | Nobody's        | It runs, but has had no turn yet.                                    |
| `done`             | Ended                         | grey         | Nobody's        | Its process is gone.                                                 |

The order of the table is the order of every list of running sessions (`compareLiveSessions`):
what blocks on you first, then what is busy, then what rests. "Recently finished" is ordered by
last activity alone.

Colors are existing tokens from `src/renderer/src/assets/main.css`; `LiveSessionStatusDot` is the
one component that draws them, in two sizes (`lg` on Home cards, `sm` in the sidebar and pills):

| Tone (`liveSessionStatusTone`) | Statuses                           | Dot                   | Label text                 |
| ------------------------------ | ---------------------------------- | --------------------- | -------------------------- |
| `busy`                         | `working`, `running-shell`         | `agent-working`       | `text-agent-working`       |
| `waiting`                      | `waiting-subagent`, `waiting-task` | `agent-working` ring  | `text-agent-working`       |
| `approval`                     | `needs-permission`                 | `status-warning`      | `text-status-warning-text` |
| `question`                     | `waiting-input`                    | `agent-question`      | `text-agent-question-text` |
| `turn`                         | `your-turn`                        | `status-success`      | `text-status-success`      |
| `failed`                       | `errored`                          | `destructive`         | `text-destructive`         |
| `quiet`                        | `idle`, `done`                     | `muted-foreground/40` | `text-muted-foreground`    |

Groups (`liveSessionStatusGroup`) are unchanged in number: `attention` (approval, question, error),
`working` (working, running shell, both waits), `idle` (`your-turn`, `idle`), `finished` (`done`).
The Home header counts them as "N working · N blocked on you · N waiting on you · N idle".

A session is running or finished by `isActiveLiveSession`, which every list, badge and count
shares. It is running while its process is seen, and also while its status is one only a running
agent has: the `working` group, `needs-permission` and `waiting-input`. So a prompt or a question
is never listed under "Recently finished", even on a host whose `ps` cannot list processes or in
the scan that misses the process. A prompt that only a leftover hook file reports is dropped once
the agent is known to be gone (layer 5). `errored` outlasts its agent: with the process gone it is a
finished session that ended in an error. `your-turn` and `idle` with no process are an agent that
just quit, and read as finished.

A question asked through the question tool also outlasts its agent. The transcript holds it open
until an answer or the end of the turn is written after it, so the session stays `waiting-input`
for as long as the transcript says so, whether or not a process is seen, and whatever the agent's
hook file says (layer 5). With no process seen, Seal offers to answer by resuming the session once
the transcript has been quiet for 2 minutes; until then the agent may still be there, and a resume
next to it would fork the conversation. A turn that only ended on a question (layer 6) is over in
the transcript, so once its process is gone it reads as finished like any other ended turn.

"Process gone" means no process is seen and the transcript was last written more than 2 minutes
ago (`FRESH_WRITE_MS`). A transcript written more recently belongs to a running agent even if `ps`
missed it, so for those 2 minutes a session with no process still reads as its transcript says: a
pending call as `working`, an ended turn as `your-turn`, or as `waiting-input` when its reply asks.

`statusDetail` says what the status is about: the command or file (`Bash: pnpm test`), the call a
prompt holds (`Allow Bash: rm -rf build?`), the question asked, the error. `statusSource` says
which signal decided: `seal-hooks`, `agent-hooks`, `screen`, `process`, `transcript`,
`classifier`.

## How a status is detected

Signals are layered from most to least certain. A lower layer only fills in what the layers above
it left open.

### 1. The transcript (always)

The newest turn of the session's own log: Claude Code's `~/.claude/projects/**.jsonl`, Codex's
`~/.codex/sessions/**/rollout-*.jsonl` (`claude-transcript-phase.ts`, `codex-transcript-phase.ts`).

| The log's newest turn                                                                    | Phase                | Status                                    |
| ---------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------- |
| A prompt, reasoning, text with no end record yet                                         | `working`            | `working`                                 |
| A tool call with no result                                                               | `tool-pending`       | `working`, refined by layers 3–4          |
| `AskUserQuestion` / `ExitPlanMode` (Claude), `request_user_input` (Codex) with no result | `input-requested`    | `waiting-input`, detail is the question   |
| Codex approval request event                                                             | `approval-requested` | `needs-permission`                        |
| End of turn (`turn_duration`, `stop_hook_summary`, `task_complete`)                      | `turn-ended`         | `your-turn`, or `waiting-input` (layer 6) |
| End of turn right after an API error record, `turn_aborted` with an error                | `errored`            | `errored`                                 |
| No turn at all                                                                           | `unknown`            | `idle`                                    |
| Process gone, and the newest turn neither failed nor is an unanswered question           |                      | `done`                                    |

A reply with no end-of-turn record is still `working` for 5 seconds: a tool call may follow. For
`ExitPlanMode` the detail is the fixed text "Plan ready for review".

### 2. Subagents and background tasks

`claude-transcript-activity.ts` folds every `Agent`/`Task` launch, background `Bash`, and
`<task-notification>` in the transcript; `session-activity.ts` joins them with the subagents' own
transcript files (Claude) or helper threads (Codex).

| Situation                                                                  | Status             |
| -------------------------------------------------------------------------- | ------------------ |
| The pending tool call is a subagent launch (`Agent`, `Task`, `wait_agent`) | `waiting-subagent` |
| Turn ended, background subagents still running                             | `waiting-subagent` |
| Turn ended, only background commands still running                         | `waiting-task`     |

An explicit question (`input-requested`) outranks a wait.

### 3. The process tree

A pending shell call looks the same in the transcript whether the command runs or a permission
prompt holds it: nothing is written until it ends. The process list tells them apart. The scan
lists every process under each agent (`@@CHILDREN` in `discovery-script.ts`), and
`agent-tool-processes.ts` keeps the ones that are tool commands: Claude Code's
`bash -c source ~/.claude/shell-snapshots/…` wrapper, Codex's sandbox (`codex-linux-sandbox`,
`bwrap`, `sandbox-exec`), or any other shell under the agent. Codex runs its commands under a
detached `codex app-server`, so for Codex the commands under any app-server count.

| Pending call                                    | Process evidence                                | Status             | After   |
| ----------------------------------------------- | ----------------------------------------------- | ------------------ | ------- |
| Foreground shell command                        | A command process started at or after the call  | `running-shell`    | 3 s     |
| Foreground shell command                        | No such process                                 | `needs-permission` | 5 s     |
| File edit (`Edit`, `Write`, `apply_patch`)      | No result                                       | `needs-permission` | 8 s     |
| Codex polling a command (`write_stdin`, `wait`) | Any command process                             | `running-shell`    | at once |
| Any                                             | The host listed no processes (`ps` unavailable) | stays `working`    |         |

The approval mode moves the prompt threshold: Claude's `auto` mode reviews a call on the server
first (20 s), `acceptEdits` never asks for edits, `bypassPermissions` / `dontAsk` / Codex `never`
never ask at all. The mode comes from the transcript (`permission-mode` records, Codex
`turn_context`) or the agent's command line.

### 4. The terminal screen

For a session in a tmux pane or a Seal terminal the scan reads the visible screen
(`agent-screen.ts`):

| On screen                                                                    | Effect                                                      |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| An approval dialog ("Do you want to proceed?", Codex's "Would you like to…") | `needs-permission`. Numbered choices become answer buttons. |
| Any other dialog while a turn runs (Claude's auto-mode notice)               | `needs-permission`, detail is the dialog's first line.      |
| The input box, while the status is `needs-permission`                        | Back to `working`: the prompt was answered.                 |
| The interrupt hint ("esc to interrupt") while the transcript says resting    | `working`: a turn started that is not logged yet.           |

### 5. Hooks

- **Seal's own panes** (`seal-hooks`): a session started in a Seal terminal reports through the
  agent-status hooks Seal installs for its panes (`seal-pane-sessions.ts`). A pending approval, or
  a wait on a tool that is not a question tool, is `needs-permission`; a wait on a question is
  `waiting-input`; a finished turn is `your-turn`. The scan still adds what a hook cannot say
  (running shell, subagent and task waits, a reply that asks).
- **The agent's hook file** (`agent-hooks`): status the agent wrote itself. It counts unless it
  was written more than 2 minutes before the transcript's last write (`HOOK_STALE_MS`). An agent
  killed mid-turn or at a prompt never clears its file, so a `working` or `needs` state counts
  only while the agent may still be there. Once the host's `ps` has listed its processes
  (`@@PS`), the agent is not among them and the transcript has gone quiet, the file is ignored
  and the session reads as its transcript says. A host whose `ps` cannot list processes proves
  nothing, and the hook stands. A `done` or `idle` state reads as the ended turn does (layer 6),
  or `done` with the process gone.
- A question the transcript holds open outranks the hook file altogether. The agent's hooks fire
  around the question tool like around any other call, so the file says `working` or `needs`
  until the answer, and `done` or `idle` if it was left from an earlier turn; none of them says
  what the agent waits on.

### 6. Did the last reply ask a question?

A finished turn is `your-turn` unless its reply hands you a question. `reply-ask.ts` reads the
reply's last lines, ignoring code, links and quotes:

| The reply                                                                                               | Verdict   | Status                 |
| ------------------------------------------------------------------------------------------------------- | --------- | ---------------------- |
| Its last line ends in a question mark                                                                   | `asks`    | `waiting-input`        |
| Nothing in its last four lines asks                                                                     | `tells`   | `your-turn`            |
| A question mark earlier in the closing lines, or a request in words ("let me know which…", "should I…") | `unclear` | the classifier decides |

### 7. The classifier (fallback only)

Only an `unclear` reply reaches a model. `LiveSessionReplyAsks`
(`src/main/session-summaries/live-session-reply-asks.ts`) sends the last 700 characters of the
reply through the same `SessionSummarizer` that writes session summaries, on
`SessionSummariesHost.model('summaries')`: whichever provider and model Settings > Session
summaries & recaps chose for summaries (Cloudflare Workers AI with `glm-4.7-flash` by default,
OpenRouter or any other provider offered there). It never picks a provider of its own.

- The answer is one word, ASKS or TELLS (`maxTokens: 8`): about 200 tokens in, about two neurons.
- Cached by session and reply hash in `session-summaries/reply-asks.json`: a reply is classified
  once, and again only when the session writes a new reply.
- It can only raise `your-turn` to `waiting-input` (`statusSource: 'classifier'`). Until it
  answers, and whenever summaries are off, paused, over budget or unconfigured, the session stays
  `your-turn`.
- It runs as background work on the shared utility-model service: after a rate limit or a spent
  allocation the service holds every request to that provider, so a spent budget costs nothing
  more.

### 8. Hold

A session between two tool calls, or one whose process list was cut short, can read as finished for
one scan. `LiveSessionStatusHold` keeps a busy session busy until a second scan of its machine
agrees (3 s locally, 8 s over SSH), or 20 s pass. Only inferred readings are held (`transcript`,
`process`, `classifier`). A hook event, a dialog on screen, `needs-permission` and `errored` are
shown at once, and so is every change into a busy status. This also keeps the "finished"
notification from firing for a turn that is still running.

## Decision table

Read top to bottom; the first row that matches wins.

| #   | Signal                                                                 | Status                               | Source        |
| --- | ---------------------------------------------------------------------- | ------------------------------------ | ------------- |
| 1   | Approval dialog on screen                                              | `needs-permission`                   | `screen`      |
| 2   | Other dialog on screen while the turn is busy                          | `needs-permission`                   | `screen`      |
| 3   | Seal pane hook says a permission or question is pending                | `needs-permission` / `waiting-input` | `seal-hooks`  |
| 4   | Transcript: question tool pending, with or without a process           | `waiting-input`                      | `transcript`  |
| 5   | Agent hook file says a prompt is pending, agent not known to be gone   | `needs-permission`                   | `agent-hooks` |
| 6   | Agent hook file says working, agent not known to be gone               | `working`, refined by rows 9–11      | `agent-hooks` |
| 7   | Transcript: the turn failed                                            | `errored`                            | `transcript`  |
| 8   | Process gone                                                           | `done`                               | `transcript`  |
| 9   | Transcript: subagent launch pending                                    | `waiting-subagent`                   | `transcript`  |
| 10  | Pending shell call, its command process is running for 3 s             | `running-shell`                      | `process`     |
| 11  | Pending shell or edit call, nothing running, past the prompt threshold | `needs-permission`                   | `process`     |
| 12  | Transcript: turn in progress                                           | `working`                            | `transcript`  |
| 13  | Turn ended, interrupt hint on screen                                   | `working`                            | `screen`      |
| 14  | Turn ended, background subagents running                               | `waiting-subagent`                   | `transcript`  |
| 15  | Turn ended, background commands running                                | `waiting-task`                       | `transcript`  |
| 16  | Turn ended, reply ends in a question                                   | `waiting-input`                      | `transcript`  |
| 17  | Turn ended, reply unclear, classifier says ASKS                        | `waiting-input`                      | `classifier`  |
| 18  | Turn ended                                                             | `your-turn`                          | `transcript`  |
| 19  | No turn yet                                                            | `idle`                               | `transcript`  |

"Process gone" is no process seen and a transcript quiet for 2 minutes. Row 6 keeps the source
`agent-hooks` unless row 10 or 11 refines it, which report `process`.

An agent hook file that says `done` or `idle` says the turn is over, with source `agent-hooks`.
While the agent runs, an ended turn reads as rows 14–18 read it, and any other newest turn as
`idle`: a pending call, and a failed turn too. With the process gone it reads `done`.

## Older clients

`running-shell`, `your-turn` and the sources `process` and `classifier` are new on the wire. A
client that sends its capabilities without `live-sessions.status.v2` (a mobile or web build from
before this change) is sent `working` for `running-shell`, `idle` for `your-turn`, and `transcript`
for the new sources (`live-session-status-compat.ts`).

## Known limits

- Without a terminal screen (an agent outside tmux and outside Seal), an approval prompt is
  inferred from the process tree after 5–20 s rather than read at once, and a prompt that holds a
  subagent launch reads as `waiting-subagent`.
- A host whose `ps` cannot list processes gets no `running-shell`; such a session stays `working`.
- An agent killed while its question was open never writes an end to its transcript, so the
  session keeps asking until it is answered, removed from Seal, or its transcript is 12 hours old
  and leaves the scan.
- On a host whose `ps` cannot list processes, an agent whose transcript has been quiet for 2
  minutes cannot be told from one that is gone, so Seal offers to resume it: at a question, and
  also while its hook file says it works or waits at a prompt. Answering there starts a second
  process on the same conversation.
- A `done` or `idle` hook file written after a failed turn hides the error: the session reads
  `idle` while its agent runs and `done` after, not `errored`.
- Providers other than Claude Code and Codex have no session record; they keep their pane status.

## How this was verified

Automated: `src/main/live-sessions/discovery/session-status-fixtures.test.ts` runs the real scanner
over transcripts and screens captured from real Claude Code 2.1 and Codex 0.169 sessions
(`__fixtures__/live-*`), `host-session-scanner.test.ts` runs it against a real process tree, and
`live-session-status-hold.test.ts`, `reply-ask.test.ts`, `live-session-reply-asks.test.ts` cover
the hold and the reply tiers.

By hand, to re-check against a live agent: start `claude` or `codex` in tmux, open Home, and

1. ask it to run `sleep 90` → Running shell within a few seconds, until the command ends;
2. ask it something it must ask back about → Asking you a question;
3. ask it to delete a file in default permission mode → Waiting for approval;
4. let a turn finish → Waiting on you;
5. ask it to run two subagents in the background → Waiting on 2 subagents.
