# Agent status

What each agent session is doing, said in one of ten status codes, and how Seal arrives at it.
This is the state machine: every status, every input that drives it, which event moves a session
where, and which signal wins when two disagree.

## One source of truth

Every session has one status: `LiveSession.status`, computed in the main process by the live-session
registry. Every surface reads that field and none computes its own:

| Surface                                                 | Reads                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Active agents sidebar, Home, Machines, Project overview | `LiveSession.status` (`liveSessionRegistryStore`)             |
| Session view header, pills, command palette             | the same store                                                |
| Phone and web clients                                   | the same registry, over the runtime RPC                       |
| `seal sessions` CLI, Home chat `list_sessions`          | the registry snapshot                                         |
| Session summaries and recaps                            | the registry's events                                         |
| Desktop notifications                                   | the registry's events (`live-session-notices.ts`)             |
| Terminal tab glyph, workspace card dot                  | the pane's hook row, or its session where discovery knew more |

The predicates every surface shares live in `src/shared/live-sessions/live-session-status.ts`:

| Predicate                        | True for                                                         | Used by                                         |
| -------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- |
| `isActiveLiveSession`            | a process is seen, or the status is one only a running agent has | every list, badge, count, CLI, Home chat        |
| `isTurnRunningLiveSessionStatus` | `working`, `running-shell`                                       | recaps (a turn is going), pane roll-ups         |
| `isWaitingOnBackgroundWork`      | `waiting-subagent`, `waiting-task`                               | row and label rendering                         |
| `isSettledLiveSessionStatus`     | `waiting-input`, `your-turn`, `idle`, both waits                 | summaries, recaps (there is a stop to describe) |
| `isRestingLiveSessionStatus`     | `your-turn`, `idle`                                              | discovery                                       |
| `liveSessionStatusGroup`         | `attention`, `working`, `idle`, `finished`                       | sort order, counts, notifications               |

Agents that run in a Seal terminal also have a hook row (`AgentStatusEntry`: `working`, `blocked`,
`waiting`, `done`, with `workingMode`, `mainAgent`, `interrupted`). For Claude Code and Codex that
row is one input of the pane's session, not a second status: `sealPanesFromRows` maps it to a
status and `mergeSealPanes` joins it with what discovery read (see
[Seal panes](#seal-panes-hook-rows-against-discovery)). The tab glyph and the workspace dot roll
pane rows up for every agent type; for a pane whose session took its status from discovery they
read the session instead (`live-session-pane-activity.ts`), so they cannot disagree with the
session's row. Providers other than Claude Code and Codex have no session record; their hook row
is their status.

- Model: `src/shared/live-sessions/live-session-status.ts`, `live-session-types.ts`.
- Detector: `src/main/live-sessions/discovery/` (one scan of a machine),
  `src/main/live-sessions/seal-panes/` (Seal's own panes), and
  `src/main/live-sessions/live-session-registry.ts` (hold, unreachable machines, events).
- Labels: `live-session-presentation.ts` on desktop and on mobile.

## Status codes

| Code               | Label                         | Dot          | Whose move      | Meaning                                                                |
| ------------------ | ----------------------------- | ------------ | --------------- | ---------------------------------------------------------------------- |
| `needs-permission` | Waiting for approval          | amber, halo  | Yours, now      | A permission prompt or a dialog holds a tool call until you answer.    |
| `waiting-input`    | Asking you a question         | orange, halo | Yours, now      | It asked through its question tool, or its turn ended on a question.   |
| `errored`          | Error                         | red, halo    | Yours, now      | The turn failed (API error, crashed tool run).                         |
| `working`          | Working                       | blue spinner | The agent's     | It is generating, or a tool call is in flight.                         |
| `running-shell`    | Running shell                 | solid blue   | The agent's     | A foreground shell command it started is still running.                |
| `waiting-subagent` | Waiting on N subagents        | blue ring    | The agent's     | It waits for subagents it launched, in its turn or after it.           |
| `waiting-task`     | Waiting on N background tasks | blue ring    | The agent's     | Its turn ended, but work it left in the background still runs.         |
| `your-turn`        | Waiting on you                | green        | Yours, whenever | It finished its turn and told you the result. Nothing of its own runs. |
| `idle`             | Idle                          | grey         | Nobody's        | It runs, but has had no turn yet.                                      |
| `done`             | Ended                         | grey         | Nobody's        | Its process is gone.                                                   |

"Waiting on you" is only ever shown for a turn that ended with nothing of the agent's still
running. Work left behind a finished turn is `waiting-task` or `waiting-subagent`: the agent wakes
itself when that work reports, so the next move is still its own.

The order of the table is the order of every list of running sessions (`compareLiveSessions`).
Colors are existing tokens from `src/renderer/src/assets/main.css`; `LiveSessionStatusDot` is the
one component that draws them:

| Tone (`liveSessionStatusTone`) | Statuses                           | Dot                   | Label text                 |
| ------------------------------ | ---------------------------------- | --------------------- | -------------------------- |
| `busy`                         | `working`, `running-shell`         | `agent-working`       | `text-agent-working`       |
| `waiting`                      | `waiting-subagent`, `waiting-task` | `agent-working` ring  | `text-agent-working`       |
| `approval`                     | `needs-permission`                 | `status-warning`      | `text-status-warning-text` |
| `question`                     | `waiting-input`                    | `agent-question`      | `text-agent-question-text` |
| `turn`                         | `your-turn`                        | `status-success`      | `text-status-success`      |
| `failed`                       | `errored`                          | `destructive`         | `text-destructive`         |
| `quiet`                        | `idle`, `done`                     | `muted-foreground/40` | `text-muted-foreground`    |

`statusDetail` says what the status is about (`Bash: pnpm test`, `Allow Bash: rm -rf build?`, the
question, the error, `Waiting on 2 background tasks`, `Interrupted`). `statusSource` says which
signal decided: `seal-hooks`, `agent-hooks`, `agent-state`, `screen`, `process`, `transcript`,
`classifier`.

## Inputs

The rule behind the layering: **the transcript proposes; the agent's own state and the process
tree confirm.** A transcript is a log read in pieces, minutes or megabytes apart. Whatever it says
is still running is checked against what the agent itself reports and what actually runs under it.

| #   | Input                                   | Where it comes from                                                                | Code                                                                                                                     |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Transcript turn                         | Claude `~/.claude/projects/**.jsonl`, Codex `~/.codex/sessions/**/rollout-*.jsonl` | `claude-transcript-phase.ts`, `codex-transcript-phase.ts`                                                                |
| 2   | Background work the transcript launched | the same logs, folded scan after scan                                              | `claude-transcript-activity.ts`, `claude-background-launches.ts`, `codex-background-terminals.ts`, `session-activity.ts` |
| 3   | The agent's own state                   | Claude Code's registry `~/.claude/sessions/<pid>.json` (`status`, `waitingFor`)    | `claude-session-registry.ts`                                                                                             |
| 4   | Process tree                            | `ps` on the machine: agent processes and every command under them                  | `agent-tool-processes.ts`, `session-process-pairing.ts`                                                                  |
| 5   | Terminal screen                         | tmux `capture-pane`, Seal terminal screen                                          | `agent-screen.ts`, `agent-screen-status.ts`                                                                              |
| 6   | Agent hook file                         | `~/.config/sisomewhere/agents/<id>.json`, written by the agent's hooks             | `agent-hook-states.ts`                                                                                                   |
| 7   | Seal pane hook row                      | the agent-status hooks Seal installs in its own terminals                          | `seal-pane-sessions.ts`, `src/shared/agent-hook-listener/`                                                               |
| 8   | Reply wording                           | the last lines of a finished turn's reply                                          | `reply-ask.ts`                                                                                                           |
| 9   | Classifier                              | the summaries model, for a reply that is unclear                                   | `live-session-reply-asks.ts`                                                                                             |
| 10  | Scan history                            | the previous scan of the same machine                                              | `live-session-status-hold.ts`                                                                                            |
| 11  | Machine reachability                    | whether the machine's scans succeed                                                | `live-session-registry.ts`                                                                                               |
| 12  | Pane agent presence                     | a probe of the process a pane's hooks recorded                                     | `seal-pane-runtime.ts`, `agent-hook-server`                                                                              |

A scan runs every 3 s locally and every 8 s over SSH or on a remote server; the same script and the
same assembly run for all three, so every rule below holds on every kind of machine. Timestamps are
compared within one machine only: the scan reports the machine's own clock (`@@NOW`), and every
age is that clock against stamps written on that machine. Clock skew between machines does not
enter status.

### What the transcript records

| The log's newest turn                                                                    | Phase                |
| ---------------------------------------------------------------------------------------- | -------------------- |
| A prompt, reasoning, text with no end record yet                                         | `working`            |
| A tool call with no result                                                               | `tool-pending`       |
| `AskUserQuestion` / `ExitPlanMode` (Claude), `request_user_input` (Codex) with no result | `input-requested`    |
| Codex approval request event                                                             | `approval-requested` |
| End of turn (`turn_duration`, `stop_hook_summary`, `task_complete`)                      | `turn-ended`         |
| End of turn right after an API error record, `turn_aborted` with an error                | `errored`            |
| A scheduled wake-up firing (`system` / `scheduled_task_fire`)                            | `working`            |
| No turn at all                                                                           | `unknown`            |

Claude Code logs each API request before it sends it (`api-request*` records, `prompt_snapshot`
attachments, 40–60 KB apiece). They say nothing about status, so the scan reads the turn's records
from a window eight times the tail it keeps and drops those records first
(`transcript-turn-tail.ts`); a launch is not pushed out of view by the request that followed it.

### Background work

| Agent  | What is tracked                                                              | It ends when                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude | `Bash` with `run_in_background`, or a command Claude moved to the background | a `<task-notification>` with a `<status>`; or the agent has nothing left running                                                                   |
| Claude | `Monitor` (a watch on a command or a file)                                   | its closing notification, its timeout, or (a command) nothing left running                                                                         |
| Claude | `Agent` / `Task` launched in the background, `Workflow`                      | its notification; a subagent also by its own transcript going quiet                                                                                |
| Claude | `ScheduleWakeup`                                                             | the wake-up fires, or a minute after it was due                                                                                                    |
| Codex  | `exec_command` handed back with "Process running with session ID N"          | Codex writes that the command ended (`CommandExecution` completed); a `write_stdin` poll sees it exit; or no command runs under the agent any more |
| Codex  | helper threads (`spawn_agent`)                                               | the helper's own rollout ends its turn                                                                                                             |

A `<task-notification>` without a `<status>` is a progress event (a Monitor line, a "still
running" check-in). It names a task that is running and never ends it.

"Nothing left running" is the confirmation step. For Claude it is the registry saying `idle`
rather than `shell`; on a build that writes no state, the absence of any command of Claude's Bash
tool under the agent. For Codex it is the absence of any command under the agent. A host that
cannot list processes confirms nothing, and what the transcript says stands.

### The agent's own state (Claude Code)

| Registry `status` | Meaning                                               | Effect                                                                                                                                    |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `busy`            | a turn runs, or work it delegated does                | A turn the transcript ended reads `working` (compaction, a turn not logged yet). No prompt is inferred from a slow call.                  |
| `shell`           | at its prompt, commands it left in the background run | Background commands are running, whether or not the scan still sees their launch.                                                         |
| `idle`            | at its prompt, nothing of its own running             | Background commands are over. A turn the transcript left open is dropped (`your-turn`).                                                   |
| `waiting`         | a dialog holds it (`waitingFor` says which)           | `permission prompt` and others: `needs-permission`. `input needed`: `waiting-input`. A dialog the user opened (`dialog open`) is ignored. |

The registry speaks for the process's current conversation only, and a state counts over the
transcript only when it was stamped after the transcript's last write.

## State machine

```mermaid
stateDiagram-v2
    [*] --> idle: agent starts
    idle --> working: prompt
    working --> running_shell: command runs 3 s
    running_shell --> working: command ends
    working --> needs_permission: prompt holds a call
    needs_permission --> working: answered, here or elsewhere
    working --> waiting_input: question tool
    waiting_input --> working: answered
    working --> waiting_subagent: subagent launch pending
    waiting_subagent --> working: subagents report
    working --> errored: turn fails
    working --> your_turn: turn ends, nothing left running
    working --> waiting_task: turn ends, background work runs
    working --> waiting_subagent: turn ends, background subagents run
    working --> waiting_input: turn ends on a question
    waiting_task --> working: work reports, agent wakes
    waiting_task --> your_turn: work ended, agent stays quiet
    your_turn --> working: prompt, wake-up
    errored --> working: prompt
    your_turn --> done: process gone
    idle --> done: process gone
    working --> done: process gone
    needs_permission --> done: process gone
    waiting_input --> done: process gone (host lists processes)
    waiting_task --> done: process gone
    errored --> errored: process gone
```

### Transitions

| From                               | Event                                                                                                                                               | To                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `idle`, `your-turn`, `errored`     | user prompt; scheduled wake-up fires; background work reports and the agent resumes                                                                 | `working`                             |
| `working`                          | foreground command running for 3 s                                                                                                                  | `running-shell`                       |
| `working`                          | shell call 5 s with no process, edit 8 s with no result (20 s in `auto` mode)                                                                       | `needs-permission`                    |
| `working`                          | approval dialog on screen; registry `waiting`; pane hook `PermissionRequest`                                                                        | `needs-permission`                    |
| `needs-permission`                 | answered in Seal, in the terminal, or on another device: the result is written, the dialog leaves the screen, or the registry leaves `waiting`      | `working`                             |
| `working`                          | question tool call pending                                                                                                                          | `waiting-input`                       |
| `working`                          | subagent launch pending (`Agent`, `Task`, `wait_agent`)                                                                                             | `waiting-subagent`                    |
| `working`                          | turn ends; nothing left running; reply tells                                                                                                        | `your-turn`                           |
| `working`                          | turn ends; reply asks (wording, or the classifier)                                                                                                  | `waiting-input`                       |
| `working`                          | turn ends; background subagents still run                                                                                                           | `waiting-subagent`                    |
| `working`                          | turn ends; background commands, monitors, workflows or a wake-up remain                                                                             | `waiting-task`                        |
| `working`                          | turn fails (API error, `StopFailure`, `turn_aborted` with an error)                                                                                 | `errored`                             |
| `working`                          | interrupted (Esc, Ctrl-C)                                                                                                                           | `your-turn`, detail `Interrupted`     |
| `waiting-task`, `waiting-subagent` | the work reports and the agent takes a turn                                                                                                         | `working`                             |
| `waiting-task`, `waiting-subagent` | the work ended and nothing else runs (its notice, or confirmation it is gone)                                                                       | `your-turn`                           |
| `waiting-task`                     | killed outside the agent                                                                                                                            | `your-turn`                           |
| any but `errored`                  | the agent's process, seen by an earlier scan, is off the host's process list; or no process was ever seen and the transcript is quiet for 2 minutes | `done`                                |
| `waiting-input` (question tool)    | process gone, on a host that cannot list processes                                                                                                  | stays `waiting-input`                 |
| `errored`                          | process gone; a `done` or `idle` hook arrives                                                                                                       | stays `errored`                       |
| any                                | the machine stops answering for three scans in a row                                                                                                | not shown, machine marked unreachable |

`done` needs the process to be gone, not merely unseen. A transcript written in the last 2 minutes
(`FRESH_WRITE_MS`) belongs to a running agent even if `ps` missed it, unless a scan paired that
transcript with a process which the host's list no longer shows and nothing was written since: that
agent exited, and its session ends at the next scan. A prompt or a question is
written to the transcript once and then nothing more until it is answered, so a quiet transcript
does not end it: only a host that listed its processes (`@@PS`) and has nobody left holding the
session does. A Codex thread held open by a shared `codex app-server` is still held.

## Precedence

Read top to bottom; the first row that matches wins.

| #   | Signal                                                                                      | Status                               | Source        |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------ | ------------- |
| 1   | Approval dialog on screen                                                                   | `needs-permission`                   | `screen`      |
| 2   | Other dialog on screen while the turn is busy                                               | `needs-permission`                   | `screen`      |
| 3   | Seal pane hook says a permission or question is pending                                     | `needs-permission` / `waiting-input` | `seal-hooks`  |
| 4   | Transcript: question tool pending, agent not known to be gone                               | `waiting-input`                      | `transcript`  |
| 5   | Claude registry `waiting` on a prompt or a question                                         | `needs-permission` / `waiting-input` | `agent-state` |
| 6   | Agent hook file says a prompt is pending, agent not known to be gone, turn not ended since  | `needs-permission`                   | `agent-hooks` |
| 7   | Agent hook file says working, agent not known to be gone, turn not ended since              | `working`, refined by rows 11–13     | `agent-hooks` |
| 8   | Transcript: the turn failed (whatever a later `done` or `idle` hook says)                   | `errored`                            | `transcript`  |
| 9   | Process gone                                                                                | `done`                               | `transcript`  |
| 10  | Claude registry `idle`, stamped after a turn the transcript left open                       | `your-turn`                          | `agent-state` |
| 11  | Transcript: subagent launch pending                                                         | `waiting-subagent`                   | `transcript`  |
| 12  | Pending shell call, its command process running for 3 s                                     | `running-shell`                      | `process`     |
| 13  | Pending shell or edit call, nothing running, past the prompt threshold, registry not `busy` | `needs-permission`                   | `process`     |
| 14  | Transcript: turn in progress                                                                | `working`                            | `transcript`  |
| 15  | Turn ended, Claude registry `busy`                                                          | `working`                            | `agent-state` |
| 16  | Turn ended, interrupt hint on screen                                                        | `working`                            | `screen`      |
| 17  | Turn ended, background subagents running                                                    | `waiting-subagent`                   | `transcript`  |
| 18  | Turn ended, background work running and confirmed                                           | `waiting-task`                       | `transcript`  |
| 19  | Turn ended, reply ends in a question                                                        | `waiting-input`                      | `transcript`  |
| 20  | Turn ended, reply unclear, classifier says ASKS                                             | `waiting-input`                      | `classifier`  |
| 21  | Turn ended                                                                                  | `your-turn`                          | `transcript`  |
| 22  | No turn yet                                                                                 | `idle`                               | `transcript`  |

An explicit question (row 4) outranks a wait (rows 17–18): a session that asks and also has a
watcher running is asking. A hook file older than the transcript by 2 minutes (`HOOK_STALE_MS`) is
ignored. A hook file that says `working` or `needs` more than 3 s before the transcript recorded
a settled end of turn is left over from an interrupted turn, for which no hook fires, and is
ignored too.

### Seal panes: hook rows against discovery

A pane's hook row maps to a status first (`hookStatus` in `seal-pane-sessions.ts`):

| Hook row                                              | Pane status                                             |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `blocked`                                             | `needs-permission`                                      |
| `waiting` on a question tool                          | `waiting-input`                                         |
| `waiting` on anything else                            | `needs-permission`                                      |
| main agent ended in a failure (`mainAgent.outcome`)   | `errored`                                               |
| `done`                                                | `your-turn` (detail `Interrupted` when the row says so) |
| `working`, `workingMode: 'monitoring'`                | `waiting-task`                                          |
| `working`, main agent done, held open by child agents | `waiting-subagent`                                      |
| `working`                                             | `working`                                               |

Then the scan's reading of the same session is joined in (`mergeSealPanes`). Hooks are events and
are trusted for what they can say; discovery fills in what they cannot:

| Pane says                          | Discovery read                                                  | Shown                              |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------- |
| anything                           | an approval dialog on screen                                    | discovery                          |
| anything                           | a classifier verdict                                            | pane                               |
| silent pane                        | anything                                                        | discovery                          |
| `your-turn`                        | `waiting-task`, `waiting-subagent`, `waiting-input`, `errored`  | discovery                          |
| `your-turn`                        | the agent's own state says `working`, a prompt or a question    | discovery                          |
| `working`                          | `running-shell`, `waiting-task`, `waiting-subagent`             | discovery                          |
| `working`                          | the agent's own state says a prompt or a question               | discovery                          |
| `working` (local)                  | the transcript ended the turn more than 3 s after the last hook | discovery (`your-turn`, `errored`) |
| `waiting-task`, `waiting-subagent` | the other wait                                                  | discovery                          |
| a prompt or question               | anything but a dialog on screen                                 | pane                               |
| anything else                      |                                                                 | pane                               |

A pane is silent when its row was restored at startup and not confirmed since, or when it is not
`done` and has had no hook evidence for 30 minutes (`AGENT_STATUS_STALE_AFTER_MS`). A silent pane
speaks for nothing; the scan decides.

## Lifecycle cases

| Case                                        | What happens                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine disconnects                         | Its scans fail. After three failures in a row its sessions are dropped and the machine shows its error; nothing keeps the status it had.                                                                                                                                               |
| Machine reconnects                          | The first scans list its sessions again with their current status. A remote scan reads a few transcripts at a time, and a running agent is listed once its own is read, never as `idle` or under another session before. Background work is rebuilt from the transcript and confirmed. |
| A scan is cut short (read budget, timeout)  | The previous list is kept for that scan, and the hold keeps a busy session busy until a second scan agrees (20 s at most).                                                                                                                                                             |
| App restart                                 | External sessions are rediscovered by the first scan. Pane rows restored from disk are silent until a hook confirms them.                                                                                                                                                              |
| New agent where an earlier session ended    | Claude names its conversation in its registry before it writes a transcript: the agent is its own new session, and the earlier one stays ended instead of reading as running again.                                                                                                    |
| Agent killed in a Seal pane (no hooks fire) | The scan sees no process for the pane's session; Seal probes the process the hooks recorded (at most every 15 s per pane) and ends the row.                                                                                                                                            |
| Agent killed at a prompt or a question      | `done` at the scan that finds its process off the host's list, when an earlier scan saw it; otherwise once the host has listed its processes, nobody holds the session and its transcript is 2 minutes quiet.                                                                          |
| Interrupted turn (Esc, Ctrl-C)              | The transcript records the end; a stale `working` hook file or pane row from before it is overruled. Shown as `your-turn`, `Interrupted`, or as a background wait while a command the turn left behind still runs (Codex keeps a command it was polling in its terminal).              |
| Compaction                                  | Runs inside a turn. The Claude registry says `busy` throughout, so a transcript that reads as ended still shows `working`.                                                                                                                                                             |
| Subagents                                   | A pending launch is `waiting-subagent`; background subagents hold an ended turn in `waiting-subagent` until each reports or goes quiet.                                                                                                                                                |
| Prompt answered elsewhere                   | The result lands in the transcript, the dialog leaves the screen, or the registry leaves `waiting`; any one returns the session to `working`.                                                                                                                                          |
| Hooks out of order or duplicated            | A status is a function of the newest state, not of the sequence: a repeated hook changes nothing, and a late `done` cannot hide an `errored` turn.                                                                                                                                     |
| Failed turn, then a `done` or `idle` hook   | `errored` stays, while the agent runs and after it exits.                                                                                                                                                                                                                              |
| Clock skew between machines                 | No effect: ages compare one machine's clock with stamps written on it. The pane rule that compares a hook's time to a transcript's is local-only.                                                                                                                                      |

## Agents

| Agent                                                                                                | Session record | Signals                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code                                                                                          | yes            | all twelve inputs                                                                                                                                              |
| Codex                                                                                                | yes            | transcript, background terminals and helper threads, process tree (its own process and any `codex app-server`), screen, hook file, pane row, reply, classifier |
| Kimi, Copilot, Jcode                                                                                 | no             | pane hook row; a failed turn is recorded as a failure (`StopFailure`, a non-recoverable `ErrorOccurred`, `turn_end` with `status: error`)                      |
| Claude-compatible agents (Qoder, Qwen Code, CodeBuddy, Grok, Muse, …)                                | no             | pane hook row through the shared lifecycle mapping, including `StopFailure` and interrupts                                                                     |
| Gemini, Cursor, Kiro, DSH, Command Code, Amp, Droid, Devin, Hermes, Pi, OpenCode, Zcode, Antigravity | no             | pane hook row; `working`, a prompt where the agent reports one, `done`                                                                                         |

## Notifications, summaries, recaps

- A notification fires when a session enters the `attention` group, and when it leaves the
  `working` group for `idle` or `finished`. Entering or leaving a background wait says nothing, so
  a turn that ends with work still running is announced once: when that work is over and the
  session reaches `your-turn`.
- Summaries describe a settled session (`isSettledLiveSessionStatus`), which includes both waits.
- Recaps start when a turn is running and are written when it settles.

## Older clients

`running-shell`, `your-turn` and the sources `process`, `classifier` and `agent-state` are newer
than some clients on the wire. A client that sends its capabilities without
`live-sessions.status.v2` is sent `working` for `running-shell`, `idle` for `your-turn`, and
`transcript` for the newer sources (`live-session-status-compat.ts`).

## Known limits

- Without a terminal screen (an agent outside tmux and outside Seal) and without a registry state,
  an approval prompt is inferred from the process tree after 5–20 s, and a prompt that holds a
  subagent launch reads as `waiting-subagent`.
- A host whose `ps` cannot list processes gets no `running-shell`, cannot confirm that background
  work is over, and cannot tell a quiet agent from one that is gone: a wait stands until its notice
  is read, and a question stands until its transcript is 12 hours old and leaves the scan.
- Codex runs commands under a shared `codex app-server`, so a command there counts for every Codex
  session on the machine. A Codex that does not write a command's end to its rollout (0.169 does)
  keeps a background terminal that exited unpolled in `waiting-task` while any other Codex command
  still runs under that app-server.
- Codex's context compaction writes no record Seal reads; it runs inside a turn, so the session
  reads `working` from the turn itself.
- A Codex turn that hit a stream error and then completed reads as completed: the error was a
  retry notice, not the turn's outcome.
- Agents without a session record report only what their hooks say. Those whose hooks carry no
  failure or approval event (see the last row of [Agents](#agents)) cannot show `errored` or a
  prompt they do not report.
- The workspace dot a phone shows for a desktop workspace is rolled up in the runtime from hook
  rows alone (`runtime-worktree-sidebar-status.ts`); it does not yet read the pane's session. The
  phone's session rows do.
- Mobile labels a wait without its count ("Waiting on background tasks").

## How this is verified

Automated, all on the real scanner (`HostSessionScanner`) with a scripted host:

- `session-status-transitions.test.ts` is the table of this document: each session is one recorded
  transcript followed scan by scan through the events that can happen to it, for Claude Code and
  for Codex. A changed transition fails the row that names it.
- `seal-pane-sessions.test.ts` holds the hook-row table and the pane-against-discovery table.
- `transcript-turn-tail.test.ts` runs the real `/bin/sh` scan script over a transcript padded with
  request logs.
- `session-status-fixtures.test.ts`, `session-assembly.test.ts`, `host-session-scanner.test.ts`,
  `live-session-registry.test.ts`, `live-session-status-hold.test.ts`, `reply-ask.test.ts`,
  `live-session-reply-asks.test.ts`, `terminal-tab-activity-status.test.ts`,
  `agent-hook-listener-failed-turn.test.ts` cover the layers one by one.

Fixtures in `discovery/__fixtures__/live-*` are recordings of real Claude Code 2.1 and Codex 0.169
sessions, trimmed of request logs and instructions. The newer ones (`live-claude-background-*`,
`live-claude-monitor-watch`, `live-claude-scheduled-wakeup`, `live-codex-background-terminal`, …)
were recorded with the real CLIs driven by a scripted model endpoint, so the tool calls are
scripted and every record is the CLI's own. `claude-background-command-check-in` is written by hand
from Claude Code's notification format.

By hand, to re-check against a live agent: start `claude` or `codex` in tmux, open Home, and

1. ask it to run `sleep 90` → Running shell within a few seconds, until the command ends;
2. ask it to start `while true; do date; sleep 5; done` in the background and stop → Waiting on 1
   background task, not Waiting on you; kill the loop → Waiting on you;
3. ask it something it must ask back about → Asking you a question;
4. ask it to delete a file in default permission mode → Waiting for approval;
5. let a turn finish → Waiting on you;
6. ask it to run two subagents in the background → Waiting on 2 subagents;
7. kill the agent while a question is up → Ended.
