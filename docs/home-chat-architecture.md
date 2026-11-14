# Home assistant architecture

The Home assistant is the chat at the top of Seal's Home view. It acts for the user on every
machine Seal knows: this computer, SSH hosts and paired Seal servers.

This document describes the second design. The first one kept a Claude Code process open per chat,
replayed history as a text preamble, and could only reach this computer and SSH hosts.

- [What the basis-quant conductor does, and what Seal takes from it](#what-the-basis-quant-conductor-does-and-what-seal-takes-from-it)
- [Layers](#layers)
- [The agent loop](#the-agent-loop)
- [Drivers: no process outlives a turn](#drivers-no-process-outlives-a-turn)
- [Tools](#tools)
- [Machines](#machines)
- [Skills and instructions](#skills-and-instructions)
- [History](#history)
- [What the window shows](#what-the-window-shows)
- [Verification](#verification)
- [Limits](#limits)

## What the basis-quant conductor does, and what Seal takes from it

`gh repo clone answerrocket/basis-quant` failed from the build machine: the CLI token could not see
the repository. The conductor was read instead through Cursor's GitHub connection, at
`src/conductor/src/conductor/` on the `dev` branch. The files that shaped this design are
`loop.py`, `dispatch.py`, `guards.py`, `tool_guards.py`, `history.py`, `retry.py`,
`chat/compaction.py`, `chat/session.py`, `record/transcript.py` and `runner/adapters/`.

| Conductor pattern                                                                                                                 | In Seal                                                                   | Why                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| One loop owns every model round. Guards run before a round is paid for.                                                           | `engine/home-chat-turn-engine.ts`, `drivers/api/home-chat-api-driver.ts`  | One place decides whether to continue, compact or stop.                         |
| One finalization path, whatever ended the run.                                                                                    | `runTurn`'s `finally` in the turn engine                                  | A stopped, failed or finished turn all leave the thread consistent and idle.    |
| A tool call always answers the model. Failures are replies, not exceptions.                                                       | `tools/home-chat-tool-runner.ts`, `tools/home-chat-tool-replies.ts`       | The model can recover from an error it can read.                                |
| Recovery text names what to do next: nearest tool names, which argument was wrong.                                                | `home-chat-tool-replies.ts`                                               | "Unknown tool" alone leaves the model guessing.                                 |
| Repeat guard: note, last-try warning, then refusal for the same failing call.                                                     | `engine/home-chat-repeat-guard.ts`                                        | Stops a model that loops on one broken call.                                    |
| Nudge after an empty or cut-off round.                                                                                            | API driver, `engine/home-chat-system-note.ts`                             | A silent round would otherwise end the turn with nothing.                       |
| Text the app adds is labelled as the app's, never as the user's.                                                                  | `systemNote()`                                                            | The model must not treat a nudge as a user request.                             |
| History is a log of items plus compaction items. The active view is the newest summary and the tail it kept.                      | `thread/home-chat-thread-items.ts`, `thread/home-chat-thread-history.ts`  | The full thread stays readable; the model's view is derived.                    |
| Dangling tool calls are repaired when history is rebuilt.                                                                         | `answeredItems()`                                                         | A crash between call and result must not break the next request.                |
| Compact at a fraction of the window, cut only at round boundaries, ask the same model with tools off, restate the latest request. | `engine/home-chat-compaction.ts`, `engine/home-chat-thread-compaction.ts` | A tool call is never parted from its result, and the task survives the summary. |
| Token estimate calibrated from the provider's own usage numbers.                                                                  | `calibratedRatio()`                                                       | The estimate tracks the real tokenizer without shipping one.                    |
| CLI adapters run once per request, resume a stored session id, and seed a transcript when the provider has no session.            | `drivers/claude/`, `drivers/codex/`, `engine/home-chat-session-seed.ts`   | This is the "no long-lived process" rule.                                       |
| Retry with backoff on transient provider errors.                                                                                  | `drivers/api/openai-chat-request.ts`                                      | Rate limits and overloads should not fail a turn.                               |
| Parallel dispatch only for tools that are safe to run together.                                                                   | `PARALLEL_SAFE_TOOLS`                                                     | Reads fan out; writes stay ordered.                                             |

Not taken: the conductor's SQLite record store, vector store and RAG ledger, and its Python
sandbox. Seal's threads are small and local, so a JSONL log per thread is enough, and commands run
on the user's machines through transports Seal already has.

## Layers

All main-process code is under `src/main/home-chat/`.

| Folder                                                                 | Owns                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `thread/`                                                              | The thread log, its store on disk, and the projection to chat entries.                   |
| `engine/`                                                              | The turn engine, the recorder that writes the log, compaction and the repeat guard.      |
| `drivers/`                                                             | Talking to a model: `api/`, `claude/`, `codex/`.                                         |
| `tools/`                                                               | Tool specs, validation, approval, execution and the replies a model reads.               |
| `machines/`                                                            | One interface over this computer, SSH hosts, Seal servers and hop hosts.                 |
| `skills/`                                                              | Discovering skills and instruction files on any machine.                                 |
| `seal/`                                                                | Agent sessions and AI accounts, as the assistant sees them.                              |
| `jobs/`, `delegation/`, `routines/`, `memory/`, `web/`, `attachments/` | Background jobs, worker chats, schedules, memory, web access, files shown in the thread. |

`home-chat-service.ts` wires these together. `src/main/ipc/home-chat.ts` exposes it on the
`homeChat:*` channels, and `src/preload/api/home-chat/` gives the renderer `window.api.homeChat`.
The renderer lives in `src/renderer/src/components/home-chat/`.

## The agent loop

`HomeChatTurnEngine` runs one turn at a time per thread.

1. Append the user's message to the log, so it survives anything that follows.
2. Compact if the next request would fill 80% of the model's window.
3. Hand the turn to a driver. The driver streams text, thinking and tool calls into the recorder
   and calls `runTool` for each tool call.
4. Finalize, on one path: close open entries, record "Stopped." or the error, store the provider
   session id, compact again if due, measure context use, set the status, flush to disk.
5. Start the next queued notice, if a job, worker or routine reported while the turn ran.

A driver only talks to its model. It never writes history, runs a tool or decides approval.

`runHomeChatToolCall` handles every tool call the same way for every driver:

1. Record the call, so the card appears.
2. Refuse without running if the turn was stopped, the tool is unknown, the arguments are not an
   object or fail the schema, or the identical call already failed three times this turn.
3. Ask the user when the call is risky. Declined calls tell the model not to retry or work around.
4. Run it. A thrown error becomes a failure reply.
5. Record the result. The stored text is exactly what the model was told.

## Drivers: no process outlives a turn

| Model source | Driver                                      | How a turn runs                                                                                                                                                    |
| ------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude       | `drivers/claude/home-chat-claude-driver.ts` | The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) starts one Claude Code process, resumes the thread's session by id, and the driver closes it in `finally`. |
| Codex        | `drivers/codex/home-chat-codex-driver.ts`   | One `codex exec --json` (or `codex exec resume <id>`) per turn, prompt on stdin, killed in `finally` if still alive.                                               |
| Model API    | `drivers/api/home-chat-api-driver.ts`       | Seal's own loop over an OpenAI-compatible Chat Completions endpoint. No process at all.                                                                            |

The persistent process in the first design was `createClaudeCodeSession` in
`backends/claude-code/claude-code-session.ts`. `HomeChatTurnRunner` kept one per chat in a
`sessions` map and held its Claude Code stream-json connection open until the chat was deleted or
the app quit. Both files are gone.

Claude specifics:

- Built-in tools are off (`tools: []`) and no settings files are read (`settingSources: []`).
  Seal's tools reach Claude through an in-process SDK MCP server named `seal`.
- The account is the user's selected Claude account (`CLAUDE_CONFIG_DIR`), or the default login.
- If the stored session cannot be resumed and nothing was said yet, the turn starts a new session
  seeded with a plain-text transcript of the thread.

Codex specifics:

- Seal's tools reach Codex through a loopback MCP HTTP endpoint that exists for one turn. It is
  guarded by a bearer token passed in the child's environment.
- Codex's own shell stays in a read-only sandbox. A command it runs there shows as a `codex_shell`
  card.
- The account is the selected Codex account (`CODEX_HOME`), or the default login.

Both CLIs keep their own copy of the conversation. The thread log stays the source of truth:
`providerSession.throughSeq` records how far the CLI session has seen, and anything newer (a
notice, a turn on another model source) is prepended to the next prompt. A compaction clears the
stored session, so the next turn starts a new CLI session from the summary.

## Tools

Specs are zod shapes in `tools/home-chat-*-tool-specs.ts`. All three drivers expose the same set.

| Area                 | Tools                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Machines             | `list_machines`, `run_command`, `read_file`, `write_file`, `transfer_file`, `delete_path`, `configure_machine` |
| Background jobs      | `job_status`, `job_output`, `job_kill`, `job_cleanup`                                                          |
| Agent sessions       | `list_sessions`, `read_session`, `message_session`, `take_over_session`, `start_session`                       |
| Accounts             | `account_usage`, `switch_account`                                                                              |
| Seal itself          | `open_in_seal`, `seal_cli`                                                                                     |
| Skills               | `list_skills`, `load_skill`                                                                                    |
| Delegation           | `spawn_subagent`, `check_subagent`, `message_subagent`, `stop_subagent`                                        |
| Memory and schedules | `remember`, `forget`, `routines`                                                                               |
| Web                  | `web_search`, `web_fetch`                                                                                      |
| Thread               | `report_progress`, `attach_file`                                                                               |

The session tools read Seal's live-session service, the one behind Active agents in the sidebar. They
cover the same sessions: on this computer, SSH hosts and paired Seal servers.

Approval is decided in `tools/home-chat-tool-risk.ts`. These always ask: `delete_path`,
`take_over_session`, `switch_account`. `run_command` asks when a shell segment deletes files,
force-pushes, discards git work, stops processes, sends data over the network, publishes, or shuts
the machine down. `seal_cli` asks before removing workspaces, stopping terminals or interrupting an
agent.

A reply has one of five outcomes: `ok`, `error`, `refusal`, `denied`, `interrupted`. The model
reads the text in every case.

## Machines

`machines/home-chat-machine-provider.ts` builds its list with `buildMachineSummaries`
(`src/shared/machines/machine-summaries.ts`), the same function the Machines page uses. A machine
is `local`, `ssh:<targetId>`, `runtime:<environmentId>` or `hop:<name>`, with a status of online,
connecting, offline or error.

A tool's `machine` argument accepts an id, a label, or an SSH host name, case-insensitively.
"kessel-ml" resolves whether it is an SSH target or a paired Seal server. A name that matches
nothing fails with the list of known machines, so the model can correct itself.

| Kind          | Commands                                            | Files                                                                                |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| This computer | A local shell                                       | The local filesystem                                                                 |
| SSH host      | Seal's existing SSH connection                      | Reads through the shell, writes and transfers through the connection's file transfer |
| Seal server   | The `machineHost.exec` RPC over the runtime channel | Reads and writes through the same RPC, transfers through the server's file transfer  |
| Hop host      | `ssh` from the machine it is reached through        | Shell commands, staged on that machine                                               |

`machineHost.exec` is new. The runtime RPC had files, metrics and processes, but no way to run a
one-off command, which is why the first design could not act on a paired server.

Every script Seal writes itself (the job launcher, file reads and writes, deletes, skill discovery,
session scans) is POSIX `sh` and is run by `/bin/sh`, never by the user's login shell: zsh does
not split an unquoted `$var` into words and fish cannot parse `sh` at all. The login shell is used
for two things only: its environment (`PATH` and the like), and running the command the model
asked for, which is handed to it as one argument. Scripts never rely on word splitting, and file
content travels as a quoted here-document or on stdin. A path may be absolute, relative to the
home folder, or start with `~`; `machines/home-chat-machine-paths.ts` resolves it the same way on
every kind of machine.

## Skills and instructions

`skills/home-chat-skills.ts` and `skills/home-chat-machine-catalog.ts` find, on this computer and
on every online machine:

- skills in `~/.claude/skills`, `~/.codex/skills`, `~/.cursor/skills` and `~/.agents/skills`
- agent definitions in `~/.claude/agents` and prompts in `~/.codex/prompts`
- `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`
- for a repository: `.claude/skills`, `CLAUDE.md` and `AGENTS.md`

Disclosure is progressive, as in Claude Code:

1. The system prompt carries a catalog: each skill's name and description, per machine. It also
   carries this computer's `CLAUDE.md` and `AGENTS.md` text, capped at 8,000 characters each.
2. `load_skill` returns one `SKILL.md` in full, with the paths of the files beside it.
3. `list_skills` lists another machine or a project on demand.

A remote machine is scanned in one shell round trip and cached for five minutes. Building the
prompt waits at most 2.5 seconds for remote catalogs, so a slow host never delays a reply.

## History

### The log

Each thread is two files under `<userData>/home-chat/threads/`: an append-only `<id>.jsonl` log
and a small `<id>.meta.json`. A log line is one item with a sequence number:

| Item          | Holds                                                                           |
| ------------- | ------------------------------------------------------------------------------- |
| `user`        | Text, and whether the user, a notice or Seal itself wrote it.                   |
| `assistant`   | One model round: text, thinking and tool-call parts, and why the round stopped. |
| `tool_result` | The call id, the exact text the model was told, and the outcome.                |
| `compaction`  | A summary, and the sequence number from which items stay word for word.         |
| `event`       | Things only the user sees: progress lines, errors, notices, attachments.        |

A torn last line from a crash is dropped on load and the rest of the log stands. Chats saved by
the first design are imported once.

### What the user sees

`thread/home-chat-entry-projection.ts` turns items into chat entries. Each entry has a stable id,
a revision and an `ord` position that main assigns once. The renderer merges by id, keeps the
higher revision, and sorts by `ord`, so a replayed or late event can neither duplicate nor reorder
a message. The renderer subscribes before it fetches the thread, and merges anything that arrived
in between.

Items written by Seal for the model (`origin: 'system'`) are not projected at all. A compaction
projects to a divider with the summary behind a toggle. No internal label or tag reaches the window.

### What the model sees

`activeItems()` returns the newest compaction and everything from its `keepFromSeq` on.
`answeredItems()` then drops orphan results and gives any call without a result an "interrupted"
answer. From there:

- The API driver encodes proper Chat Completions messages: assistant `tool_calls` followed by
  `tool` messages with matching `tool_call_id`. A summary becomes a labelled note.
- The CLI drivers resume their session by id and add only what the session has not seen.

### Compaction

- Due when the next request would use 80% of the window. The window is 200k for Claude (1M for a `[1m]` model), 272k for
  Codex, and a setting for the model API (128k by default).
- Keeps the newest three exchanges word for word if they fit in 25% of the window, otherwise as
  many whole rounds as fit.
- The summary is written by the same model with tools off. If that fails, a mechanical summary is
  used, so nothing is dropped silently.
- The user's latest request is restated when the kept tail does not contain it.
- The user can trigger it from the context popover.

## What the window shows

- **Thread list**: every saved thread, newest first. Pick one to resume it; rename and delete from
  its row. Reopening Seal resumes the thread used last.
- **Context bar**: the machine the assistant last acted on, how many machines are online (the list
  opens on click), and how full the model's context is.
- **Tool cards**: collapsed to one line with the tool, its target machine, duration and status.
  Expanding shows the arguments and the result.
- **Approval**: a card with the reason and Approve and Decline.
- **Stop**: replaces Send while a turn runs.
- **Model source**: Claude, Codex or Model API, with the account or model beside it.

## Verification

- Unit tests beside the code cover the log, replay encoding, compaction, the tool dispatcher,
  machine name resolution and remote skill discovery.
- `tests/e2e/home-chat-assistant.spec.ts` runs the real app paired to a headless Seal server named
  `kessel-ml`, with a scripted model behind an OpenAI-compatible endpoint. It runs a command on
  kessel-ml, loads a skill installed there, approves a deletion, outgrows the context window, then
  quits and reopens the app and checks both the window and the request the model receives.
- The Claude and Codex drivers were each run once against the real CLI (Claude Code 2.1.325,
  Codex 0.169.0) with a fake provider API: one tool call through Seal's MCP tools, a second turn
  that resumed the session, and no CLI process left after either turn. Those runs are not in the
  test suite because they need the CLIs installed.

- `tests/e2e/home-chat-tools-real-machines.spec.ts` runs every tool in the registry in the real
  app against real machines, and fails when a tool has no case. The machines are this computer,
  three accounts behind a real `sshd` whose login shells are zsh, bash and fish, and a paired
  headless Seal server; the app and the server run with zsh as their login shell. Only the model
  is scripted: an OpenAI-compatible endpoint asks for each tool with the JSON arguments a model
  sends. The cases cover quotes, `$variables`, new lines, unicode, globs, paths with spaces,
  output larger than a reply holds, exit codes, stderr, timeouts and binary files. It writes a
  tool by machine pass/fail matrix as a test attachment. It needs Linux and passwordless `sudo`
  (to create the accounts), so it runs in CI and is skipped on a developer's machine without them.
  macOS is not covered by it: the zsh accounts stand in for a Mac's default shell.

## Limits

- `start_session` does not work on a hop host. The tool says so and names the alternative.
- Codex keeps its own built-in tools. Seal restricts its shell to a read-only sandbox rather than
  removing it.
- Claude's context use is the provider's own count. Codex's is an estimate, because `codex exec`
  reports usage summed over a turn.
- Chats on the Claude and Codex sources bill the selected subscription account. The model API
  source uses the key in the assistant's settings.
