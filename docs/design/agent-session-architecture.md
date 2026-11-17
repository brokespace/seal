# Agent session architecture: one session model for chats and CLI agents

Status: design, not built. This document is the plan that parallel builder agents implement. It replaces the working title "chat parity": the parity gaps are a symptom, and the cause is that Seal has three models of one thing.

Read sections 1 to 3 for the decision. Sections 4 to 11 are the specification. Section 12 is the merge-and-delete list with the line estimate. Section 13 is the feature-preservation checklist every builder verifies. Section 14 is the build plan with workstreams, owned files, interfaces, merge order, acceptance criteria and test plans. Section 16 lists the questions put to Brian and his answers.

Terms used throughout:

| Term             | Meaning                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Chat             | An agent run headless by Seal (Claude over stream-json or the Agent SDK, Codex app-server, ACP agents), shown as a chat. |
| CLI              | The agent's own interactive terminal program, running in a Seal terminal tab.                                            |
| External session | An agent somebody started outside Seal (a plain terminal, tmux, an SSH shell) that Seal discovers and can watch.         |
| Agent session    | Any of the three. After this work it is one record with one identity, whatever started it.                               |
| Registry         | The process in Seal that holds every agent session record (today `src/main/live-sessions`).                              |
| Seal server      | The headless Seal runtime on a machine (`orcad` internally; internal names stay upstream's).                             |

## 1. The problem: three models of one thing

Seal has three representations of "an agent conversation". Each has its own identity, status vocabulary, stores, IPC and UI. Features were built on one and never reached the others.

|                   | (A) Structured chat                                                                 | (B) Pane agent status                                     | (C) Live session registry                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin            | Upstream Orca                                                                       | Upstream Orca                                             | Seal (`036be7c6c93` and later)                                                                                                                 |
| What it tracks    | Headless agent sessions run by Seal                                                 | Agents in terminal panes, through hooks                   | Claude and Codex anywhere: Seal panes plus processes and transcripts found by a scan                                                           |
| Identity          | `sessionId` (`<agent>_<uuid>`), tab `structured-agent-session-<sessionId>`          | `paneKey` (`<tabId>:<leafId>`)                            | `<hostId>:<provider>:<providerSessionId>`                                                                                                      |
| Agents            | Claude, Codex, Pi, and ACP agents (Grok, OpenCode, OMP, Antigravity, Copilot, Kimi) | 23 hook targets plus plugin agents (OpenCode, Pi, OMP)    | `claude` and `codex` only (`LIVE_SESSION_PROVIDERS`)                                                                                           |
| Status vocabulary | `working`, `attention`, `idle`                                                      | `working`, `blocked`, `waiting`, `done`                   | Ten codes (`docs/session-status.md`): approval, question, error, working, running shell, waiting on subagents or tasks, your turn, idle, ended |
| Where it shows    | Workspace tab (`contentType: 'agent-session'`), `NativeChatView mode="structured"`  | Inline rows on workspace cards, tab attention, dock badge | Active agents, Home, Machines, project overview, palette, phone, `seal sessions`, MCP, Home chat tools                                         |
| Summary and recap | None (summaries skip `structuredHost` rows)                                         | One-line summary keyed `pane:<paneKey>`                   | One-line summary keyed `live:<id>`, recaps, reply-ask classifier                                                                               |
| Unread            | Tab attention with acknowledge                                                      | `unreadAgentCompletionPanes[paneKey]`                     | `seenAt[sessionId]` in `localStorage`                                                                                                          |
| Notifications     | `agentNeedsInput`, `agentTaskComplete`, phone push                                  | Same settings, hook driven                                | `liveSessionsNotify`, desktop only, skips Seal panes                                                                                           |
| Size (non-test)   | About 231k lines, most of it the host, journal and providers                        | About 39k lines                                           | About 15k lines, plus about 5k for summaries and recaps                                                                                        |

How it happened: the registry was added as a parallel product to see Claude and Codex sessions on every machine. Summaries, recaps and the ten-code status accreted on it. `seal/ia-unify` then re-homed it under Active agents, badges, Home and Machines. Structured chat was never folded in, and non-Claude, non-Codex agents never got a registry record.

Evidence from the running app and the code (screenshots are attached to the pull request):

1. A chat started from a project appears under Active agents only by accident. `sealPanesFromRows` (`src/main/live-sessions/seal-panes/seal-pane-sessions.ts`) reads the full hook snapshot and never checks `structuredHost`, so a structured row with a provider session id is admitted as a "Seal pane" session. It gets the wrong input route, no one-line summary (`pane-session-summaries.ts` skips `structuredHost`) and no recap.
2. Clicking any session row, including one whose agent already has a tab in a workspace, opens a second, thinner view of it: `openLiveSessionFromRow` always calls `openLiveSessionView`, which switches to the separate `sessions` top-level view with its own tab strip (`LiveSessionWorkspace.tsx`).
3. That strip is a hand-written `SessionTab` with no drag, no `select-none` and different tokens, so dragging a tab selects its title text. The workspace strip is `TabBar` with `SortableTab` (dnd-kit).
4. That view's composer is a 66-line textarea (`LiveSessionComposer.tsx`). The project chat's composer has model, effort and permission pickers, attachments, voice, mentions, commands, a queue, a context ring and a footer with machine, folder and branch.
5. The context ring exists only for structured chats. The auto-compact threshold Claude reports (`AgentSessionContextReport.autoCompactAtTokens`) is dropped before the ring. CLI and external sessions show nothing, although their transcripts hold the token usage.
6. The phone has the same split: `mobile/src/seal/live-sessions` (1,949 lines, text-only composer) next to `mobile/src/session/native-chat` (the full chat).
7. A Gemini, Copilot or OpenCode CLI session shows as a compact upstream row on its workspace card and nowhere else: not on Home, Machines, the phone list or `seal sessions`.
8. Opening a project chat from its Active agents row shows it in the session view with an empty transcript and the plain textarea: its record has no working directory and no transcript path.
9. The session view sits below an empty 36px band, draws a scrollbar inside its strip when tabs overflow, ignores the chat appearance settings (it lacks the `native-chat-appearance` wrapper, so code blocks use a different font), and leaves the right sidebar showing the file tree of whichever workspace was open before.

## 2. Goals, hard constraints and non-goals

Goals:

1. One agent session model for every agent and every surface. A capability built once works for chats, CLI sessions and external sessions, wherever the agent can supply the data.
2. One per-agent adapter with a shared core, so adding an agent is writing an adapter.
3. One chat view, one composer, one tab strip, one session row, one context indicator. The project chat's design is the design.
4. Agent sessions live in workspaces. The sidebar is Project > Workspace > every agent session as its own always-visible row. The separate machine-grouped Active agents section is merged into this list, not dropped: each feature it has is first built into the sidebar and the session rows (section 13.5), and the separate section is removed only after that.
5. Remote machines behave like the local one. Chat works over SSH. Adding an SSH machine installs the Seal server by default and keeps it running as a service.
6. Every agent offers both Chat and CLI wherever both are possible, and both are visible in the new-tab menu.

Hard constraints (Brian):

1. No useful functionality is removed. Only true duplicates are deleted. Section 13 is the checklist; a workstream is not done until its rows are verified in the real app.
2. The build is done by several builder agents in parallel. Workstreams have owned files, named interfaces between them and a merge order (section 14).
3. The sidebar is exactly as specified in section 5.2 and is its own workstream with its own acceptance criteria and tests.
4. Never duplicate functionality. Reuse what exists; where two things do the same job, keep the richer one.
5. Work lands on feature branches off `seal/all`, by pull request. Never `main`, never force-push, never skip hooks.

Constraint from the fork (`docs/upstream-sync.md`): upstream Orca is merged in every week, so Seal keeps its diff against upstream-owned files small. This shapes the whole design:

| Tree                                                                                                                                                                                                                                                                                           | Owner    | Rule in this plan                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/main/live-sessions`, `src/shared/live-sessions`, `components/live-sessions`, `src/main/session-summaries`, `src/main/session-recap`, `components/session-recap`, `src/main/machines`, `components/machines`, `components/home-overview`, `components/project-overview`, `mobile/src/seal` | Seal     | Change, merge and delete freely.                                                                                 |
| `components/native-chat`, `components/tab-bar`, `components/tab-group`, `components/sidebar`, `src/main/native-chat`, `src/shared/agent-status`, `src/main/agent-hooks`, `src/main/managed-server`, `src/main/ssh`, `mobile/src/session`                                                       | Upstream | Reuse through existing seams (props, transports, registries, the card template). Keep edits few lines and local. |

So the merge direction is: the Seal-owned registry becomes the one session record, fed by adapters over upstream's structured host and hook feed. Upstream's chat view, composer and tab strip are reused as they are and become the only ones. Seal's parallel view, strip, composer and section are deleted once what they do lives in the shared ones; for the Active agents section that is section 13.5. Upstream code that Seal stops mounting is left in place (section 16, question 1: Brian took the default), because every deleted upstream file is a recurring merge conflict.

Non-goals:

- Rewriting the structured host, the journal, the hook server or the providers.
- Changing the Home chat assistant. It is a different product (Seal's own assistant with its own threads). It only shares the message row and, after this work, the context indicator.
- Changing what multi-pane owns (panes, split layout, drop zones). See section 15.
- Renaming the internal identifiers, paths or environment variables that keep upstream's name.

## 3. Decision summary

| #   | Decision                                                                                                                                                                                                                                                                                                                                     | Why                                                                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | The registry record (`LiveSession`, widened) is the one agent session record. It keeps its id, `<hostId>:<agent>:<providerSessionId>`.                                                                                                                                                                                                       | It is Seal-owned, already feeds every list surface, the phone, the CLI and MCP, and already carries the richest status, summaries, recaps, titles and pins.    |
| D2  | Three sources feed it through one per-agent adapter: the structured host (chats), the hook feed (CLI in Seal, every hook agent), and discovery (external).                                                                                                                                                                                   | Upstream's host and hooks stay untouched and become inputs. A chat, a CLI session and an external session of the same conversation are one row.                |
| D3  | Status is computed in one place: the module the status-sweep work delivers (`src/shared/live-sessions/live-session-status.ts`, `docs/design/agent-status.md`). The three-state and four-state vocabularies become inputs, never displayed.                                                                                                   | One source of truth, already in progress on `cursor/agent-status-background-work-1937`.                                                                        |
| D4  | Summaries, recaps, titles, unread, notifications and context usage are shared services keyed by the record id. They read a transcript through the adapter, so chats get them too.                                                                                                                                                            | Removes the `pane:` and `live:` double keys and gives chats what CLI sessions have.                                                                            |
| D5  | One chat view, `NativeChatView`, with three sources of content: structured (exists), terminal bridge (exists), external (new, small). `LiveSessionChat`, `LiveSessionComposer` and `LiveSessionPane` are deleted.                                                                                                                            | The project chat's view becomes the only one. The composer already has a transport seam that needs no terminal.                                                |
| D6  | A session opens as a tab in its workspace, in the workspace tab strip: a chat tab, a terminal tab, or (external) a new tab kind. The `sessions` top-level view and its strip are deleted.                                                                                                                                                    | One strip, drag and split for free, and multi-pane works with session tabs without special cases.                                                              |
| D7  | The sidebar renders every agent session as a full row under its workspace through the workspace card template (a Seal part replaces the inline agents part). Active agents is merged in: its features move to the sidebar and the session rows (section 13.5), and the separate section is removed only once each of them is verified there. | The card template is an existing seam, so the upstream diff is a few lines.                                                                                    |
| D8  | A session in a folder no workspace covers gets a workspace, and a project if needed, created automatically and matched by repository identity across machines.                                                                                                                                                                               | Sessions always belong to a project. Reuses `getProjectIdentityKey`.                                                                                           |
| D9  | The new-tab menu always shows a labelled Chat action and a labelled CLI action for every agent that can do both.                                                                                                                                                                                                                             | Fixes the missing CLI option (section 8).                                                                                                                      |
| D10 | Chat is never refused for SSH or a subfolder. The launcher picks the best transport the host supports: structured on a host that runs it, otherwise the CLI shown as a chat.                                                                                                                                                                 | Same entry point everywhere; the difference is only which extras the host supports.                                                                            |
| D11 | Adding an SSH machine installs the managed Seal server by default, as a persistent service, reached only through the SSH tunnel. If the install fails the machine works over plain SSH.                                                                                                                                                      | Upstream already deploys, pairs, tunnels and updates the server over SSH. Seal's Machines flow turns that off today. The missing parts are small and additive. |
| D12 | The server computes its own registry. The desktop subscribes to it (`liveSessions.watch`) instead of scanning the server with a script, and falls back to the scan for old servers and SSH-only machines.                                                                                                                                    | Chats and hook agents on a server exist only in that server's memory. A script scan cannot see them.                                                           |

## 4. Target architecture

```text
                per-agent adapter (one table, read from upstream's catalogs)
                 ┌──────────────────────┬──────────────────────┐
                 │                      │                      │
        structured source         pane source           external source
     (StructuredAgentSession   (agent hook feed,      (process + transcript
      Host: status feed,        every hook agent)       scan: local, SSH)
      record store, journal)
                 └──────────────┬───────┴──────────────────────┘
                                ▼
                 Registry on the machine that runs the agent
        merge by identity → status (one module) → hold → annotate (title, pin)
        → link to workspace → decorate (summary, recap, context usage)
                                │
              liveSessions.watch (IPC on the desktop, RPC to servers and phones)
                                │
     ┌───────────┬──────────────┼───────────────┬──────────────┬───────────┐
  sidebar rows  Home     Machines, project    palette,      phone       CLI, MCP,
  (workspace)            overview            notifications              Home chat tools
                                │
                    open(session) → a tab in its workspace
        chat tab (structured)  |  terminal tab (CLI, chat view optional)  |  external tab
                     all three render NativeChatView + NativeChatComposer
```

### 4.1 The record

`LiveSession` (`src/shared/live-sessions/live-session-types.ts`) is widened, not replaced. Its name in code stays `LiveSession` until the final clean-up phase, so parallel builders do not collide on a rename. New and changed fields:

```ts
// src/shared/live-sessions/live-session-types.ts (Seal-owned)
export type LiveSession = {
  id: string // unchanged: `${hostId}:${agent}:${providerSessionId}`
  provider: AgentSessionAgentId // widened from 'claude' | 'codex' to every agent with an adapter
  surface?: AgentSessionSurface // new: where it runs and how it opens
  capabilities?: AgentSessionCapabilityFlags // new: what this session can do, from adapter + host
  workspace?: { worktreeId: string; projectKey: string } // new: set by the link step (section 5.3)
  context?: NativeChatContextUsageSummary // new: section 7
  model?: string // new
  // unchanged: machine, origin, cwd, project, title, titleNamed, customTitle, pinned, status,
  // statusSource, statusDetail, lastActivityAt, startedAt, alive, pid, transcriptPath, inputRoutes,
  // permission, activity, lastMessage, configDir, continues, summary, summaryPending, recap
}

export type AgentSessionSurface =
  | { kind: 'chat'; sessionId: string; tabId: string } // structured host owns the process
  | { kind: 'cli'; paneKey: string } // a Seal terminal pane owns the process
  | { kind: 'external' } // started outside Seal

// One more input route, first in the list for chats.
export type LiveSessionInputRoute =
  | { kind: 'structured'; sessionId: string }
  | { kind: 'seal-pane'; paneKey: string }
  | { kind: 'codex-queue' /* … */ }
  | { kind: 'tmux' /* … */ }
  | { kind: 'resume' /* … */ }

export type AgentSessionCapabilityFlags = {
  send: boolean // a message can be delivered
  answer: 'full' | 'options' | 'none' // free text and multi-select, option ids only, or view only
  transcript: boolean // message history can be read on this host
  recap: boolean
  context: 'exact' | 'estimated' | 'none'
  switchSurface: { toChat: boolean; toCli: boolean } // adopt into chat, fork into CLI
  takeOver: boolean // external only
}
```

`origin` (`'seal' | 'external'`) stays for existing readers. `surface` is the precise field new code reads.

`surface` and `capabilities` are optional in the frozen type (W0). Phase 0 changes no producer, and a record from a server that predates W1 does not carry them. A reader that finds them absent falls back to `origin` and to today's behaviour. W1 may make both required once every producer sets them, including the federation path for old servers; that change is agreed in advance and needs no new round with W0's owner.

### 4.2 Identity and joins

| Case                                                                  | Rule                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal                                                                | `id = <hostId>:<agent>:<providerSessionId>`. The provider session id is Claude's session id, Codex's thread id, an ACP agent's native id, or the id the agent's hook reports.                                                                              |
| A chat before the provider mints an id                                | Provisional id `<hostId>:<agent>:seal-<structuredSessionId>`. When the provider handle appears the registry emits `remove` with `replacedBy`, the same mechanism that renames `pid-` placeholders today. Annotations, marks and summary keys move with it. |
| A CLI agent whose hooks never report a session id (Amp, Command Code) | Permanent id `<hostId>:<agent>:pane-<paneKey>`.                                                                                                                                                                                                            |
| CLI to Chat (adopt, `cli-chat-resume-run.ts`)                         | The provider session id is kept, so it is the same record. Only `surface` changes from `cli` to `chat`. One row, before and after.                                                                                                                         |
| Chat to CLI (fork, `native-chat-cli-fork-run.ts`)                     | The provider creates a new session id. It is a new record whose `continues` lists the origin, so pins, custom titles and recap history follow it.                                                                                                          |
| The same id from several sources                                      | One record. Precedence for ownership fields (`surface`, `inputRoutes`, `status`): structured, then pane, then discovery. Lower sources only fill fields the owner left empty (for example `pid`).                                                          |
| Structured rows in the hook snapshot                                  | The pane source filters `structuredHost !== undefined`. This removes the accidental admission described in section 1.                                                                                                                                      |
| Headless processes and transcripts in discovery                       | Stay excluded (`HEADLESS_FLAGS`, `summary.headless`). The structured source is the only producer for chats. This prevents double rows.                                                                                                                     |

The other ids remain as aliases on the record, not as second identities: `surface.sessionId` (structured), `surface.paneKey` (pane). Tab unread, pane attention and auto-acknowledge keep their keys and are joined to the record through these aliases (section 4.5).

### 4.3 The per-agent adapter

One adapter per agent, in a new Seal-owned folder `src/shared/live-sessions/adapters/` (pure data and pure functions) with main-only parts in `src/main/live-sessions/adapters/`. An adapter does not reimplement anything. It names which existing upstream piece supplies each capability for that agent, and adds small functions only where the agent differs.

```ts
// src/shared/live-sessions/adapters/agent-session-adapter.ts (new)
export type AgentSessionAdapter = {
  agent: AgentSessionAgentId
  label: string // "Claude Code", "Codex", …; replaces the hard-coded names in the notifier

  /** Chat: which structured runtime runs it headless, if any. Looked up in upstream's catalog. */
  chat?: { runtime: 'claude' | 'codex' | 'pi' | 'acp' }

  /** CLI in a Seal pane: how its hook rows become a session. Defaults cover most agents. */
  cli?: {
    /** Defaults to upstream's extractAgentProviderSession. */
    sessionOf?: (
      row: AgentStatusIpcPayload
    ) => { id: string; cwd?: string; transcriptPath?: string } | null
    /** Extra evidence for the status module, beyond the shared hook mapping. */
    evidenceOf?: (row: AgentStatusIpcPayload) => Partial<AgentSessionStatusEvidence>
    /** How a prompt is answered in the terminal: structured answers, option keys, or not at all. */
    answers: 'ask-steps' | 'option-keys' | 'none'
    /** Argument vector that resumes a session in a terminal, if the agent can. Null when this
     *  session cannot be resumed from what is known (Pi resumes by its session file). */
    resumeArgv?: (providerSessionId: string, transcriptPath?: string | null) => string[] | null
  }

  /** External: how to find sessions nobody started through Seal. Claude and Codex today. */
  discovery?: {
    processMatch: (argv: string[]) => boolean
    transcripts: AgentTranscriptLocator // where transcripts live under the agent's home
    /** Headless one-shot command that continues a session, used by the `resume` input route. */
    resumeCommand?: (session: LiveSession, text: string) => string
  }

  /** Message history, used by the chat view, summaries, recaps and context usage. */
  transcript?: {
    decoder: NativeChatTranscriptAgent // upstream decoder to reuse
    remoteReadable: boolean // false for Grok, OMP, OpenCode: local files or a Seal server only
    usageOf?: (record: unknown) => AgentSessionContextSample | null // section 7
  }
}
```

The registry asks the adapter table, never a hard-coded `claude | codex` test. Adding an agent is one adapter file plus, if the agent is new to Seal altogether, upstream's own registration (TUI config, hook installer). The six or more existing agent catalogs (`TuiAgent`, display names, `tui-agent-config`, hook targets, native-chat support, the structured runtime catalog, the ACP registry) are upstream-owned and stay. The adapter table reads them and is the only catalog Seal's session code consults; `LIVE_SESSION_PROVIDERS`, `ConnectorAgent` checks in the delivery path and the notifier's hard-coded names are replaced by it.

As built in Phase 0 (`src/shared/live-sessions/adapters/`): `agent-session-agent-ids.ts` holds `AgentSessionAgentId`, which is upstream's `AGENT_HOOK_TARGETS` plus the four plugin agents (OpenCode, OpenCode 2, Pi, OMP), 27 ids in all. `agent-session-adapter.ts` holds the type above with `AgentSessionStatusEvidence`, `AgentTranscriptLocator` and `AgentSessionContextSample`. `agent-session-adapters.ts` holds the table, `AGENT_SESSION_ADAPTERS`, and the lookup `agentSessionAdapter(agent)`. The table is one file, not one file per agent, because every entry is read from upstream's catalogs and a file per agent would restate them: `label` from `TUI_AGENT_DISPLAY_NAMES` (Claude keeps "Claude Code", the name rows and notifications use today), `cli.answers` and `transcript` from `native-chat-agent-support.ts`, `cli.resumeArgv` from `getAgentResumeArgv`. The one fact it states itself is `chat.runtime`, because upstream's runtime catalog is main-only; W1 checks it against that catalog when it attaches the main-only parts.

The main-only parts are not in the shared table: `cli.sessionOf` (the default, `extractAgentProviderSession`, applies), `cli.evidenceOf`, and `discovery` for Claude and Codex (process match, transcript locator, resume command live in `src/main/live-sessions/discovery` and `delivery` today). W1 attaches them in `src/main/live-sessions/adapters/`. `transcript.usageOf` is W5's; it adds one function per agent in a new file under `src/shared/live-sessions/adapters/` and one line in the table, which is agreed in advance. Until W1, `LIVE_SESSION_PROVIDERS` stays as the list of agents the registry admits, and `liveSessionProviderOf(agent)` is how code that knows only Claude and Codex steps aside for any other agent.

### 4.4 The three sources

| Source     | Runs where                                   | Reads                                                                                                                              | Produces                                                                                           | New code                                                                                                                               |
| ---------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Structured | The machine that hosts the chat              | `StructuredAgentSessionHost.subscribeStatus` and `readStatusSummary`, `AgentSessionRecordStore.listRecords`, journal pending items | `surface: 'chat'` records with status evidence, permission prompt, activity, title, model, context | New: `src/main/live-sessions/sources/structured-session-source.ts`. Plugs into `LiveSessionRegistry.publish` next to `mergeSealPanes`. |
| Pane       | The machine whose hook server gets the hooks | `agentHookServer.getStatusSnapshot()`                                                                                              | `surface: 'cli'` records for every agent with an adapter                                           | Generalise `sealPanesFromRows` and `mergeSealPanes` (drop the `claude` or `codex` test, filter `structuredHost`, provisional ids).     |
| External   | Local, and over SSH or a server's `hostRun`  | The discovery script (processes and transcripts)                                                                                   | `surface: 'external'` records                                                                      | None for Claude and Codex. Other agents get discovery only if an adapter supplies it.                                                  |

Field mapping for the structured source (everything on the right exists today):

| Record field                                  | From                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`, provider session                        | `agentSessionProviderHandleChainHead(record.providerHandleChain).handle.nativeId`, else the provisional id                         |
| `machine`                                     | `record.location.executionHostId` mapped to the machine registry                                                                   |
| `cwd`, `project`                              | `record.launchDirectory`, `projectOf(cwd)`                                                                                         |
| `title`, `titleNamed`                         | `record.conversationName`, `conversationNameSource === 'user'`; falls back to the latest prompt                                    |
| Status evidence                               | Projected status, pending approval or question items, live turn tool, `children`, `backgroundTasks`, `turnOutcome`, `awaitingUser` |
| `permission`                                  | The pending journal approval or question, mapped like `permissionFromPendingPrompt`                                                |
| `activity`                                    | `children`, `backgroundTasks` and journal todos into `LiveSessionActivity`                                                         |
| `lastMessage`                                 | `lastAssistantMessage` from the status summary                                                                                     |
| `lastActivityAt`, `startedAt`, `alive`, `pid` | `journal.lastActivityAt()`, `record.createdAt`, lease state, `lease.ownerProcess?.pid`                                             |
| `model`, `context`                            | `record.options.model`, the journal's latest `contextUsage` report                                                                 |
| `configDir`                                   | `agentSessionAccountHomePath(record.accountHome)`                                                                                  |
| `continues`                                   | Earlier links of `providerHandleChain`, and `forkedFrom`                                                                           |
| `inputRoutes`                                 | `[{ kind: 'structured', sessionId }]`                                                                                              |

Input for chats goes through the host, never around it: the `structured` route calls the same host functions as `agentSession.send`, `respondToApproval` and `respondToQuestion`, so workspace authorisation and the host's fences apply. Delivery is confirmed from the journal, not from a transcript file.

### 4.5 The shared core

Each service exists once and is keyed by the record id.

| Service             | Kept implementation                                                                                   | Change                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status              | The status-sweep module and `docs/design/agent-status.md`                                             | Structured and hook evidence are mapped inside that module, with its table-driven tests extended. No source chooses a status code on its own. `LiveSessionStatusHold` stays. Proposed evidence mapping is in section 4.6.                                                                             |
| Asking a question   | `replyAskOf` plus the `LiveSessionReplyAsks` classifier                                               | Runs for every record whose transcript is readable, so a chat that ends its turn on a question reads "Asking you a question". For chats `awaitingUser` and a pending question item are deterministic evidence and skip the classifier.                                                                |
| One-line summary    | `SessionSummarizer` with `live-session-summaries.ts`                                                  | `pane-session-summaries.ts` is merged in: one path keyed by record id, with the hook's last assistant message as the fast input for CLI sessions and the journal's for chats. The `structuredHost` skip is removed.                                                                                   |
| Recap               | `src/main/session-recap` (asked, did, decisions, references)                                          | Its transcript reader becomes the adapter's: files for CLI and external, `projectStructuredItemsToNativeChat(history)` for chats. Same engine, same UI (`components/session-recap`).                                                                                                                  |
| Title               | `liveSessionLabel` precedence: custom title, provider or user name, recap title, first prompt         | Rename writes through to the owner: `agentSession.rename` for chats, the annotation for others. Chat auto-naming (`nativeChatAutoName`, regenerate) stays and feeds `title`. The tab label reads the same value.                                                                                      |
| Unread              | `liveSessionMarksStore` (`seenAt` by record id)                                                       | One rule: unread when activity is newer than `seenAt` and the session is not working. Viewing the session's tab marks it seen. Tab attention and pane completion markers stay as they are for the tab strip and dock badge and are acknowledged together with the record through the `surface` alias. |
| Notifications       | Hook and structured attention paths for sessions in Seal; `LiveSessionNotifier` for external sessions | One rule decides who notifies: the owner of the surface. One settings group ("Agent needs input", "Agent finished") covers all three; `liveSessionsNotify` is migrated into it and removed. Clicking a notification opens the session's tab. Phone push gains external sessions (section 11).         |
| Context usage       | `StructuredAgentContextUsage` and the ring                                                            | Section 7.                                                                                                                                                                                                                                                                                            |
| Activity            | `LiveSessionActivity` (subagents, tasks, todos) and `LiveSessionActivityPanel`                        | Fed by all three sources. Shown from the chat view's header for every session.                                                                                                                                                                                                                        |
| Pins, custom titles | `annotations.json`                                                                                    | Unchanged; follows `continues` and `replacedBy`.                                                                                                                                                                                                                                                      |
| Take over           | `takeOverLiveSession`                                                                                 | External sessions only. Unchanged, but it can now always find a workspace (section 5.3).                                                                                                                                                                                                              |

### 4.6 Status evidence from chats and hooks (proposal for the status module)

To be ratified against `docs/design/agent-status.md` when the status-sweep pull request lands. The codes and labels are that document's; nothing here adds a code.

| Evidence                                                                                        | Status code                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Chat: pending approval item. Hook: `blocked` with an approval prompt                            | `needs-permission`                                                       |
| Chat: pending question item, or `awaitingUser`. Hook: `blocked` with a question prompt          | `waiting-input`                                                          |
| Chat: last turn outcome failed. Hook: stop failure                                              | `errored`                                                                |
| Chat: a turn is running with a foreground shell tool in flight                                  | `running-shell`                                                          |
| Chat: a turn is running. Hook: `working`                                                        | `working`                                                                |
| Chat: waiting only on `children`. Hook: `working` with `workingMode: 'monitoring'` on subagents | `waiting-subagent`                                                       |
| Chat: a turn is running and waits on the output of a task it started earlier                    | `waiting-task`                                                           |
| Chat: turn ended successfully, `backgroundTasks` running or not. Hook: `done`                   | `your-turn`, which the reply-ask classifier may raise to `waiting-input` |
| Chat: created, no turn yet                                                                      | `idle`                                                                   |
| Chat: closed or its host is gone. Hook: session end, pane closed                                | `done`                                                                   |

### 4.7 Machines and federation

The registry runs wherever agents run: in the desktop app for the local machine, and inside the Seal server on each remote machine (`installOrcadSealHub` already installs it there).

| Machine                           | How the desktop gets its sessions                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local                             | All three sources in process.                                                                                                                                                                                            |
| Paired Seal server                | New: the desktop subscribes to the server's `liveSessions.watch` and merges its records, rewriting `machine` to the desktop's machine record. Sending and answering go to the server's `liveSessions.send` and `answer`. |
| Paired server too old to federate | Today's path: the discovery script through `liveSessions.hostRun`. External sessions only. The row for the machine says the server needs an update for chats to be listed.                                               |
| SSH only                          | Today's path: the discovery script over SSH. Spike S2 found no pane rows there: the desktop runs no CLI tabs on an SSH-only machine, only the floating machine shell, which has no hooks.                                |

Precedent for the fallback exists: `desktop-session-summaries.ts` asks the server for its summaries and summarises locally when the server answers `method_not_found`. Summaries and recaps follow the same rule after this work: the machine that owns the record decorates it, and the desktop fills in only what the owner left empty.

The link to a workspace (`workspace`) is set by the registry that serves the client, because the project catalogue lives there: the desktop links federated records against its own catalogue; a server serving a phone directly links against its own.

## 5. Information architecture

### 5.1 The model

- Projects stay as they are: top-level, and opening one shows the project overview with its workspaces and agents.
- A workspace is a folder on a machine with tabs (terminal, browser, Markdown, chat). An agent session is a tab in a workspace.
- Every agent session belongs to exactly one workspace. A session in a folder that an existing workspace covers attaches to it. A session in an unknown folder gets a workspace, and a project if needed, created for it (section 5.3).
- The machine-grouped Active agents section is merged into the sidebar and then removed. Everything it does today keeps a place: section 13.5 lists each feature and where it lives afterwards, and nothing is deleted before that list is verified. The machine is a badge on the workspace and on the session row, a filter in the sidebar toolbar, and the Machines page is the per-machine view.
- Home and the phone follow the same model: sessions grouped by project and workspace, with the machine as a badge. "Needs you" stays as the attention strip on the phone and becomes one on Home.

### 5.2 Sidebar (exact specification, own workstream)

```text
Projects
▾ alpharidge-app
    main                      primary · kessel-ml        ▢ 2 terminals · 1 browser
      ✳ Fix the flaky portfolio chart test                       6m
        ● Asking you a question
        Wants to know whether to mock the clock or use fake timers
      ✳ Add a dark-mode toggle to the settings page              2m
        ● Working
        Editing src/theme.ts after reading the settings page
      ◆ Review the pull request                                   9m
        ● Waiting on you
        Finished the review; two blocking comments on the API change
    feature/payments          2299
      ✳ Migrate the invoices table                               1m
        ● Waiting on 2 background tasks
        Migration script running; will verify row counts next
▸ weye
```

Rules:

1. Under each workspace, every agent session (Claude, Codex, and every other agent with a record; chat, CLI and external alike) is its own full row. Rows are always visible. There is no chevron that hides them, no "N more", and the compact card style and the "inline agents" card option do not hide them.
2. Each row shows, in this order: agent icon with the unread dot, session title, relative time; the status dot and status label ("Working", "Asking you a question", "Waiting on you", "Waiting on 2 background tasks", "Waiting for approval", "Error", "Ended", and the rest of the ten codes, from the one status module); the one-line live summary underneath. It is the existing `LiveSessionRow` (`components/live-sessions/row/LiveSessionRow.tsx`), `tone="sidebar"`, `layout="row"`. One shared row component everywhere: sidebar, Home, Machines, project overview, palette results.
3. Everything else the row has today stays: pin, recap badge, subagent count, account badge, hover preview, context menu and dropdown (`LiveSessionMenuItems`), keyboard navigation, the highlighted current session.
4. Order within a workspace: `compareLiveSessions` (what blocks on you first, then busy, then resting), pinned first. "Every session" means every running session (`isActiveLiveSession`). Sessions that ended are not rows of their own: a workspace that has any shows one line, "Recently finished · N", that expands to their rows, as the Active agents section does today (question 5 in section 16). They also remain reachable from their tab if it is open and from the palette.
5. Non-agent tabs (terminal, browser, Markdown, editor) are not rows. The workspace row shows compact indicators for them at most (counts with icons). The workspace-level sessions badge (`LiveSessionsBadge`) is removed from the card because the rows replace it; the project-level badge on the project header stays.
6. Clicking a session row opens its workspace and focuses that session's tab (a preview tab on single click, kept on double click, as today). Clicking the workspace row opens the workspace with all its tabs.
7. Drag sources for multi-pane are the workspace row and the session row (section 15).
8. A workspace with no sessions shows no session rows and looks as it does today.
9. A session no workspace holds still belongs to a project (section 5.3, "Sessions without a workspace"). Its row sits right under that project's header, above the project's workspaces. When the list draws no header for the project (no such project in the sidebar, or the list is grouped another way), the project is a group after the workspaces, named by the project. Only a session with no folder at all is listed under a last group, "Unassigned". Every such group is absent when empty.
10. The sidebar toolbar carries what the Active agents header and toolbar carry today, and the session rows carry what its rows carry. Section 13.5 is the full list, taken from the section's code.

Implementation seam: the workspace card is rendered from a template (`components/sidebar/workspace-card/template/default-workspace-card.json` with parts registered in `card-activity-parts.tsx` and `card-identity-parts.tsx`). Seal adds a `SessionRows` part that renders a Seal-owned component (`components/live-sessions/workspace-rows/WorkspaceSessionRows.tsx`) and uses it in the template where the upstream `Agents` part sits, without the `vars.inlineAgents` condition. Upstream's inline agent rows (`WorktreeCardAgents`, `CompactAgentRow`) are no longer mounted in Seal once every hook agent has a record; `agent-rows-without-session-panes.ts` (Seal's stop-gap filter) is deleted. The sidebar virtualiser already measures cards with variable height because cards carry inline agent rows today.

### 5.3 Attaching sessions to workspaces and projects

The link step runs in the registry (main process), not in the renderer as `linkLiveSessions` does today, so the phone, Home, the CLI and MCP see the same grouping.

| Step | Rule                                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | A chat or CLI session belongs to the workspace its tab is in.                                                                                                                                                                                                                                                                    |
| 2    | Otherwise the workspace on the same machine whose folder is the session's `cwd` or its longest ancestor (today's rule, extended to Windows path separators).                                                                                                                                                                     |
| 3    | Otherwise probe the folder on its machine: `git rev-parse --show-toplevel`, the remote URL and the branch. Locally through the existing git runner, on a server through an RPC, over SSH through `MachineConnection.exec`. The probe result is cached per folder.                                                                |
| 4    | In a repository: find the project by `getProjectIdentityKey` (`github:` owner and name, else `git:` canonical remote, else path). Found: add a workspace for that checkout on that machine under the project (a host setup is added if the project has none on that machine). Not found: create the project, then the workspace. |
| 5    | Not in a repository: a folder workspace at `cwd` under a folder project identified by machine and path.                                                                                                                                                                                                                          |
| 6    | Cannot probe (machine offline, folder gone, permission denied), or no workspace can be made (a machine reached over SSH only, an ended session): the session has no workspace and is listed under its project by the rule below. A failed probe is retried on the next scan.                                                     |

Sessions without a workspace. A workspace is optional; a project is not. Every session with a folder has a project, whichever agent, machine or launch path it came from:

- The registry publishes `session.repository = { name, projectKey? }` on a session it links to no workspace. `name` is the folder name of the repository's main checkout (so a linked worktree or a subfolder names the repository, not itself); `projectKey` is `getProjectIdentityKey` of its remote (`github:` owner and name, else `git:` canonical remote) when it has one. The probe is step 3's, on every transport, and runs for ended sessions too.
- `liveSessionFolderProject(session)` (`src/shared/live-sessions/live-session-project.ts`) is the one rule every surface uses: the repository's key and name, else the name of the session's folder (`session.project`, the last segment of `cwd`) under the key `folder:<name>`. A session with no `cwd` has no project.
- The sidebar matches that project to its own projects by key, then by name in any letter case (a project's label, a repository's display name or folder name, a project group's name). The same repository or folder name on two machines is one project. No record is created for a project that exists only as a folder name: like `Project`, it is a projection of what is there.
- The user can move a session: "Move to project" on its row's menu lists the projects and "New project…". The choice is saved with the session's other annotations (`annotations.json`, `project: { key, name }`), is published as `session.assignedProject`, and wins over the workspace link and the folder rule; "Reset to automatic" removes it.

Rules for what is created automatically:

- Auto-created workspaces and projects are marked `autoCreated`. They are removed again when their last session has left the list and the user never opened a tab in them, renamed them, pinned them or added anything to them. Any such action clears the mark.
- Dedupe: one workspace per (machine, checkout root). One project per identity key. Two machines with clones of the same remote are one project with two host setups, which is today's `Project` and `ProjectHostSetup` model.
- Rename and merge: a project can be renamed as today. Merging two projects (for example a path-identified one that later gains a remote) is offered when identity keys converge, and is available as a manual action on the project; sessions, pins and order move with it.
- Sessions in a home directory, a temporary directory or `/` do not create a project per folder. They attach to one folder workspace per machine named after the machine's home ("~ on kessel-ml").

### 5.4 File tree

A collapsible VS Code-style file tree inside a workspace reuses the existing explorer (`components/right-sidebar/file-explorer/**`, about 11.7k lines: lazy loading, git decorations, drag and drop, search, remote owners). No second tree is built. The explorer is bound to the active workspace through the store today; the work is to give `FileExplorer` a `worktreeId` and execution host prop (defaulting to the active workspace), and to mount it as a collapsible panel at the left edge of the workspace content with its open state stored per workspace. The Machines page has a separate explorer (`components/machines/explorer/**`, 2,142 lines) for browsing a whole machine's disk; whether it can be folded into the same component is a follow-up, not part of this plan.

### 5.5 Migration

| Existing state                                                                                                                | After                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projects, workspaces, their tabs and order                                                                                    | Unchanged.                                                                                                                                                   |
| Pinned sessions and custom titles (`annotations.json`, keyed by record id)                                                    | Unchanged; ids do not change. Pinned sessions sort first within their workspace.                                                                             |
| The fold state of Active agents, of its machine groups and of "Recently finished"; the project or workspace it is narrowed to | Not dropped; each has a place in section 13.5 (A2, A3, A7, A8). Order stays by status, pinned first. Active agents has no manual row order at `51496ea453d`. |
| Open session tabs (`liveSessionTabsStore`, `localStorage`)                                                                    | Migrated once: each becomes a tab in the session's workspace; the stored list is then cleared.                                                               |
| `seenAt` marks                                                                                                                | Unchanged.                                                                                                                                                   |
| Sessions on SSH-only machines                                                                                                 | Linked by the probe over SSH (step 3). They get workspaces like any other.                                                                                   |
| Links to the former Active agents page (`showActiveAgents`, `showScopeInActiveAgents`, Home chat's `open_in_seal`)            | Open the project or workspace in the sidebar with the machine or project filter applied.                                                                     |

## 6. One chat view, one composer, one tab strip

### 6.1 Parity today

The three columns are the three ways a conversation is shown today. "Bridge" is the chat view over a CLI terminal tab (`TerminalPaneNativeChatPortal`).

| Capability                                                             | Project chat (structured) | CLI tab, chat view (bridge)     | Session view (registry)                           |
| ---------------------------------------------------------------------- | ------------------------- | ------------------------------- | ------------------------------------------------- |
| Message list with markdown, code blocks, tool calls                    | Yes                       | Yes                             | Yes, same rows, no providers                      |
| Clickable file links, link handling, image viewer                      | Yes                       | Yes                             | No                                                |
| Find in transcript, row actions (copy, fork from here), context menu   | Yes                       | Yes                             | No                                                |
| Font zoom shortcuts, appearance settings                               | Yes                       | Yes                             | No                                                |
| Subagent transcripts                                                   | Yes                       | Supported agents                | No (count and activity panel)                     |
| Turn timing ("Worked for 12s"), streaming indicator                    | Yes                       | Yes                             | No                                                |
| Changed-files cards                                                    | Yes                       | Yes                             | Yes                                               |
| Empty state ("Start a chat with Claude")                               | Yes                       | Yes                             | No                                                |
| Composer: multi-line with history                                      | Yes                       | Yes                             | Textarea only                                     |
| Model, effort and permission-mode pickers                              | Yes                       | Yes (typed into the terminal)   | No                                                |
| Attachments: drag and drop, paste images, file picker                  | Yes                       | Images                          | No                                                |
| Voice input                                                            | Yes                       | Yes                             | No                                                |
| `@` mentions, `/` commands, skills                                     | Yes                       | Yes                             | No                                                |
| Message queue and steering while the agent works                       | Yes                       | Pending sends                   | Pending sends with retry                          |
| Stop                                                                   | Yes                       | Yes (Escape)                    | No                                                |
| Approvals and questions: options, free text, multi-select, plan review | Yes                       | Yes for Claude, Codex, OpenCode | Options only                                      |
| Rewind, fork, compact, thread goal                                     | Yes                       | No                              | No                                                |
| Context usage ring                                                     | Yes                       | No                              | No                                                |
| Tokens until auto-compact, compaction warning                          | No                        | No                              | No                                                |
| Footer: machine, folder, branch                                        | Yes                       | Yes                             | Path in the header                                |
| Ten-code status, status label in the header                            | No                        | No                              | Yes                                               |
| One-line summary                                                       | No                        | Yes (pane)                      | Yes                                               |
| Recap (asked, did, decisions, references), jump to message             | No                        | No                              | Yes                                               |
| Activity panel: subagents, background tasks, todos                     | Roster only               | No                              | Yes                                               |
| Pin, custom title, account badge and switch, take over                 | Rename only               | Rename only                     | Yes                                               |
| Listed on Home, Machines, phone list, `seal sessions`, MCP             | By accident, degraded     | Claude and Codex only           | Yes                                               |
| Tab: drag to reorder, drag to split, close others, rename              | Yes                       | Yes                             | No (drag selects text)                            |
| New-tab button in the strip                                            | Yes                       | Yes                             | No                                                |
| Strip in the title-bar row, overflow handling                          | Yes                       | Yes                             | No (empty band above, scrollbar inside the strip) |
| Right sidebar (files, changes) follows the conversation's folder       | Yes                       | Yes                             | No (keeps the last workspace)                     |

Target: every row is "Yes" for every session, limited only by what the agent and its host can supply (section 6.5).

### 6.2 The chat view

`NativeChatView` is the only chat view. It already has two content sources; it gets a third.

| Source     | Used for              | History and live updates                                                                                      | Sending and answering                                            | State                                                                                                     |
| ---------- | --------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Structured | Chats                 | Journal over `agentSession.*`                                                                                 | `agentSession.send`, `respondToApproval`, `respondToQuestion`    | Exists.                                                                                                   |
| Bridge     | CLI tabs in chat view | Transcript tail for the pane's provider session                                                               | Keystrokes into the terminal                                     | Exists.                                                                                                   |
| External   | External sessions     | `liveSessions.transcriptPage` and `watchTranscript` (local files, SSH, server), already `NativeChatMessage[]` | `liveSessions.send`, `answer` through the session's input routes | New: a source object implementing the contract below, built from `use-live-transcript.ts` and the outbox. |

The contract between the registry side and the view side (owned by workstream W0, section 14):

```ts
// src/shared/live-sessions/agent-session-chat-source.ts (new)
export type AgentSessionChatSource<ComposerTransport> = {
  sessionId: string // record id
  messages: {
    page(before?: LiveTranscriptCursor): Promise<LiveTranscriptPage>
    watch(onDelta: (d: LiveTranscriptDelta) => void): () => void
  }
  pending: { list(): LiveSessionPendingMessage[]; retry(messageId: string): void } // the outbox
  prompt: LiveSessionPermissionPrompt | null
  answer(promptId: string, answer: AgentSessionPromptAnswer): Promise<void>
  /** The composer transport the existing composer already accepts in place of a terminal:
   *  NativeChatStructuredComposerTransport on desktop, the phone composer's own on the phone. */
  composer: ComposerTransport
  capabilities: AgentSessionCapabilityFlags
}
```

As frozen in Phase 0, the type takes the composer transport as a parameter because `NativeChatStructuredComposerTransport` is a renderer type that shared code cannot import; W4 uses `AgentSessionChatSource<NativeChatStructuredComposerTransport>`. `page` takes a `LiveTranscriptCursor` (a byte offset, as the registry's transcript calls do), `AgentSessionPromptAnswer` is the structured host's `AgentSessionPromptResponse`, and `LiveSessionPendingMessage` is the outbox's `LiveMessage`.

`NativeChatComposer` already runs without a terminal when it is given a `structuredTransport` and `targetPtyId={null}` (`composer/submit/native-chat-structured-composer-transport.ts`). The external source supplies that transport; controls the session cannot support are hidden by the capability flags, not by a second composer. The view is mounted with the same providers as the project chat (appearance root, link handling, file-link existence, image owner, row actions, find, context menu, font shortcuts, subagent transcripts, empty state, turn timing), which is what `LiveSessionChat` lacks today.

The header of the chat view, for every session, carries what the session view's header has today: title, status dot and label, agent, machine and folder, and the Recap, Subagents and Tasks buttons (`LiveSessionActivityPanel`, `components/session-recap`), plus the session menu. It is one Seal-owned header component mounted through `NativeChatView`'s header slot.

### 6.3 Tabs

A session opens as a tab in its workspace, in the workspace tab strip (`TabBar`, `SortableTab`):

| Surface  | Tab                                                                                                                                                                                                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat     | The existing `agent-session` tab.                                                                                                                                                                                                                                                                                                                 |
| CLI      | The existing terminal tab. Its chat view toggle stays.                                                                                                                                                                                                                                                                                            |
| External | A new tab content type, `external-agent-session`, whose entity id is the record id. It is created when the user opens the session (not for every discovered session), is persisted with the workspace like any tab, and renders `NativeChatView` with the external source. When the session ends the tab stays and shows the transcript as ended. |

`openAgentSession(sessionId, mode)` is the single entry point (it replaces `openLiveSessionView`, `openLiveSessionFromRow`'s target, the palette action and the notification click): it resolves the record, activates its workspace, and focuses or creates the tab for its surface.

The `sessions` top-level view, `LiveSessionWorkspace`, its `SessionTab` strip and `liveSessionTabsStore` are deleted. The drag-selects-text bug and every strip difference disappear with them.

Why a new content type and not a reuse of `agent-session`: about 157 non-test files test for the literal `'agent-session'` and assume a journal-backed structured session behind it. A distinct type keeps those assumptions true and lets TypeScript's exhaustive checks point at every switch that needs a case. Its footprint is known from the `simulator` tab type upstream added the same way (about 48 files, a line or two each); the commit that added `simulator` is the checklist. This is the largest edit to upstream-owned files in the plan and is recorded as a known seam in `docs/upstream-sync.md`.

Alternative to test first (spike S1 in section 14): host an external session as an `agent-session` tab through a Seal-owned structured adapter that attaches to the running conversation (history from the transcript, as adoption does today; live tail; input through the session's routes). If it works, external sessions get the journal, the queue and the phone's full chat for free and no new tab type is needed. It is not the plan of record because it depends on the host accepting a session whose process it does not own, which the code does not show.

### 6.4 What "works in both" means per surface

| Capability                              | Chat                                     | CLI in Seal                                                                                           | External                                             |
| --------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Ten-code status, question detection     | New (structured source)                  | Exists for Claude and Codex; new for other hook agents                                                | Exists                                               |
| One-line summary                        | New                                      | Exists (merged key)                                                                                   | Exists                                               |
| Recap                                   | New (journal as transcript)              | Exists for Claude and Codex; new for agents with a decoder                                            | Exists                                               |
| Title, rename, pin                      | New on the record; rename writes through | Exists                                                                                                | Exists                                               |
| Unread, notifications, phone push       | Unified rule                             | Unified rule                                                                                          | Phone push is new                                    |
| Context usage and compaction            | Exists; compaction distance is new       | New (transcript usage)                                                                                | New (transcript usage)                               |
| Home, Machines, phone, CLI, MCP listing | New                                      | New for non-Claude, non-Codex agents                                                                  | Exists                                               |
| Full composer                           | Exists                                   | Exists in chat view                                                                                   | New (external source)                                |
| Rich approvals and questions            | Exists                                   | Exists for Claude, Codex, OpenCode family                                                             | Options today; free text where the route can type it |
| Queue, rewind, fork, compact            | Exists                                   | Not available: the agent's own terminal has no such interface. Offered as "Continue in Chat" (adopt). | Not available; offered after take over               |

### 6.5 What each agent can supply

"Chat" is a headless structured session. "Bridge" is the CLI shown as a chat. Capabilities missing for an agent are missing in the agent, not in Seal; the adapter records them and the UI hides the control.

| Agent                                                                               | Chat (structured)         | CLI hooks: session id | Working directory from hooks | Transcript decoder (remote readable)    | Question detection               | Answer from Seal          | Subagents       | Context usage                                               | Resume     | External discovery |
| ----------------------------------------------------------------------------------- | ------------------------- | --------------------- | ---------------------------- | --------------------------------------- | -------------------------------- | ------------------------- | --------------- | ----------------------------------------------------------- | ---------- | ------------------ |
| Claude Code                                                                         | Yes (stream-json)         | Yes                   | Yes                          | Yes (yes)                               | Yes                              | Full                      | Yes             | Exact in chat; transcript elsewhere                         | Yes        | Yes                |
| OpenClaude                                                                          | No                        | Yes (as Claude)       | Yes                          | Yes (yes)                               | Yes                              | Full                      | Yes             | Transcript                                                  | Unverified | No                 |
| Codex                                                                               | Yes (app-server)          | Yes                   | Yes                          | Yes (yes)                               | Yes                              | Full                      | Yes             | Exact in chat; transcript elsewhere, window size unverified | Yes        | Yes                |
| GitHub Copilot CLI                                                                  | Yes (ACP)                 | Yes                   | No                           | No                                      | Weak (approvals read as working) | No (terminal only)        | Children folded | Chat only, if the agent reports it                          | Yes        | No                 |
| OpenCode, OpenCode 2                                                                | Yes (ACP)                 | Yes (plugin)          | No                           | Yes, SQLite (local or server only)      | Yes                              | Full                      | No              | Chat only, if reported                                      | Yes        | No                 |
| Grok                                                                                | Yes (ACP)                 | Yes                   | No                           | Yes (local or server only)              | Yes                              | Options (no step answers) | Yes             | Chat only, if reported                                      | Yes        | No                 |
| OMP                                                                                 | Yes (ACP)                 | Yes                   | No                           | Yes (local or server only)              | Yes                              | Terminal for questions    | Yes             | From `/context` and catalogue                               | Yes        | No                 |
| Pi                                                                                  | Yes (jsonl-rpc)           | With a session file   | No                           | No                                      | Yes                              | No                        | Yes             | Chat only, if reported                                      | Yes        | No                 |
| Antigravity                                                                         | Yes (ACP, not on Windows) | Gated on first record | No                           | No                                      | Weak                             | No                        | No              | Chat only, if reported                                      | Yes        | No                 |
| Kimi                                                                                | Yes (ACP)                 | Yes                   | No                           | No                                      | Partial                          | No                        | No              | Chat only, if reported                                      | Yes        | No                 |
| Zcode                                                                               | No                        | Yes                   | No                           | Yes, as OpenCode (local or server only) | Yes                              | Full                      | No              | None                                                        | Yes        | No                 |
| Gemini, Cursor, Droid, Devin, Hermes, Jcode, Dsh, Qoder, Qwen Code, CodeBuddy, Muse | No                        | Yes                   | No                           | No                                      | Varies                           | No                        | Varies          | None                                                        | Yes        | No                 |
| Kiro                                                                                | No                        | Yes                   | No                           | No                                      | No (approvals invisible)         | No                        | No              | None                                                        | Yes        | No                 |
| Amp, Command Code                                                                   | No                        | No (pane id used)     | No                           | No                                      | Weak                             | No                        | No              | None                                                        | No         | No                 |

The adapter table has an entry for each agent above (27 ids: Qoder is two, `qoder` and `qoder-cn`). Two agents that upstream can resume and whose hook payloads it can read, MiMo Code and Prime Agent, are not in this table and have no adapter yet; adding one is a line in `agent-session-agent-ids.ts`.

Consequences for the list surfaces: an agent with no transcript decoder still gets a row with status, title (first prompt), and a one-line summary from its hook's last assistant message. It gets no recap and no chat view; opening it focuses its terminal tab. An agent with no working directory in its hooks is attached to its tab's workspace (rule 1 in section 5.3), which is always known for a CLI in Seal.

## 7. Context and compaction indicator

One indicator, bottom right of the composer next to the send button, for every session and on the phone. It is the existing `NativeChatContextUsageRing` extended, not a second component.

Model: the ring's existing input, `NativeChatContextUsageSummary` (`src/shared/native-chat/native-chat-context-usage-summary.ts`), is extended and used for every source. No second type is added. It is not the turn-row fact type `AgentSessionContextUsage` in `src/shared/agent-session/`, which stays as the structured journal's storage format and is one of the inputs.

```ts
// src/shared/native-chat/native-chat-context-usage-summary.ts (existing, extended)
export type NativeChatContextUsageSummary = {
  usedTokens: number
  windowTokens: number
  percentage: number
  estimated: boolean // false only when the provider reported the numbers
  rows: readonly { name: string; tokens: number; percentage: number; deferred?: true }[]
  /** New. Tokens at which the agent compacts on its own; absent when unknown or auto-compact is off. */
  autoCompactAtTokens?: number
  /** New. */
  model?: string
  /** New. How many times this session compacted, and when it last did. */
  compactions?: number
  lastCompactedAt?: number
  updatedAt?: number
}
```

Data sources:

| Session                 | Used tokens                                                                                                                                                                                                                                                                                     | Window                                                                                                                                                          | Auto-compact threshold                                                                                                                            | Compactions                                                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude chat             | Exact: the SDK context report (`claude-context-usage.ts`); estimated between reports from the last assistant message's usage                                                                                                                                                                    | The report's `rawMaxTokens`, else the SDK's `modelUsage[].contextWindow`, else 1M for `[1m]` models                                                             | `autoCompactAtTokens` from the report. It is parsed today and dropped before the ring; pass it through.                                           | `compact_boundary` events                                                                                                                             |
| Codex chat              | Exact: `tokenUsage.last.totalTokens` from `thread/tokenUsage/updated`                                                                                                                                                                                                                           | `modelContextWindow` from the same notification                                                                                                                 | Unknown (no reader for Codex's auto-compact setting). Shows usage without a compaction distance.                                                  | `thread/compacted`                                                                                                                                    |
| ACP chat                | Whatever the agent reports through the structured `contextUsage` capability                                                                                                                                                                                                                     | Same                                                                                                                                                            | Unknown                                                                                                                                           | If reported                                                                                                                                           |
| Claude CLI and external | Last main-thread assistant record's `message.usage` in the transcript (input, cache read, cache creation, output). The decoder drops it today; keep it. For CLI in Seal, the status line payload's `context_window` is a second source that Seal receives and ignores today.                    | The model's window: `[1m]` hint, else the per-model default table shared with Home chat                                                                         | Unknown from the transcript. Brian took the default of question 6: the warning is relative to the context window only, with no assumed threshold. | `isCompactSummary` records, `PostCompact` hook                                                                                                        |
| Codex CLI and external  | `event_msg` `token_count` records' `info.last_token_usage.total_tokens` in the rollout, from the last record whose `info` is not null. Not decoded today. Read it directly: `parseCodexUsageRecord` is a billing-delta parser and returns nothing for the record after a compaction (spike S4). | `info.model_context_window` of the same record: Codex's effective window (95% of the model's), the same number Codex chat reports. Unknown when null (spike S4) | Unknown                                                                                                                                           | Top-level `compacted` records (current Codex also writes an `item_completed` `ContextCompaction` for the same compaction; counting both counts twice) |
| Other CLI agents        | None                                                                                                                                                                                                                                                                                            | None                                                                                                                                                            | None                                                                                                                                              | None. The indicator is not shown.                                                                                                                     |

The registry puts the latest value on the record (`context`), so lists and the phone can show it without opening the transcript.

States, in the ring and its popover:

| State           | Condition                                                                                   | Ring                                                                                       | Popover                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unknown         | No usage yet, or the agent supplies none                                                    | Hidden for agents that never supply it; empty ring before the first turn                   | "Context usage appears after the first reply."                                                                                                                                                        |
| Normal          | Below the warning point                                                                     | Neutral arc at the used fraction                                                           | "84k of 200k tokens (42%)", model, "Compacts automatically at 160k: 76k left" when the threshold is known, "Compacted 2 times, last 14 min ago", a "Compact now" action where the session supports it |
| Near compaction | Threshold known: 80% or more of the threshold. Threshold unknown: 80% or more of the window | Warning colour (`status-warning` token), and a short text beside the ring: "Compacts soon" | Same, with the distance emphasised                                                                                                                                                                    |
| Critical        | 95% or more of the threshold, or 90% or more of the window (today's `CRITICAL_PERCENTAGE`)  | Destructive colour, text "Context almost full"                                             | Same, with "Compact now" as the primary action                                                                                                                                                        |
| Compacting      | A compaction is running                                                                     | Spinner in the ring                                                                        | "Compacting…"                                                                                                                                                                                         |
| Just compacted  | Within a minute of a compaction                                                             | Arc drops; brief "Compacted" text                                                          | New numbers                                                                                                                                                                                           |

Estimated values are marked with "about" in the popover. "Time until compaction" is not shown as a clock: the rate of token use is too uneven to predict honestly. The distance in tokens and the warning states are the signal.

Sharing: the ring component keeps its input type, now filled from every source. Home chat's token bar (`HomeChatContextBar.tsx`, its own 80% rule and progress bar) renders the same indicator with its thread's numbers; its machines popover stays. The phone's `MobileNativeChatContextUsageRing` takes the same type and thresholds from shared code. Thresholds live in one shared file.

## 8. The missing CLI option

### 8.1 Root cause

Brian does not see "Claude (CLI)" or "Launch Claude in a new terminal" in the new-tab menu. This is upstream behaviour, not a Seal patch, a feature flag or a platform check. Three things combine:

1. The workspace `+` menu does not render a flat list of actions. `tab-bar-surface.tsx` passes a picker inventory, so `QuickLaunchButton` renders `AgentLaunchPickerMenu`: one row per agent ("Claude", "Codex", …) with a chevron. The row launches the agent's default surface. The other surface is only inside the chevron's sub-panel. No row is ever labelled "(CLI)". The running app confirms it with chat off and with chat on (screenshots in the pull request).
2. The row model suppresses the CLI row for any agent whose chat is the default and runnable. In `buildNewTabAgentMenuRows` (`src/shared/agent-launch/picker/agent-launch-picker-rows.ts`), `cli` rows are built only from `installed.filter((agent) => !runnable.includes(agent))`. With chat as the default surface (the `agentDefaultSurface` setting or a per-agent `nativeChatProviders` override) Claude gets a `chat` row and no `cli` row.
3. In the flat-menu path the other surface is `otherSurfaceRow`, drawn by `TabAgentSurfaceChoiceRow` with `AgentSurfaceLaunchButton`: an icon-only button with `opacity-0` until its row is highlighted, and only if the agent's CLI is in `detectedIds`.

Contributing conditions that remove the terminal surface entirely: the agent's CLI was not detected on the host (`agentPickerEntriesFromRows` adds `'terminal'` only if `detected.includes(agent)`), which is more likely on remote hosts where detection has not finished or failed; and hosts whose capability answer is `no-chats`, which get unlabelled `terminal` rows.

### 8.2 Fix

| Change                                                                                                                                                                                                                                          | File                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Emit a `cli` row for every installed agent, next to its `chat` or `chat-unavailable` row, instead of only for agents without a runnable chat. Order: the default surface first.                                                                 | `src/shared/agent-launch/picker/agent-launch-picker-rows.ts` (`buildNewTabAgentMenuRows`)          |
| In the picker menu, show both surfaces on the agent's row as two labelled actions, "Chat" and "CLI", always visible; the row's main click still launches the default. The sub-panel keeps model and setup choices.                              | `components/agent/AgentLaunchPickerMenuRow.tsx`, `AgentLaunchPickerMenu.tsx`                       |
| In the flat path, make the other-surface button visible at rest with a text label (remove the `opacity-0` until highlighted behaviour).                                                                                                         | `components/agent/AgentSurfaceLaunchButton.tsx`, `components/tab-bar/TabAgentSurfaceChoiceRow.tsx` |
| Titles stay as they are in `tab-agent-row-presentation.ts`: "Start a chat with Claude", "Launch Claude in a new terminal", label suffix "(CLI)".                                                                                                | No change                                                                                          |
| When the CLI was not detected on the host, show the CLI action disabled with the reason ("Claude is not installed on kessel-ml") instead of omitting it. When detection is still running, show it enabled; the launch reports a missing binary. | `use-new-tab-agent-menu-rows.ts`, `agent-launch-picker.ts` (`agentPickerEntriesFromRows`)          |
| The chat action is never disabled for SSH or subfolder (section 9).                                                                                                                                                                             | `structured-native-chat-launch-route.ts`, `tab-agent-row-presentation.ts`                          |

Agents with only one surface show only that one: CLI-only agents (Gemini, Cursor, and the rest) keep a single row.

## 9. Chat on remote machines

### 9.1 Today

`resolveStructuredNativeChatSupport` (`src/shared/structured-native-chat-launch-route.ts`) refuses a chat for these reasons, which the menu shows through `chatUnavailableLabel`:

| Label     | Blocker                  | Cause in code                                                                                                                                                    |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSH       | `remote-execution-host`  | `structuredAgentSessionTargetForHost` returns null for `ssh:` hosts. A plain SSH host has nothing on it that can run the structured host and its journal.        |
| Subfolder | `custom-start-directory` | A client-side rule: structured sessions start at the workspace root. The host can already start elsewhere (`hostLaunchDirectory`, used for floating workspaces). |
| WSL       | `project-runtime`        | A local Windows project that runs in WSL. Providers require a native local location.                                                                             |
| Windows   | Platform                 | Only Antigravity on native Windows. Claude and Codex chats are not blocked on Windows.                                                                           |

Chat already works on a paired Seal server (`runtime:<environmentId>`): the provider, the journal and the status feed run on the server, attachments are uploaded in chunks, and the desktop shows the tab. Chat on a paired WSL server works behind the `experimentalWslHosts` setting.

### 9.2 Design

A remote machine has the same functionality as the local one when it runs the Seal server, because then the same code runs there. So the rule is: every SSH machine gets the Seal server (section 10), and chat runs through it. For the hosts where it cannot, chat still opens, with the best transport available:

| Host                                                        | Chat transport                                                                                                                                                                                                                                                                                      | Difference from local                                                                                                            |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Local                                                       | Structured                                                                                                                                                                                                                                                                                          | None                                                                                                                             |
| SSH machine with the Seal server (the default)              | Structured, on the server, through the SSH tunnel                                                                                                                                                                                                                                                   | None. Sessions keep running when the laptop disconnects.                                                                         |
| SSH machine without the server (install failed or declined) | Bridge: the agent's CLI is started in a terminal tab that opens in chat view. Same view, same composer. Available for agents whose transcript can be read over SSH (Claude, Codex, OpenClaude). Spike S2: this terminal tab does not exist today (no PTY provider for an SSH host); see section 17. | No queue, rewind, fork or exact context numbers. A banner in the chat offers "Install Seal server on this machine" for the rest. |
| Subfolder of a workspace                                    | Structured, started in that folder. Remove the client-side `custom-start-directory` refusal and pass the folder as the launch directory, as floating workspaces do.                                                                                                                                 | None                                                                                                                             |
| Local Windows project running in WSL                        | Bridge now. Structured through the distribution's own Seal server when `experimentalWslHosts` graduates; that work is upstream's and is not duplicated here.                                                                                                                                        | As for SSH without the server                                                                                                    |
| Native Windows                                              | Structured for every agent that supports it (already the case). Antigravity stays CLI-only on Windows, with the reason shown.                                                                                                                                                                       | None for Claude and Codex                                                                                                        |

The launcher change is one function: where `resolveStructuredNativeChatSupport` returns a blocker for `remote-execution-host` or `project-runtime`, the route falls back to "CLI in chat view" if `canToggleNativeChat` allows it for that agent and host, and the menu row stays a normal "Chat" row. `chatUnavailableLabel` keeps only the reasons that are real: the agent has no chat, the agent is not installed on the host, the check failed.

Why not run the provider process over an SSH channel with the journal on the desktop: it would make the desktop the owner of a remote session, so the session would die when the laptop sleeps, a second desktop or the phone could not see it, and every host-side feature (attachments, file references, status feed) would need a remote variant. Upstream decided against it for the same reasons. The server is the mechanism; the bridge is the fallback.

## 10. Seal server on SSH machines: install by default, run as a service

### 10.1 What exists

Almost everything, upstream, in `src/main/managed-server/**` and `src/main/ssh/host-server/**`:

- `resolveHostServerOnConnect` decides on SSH connect: deploy to an empty host, convert a host that already has projects, or tunnel to and update an existing managed server.
- `createManagedOrcadEnvironment`, `deployOrcad`, `installOrcadBundle`: detect the platform, upload a pinned Node runtime and the server bundle to `~/.orca-remote/orcad-<version>/`, start it, wait for readiness. No Node or other prerequisite is needed on the host.
- The server binds `127.0.0.1:6768` on the remote machine and is reached through an SSH local port forward. No port is opened.
- Pairing is automatic through the tunnel. Tunnel resume, pairing repair, decommission and a crash-loop brake exist.
- On each connect `checkManagedServerUpdate` and `autoUpdateManagedOrcadEnvironment` upgrade the server to the app's version and never downgrade.
- `convertSshTargetToManagedOrcad` moves a machine's projects from the SSH host (`ssh:<id>`) to the server (`runtime:<environmentId>`) under a fence with a journal.
- `seal serve service install` renders a systemd user unit or a launchd agent for a locally installed app (`src/cli/server/serve-service.ts`, `src/cli/runtime/serve-service-unit.ts`).

What Seal does today instead: the Machines page's "Connect over SSH" registers a direct-SSH policy (`setDirectSshConnectPolicy`, wired in `machine-registry-service.ts`), so `ssh-connect-flow.ts` takes `connectDirect` and installs nothing.

What is missing:

| Gap                                                                                                                              | Where                                                           |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| The server is started with `nohup` and exits after 15 idle minutes. It does not survive a reboot until the next desktop connect. | `orcad-remote-launch.ts` (`OrcadLaunchDetach = 'nohup'          | 'setsid'`), `orcad-managed-idle-exit.ts` |
| No service manager integration for a managed server; no PM2 support anywhere.                                                    | New                                                             |
| A failed install ends the connection with an error instead of falling back to plain SSH.                                         | `ssh-connect-flow.ts` ("Unserved hosts have no relay fallback") |
| No per-machine choice or record of the install.                                                                                  | `machine-record.ts`, `AddMachineFlow.tsx`                       |
| Linger is reported, never enabled.                                                                                               | `serve-service.ts`                                              |

### 10.2 Add machine flow

```text
Add machine → SSH details → [x] Install Seal server on this machine (recommended)
                                 Keeps agents running when this computer disconnects, and
                                 enables chat, sessions and file features on the machine.
connect over SSH
  ├─ probe: platform and architecture, service managers, free space, existing server
  ├─ install: upload runtime and bundle (existing deploy)
  ├─ service: install and start with the first manager that works (10.3)
  ├─ tunnel and pair (existing)
  └─ done: the machine connects through the server
any step fails → plain SSH connection, the reason recorded on the machine, "Retry install" offered
```

The checkbox is on by default. The choice is stored on the machine record:

```ts
// src/shared/machines/machine-record.ts (Seal-owned)
serverInstall?: {
  policy: 'auto' | 'never' // 'auto' unless the user unticks the box
  state: 'installed' | 'failed' | 'declined' | 'pending'
  manager?: 'systemd-user' | 'launchd' | 'pm2' | 'detached' // how it is kept running
  linger?: boolean // systemd only: survives logout and reboot
  reason?: string // why the last attempt failed, shown on the Machines page
  version?: string
  attemptedAt?: number
}
```

`policy: 'auto'` stops the registry from registering the direct-SSH policy for that machine, so the existing connect decision runs. `policy: 'never'` keeps today's direct behaviour.

### 10.3 Persistent service

A launch strategy is added beside `nohup` and `setsid`. The unit never names a versioned directory: it runs a small stable launcher, `~/.orca-remote/bin/seal-server`, that reads the active version from the activation record and starts that version's runtime with the same arguments and environment the `nohup` command uses today. An update installs the new version directory, flips the activation record (existing), and restarts the service.

| Manager        | Used when                                                                                                                                 | Install                                                                                                                                                               | Notes                                                                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `systemd-user` | Linux with a working user manager (`systemctl --user show-environment` succeeds)                                                          | Write `~/.config/systemd/user/seal-server.service` (`Restart=on-failure`, `WantedBy=default.target`), `daemon-reload`, `enable --now`. Then `loginctl enable-linger`. | If enabling linger is refused (needs privileges on some systems), record `linger: false` and tell the user the one command to run; the server still starts on connect. |
| `launchd`      | macOS                                                                                                                                     | Write `~/Library/LaunchAgents/com.brokespace.seal.server.plist` (`RunAtLoad`, `KeepAlive` on failure), `launchctl bootstrap` into the user domain.                    | Over SSH there may be no GUI session; bootstrap into `user/<uid>` and fall back to `detached` if refused.                                                              |
| `pm2`          | `pm2` is on the PATH and no native manager works (containers, hosts without a user systemd), or the user picks it in the advanced options | `pm2 start ~/.orca-remote/bin/seal-server --name seal-server`, `pm2 save`.                                                                                            | Boot persistence depends on the user's own `pm2 startup`; Seal reports whether it is configured and does not run it with elevated rights.                              |
| `detached`     | Nothing above works                                                                                                                       | Today's `nohup` or `setsid` launch.                                                                                                                                   | Today's behaviour: started on connect, stops when idle.                                                                                                                |

The renderers for the systemd unit and the launchd plist are the existing ones in `serve-service-unit.ts`, parameterised for the managed launcher (command, working directory, environment, unit name) rather than copied. They run on the remote host through the SSH connection's exec channel.

A server run as a service does not idle-exit: the idle monitor is for the detached mode and is switched off by the launcher's environment in service mode. The crash-loop brake stays; `Restart=on-failure` with the unit's start limit covers crashes.

Two desktops connecting to one machine are already handled by the activation fence; installing or restarting the service takes the same fence.

### 10.4 Upgrade, pairing, uninstall

- Upgrade: the existing connect-time check upgrades the server when the app is newer. Added: after an app update, the first launch reconnects known machines with `policy: 'auto'` in the background so the upgrade does not wait for the user to open them. With a service, activation ends in a service restart; sessions hosted by the old process are handed over the way upstream's update already does it (terminal daemon sessions survive; structured chats restart-resume).
- Pairing: unchanged, through the tunnel. Pairing repair unchanged.
- Uninstall: "Remove Seal server" on the machine stops and disables the service, removes the unit and runs the existing decommission. The machine returns to plain SSH.

### 10.5 Fallback

The connect flow for machines added through Machines never ends in the "unserved host" error. On any failure of probe, upload, start, service install or pairing: record `state: 'failed'` with the reason, clean up a half-installed version directory through the existing abandon path, and call `connectDirect`. The Machines page shows the machine connected over SSH with a notice ("Seal server is not installed: no space left on device. Retry") and chat falls back to the bridge (section 9.2). Hosts that upstream's flow reaches outside Machines keep upstream's behaviour.

### 10.6 Migration of existing machines

| Machine                                         | Today                                             | After                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| kessel-ml                                       | `connection: 'server'`, a server Brian started    | Nothing changes automatically. The machine page shows whether that server runs as a service and offers "Keep it running as a service", which runs the same service install over SSH if the machine also has an SSH target, or shows the `seal serve service install` command if it does not. Its sessions gain chats and all agents through federation.           |
| 2299 on super9                                  | `connection: 'ssh'`, direct                       | The record has no `serverInstall`, which reads as `policy: 'never'` until the user decides: nothing is installed silently on an existing machine. A one-time notice on the machine and in the sidebar offers "Install Seal server". Accepting runs the flow in 10.2 through the existing conversion.                                                              |
| Any SSH-only machine with projects              | Projects registered on `ssh:<targetId>`           | Conversion moves them to the server (`runtime:<environmentId>`): fence, deploy, pair, commit the catalogue, keep the SSH rows for rollback. The machine record keeps its id and `sshTargetId`, gains `environmentId`, and `connection` becomes `'server'` (`reconcileMachines` already merges this way). Workspace ids are kept, so tabs, pins and order survive. |
| A machine with live terminals during conversion | Conversion defers while relay terminals are alive | Unchanged: the machine stays on SSH, the notice says "will finish when these terminals are closed" with the existing "Move anyway" choice.                                                                                                                                                                                                                        |

Sessions on a converted machine keep their record ids: the registry's `hostId` is the machine record id whichever transport the machine uses (`machineLiveSessionHost` in `src/main/live-sessions/hosts/live-session-hosts.ts`), so pins, custom titles, marks and summaries stay attached. The one exception is a server paired without a machine record, whose `hostId` is `runtime:<environmentId>`; W7 checks that reconciliation gives every server a machine record before federation relies on it.

## 11. Other surfaces

Every surface below already reads the registry. They change only in grouping and in what a click opens. None keeps a second model.

| Surface                                                                                                           | Today                                                                                               | After                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phone: session list and overview                                                                                  | `mobile/src/seal/live-sessions`: machine, then project. "Needs you" strip.                          | Project, then workspace, machine as a badge. "Needs you" stays. Chats and all agents are listed.                                                                                                                                                                                                                                            |
| Phone: opening a session                                                                                          | Two chat screens: `LiveSessionDetailScreen` (text-only composer) and `MobileNativeChatView` (full). | One: `MobileNativeChatView`. Chats open as they do now. CLI and external sessions open the same view with the external source over the `liveSessions.*` RPCs. Recap, take over and the account sheet move into its header menu. `LiveSessionDetailScreen`, `LiveSessionComposer`, `LiveTranscriptRow` and `LivePermissionCard` are deleted. |
| Phone push                                                                                                        | Hook agents and chats push. External sessions notify on the desktop only.                           | External sessions push too, from the registry notifier on the machine that owns them, under the same two settings.                                                                                                                                                                                                                          |
| Home                                                                                                              | `HomeSessionsPanel` groups by machine. Counts line.                                                 | Same rows grouped by project and workspace, a "Needs you" strip on top, machine badge. Counts line unchanged.                                                                                                                                                                                                                               |
| Machines                                                                                                          | Per-machine session list, process titles by pid.                                                    | Unchanged list (a filter of the same records, now including chats and all agents). A row opens the session's tab.                                                                                                                                                                                                                           |
| Project overview                                                                                                  | Agents card grouped by machine, "Show in Active agents".                                            | Agents card grouped by workspace. The link reveals the project in the sidebar.                                                                                                                                                                                                                                                              |
| Command palette                                                                                                   | "Go to agent session" opens the sessions view. Chat tabs are also listed as workspace tabs.         | Opens the session's tab. A session that has a tab is listed once.                                                                                                                                                                                                                                                                           |
| Desktop notification click                                                                                        | `liveSessions:open` opens the sessions view.                                                        | Opens the session's tab (`openAgentSession`).                                                                                                                                                                                                                                                                                               |
| `seal sessions list`                                                                                              | Groups by machine, Claude and Codex.                                                                | Adds project and workspace columns and `--machine`, `--project` filters. Lists chats and all agents. Ids unchanged.                                                                                                                                                                                                                         |
| MCP and Home chat tools (`list_sessions`, `read_session`, `message_session`, `take_over_session`, `stop_session`) | One set of handlers over the registry.                                                              | Same handlers. Chats and all agents appear. `message_session` to a chat goes through the `structured` route. `open_in_seal` for sessions reveals the sidebar instead of Active agents.                                                                                                                                                      |
| Tray, dock badge                                                                                                  | Notification flag, unread workspaces.                                                               | Unchanged.                                                                                                                                                                                                                                                                                                                                  |
| Home chat assistant                                                                                               | Own threads, own composer, own token bar; reuses the message row.                                   | Unchanged product. Its token bar becomes the shared context indicator.                                                                                                                                                                                                                                                                      |

## 12. Merge and delete

### 12.1 Every duplicated path

"Kept" is the implementation that survives. Nothing in the "Deleted" column is the only implementation of a feature; section 13 lists where each feature lives afterwards.

| Path                         | Implementations today                                                                                                                                      | Kept                                                                                              | Merged into it                                                                      | Deleted                                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Session record               | Structured record and status summary; hook status row; `LiveSession`                                                                                       | `LiveSession` as the one record every surface reads                                               | Structured and hook rows become sources                                             | The accidental admission of structured rows as panes; `LIVE_SESSION_PROVIDERS`                                                                                                                                           |
| Status                       | Three vocabularies with their own derivation; presentation in `StatusIndicator` (upstream) and `LiveSessionStatusDot`                                      | The ten codes, the status-sweep module, `LiveSessionStatusDot` and its labels                     | Structured and hook evidence                                                        | Seal's `hookStatus` and `waitingStatus` special cases in `seal-pane-sessions.ts` (moved into the status module); the duplicated label table on the phone                                                                 |
| Asking a question            | Hook prompt detection; structured `awaitingUser`; `replyAskOf` plus classifier                                                                             | All three as evidence for one decision                                                            | Classifier runs for chats too                                                       | Nothing                                                                                                                                                                                                                  |
| One-line summaries           | `pane-session-summaries.ts` (`pane:` keys) and `live-session-summaries.ts` (`live:` keys)                                                                  | `live-session-summaries.ts`, keyed by record id                                                   | The pane path's fast input                                                          | `pane-session-summaries.ts`, the `pane:` key space, the `structuredHost` skip                                                                                                                                            |
| Recaps                       | Registry only                                                                                                                                              | `src/main/session-recap`, `components/session-recap`                                              | Journal as a transcript source                                                      | Nothing                                                                                                                                                                                                                  |
| Titles                       | Structured auto-name; terminal title stack; `liveSessionLabel`; tab names                                                                                  | `liveSessionLabel` precedence for every list and tab label; the structured auto-namer as a source | Rename writes through to the owner                                                  | Nothing in upstream stacks; Seal's separate title lookups in rows and tabs                                                                                                                                               |
| Unread                       | `seenAt` marks; tab attention; pane completion markers                                                                                                     | `seenAt` for session rows; tab attention for the strip and dock                                   | Acknowledged together through the `surface` alias                                   | Nothing                                                                                                                                                                                                                  |
| Notifications                | Hook and structured paths with two settings; `LiveSessionNotifier` with `liveSessionsNotify`                                                               | Both producers, one rule for who notifies                                                         | One settings group                                                                  | The `liveSessionsNotify` setting and `LiveSessionsNotifySetting.tsx` (migrated)                                                                                                                                          |
| Tab strip                    | `TabBar` with `SortableTab`; `SessionTab` in `LiveSessionWorkspace.tsx`                                                                                    | `TabBar`                                                                                          | Session tabs become workspace tabs                                                  | `LiveSessionWorkspace.tsx`, `live-session-tabs-store.ts`, the `sessions` top-level view, `openAgentSessionTabs`, `closeAgentSessionTabs`, `previousViewBeforeSessions`                                                   |
| Chat view                    | `NativeChatView` (structured, bridge); `LiveSessionPane` with `LiveSessionChat`                                                                            | `NativeChatView`                                                                                  | External source; the session header (status, recap, subagents, tasks) as its header | `LiveSessionPane.tsx`, `LiveSessionChat.tsx`, `LiveSessionAppSurface.tsx`                                                                                                                                                |
| Composer                     | `NativeChatComposer`; `LiveSessionComposer`; the phone's two composers                                                                                     | `NativeChatComposer`, `MobileNativeChatComposer`                                                  | External transport                                                                  | `LiveSessionComposer.tsx` on desktop and phone, `live-session-send.ts`                                                                                                                                                   |
| Transcript rendering         | `NativeChatMessageList` with providers; the same list without providers; the phone's `LiveTranscriptRow`                                                   | `NativeChatMessageList` with providers; the phone's native chat rows                              | Nothing                                                                             | The provider-less mount; `LiveTranscriptRow.tsx`                                                                                                                                                                         |
| Prompts                      | Structured cards; bridge interactive card; `NativeChatApprovalCard` by option id; the phone's `LivePermissionCard`                                         | The structured and bridge cards                                                                   | External prompts rendered by the same card                                          | `LivePermissionCard.tsx`; the option-only mount                                                                                                                                                                          |
| Session rows                 | `LiveSessionRow`; upstream `CompactAgentRow` on cards                                                                                                      | `LiveSessionRow`                                                                                  | Rows under workspaces                                                               | `agent-rows-without-session-panes.ts`. `CompactAgentRow` is no longer mounted (upstream-owned, see 12.3)                                                                                                                 |
| Session lists                | Active agents section; Home panel; Machines list; project card; phone list                                                                                 | One row list component, grouped by workspace                                                      | All lists                                                                           | `ActiveAgentsSection.tsx`, `ActiveAgentsGroups.tsx`, `active-agents-model.ts`. Deleted by W4 (plan change, section 14.2). A machine filter and a status filter in the sidebar toolbar take over from the machine groups. |
| Context indicator            | Desktop ring; phone ring; Home chat token bar                                                                                                              | The ring                                                                                          | One usage type and one threshold table                                              | Home chat's own bar and 80% rule; the phone's private thresholds                                                                                                                                                         |
| IPC                          | `agentSession.*` (chat host), `agentStatus:*` (hook feed), `liveSessions:*` (registry)                                                                     | All three, with one job each: host a chat, feed hooks in, list and address sessions               | Lists stop reading `agentStatus` and `agentSession` status directly                 | `liveSessions:open` handling in the sessions view (re-pointed)                                                                                                                                                           |
| Stores                       | `liveSessionRegistryStore`, `liveSessionTabsStore`, `liveSessionMarksStore`, `active-agents-scope-store`, `agentStatusByPaneKey`, structured session state | Registry store for lists; marks; upstream stores for their own views                              | Scope store becomes the sidebar's machine filter                                    | `liveSessionTabsStore`                                                                                                                                                                                                   |
| Agent catalogue for sessions | `LIVE_SESSION_PROVIDERS`, `ConnectorAgent` tests in delivery, names in the notifier, the phone's schema enum                                               | The adapter table                                                                                 | All of them                                                                         | Those hard-coded lists                                                                                                                                                                                                   |
| Workspace link               | `linkLiveSessions` in the renderer                                                                                                                         | The registry's link step                                                                          | Renderer hook reads `session.workspace`                                             | The renderer-side matching                                                                                                                                                                                               |

### 12.2 Line estimate

Measured with `wc -l` on non-test sources at `51496ea453d`. Additions are estimates from the size of the comparable existing code.

Deleted outright (Seal-owned, true duplicates):

| What                                                                                                                                                                                                   | Non-test lines |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------: |
| Sessions view and strip: `LiveSessionWorkspace.tsx` 223, `live-session-tabs-store.ts` 224, `LiveSessionAppSurface.tsx` 53                                                                              |            500 |
| Session pane, chat, composer: `LiveSessionPane.tsx` 383, `LiveSessionChat.tsx` 137, `LiveSessionComposer.tsx` 66, `live-session-send.ts` 50                                                            |            636 |
| Active agents: `ActiveAgentsSection.tsx` 337, `ActiveAgentsGroups.tsx` 145, `active-agents-model.ts` 80                                                                                                |            562 |
| Stop-gaps and double keys: `agent-rows-without-session-panes.ts` 22, `pane-session-summaries.ts` 95, `LiveSessionsNotifySetting.tsx` 12, provider tests                                                |            150 |
| Phone: `LiveSessionDetailScreen.tsx` 368, `LiveSessionComposer.tsx` 104, `LiveTranscriptRow.tsx` 153, `LivePermissionCard.tsx` 88, `live-session-pending-rows.ts` 39, duplicated label table about 100 |            852 |
| Context: Home chat's bar logic and the phone's private thresholds                                                                                                                                      |            100 |
| Total                                                                                                                                                                                                  |    about 2,800 |

Their tests and fixtures go with them: about 550 lines (`live-session-surfaces.test.tsx`, `live-session-tabs-store.test.ts`, `LiveSessionTranscript.fixture.tsx`, `ActiveAgentsSummaries.fixture.tsx`, `pane-session-summaries.test.ts`).

Added:

| What                                                                                                                                                                                                                                                             | Estimated non-test lines |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------: |
| The merge itself: types and adapter table 350, structured source and generalised pane source 450, services through the adapter 250, sidebar rows 350, external chat source, shared header and `openAgentSession` 570, launcher 120, phone on the shared view 250 |                    2,340 |
| New capability: external tab type 400, federation 300, context usage for CLI and external sessions and the compaction states 300, server as a service with fallback and migration 900, workspace attachment, auto-create and file tree 800, other consumers 100  |                    2,800 |
| Total                                                                                                                                                                                                                                                            |              about 5,100 |

Net, stated plainly:

| Scope                                                                                                  |                    Net non-test lines |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------: |
| Merging sessions and chats (delete 2,800, add 2,340)                                                   |                            about −450 |
| The capabilities added on top (chat on every machine, server service, auto-attach, context everywhere) |                          about +2,800 |
| Whole plan                                                                                             | about +2,300 (range +1,300 to +3,300) |

The plan does not reduce the total line count on its own, and it would be misleading to claim it does. What it removes is every second implementation: after it there is one record, one status, one row, one strip, one chat view, one composer and one indicator, and each later feature is written once. The earlier estimate of 4,000 to 12,000 deletable lines counted overlapping code inside upstream's stacks (title handling, child-work presentation, inline agent rows); deleting those is possible but is a different decision, below.

### 12.3 Upstream-owned code Seal stops using

| Code                                                                                   | Non-test lines | State after the plan                                                                                                   |
| -------------------------------------------------------------------------------------- | -------------: | ---------------------------------------------------------------------------------------------------------------------- |
| Inline agent rows on workspace cards (`components/sidebar/workspace-card/activity/**`) |          5,032 | Not mounted in Seal's card template. Parts of it are still imported elsewhere (row types, lineage).                    |
| Agent dashboard (`components/dashboard/**`)                                            |          7,271 | Already unmounted per `docs/information-architecture.md`; 29 files outside it still import from it (mostly row types). |

Deleting the unreachable parts could remove an estimated 5,000 to 8,000 lines and would make the whole plan net negative. The cost is that upstream keeps editing these files, so every weekly merge would hit modify-delete conflicts in them. Recommendation: leave them, and revisit once upstream's direction for those views is clear. Brian took this default (question 1 in section 16).

## 13. Feature-preservation checklist

Every row is a feature that exists today. "After" says where it lives once the merge is done. The workstream named in the last column verifies it in the real app before its pull request is ready. There is no re-verification of the whole table at the end (section 14.1, rules 4 and 9).

### 13.1 From the registry (Active agents, session view)

| #   | Feature                                                                                                                                                                                                                                                                                                                                                                 | After                                                                                                                  | Verified by |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| R1  | Ten status codes with dot, label and tone, same on every surface                                                                                                                                                                                                                                                                                                        | Unchanged, now for chats and every agent                                                                               | W1          |
| R2  | Status hold (no flicker between scans), `errored` outliving the process, question held open by transcript                                                                                                                                                                                                                                                               | Unchanged                                                                                                              | W1          |
| R3  | "Asking you a question" from the reply-ask classifier                                                                                                                                                                                                                                                                                                                   | Unchanged, also for chats                                                                                              | W2          |
| R4  | One-line live summary under the title, pending state                                                                                                                                                                                                                                                                                                                    | Unchanged, also for chats                                                                                              | W2          |
| R5  | Recap: asked, did, decisions, references; recap badge; overview; jump to message                                                                                                                                                                                                                                                                                        | Unchanged; opened from the chat view header and the row                                                                | W2, W4      |
| R6  | Title precedence, Claude `/rename` detection, custom title (rename)                                                                                                                                                                                                                                                                                                     | Unchanged; rename also renames the tab                                                                                 | W2          |
| R7  | Pin a session                                                                                                                                                                                                                                                                                                                                                           | Unchanged; pinned first within the workspace                                                                           | W3          |
| R8  | Unread dot and seen marks                                                                                                                                                                                                                                                                                                                                               | Unchanged; viewing the tab marks seen                                                                                  | W2          |
| R9  | Desktop notification when an external session needs you, fails or finishes; click opens it                                                                                                                                                                                                                                                                              | Unchanged; opens the tab; setting merged into the agent notification group                                             | W2          |
| R10 | Row: agent icon, title, time, status pill, detail and place, recap badge, subagent count, account badge                                                                                                                                                                                                                                                                 | Unchanged (`LiveSessionRow`)                                                                                           | W3          |
| R11 | Row hover preview (`LiveSessionPreview`)                                                                                                                                                                                                                                                                                                                                | Unchanged                                                                                                              | W3          |
| R12 | Row menu (`LiveSessionMenuItems`): Open, Open in new tab, Open in split, Send message, Answer pending permission, View subagents, View tasks, Rename, Pin, Copy session id, Copy resume command, Swap account, Take over in a Seal pane, Open project workspace, Open machine, Reveal transcript file, Stop, Stop and remove, Remove from Seal, Delete with transcripts | Unchanged. Open targets the workspace tab; Open in split uses the workspace's split                                    | W3          |
| R13 | Single click previews, double click keeps the tab                                                                                                                                                                                                                                                                                                                       | Workspace preview tab semantics                                                                                        | W4          |
| R14 | Keyboard navigation through session rows, current row highlight                                                                                                                                                                                                                                                                                                         | Unchanged within the sidebar list                                                                                      | W3          |
| R15 | Sessions grouped by machine with a fold per machine, the project or workspace scope chip, "Recently finished" (Active agents; it has no machine or status filter control today)                                                                                                                                                                                         | Machine filter and status filter in the sidebar toolbar; "Recently finished" per workspace; row by row in section 13.5 | W3          |
| R16 | Send a message to an external session: outbox, pending rows, retry, delivery routes (pane, Codex queue, tmux, resume)                                                                                                                                                                                                                                                   | Unchanged, behind the external source                                                                                  | W4          |
| R17 | Answer a permission prompt or question of an external or pane session                                                                                                                                                                                                                                                                                                   | Unchanged, in the shared prompt card                                                                                   | W4          |
| R18 | Transcript paging and live updates, on SSH machines and servers                                                                                                                                                                                                                                                                                                         | Unchanged (`use-live-transcript.ts` behind the source)                                                                 | W4          |
| R19 | Activity panel: subagents, background tasks, todos                                                                                                                                                                                                                                                                                                                      | Chat view header, every session                                                                                        | W4          |
| R20 | Take over an external session into Seal                                                                                                                                                                                                                                                                                                                                 | Unchanged; always finds a workspace                                                                                    | W8          |
| R21 | Stop and remove a session, with one confirmation                                                                                                                                                                                                                                                                                                                        | Unchanged                                                                                                              | W3          |
| R22 | Copy resume command for the session's machine                                                                                                                                                                                                                                                                                                                           | Unchanged                                                                                                              | W3          |
| R23 | Account badge, account sheet, switch account (multi-account)                                                                                                                                                                                                                                                                                                            | Unchanged                                                                                                              | W3          |
| R24 | Shell integration that wraps agents started outside Seal (`liveSessionsWrapAgents`)                                                                                                                                                                                                                                                                                     | Unchanged                                                                                                              | W1          |
| R25 | Home: sessions panel and counts line                                                                                                                                                                                                                                                                                                                                    | Regrouped by workspace                                                                                                 | W9          |
| R26 | Machines: sessions per machine, process titles by pid                                                                                                                                                                                                                                                                                                                   | Unchanged                                                                                                              | W9          |
| R27 | Project overview: agents card with finished sessions                                                                                                                                                                                                                                                                                                                    | Regrouped by workspace                                                                                                 | W9          |
| R28 | Workspace and project session badges                                                                                                                                                                                                                                                                                                                                    | Rows replace the workspace badge; project badge stays                                                                  | W3          |
| R29 | Palette: go to agent session                                                                                                                                                                                                                                                                                                                                            | Opens the tab                                                                                                          | W9          |
| R30 | Phone: list, "Needs you", detail with transcript, send, answer, take over, recap, account sheet                                                                                                                                                                                                                                                                         | List regrouped; detail is the native chat view with the same actions                                                   | W9          |
| R31 | `seal sessions list` and `--all`                                                                                                                                                                                                                                                                                                                                        | Unchanged output plus new columns                                                                                      | W9          |
| R32 | MCP and Home chat session tools                                                                                                                                                                                                                                                                                                                                         | Unchanged                                                                                                              | W9          |
| R33 | Sessions on SSH-only machines and on servers, including old servers                                                                                                                                                                                                                                                                                                     | Unchanged; federation with the scan as fallback                                                                        | W1          |

### 13.2 From the project chat (structured)

| #   | Feature                                                                                             | After                                         | Verified by |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------- |
| C1  | Composer: multi-line, history, `@` mentions, `/` commands, skills                                   | Unchanged; also for external sessions         | W4          |
| C2  | Model, effort and permission-mode pickers                                                           | Unchanged; hidden where the session cannot    | W4          |
| C3  | Attachments: drag and drop, paste images, file picker; chunked upload to servers                    | Unchanged                                     | W4          |
| C4  | Voice input                                                                                         | Unchanged; also for external sessions         | W4          |
| C5  | Message queue (edit, move, send, hold), steering, stop                                              | Unchanged                                     | W4          |
| C6  | Approvals and questions: options, free text, multi-select, plan review, async questions             | Unchanged                                     | W4          |
| C7  | Rewind, fork from a message, compact, thread goal                                                   | Unchanged                                     | W4          |
| C8  | Context usage ring and its popover                                                                  | Extended (section 7)                          | W5          |
| C9  | Footer: machine, folder, branch                                                                     | Unchanged; shown for every session            | W4          |
| C10 | Transcript: markdown, code, tool calls, changed-files cards, subagent transcripts, turn timing      | Unchanged                                     | W4          |
| C11 | Find in transcript, row actions, context menu, link and file-link handling, image viewer, font zoom | Unchanged; also for external sessions         | W4          |
| C12 | Auto-naming, regenerate name, rename                                                                | Unchanged; feeds the record title             | W2          |
| C13 | Session history switcher, restart-resume, usage-limit continue, sleep workspace                     | Unchanged                                     | W4          |
| C14 | Chat tab in the workspace strip: reorder, split, close, restore after relaunch                      | Unchanged                                     | W4          |
| C15 | Chat on a paired server, attachments over the wire                                                  | Unchanged; the default for SSH machines       | W7          |
| C16 | Phone: full native chat                                                                             | Unchanged; also for CLI and external sessions | W9          |
| C17 | Tab attention, acknowledge, "agent needs input" and "agent finished" notifications, phone push      | Unchanged                                     | W2          |
| C18 | Switch surface: continue a CLI session in Chat (adopt), fork a chat into the CLI                    | Unchanged; one row follows an adopt           | W1          |

### 13.3 From CLI agents in panes (hooks)

| #   | Feature                                                                                          | After                                                     | Verified by |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------- |
| P1  | Hook status for every hook agent (23 targets and plugin agents), local, WSL and on servers       | Unchanged; becomes a registry source                      | W1          |
| P2  | An agent row on the workspace card for every agent, including non-Claude, non-Codex agents       | The shared session row                                    | W3          |
| P3  | Subagent children under their agent                                                              | Subagent count on the row; children in the activity panel | W3, W4      |
| P4  | Chat view toggle on a terminal tab (bridge), with composer, interactive card, stop, model switch | Unchanged                                                 | W4          |
| P5  | Tab and pane unread, auto-acknowledge when on screen, dock badge                                 | Unchanged                                                 | W2          |
| P6  | Terminal resume after restart (sleeping sessions), saved resume                                  | Unchanged                                                 | W1          |
| P7  | Workspace status rollup (`WorktreeStatus`) on the card                                           | Unchanged                                                 | W3          |
| P8  | Orchestration (worker and task messaging)                                                        | Unchanged                                                 | W1          |
| P9  | New-tab menu: default agent, shortcuts, search, model and setup choices, set default             | Unchanged, with both surfaces visible                     | W6          |

### 13.4 Machines and remote

| #   | Feature                                                                                   | After                                                   | Verified by |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------- |
| M1  | Connect a machine over plain SSH with nothing installed                                   | Still possible: untick the box, or automatic on failure | W7          |
| M2  | Connect a machine through a Seal server the user runs                                     | Unchanged                                               | W7          |
| M3  | Switch a machine between SSH and server ("Connect over SSH instead")                      | Unchanged                                               | W7          |
| M4  | Managed server: tunnel resume, pairing repair, auto-update, never downgrade, decommission | Unchanged                                               | W7          |
| M5  | `seal serve service install` for a local server                                           | Unchanged; its unit renderers are shared                | W7          |
| M6  | Machines page: files, disk, vitals, GPU, clean-up                                         | Unchanged                                               | W7          |
| M7  | CLI agent tabs on SSH machines                                                            | Unchanged                                               | W6          |

### 13.5 Active agents, feature by feature

Brian's instruction: "remember we still want the functionality we built, just merged in." The Active agents section is therefore removed only after every feature below lives in the merged sidebar and the session rows. The list was taken from the section's code at `51496ea453d` (`components/live-sessions/active-agents/**`, `row/**`, `menu/**`, `links/**`, `live-session-marks-store.ts`), not from memory of the product.

How it is used:

- W3 (or the workstream named) builds each row's "After" while the Active agents section still exists.
- W4 deletes the section in its own pull request (plan change, section 14.2): W3's rows already carry these features, so the rows are not verified one at a time.
- A feature found in the code that is missing from this list is added to it, not skipped.

| #   | Feature today                                                                                                                                                                                                                                                                                          | In the code                                                                                                          | After                                                                                                                                                                                                                                         | Built by |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1  | Header: the title, the number of active sessions on every machine, a spinner until the first scan has loaded                                                                                                                                                                                           | `ActiveAgentsSection.tsx`                                                                                            | The count and the spinner sit in the sidebar toolbar, beside the filters                                                                                                                                                                      | W3       |
| A2  | Fold the whole section; the fold survives a change of the Projects grouping                                                                                                                                                                                                                            | `ACTIVE_AGENTS_COLLAPSE_KEY`, `isActiveAgentsCollapseKey`                                                            | A project folds with its session rows, and "Unassigned" folds with the same remembered state. Rows under an open workspace stay visible (rule 1 of section 5.2)                                                                               | W3       |
| A3  | Sessions grouped by machine, this machine first. Each group shows the machine's name and its session count, has a fold that is remembered, and when folded shows the status dot of its most urgent session                                                                                             | `ActiveAgentsGroups.tsx`, `groupLiveSessionsByMachine`                                                               | Machine filter in the sidebar toolbar: all machines or one, and its list shows each machine's session count and most urgent status. The machine is also a badge on the row and on the workspace; the Machines page keeps the per-machine list | W3       |
| A4  | Status filter. Not a control today: the nearest thing is the order by status (A6)                                                                                                                                                                                                                      | None                                                                                                                 | Status filter in the sidebar toolbar by status group (needs you, working, idle; `liveSessionStatusGroup`), as this plan and Brian name it                                                                                                     | W3       |
| A5  | Scan errors: a warning with the error text on the machine's header, and the line "Could not scan (machine): (error)" for a machine that lists no sessions                                                                                                                                              | `ActiveAgentsGroups.tsx` (`hostErrors`)                                                                              | The warning on that machine's entry in the machine filter, and on the filter button while any machine fails, with the same error text                                                                                                         | W3       |
| A6  | Order: pinned first, then what needs you, then working, then idle                                                                                                                                                                                                                                      | `compareLiveSessions`                                                                                                | The same order within a workspace (rule 4 of section 5.2)                                                                                                                                                                                     | W3       |
| A7  | "Recently finished": one group with a count, folded until opened, the fold remembered. It holds sessions that ended in the last 24 hours, and pinned ones whatever their age, newest first                                                                                                             | `buildActiveAgents`, `RECENTLY_FINISHED_MS`                                                                          | One "Recently finished · N" line per workspace and in "Unassigned", with the same 24-hour and pin rule, the same order and a remembered fold                                                                                                  | W3       |
| A8  | Scope: clicking the sessions badge of a project or workspace narrows the list to it and shows a chip with its name; clicking the chip shows all sessions again; "No sessions match." when nothing is left                                                                                              | `ActiveAgentsToolbar.tsx`, `active-agents-scope-store.ts`, `show-scope-in-active-agents.ts`, `LiveSessionsBadge.tsx` | The project badge unfolds the project and reveals its session rows (A10). An active machine or status filter shows as a chip that clears it; "No sessions match." when the filters hide every row                                             | W3       |
| A9  | Pointing at a badge rings the rows it counts; the rows of the workspace on screen are ringed                                                                                                                                                                                                           | `liveSessionMarksStore.highlight`, `use-live-session-row-state.ts`                                                   | Unchanged for the project badge and for the workspace on screen                                                                                                                                                                               | W3       |
| A10 | Reveal: a session asked for from a badge, a fresh launch, the palette or the project overview is unfolded, scrolled into view below the pinned header and ringed for four seconds                                                                                                                      | `ActiveAgentsSection.tsx` (`marks.reveal`), `liveSessionMarksStore.reveal`                                           | The same, with the project and workspace unfolded instead of the machine group                                                                                                                                                                | W3       |
| A11 | Row content: agent icon; unread dot and bold title; title; pin mark; time (how long it has run while working, otherwise since its last activity); status dot and label; detail and place; recap badge; subagent count (running of total, coloured while any runs); account badge; the one-line summary | `LiveSessionRow.tsx`                                                                                                 | Unchanged, the same component (R10)                                                                                                                                                                                                           | W3       |
| A12 | Hover preview after half a second: title; agent, machine and workspace; status; the pending question or status detail; up to three running subagents with what each is doing; the AI summary; the last message; the folder. It does not open over an open menu                                         | `LiveSessionPreview.tsx`                                                                                             | Unchanged (R11)                                                                                                                                                                                                                               | W3       |
| A13 | Row menu, on right-click and on the "…" button that appears on hover: the items of R12, among them "Rename…", "Pin to top" and "Unpin"                                                                                                                                                                 | `LiveSessionMenuItems.tsx`, `LiveSessionDialogs.tsx`                                                                 | Unchanged (R12)                                                                                                                                                                                                                               | W3       |
| A14 | Opening: a click previews, a double click or Enter keeps the tab; the row of the session on screen is highlighted, in a split both                                                                                                                                                                     | `openLiveSessionFromRow`, `use-live-session-row-state.ts` (`current`)                                                | Unchanged on session rows (R13, R14)                                                                                                                                                                                                          | W3, W4   |
| A15 | Selecting several: "Select sessions" in the options menu; Ctrl or Cmd click toggles a row, Shift click a range, Space the focused row; checkboxes on the rows; a bar with "N selected", Stop, Remove, Delete (each confirmed once) and Cancel; Escape ends it                                          | `ActiveAgentsSection.tsx` (`onPick`), `ActiveAgentsToolbar.tsx`, `liveSessionMarksStore` (`picked`)                  | The same on session rows across workspaces; the bar is pinned under the sidebar toolbar                                                                                                                                                       | W3       |
| A16 | Keyboard: one Tab stop (the row of the session on screen, else the first row); Up and Down through the rows; Home and End; the cursor passes between session rows and Projects rows as one list; focus scrolling that allows for the pinned header                                                     | `ActiveAgentsSection.tsx`, `sidebar-section-keyboard-handoff.ts`                                                     | The same; session rows and workspace rows are one list                                                                                                                                                                                        | W3       |
| A17 | Options menu: "Scan again", "Select sessions" or "Done selecting", "Idle sessions and notifications…" (opens Settings, Agents)                                                                                                                                                                         | `ActiveAgentsSection.tsx`                                                                                            | The same three items in the sidebar toolbar's menu                                                                                                                                                                                            | W3       |
| A18 | Loading and empty text: "Looking for sessions", "No Claude Code or Codex sessions are running…", "No sessions match."                                                                                                                                                                                  | `ActiveAgentsSection.tsx`                                                                                            | "Looking for sessions" with the spinner of A1; "No sessions match." under active filters (A8). A workspace without sessions shows no rows (rule 8 of section 5.2), so the none-running sentence has no place of its own                       | W3       |
| A19 | The header, the scope chip and the selection bar stay in view while the rows scroll; Active agents and Projects scroll as one list                                                                                                                                                                     | `SIDEBAR_STICKY_SECTION_HEADER_CLASS`, `sidebar-scroll-sections.tsx`                                                 | The sidebar toolbar with the filters, their chips and the selection bar stays pinned; one scrolling list                                                                                                                                      | W3       |
| A20 | Absent in a window that has no registry (a paired web client)                                                                                                                                                                                                                                          | `ActiveAgentsSection.tsx` (`window.api.liveSessions.onEvent`)                                                        | Session rows, the filters and the count are absent there and nothing else changes                                                                                                                                                             | W3       |
| A21 | Ways in from other pages: the button on the project overview's agents card, Home chat's `open_in_seal`, the reveal after a launch                                                                                                                                                                      | `ProjectAgentsCard.tsx`, `home-chat-open-target.ts`, `LiveSessionAppSurface.tsx`                                     | Each reveals the project's or the session's rows in the sidebar (A10; section 5.5)                                                                                                                                                            | W3, W9   |
| A22 | Pin, rename, recap badge and recap, unread and seen marks, account badge with the account sheet and "Swap account"                                                                                                                                                                                     | `menu/**`, `live-session-marks-store.ts`, `SessionRecapBadge`                                                        | Unchanged (R5 to R8, R23)                                                                                                                                                                                                                     | W2, W3   |

Five rows change form instead of moving as they are: A2 (no fold for running sessions, by rule 1 of section 5.2), A3 (groups become a filter), A5 (the error moves to the filter), A8 (narrowing becomes a reveal plus filter chips) and A18 (one sentence loses its place). W3 shows Brian each of the five in its pull request.

## 14. Build plan

### 14.1 Rules for every builder

1. Branch off `seal/all` as `cursor/<workstream-name>-<suffix>`, open a pull request into `seal/all`, do not merge it yourself. Never push to `main`, never force-push, never skip hooks. Run `pnpm check:changed --base=origin/seal/all` after the last edit and before every push. Without `--base` the check compares against `origin/main` and runs the tests for the whole Seal diff.
2. Edit only the files your workstream owns (14.4). If you need a change in a file another workstream owns, or in a W0 contract, ask for it through a small pull request to that owner instead of editing it.
3. Use your own subagents. Split the implementation by file group and run those in parallel. Do not finish your run while a subagent is still running. Each workstream removes what it replaces in its own pull request, and never builds temporary or bridge UI that a later workstream would remove.
4. Test in the real app only on the final head: targeted unit tests while iterating; then the gates (`pnpm tc`, `pnpm lint`, `pnpm check:changed --base=origin/seal/all`) once; then, not at the same time, at most three tester subagents in parallel, one scenario each (the ones marked "tester" in the test plan), on a build made with `pnpm exec electron-vite build --mode e2e`, launched with `ORCA_BACKGROUND_LAUNCH=1` and driven over CDP in hidden windows. Never show, focus or raise a window. One push at the end. A minor issue goes in the pull request as a known issue, not into another round.
5. Follow the repository's test rule: do not add tests by default. Add a unit test only where the behaviour is owned and a revert would fail it (the tables named in each workstream). Commit at most three Playwright specs, the scenarios marked "spec". The other scenarios in a test plan are not run as a round.
6. Edits to upstream-owned files are few lines, local, and listed in the pull request under "Upstream seams touched". Prefer a registry entry, a prop, a template part or a transport over an inline change.
7. Follow `docs/STYLEGUIDE.md` and the tokens in `src/renderer/src/assets/main.css`. No new colours, sizes or shadows. File size limits apply (300 lines for `.ts`, 400 for `.tsx`); several tab-bar and tab-group files are near the limit, so add modules rather than lines.
8. Every user-facing string goes through the Seal locale overlay (`src/renderer/src/i18n/seal-overrides/en.json`), under a key namespace named after the workstream, and `pnpm sync:localization-catalog` is run. This file is shared; keep each workstream's keys in one block.
9. Every pull request states: non-test lines added and deleted, the result of each spec and tester scenario it ran, and its known issues. No per-row evidence for section 13 and no platform matrix.
10. Consider the first-class areas from `AGENTS.md` in every change: cross-platform, remote hosts, mobile, folder workspaces (not every workspace is a git worktree).

Fixtures that exist and are to be reused: stub agents (`tests/e2e/fixtures/golden-stub-agent/**` for Claude, Codex and Grok CLIs, `tests/e2e/fixtures/structured-claude-stub.cjs` for chats, `tests/e2e/helpers/connector-fake-claude.ts`), a Docker SSH host (`tests/e2e/fixtures/docker-ssh-host`, `tests/e2e/helpers/docker-ssh-host-target.ts`: Debian, sshd, Node, no systemd), a loopback sshd (`tests/e2e/helpers/local-sshd-machines.ts`, needs passwordless sudo), the managed-server helpers (`orcad-managed-workspace.ts`, `orcad-convert-flow.ts`), fake account CLIs, and the Home chat scripted model. The E2E harness being built by another agent (section 15) is the place for shared seeding helpers; check it before writing a new one.

### 14.2 Phases and merge order

```text
Phase 0   W0 Contracts and spikes ───────────────────────────────── merges first
Phase 1   W1 Registry sources      W2 Session services     W3 Sidebar session rows
          W5 Context indicator     W6 Launcher             W7 Seal server on SSH machines
          (six builders in parallel; any merge order, W1 before W3 preferred)
Phase 2   W4 Session tabs and chat view    W8 Workspace attachment and file tree
          W9 Phone and other consumers
          (three builders in parallel; need W1; W4 also needs the multi-pane build merged)
```

`seal/all` stays releasable after every merge. Between phases the app is consistent: after Phase 1 sessions are rows under their workspaces and Active agents shows only sessions that have no workspace yet; after Phase 2 every session opens as a workspace tab and every session has a workspace. There is no clean-up phase: each workstream deletes what it replaces in its own pull request. W4 deletes the Active agents section, the sessions view, its strip and store, the thin chat and composer, `openLiveSessionView` and `liveSessionTabsStore`, and adds the "Unassigned" group; W3's rows already carry the Active agents features, so section 13.5 is not verified row by row.

Dependencies on work outside this plan: W1 starts from the status-sweep branch once it is merged (section 15); W4 starts after the multi-pane build is merged, because both edit the tab strip and tab group.

### 14.3 Interfaces between workstreams

These are created by W0 and then frozen. A change goes through W0's owner.

| Interface                                                                                                   | File                                                                        | Producer                                                                                | Consumers       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| `LiveSession` with `surface`, `capabilities`, `workspace`, `context`, `model`; the `structured` input route | `src/shared/live-sessions/live-session-types.ts`                            | W1 fills                                                                                | Everyone        |
| `AgentSessionAdapter` and the adapter table                                                                 | `src/shared/live-sessions/adapters/**`                                      | W0                                                                                      | W1, W2, W5, W6  |
| `AgentSessionChatSource`                                                                                    | `src/shared/live-sessions/agent-session-chat-source.ts`                     | W4                                                                                      | W4, W9 (phone)  |
| `NativeChatContextUsageSummary` (extended) and thresholds                                                   | `src/shared/native-chat/native-chat-context-usage-summary.ts`               | W5                                                                                      | W1, W4, W9      |
| `openAgentSession(sessionId, mode)`                                                                         | `src/renderer/src/components/live-sessions/open/open-agent-session.ts`      | W0 creates it delegating to `openLiveSessionView`; W4 replaces the body                 | W3, W9          |
| `useWorkspaceSessions(worktreeId)` and `useSidebarSessionGroups()`                                          | `src/renderer/src/components/live-sessions/links/use-workspace-sessions.ts` | W0 creates it over today's `useLiveSessionLinks`; W8 switches it to `session.workspace` | W3, W9          |
| Session transcript for services: `transcriptOf(session)` returning pages of `NativeChatMessage`             | `src/main/live-sessions/transcripts/session-transcript.ts`                  | W2 (files), W1 (journal branch)                                                         | W2              |
| `serverInstall` on the machine record                                                                       | `src/shared/machines/machine-record.ts`                                     | W7                                                                                      | W6 (banner), W9 |
| Status entry points                                                                                         | `src/shared/live-sessions/live-session-status.ts`                           | Status-sweep work                                                                       | W1              |

What Phase 0 froze, and where it differs from the sketches in sections 4, 6 and 7. Phase 1 builders read the files, not the sketches.

| File                                                                        | Exports                                                                                                                                                                                                                                               | Notes for consumers                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/live-sessions/live-session-types.ts`                            | `LiveSession` (new: `surface?`, `capabilities?`, `workspace?`, `context?`, `model?`; `provider: AgentSessionAgentId`), `AgentSessionSurface`, `AgentSessionCapabilityFlags`, `LiveSessionInputRoute` with `structured` first, `liveSessionProviderOf` | `surface` and `capabilities` are optional until W1 fills them (section 4.1). `LIVE_SESSION_PROVIDERS` and `LiveSessionProvider` stay until W1: they are the agents the registry admits and discovery finds. `LiveTakeOverResult.provider` stays Claude or Codex, because take over is for external sessions.                                                                                                     |
| `src/shared/live-sessions/adapters/agent-session-agent-ids.ts`              | `AGENT_SESSION_AGENT_IDS`, `AgentSessionAgentId`, `isAgentSessionAgentId`                                                                                                                                                                             | 27 ids (section 6.5).                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/shared/live-sessions/adapters/agent-session-adapter.ts`                | `AgentSessionAdapter`, `AgentSessionChatRuntime`, `AgentSessionStatusEvidence`, `AgentTranscriptLocator`, `AgentSessionContextSample`                                                                                                                 | `cli.resumeArgv(providerSessionId, transcriptPath?)` may return null. Every field of `AgentSessionContextSample` is optional: a record may carry only used tokens, only a model, or only a compaction mark, and the window may be unknown. `AgentSessionStatusEvidence` lists the evidence of section 4.6; W1 matches it to the status module's own input type when that lands and may replace it with an alias. |
| `src/shared/live-sessions/adapters/agent-session-adapters.ts`               | `AGENT_SESSION_ADAPTERS`, `agentSessionAdapter(agent)`                                                                                                                                                                                                | Shared, pure parts only (section 4.3).                                                                                                                                                                                                                                                                                                                                                                           |
| `src/shared/live-sessions/agent-session-chat-source.ts`                     | `AgentSessionChatSource<ComposerTransport>`, `AgentSessionPromptAnswer`, `LiveSessionPendingMessage`                                                                                                                                                  | Section 6.2.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/shared/native-chat/native-chat-context-usage-summary.ts`               | `NativeChatContextUsageSummary` with `autoCompactAtTokens?`, `model?`, `compactions?`, `lastCompactedAt?`, `updatedAt?`                                                                                                                               | Nothing fills or reads the new fields yet. Thresholds are W5's.                                                                                                                                                                                                                                                                                                                                                  |
| `src/shared/machines/machine-record.ts`                                     | `MachineServerInstallSchema`, `MachineServerInstall`, `MachineRecord.serverInstall?`                                                                                                                                                                  | A value the schema cannot read is dropped, never fatal to the machines file.                                                                                                                                                                                                                                                                                                                                     |
| `src/renderer/src/components/live-sessions/open/open-agent-session.ts`      | `openAgentSession(sessionId, mode)`, `AgentSessionOpenMode`                                                                                                                                                                                           | Modes are today's `'preview' \| 'tab' \| 'split'`.                                                                                                                                                                                                                                                                                                                                                               |
| `src/renderer/src/components/live-sessions/links/use-workspace-sessions.ts` | `useWorkspaceSessions(worktreeId)`, `useSidebarSessionGroups()`                                                                                                                                                                                       | Both return running and ended sessions in the registry's order; rows sort and split them (`compareLiveSessions`, `isActiveLiveSession`). `worktreeId` is a git worktree's id or a folder workspace's key.                                                                                                                                                                                                        |
| `mobile/src/seal/live-sessions/live-session-schemas.ts`                     | `liveSessionSchema` accepts `surface`, `capabilities`, `workspace`, `context`, `model`                                                                                                                                                                | Each is optional, and a shape the phone cannot read is dropped without losing the session.                                                                                                                                                                                                                                                                                                                       |

Phase 0 changed no behaviour. Where widening `provider` did not compile, the code steps aside for an agent that is not Claude or Codex: transcripts read as empty (`LiveTranscriptStreams.source`), take over answers `not_resumable`, the Seal pane route answers `unavailable` and `not_answerable`, and "Copy resume command" has no command for an agent Session History cannot resume. No registry lists such an agent before W1, so none of these can be reached yet. W1 replaces each with the adapter's answer, and W3 disables "Copy resume command" when the adapter has no `resumeArgv`.

Before any source emits the `structured` route, W1 adds its branch in `SessionInputRoutes.attempt` and in the answer path: today a route kind that code does not know falls through to the headless resume command.

### 14.4 Workstreams

Each workstream lists what it owns. Files not listed belong to nobody in this plan and are not edited.

#### W0 Contracts and spikes (Phase 0, one builder)

Owns: `src/shared/live-sessions/live-session-types.ts`, `src/shared/live-sessions/adapters/**` (new), `src/shared/live-sessions/agent-session-chat-source.ts` (new), `src/shared/machines/machine-record.ts` (the `serverInstall` type only), the new optional fields on `NativeChatContextUsageSummary` (section 7), `components/live-sessions/open/open-agent-session.ts` (new, delegating), `components/live-sessions/links/use-workspace-sessions.ts` (new, over the existing hook), `mobile/src/seal/live-sessions/live-session-schemas.ts` (accept the new fields), this document.

Delivers: the types and the adapter table with an entry for every agent in section 6.5 (data only, no behaviour change: the registry still admits Claude and Codex until W1). Widening `provider` must compile everywhere; places that switch on it get a default branch, not new behaviour.

Spikes, each answered in writing in this document before Phase 1 starts:

| Spike | Question                                                                                                                                                         | Decides                                                                         | Answer                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| S1    | Can a Seal-owned structured adapter attach to a conversation whose process the host does not own (history from the transcript, live tail, input through routes)? | Whether W4 adds a tab type or reuses `agent-session`                            | It can be made to run, but not safely. W4 adds the `external-agent-session` tab type.                             |
| S2    | Do hook events reach the desktop for a CLI tab on an SSH-only machine (no server, no WSL relay)?                                                                 | Whether CLI rows on SSH-only machines have hook status or only discovery status | No. Discovery status only. There is also no CLI tab on such a machine today, only the floating machine shell.     |
| S3    | A systemd-enabled Docker SSH image that runs a user manager with linger in CI and in a cloud agent VM                                                            | W7's test fixture                                                               | Works in a cloud agent VM (run). Expected to work in CI (not run). The recipe is in the appendix.                 |
| S4    | Does a Codex rollout's `token_count` record carry the model's context window?                                                                                    | W5's window source for Codex CLI sessions                                       | Yes, at `payload.info.model_context_window`. It is Codex's effective window, the number Codex chat already shows. |

The answers in full follow the acceptance line below.

Acceptance: `pnpm tc` and `pnpm lint` pass; no behaviour change in the app (tester: the existing golden specs for tab launch and session restore pass); the four spike answers are written down.

##### Spike answers

All four were run on Linux, in a cloud agent VM, against `origin/seal/all` at `51496ea453d`. Each lists what was run, what was only read in code, and what was not checked.

**S1. Attaching a structured adapter to a process the host does not own**

Answer: the host accepts such an adapter without edits, but its lifecycle then acts on a process it does not own. W4 does not build on it and adds the `external-agent-session` tab type, as section 6.3 plans.

Run: a scratch test built the real `StructuredAgentSessionHost`, record store and journal database with a fake adapter whose `acquire` starts no process (5 cases, all ran; the findings are the values they logged).

| What was tried                                                                                                                                                                                                        | Result                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Attach with `adopt` and a Codex rollout, history import, tail writes through the event sink, `host.send`, an approval answered with `host.respondToPrompt`, a queued send released when the tail wrote the turn's end | All worked.                                                                                                                                        |
| Close the tab while a turn written by the tail was running                                                                                                                                                            | The lease was released, the journal marked the turn `interrupted` although nothing was interrupted, and later tail writes were refused (`closed`). |
| Quit while such a turn was running                                                                                                                                                                                    | A "continue after restart" offer was recorded for it.                                                                                              |
| Record the external agent's real pid as the lease owner, then restart the host and attach again                                                                                                                       | The host sent the process SIGTERM (a `sleep 600` stand-in ended with `signal: SIGTERM`).                                                           |
| Idle sweep with an adapter that cannot say whether it is idle                                                                                                                                                         | The session was closed after 30 minutes.                                                                                                           |

Read in code: an SSH-only machine has no structured host to attach to (`structuredAgentSessionTargetForHost` returns null for it), so a second view would be needed there in any case. A registry id contains `:` and is not a valid structured session id (`SESSION_ID_PATTERN`). One adapter is registered per agent id, and a record made under a new agent id could not continue into a real Claude or Codex chat. Routes never return a provider item id, so an attached send could only be `admitted`, never `accepted`.

Decides:

- W1: the registry stays the only record of external sessions. Nothing writes them into the structured record store or journal, and an external session's pid is never given to the structured host as a lease owner.
- W4: add the tab type. Its chat view reads from the registry and sends through `liveSessions.*`; closing it never goes through `host.close`. Turning an external session into a chat stays the existing adoption path (stop the terminal writer, wait for its exit, then resume). Budget for the tab type from the files that mention `'simulator'` today: 44 upstream-owned non-test files outside the simulator's own folders.
- W9: `RuntimeMobileSessionAgentTab` needs a structured session id and has no member for the simulator tab, so the phone needs its own contract member or a registry-backed view for external sessions.

Not checked: macOS and Windows; the renderer, RPC and phone side of an attach; reopening an attached session after close; a real transcript tailer or input route (the adapter was a fake).

**S2. Hook events from a CLI on an SSH-only machine**

Answer: none reach the desktop. Two things are missing, and the first changes more than the status source.

1. There is no CLI tab on an SSH-only machine. The desktop has only a local PTY provider, so `pty:spawn` for an SSH host fails with `PtyHostNotDispatchableError` (`src/main/ipc/pty/provider/registry.ts`). The one terminal there is the floating machine shell (`machines:shellOpen`), which has no tab and no pane key and cannot be reattached after a window reload.
2. That shell has no hook path. It gets no hook port, token or pane key, Seal installs no hooks in the remote home, and nothing forwards the desktop's loopback hook endpoint to the host.

Run: an E2E spec against a loopback sshd under a throwaway account, with the machine added the way the Machines page adds it (`connection: 'ssh'`), and a stub `claude` that runs Seal's real Claude hook script. It passed twice with the same results.

| Check                                                                        | Result                                                                                                                             |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Control: a local pane                                                        | Has the hook variables and `ORCA_PANE_KEY`; the hook script produced a row in the main snapshot and the renderer store.            |
| `pty.spawn` with the SSH connection                                          | Fails: `No PTY provider for connection …`.                                                                                         |
| `machines.shellOpen` with `agent: 'claude'`                                  | Works over SSH. The remote agent's environment has no `ORCA_*` or `SEAL_*` variable.                                               |
| Hooks in the remote home                                                     | None installed; the hook script exits at its missing-coordinates guard without posting.                                            |
| Hook rows for the remote session                                             | None in 10 seconds, in main or renderer.                                                                                           |
| Reverse forward                                                              | The sshd debug log shows no `tcpip-forward` or `streamlocal-forward` request from Seal's session (a control `ssh -R` did log one). |
| What discovery lists                                                         | One `external` session on the right machine, `statusSource: "transcript"`, `inputRoutes: []`.                                      |
| A hook posted with the desktop's real port and token from the remote account | Accepted, and filed under the local machine with a `seal-pane` route to a pane that does not exist.                                |

Read in code: `installRemoteManagedAgentHooks` and `ingestRemote` are called only by the WSL relay; `src` has no reverse forward (`forwardIn`, `-R`); upstream's SSH relay no longer has a client; a paired Seal server runs its own hook server, hook install and registry on its own host. `mergeSealPanes` files a pane with a non-null connection under the placeholder `seal-remote` machine, not the real one.

Decides:

- W1: an SSH-only machine has one source, discovery. There is no pane-source branch for it (section 4.7's "plus pane rows for CLI tabs the desktop runs there" does not exist today). Any later remote hook path must stamp the connection and map it to the real machine.
- W3: a CLI on an SSH-only machine is an `external` row with status from the transcript or the process list at scan cadence. Outside tmux it has no input route until its process ends, so no send and no prompt answer. There is no pane to open.
- W6: the bridge fallback of section 9.2 for SSH machines without the server cannot be "a terminal tab that opens in chat view", because that tab does not exist. This needs a decision from the plan's owner before W6 builds it (see section 17).
- W7: the server is the only existing way to get hook status on a remote machine. Without it Seal writes nothing to the remote home.

Not checked: a real remote host (the sshd shared the desktop's loopback, so the missing path is shown by the missing variables, the missing hook install and the missing forward request); the system-ssh transport, Windows and macOS; an agent inside tmux on the host (from code it would get `screen` status and a `tmux` route); opening a terminal tab from the UI in a workspace on that machine (the spawn was called through the preload API; the renderer has a handler for this error in `ipc-pty-connect.ts`); the legacy relay bridge and a paired server were not run, and the relay stayed off.

**S3. A systemd Docker SSH host with a lingering user manager**

Answer: it works in a cloud agent VM once Docker is installed there, without `--privileged`. CI was not run; the same flags are expected to work on the `ubuntu-24.04` runners the Docker SSH job uses.

The image is the existing `tests/e2e/fixtures/docker-ssh-host` Dockerfile plus one layer (`systemd`, `systemd-sysv`, `libpam-systemd`, `dbus`, `dbus-user-session`, `polkitd`, a non-root user `seal`) and an entrypoint that writes the SSH key and a per-container machine id and then becomes systemd. The files are in the appendix.

Run flags, each tried:

| Flags                                                                                | Result                                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `--security-opt writable-cgroups=true --tmpfs /run --tmpfs /run/lock`                | Works. No added capability, private cgroup namespace. Needs Docker Engine 28 or newer. First choice.                                   |
| `--cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock` | Works. Second choice, for older Docker on cgroup v2. Gives root in the container write access to the host's cgroup tree.               |
| None, `--tmpfs` only, `--cap-add SYS_ADMIN` alone                                    | systemd exits 255.                                                                                                                     |
| `--privileged`                                                                       | Works, but the container's systemd then writes its sysctls into the host kernel. Not to be used on a developer machine or an agent VM. |

Run, on the first-choice flags (the second choice passed the same checks):

| Claim                                                                      | Result                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A user manager answers over a real SSH login as a non-root user            | `systemctl --user show-environment` exits 0; `XDG_RUNTIME_DIR=/run/user/1100`.                                                                                                                                                                                                           |
| A user unit is written and enabled over SSH without root                   | `systemctl --user enable --now` exits 0; the unit is `active` and answers on loopback.                                                                                                                                                                                                   |
| Linger without root                                                        | `loginctl enable-linger` exits 0 with polkit present. Without polkit it is refused (`Could not enable linger: Access denied`, exit 1), which is the `linger: false` case of section 10.3; the user manager still works, and it stops about 10 seconds after the last SSH session closes. |
| After `docker restart`, and after `docker stop` and `start`, with no login | The unit is `active` about 200 ms after start with `loginctl list-sessions` empty, and answers on loopback.                                                                                                                                                                              |
| `Restart=on-failure`                                                       | After `kill -9` the unit is `active` again with `NRestarts=1`.                                                                                                                                                                                                                           |
| Cost                                                                       | 27 MB more than the plain image; about 0.55 s from `docker run` to the first SSH login against about 0.32 s.                                                                                                                                                                             |
| Nothing public besides sshd                                                | Listeners: port 22, and the test unit on loopback. Node 22.23.4 and git work as in the plain image.                                                                                                                                                                                      |

Docker in the VM: it was not installed. `apt-get install docker.io docker-buildx iptables` and `sudo dockerd --group ubuntu` in a tmux session worked with the default storage driver (Docker 29.1.3, cgroup v2). The VM's own init is `tini`, so a loopback sshd cannot stand in for the systemd cases.

Decides for W7:

- Commit the appendix's two files under `tests/e2e/fixtures/docker-ssh-host-systemd/`. Keep polkit in the default build; build with `--build-arg POLKIT=` for the host that refuses linger.
- The helper picks the flags from the Docker server version (28 or newer: the first choice; else the second), waits for SSH and then for `systemctl is-system-running` to print `running`.
- The plain helper cannot be reused as it is: it hard-codes the `sshd -D` command, the `root` user, an ephemeral host port and `kill -HUP 1`. The systemd host needs a pinned host port (the ephemeral one changes on `docker restart`, which T7.2 does), test repositories seeded outside `/tmp` (emptied at boot), and `systemctl reload ssh`. That is a new helper file, `tests/e2e/helpers/docker-ssh-host-systemd-target.ts`, added to W7's owned files below.
- Specs named `tests/e2e/ssh-orcad-*.spec.ts` are picked up by the existing `orcad-ssh-docker` job without workflow edits. Pull-request source routing lists helper names one by one, so a change to the new helper or fixture alone selects those specs only once a routing entry is added. Skip, with the reason, when Docker is unreachable or `docker info` does not report cgroup v2.
- Report as not run, never as passed: every systemd case on a machine without Docker, every CI claim until a CI run exists, and T7.10.

Not checked: CI itself (AppArmor's `docker-default` profile, Docker's `systemd` cgroup driver, Docker 28.0.4 and kernel 7.0 were not reproduced; if systemd does not reach `running` there, add `--security-opt apparmor=unconfined` before considering `--privileged`); the product's own install path, which does not exist yet (the unit was a stand-in Node server installed by hand); arm64, Docker Desktop, rootless Docker and podman; distributions other than Debian 12.

**S4. The context window in a Codex rollout**

Answer: yes. Every `token_count` record whose `info` is not null carries `payload.info.model_context_window`, an integer or `null`. It is Codex's effective window (the model's window times `effective_context_window_percent`, 95 by default), and it is the same number the app-server sends as `tokenUsage.modelContextWindow`, which Codex chat already shows.

Run: no committed fixture has a `token_count` record, so the real `codex` 0.169.0 binary was run against a local mock model provider with an isolated `CODEX_HOME`. Token counts are synthetic; the record shape and the window are the binary's.

| Run                                                 | Window in `token_count`     |
| --------------------------------------------------- | --------------------------- |
| `gpt-6.1-sol`, three turns                          | 258400 on all three records |
| `gpt-6.1-terra`                                     | 475000                      |
| `gpt-6.1-sol` with `-c model_context_window=100000` | 95000                       |
| An unknown model name                               | 258400                      |
| Auto-compaction forced twice                        | 258400 on all nine records  |

A record as written (`rate_limits` shortened):

```json
{
  "timestamp": "2026-11-15T21:29:42.151Z",
  "ordinal": 16,
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 12000,
        "cached_input_tokens": 4000,
        "cache_write_input_tokens": 0,
        "output_tokens": 50,
        "reasoning_output_tokens": 10,
        "total_tokens": 12050
      },
      "last_token_usage": {
        "input_tokens": 12000,
        "cached_input_tokens": 4000,
        "cache_write_input_tokens": 0,
        "output_tokens": 50,
        "reasoning_output_tokens": 10,
        "total_tokens": 12050
      },
      "last_usage_includes_reasoning": true,
      "model_context_window": 258400
    },
    "rate_limits": "(trimmed)"
  }
}
```

The record right after an auto-compaction (cumulative totals unchanged, `last_token_usage.total_tokens` is Codex's estimate of the new context size):

```json
{
  "timestamp": "2026-11-15T21:29:42.391Z",
  "ordinal": 29,
  "type": "event_msg",
  "payload": {
    "type": "token_count",
    "info": {
      "total_token_usage": {
        "input_tokens": 36000,
        "cached_input_tokens": 8000,
        "cache_write_input_tokens": 0,
        "output_tokens": 100,
        "reasoning_output_tokens": 20,
        "total_tokens": 36100
      },
      "last_token_usage": {
        "input_tokens": 0,
        "cached_input_tokens": 0,
        "cache_write_input_tokens": 0,
        "output_tokens": 0,
        "reasoning_output_tokens": 0,
        "total_tokens": 13241
      },
      "last_usage_includes_reasoning": true,
      "model_context_window": 258400
    },
    "rate_limits": "(trimmed)"
  }
}
```

Read in upstream source (`openai/codex`, tag `rust-v0.169.0`): `TokenUsageInfo.model_context_window` is `Option<i64>` and is always serialised; `TokenCountEvent.info` is optional; the field exists since 0.31.0 and `token_count` is written to rollouts since 0.32.0; after a compaction Codex writes a `token_count` whose `last_token_usage.total_tokens` is its own estimate of the new context size.

Decides for W5:

- For Codex CLI and external sessions, used tokens are `info.last_token_usage.total_tokens` and the window is `info.model_context_window` of the same record, from the last `token_count` whose `info` is not null. Read the window per record: it changes when the model changes.
- When the window is null or not positive, it is unknown, as in Codex chat (`readCodexContextUsage`). Do not fall back to `task_started.model_context_window`; it comes from the same function.
- Do not reuse `parseCodexUsageRecord`. It is a billing-delta parser with state: over the rollout with two compactions it returned 5 events for 9 records and nothing for the two records after a compaction. The read is two fields and needs no state.
- The record carries no model name; that is on the preceding `turn_context` record.
- Count top-level `compacted` records as compactions. Current Codex also writes an `item_completed` `ContextCompaction` for the same compaction and no `context_compacted`.
- No fixture exists. The tester adds `token_count` lines to the stub's rollout from the two records above.

Not checked: a real model turn; the interactive TUI (`codex exec` was run; both use the same core code); `info: null` and a null window inside `info` (both rest on the upstream types); the record Codex writes when the window is exceeded. Section 7 also names a "per-model default table shared with Home chat" for Claude; no such table exists (Home chat has three per-driver constants), so W5 decides that row's fallback.

#### W1 Registry sources (Phase 1)

Owns: `src/main/live-sessions/**` except `transcripts/**`, `live-session-notifier.ts` and `live-session-desktop-notifications.ts`; `src/main/runtime/rpc/methods/live-sessions/**`; `src/main/orcad/host-runtime/orcad-seal-hub.ts`; the status mapping additions in `src/shared/live-sessions/live-session-status.ts` once the status-sweep work is merged.

Delivers:

1. Structured source (`sources/structured-session-source.ts`): subscribes to the host's status feed and record store, maps fields as in section 4.4, plugs into `LiveSessionRegistry.publish` beside `mergeSealPanes`.
2. Pane source for every adapter: `sealPanesFromRows` admits any agent with an adapter, filters `structuredHost`, and uses provisional and pane ids as in section 4.2. `deliverFollowUp` and the answer path take the agent from the adapter instead of `ConnectorAgent`.
3. The `structured` input route in `delivery/session-input-routes.ts`, with delivery confirmed from the journal.
4. Identity: precedence between sources, provisional id rename through `replacedBy`, `continues` for forks.
5. Federation: subscribe to each paired server's `liveSessions.watch`, merge with the machine record as host; fall back to the `hostRun` scan on `method_not_found`.
6. Status evidence from chats and hooks mapped in the status module (section 4.6), with its table-driven tests extended.

Unit tests worth having (tables): source precedence and id merge; structured and hook evidence to status code.

Acceptance:

- A chat appears exactly once in the registry, with `surface: chat`, and goes through working, asking a question, waiting on you and ended as the stub agent does those things.
- A Claude CLI in a Seal pane appears exactly once (not once from the pane and once from discovery). The same for Codex.
- A CLI session of an agent other than Claude and Codex (Grok stub, and one hook-only agent) appears once with status and last message.
- Continuing a CLI session in Chat keeps the record id; forking a chat into the CLI creates a second record that lists the first in `continues`.
- `liveSessions.send` to a chat's id delivers the message; `liveSessions.answer` resolves its approval.
- No record of a chat has a `seal-pane` route.
- A chat hosted on a paired server appears on the desktop under that machine; with a server that lacks federation the external sessions still appear.
- The rows of section 13 marked W1.

Test plan (testers; oracle is `seal sessions list --all --json` plus Home screenshots):

| #    | Scenario                                                                                                                                     | Spec |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T1.1 | Start a stub Claude chat in a workspace; assert one record, `surface: chat`; drive it to an approval, a question, a finished turn, close     | Yes  |
| T1.2 | Start stub Claude and Codex CLIs in panes with discovery running; assert one record each, route `seal-pane`                                  | Yes  |
| T1.3 | Start the Grok stub CLI and a hook-only agent; assert a record each with status from hooks                                                   | No   |
| T1.4 | Adopt the CLI session from T1.2 into Chat; assert the same id, `surface: chat`, pin and custom title kept                                    | Yes  |
| T1.5 | Fork a chat into the CLI; assert a new record with `continues`                                                                               | No   |
| T1.6 | `liveSessions.send` and `answer` against a chat from the CLI and from the Home chat tool                                                     | No   |
| T1.7 | Docker SSH host with a managed server: start a chat there; assert it is listed on the desktop under the machine, and after a desktop restart | Yes  |
| T1.8 | Same host with federation disabled on the server (simulate an old server): external sessions still listed, notice shown                      | No   |
| T1.9 | Fifty sessions across three machines: registry publish stays under the existing scan budget; no duplicate ids                                | No   |

#### W2 Session services (Phase 1)

Owns: `src/main/session-summaries/**`, `src/main/session-recap/**`, `src/main/live-sessions/transcripts/**`, `src/main/live-sessions/live-session-notifier.ts`, `src/main/live-sessions/live-session-desktop-notifications.ts`, `src/shared/live-sessions/live-session-settings.ts`, `components/live-sessions/live-session-marks-store.ts`, `components/session-recap/**`, the settings entry `LiveSessionsNotifySetting.tsx` and its mount in the agents settings pane.

Delivers: one summary path keyed by record id (merge `pane-session-summaries.ts`, remove the `structuredHost` skip); recaps and the reply-ask classifier reading through `transcriptOf(session)`, with the journal branch for chats; title write-through on rename; the unread rule and the join with tab attention; one notification rule (the surface's owner notifies) and the merged settings group with migration of `liveSessionsNotify`; adapter labels in notification text.

Unit tests worth having: who-notifies table by surface; unread rule.

Acceptance: a chat gets a one-line summary and a recap; a chat that ends on a question reads "Asking you a question"; renaming a chat from a row renames its tab and survives restart; exactly one notification per event for a chat, a CLI session and an external session; the old setting's value carries over. The rows of section 13 marked W2.

Test plan:

| #    | Scenario                                                                                                                       | Spec |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ---- |
| T2.1 | Stub chat finishes a turn with the scripted utility model: summary line appears on its row; recap opens with the four sections | Yes  |
| T2.2 | Stub chat ends its turn with a question without a question mark: status becomes "Asking you a question"                        | No   |
| T2.3 | Rename a chat, a CLI session and an external session from the row menu; titles on row and tab agree; restart                   | No   |
| T2.4 | One event each for chat, CLI, external with notifications captured: one notification each; click opens the session             | Yes  |
| T2.5 | Unread dot appears when a session finishes off screen and clears when its tab is viewed, for all three surfaces                | No   |
| T2.6 | Profile with `liveSessionsNotify: false` from before the change: external sessions stay silent after migration                 | No   |

#### W3 Sidebar session rows (Phase 1, the sidebar workstream)

Owns: `components/live-sessions/row/**`, `components/live-sessions/workspace-rows/**` (new), `components/live-sessions/active-agents/**`, `components/live-sessions/links/**` except `use-workspace-sessions.ts`, `components/live-sessions/menu/**`. Upstream seams: `components/sidebar/workspace-card/template/default-workspace-card.json`, `card-activity-parts.tsx`, `card-identity-parts.tsx`, `build-workspace-card-facts.ts`, and `components/sidebar/workspace-card/activity/use-worktree-card-agent-rows.ts` with `agent-rows-without-session-panes.ts`.

Delivers: section 5.2 exactly. `WorkspaceSessionRows` renders `LiveSessionRow` for `useWorkspaceSessions(worktreeId)`; a `SessionRows` template part mounts it on every card style; the workspace sessions badge is removed from the card; a machine filter and a status filter in the sidebar toolbar (new controls: Active agents groups by machine and can be narrowed to a project or workspace, and has no filter control today); "Recently finished · N" per workspace; and every row of section 13.5 marked W3, so that each feature of Active agents exists in the merged sidebar before anything is removed. W3 removes no feature from the Active agents section. During Phases 1 and 2 the section stays, complete, but lists only `useUnassignedSessions()`, so no session is shown twice; W4 replaces it with the "Unassigned" group.

Acceptance (covers rules 1 to 9 of section 5.2):

1. Every running agent session of a workspace is a full row under it, on the default, compact and classic card styles, with the "inline agents" option on and off.
2. Each row shows title, status dot and label, and the one-line summary under it; the labels are the ten codes' labels.
3. Rows are never collapsed or truncated to a count; a workspace with twelve sessions shows twelve rows.
4. Order is by status, pinned first; a status change reorders within a second.
5. Terminal, browser and Markdown tabs are not rows.
6. Click opens the session through `openAgentSession`; double click keeps the tab; the workspace row opens the workspace.
7. Pin, rename, the whole menu, hover preview, recap badge, subagent count, account badge and keyboard navigation work from the row.
8. No session appears both under a workspace and in Active agents.
9. The sidebar scrolls smoothly with sixty rows; cards do not overlap after rows are added or removed (virtualiser measurement).
10. Dragging a row does not select text.
11. Light and dark themes, narrow and wide sidebar.
12. The rows of section 13 marked W3.
13. Every row of section 13.5 marked W3 works in the merged sidebar while the Active agents section is still present, with a screenshot or recording per row in the pull request.

Test plan:

| #    | Scenario                                                                                                                                    | Spec |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| T3.1 | Seed two workspaces with six sessions in six different statuses (stub agents); screenshot the sidebar; compare labels with the status table | Yes  |
| T3.2 | Switch card style to compact and classic, toggle "inline agents": rows remain                                                               | Yes  |
| T3.3 | Twelve sessions in one workspace: twelve rows, no "more" control                                                                            | No   |
| T3.4 | Drive one session from working to asking a question: its row moves to the top of its workspace and the label changes                        | No   |
| T3.5 | Open a terminal, a browser and a Markdown tab: no rows appear for them                                                                      | No   |
| T3.6 | Every menu item on a chat row, a CLI row and an external row                                                                                | No   |
| T3.7 | Sixty sessions over ten workspaces: scroll trace has no long frames; add and remove rows while scrolled; no overlapping cards               | No   |
| T3.8 | Fixture shots of `WorkspaceSessionRows` in each status, with and without summary, pinned, unread, in both themes (`pnpm fixtures:shot`)     | No   |
| T3.9 | Drag a row across the sidebar: no text selection; with multi-pane merged, the drag payload is the session                                   | No   |

#### W5 Context indicator (Phase 1)

Owns: `components/native-chat/usage/**`, the context usage files under `src/shared/native-chat/` and `src/shared/agent-session/` (`native-chat-context-usage*.ts`, `agent-session-context-usage.ts`), `src/main/claude/context-usage/**`, the usage fields in `src/main/native-chat/transcript-decoding/transcript-line-decoders-claude.ts` and `transcript-line-decoders-codex.ts`, the Claude status line payload reader under `src/main/agent-hooks` (context window only), `components/home-chat/HomeChatContextBar.tsx`, `mobile/src/session/native-chat/composer/MobileNativeChatContextUsageRing.tsx`.

Delivers: section 7. The ring reads the extended `NativeChatContextUsageSummary` for every source; `autoCompactAtTokens` is passed through from Claude's report; decoders keep usage so bridge and external sessions have a sample; the registry copies the latest sample to `session.context` through the adapter's `usageOf`; the states and texts; one threshold file used by desktop, Home chat and the phone.

Unit tests worth having: state from (used, window, threshold) table.

Acceptance: the indicator sits bottom right next to the send button in every chat view; a Claude chat shows the distance to auto-compaction; a Claude CLI session in chat view and an external Claude session show estimated usage; Codex chat shows exact usage; the warning and critical states appear at the stated points; a compaction updates the count and the arc; Home chat and the phone show the same component states. The rows of section 13 marked W5.

Test plan:

| #    | Scenario                                                                                                  | Spec |
| ---- | --------------------------------------------------------------------------------------------------------- | ---- |
| T5.1 | Stub Claude chat reporting 40%, 82% and 96% of its threshold in turn: screenshot ring and popover at each | Yes  |
| T5.2 | Stub transcript with usage for a Claude CLI session and an external session: ring shows "about" values    | No   |
| T5.3 | Stub Codex chat with `tokenUsage` updates and a `thread/compacted`: count increments                      | No   |
| T5.4 | An agent with no usage (Gemini CLI): no indicator                                                         | No   |
| T5.5 | Home chat thread near its limit: same indicator, "Compact now" works                                      | No   |
| T5.6 | Phone (mobile web bundle in the emulator tab): ring states match desktop                                  | No   |

#### W6 Launcher: CLI option and chat everywhere (Phase 1)

Owns: `src/shared/agent-launch/picker/**`, `src/shared/structured-native-chat-launch-route.ts`, `components/tab-bar/tab-agent-row-presentation.ts`, `components/tab-bar/TabAgentSurfaceChoiceRow.tsx`, `components/tab-bar/QuickLaunchButton.tsx`, `components/tab-bar/use-new-tab-agent-menu-rows.ts`, `components/agent/AgentLaunchPicker*.tsx`, `components/agent/AgentSurfaceLaunchButton.tsx`, `lib/agent-session/launch/**`, the launch-directory handling in `structured-session-create-support.ts`, `tests/e2e/golden-tab-bar-agent-launch.spec.ts`.

Delivers: section 8.2 and the launcher part of section 9.2 (bridge fallback instead of a refused chat on SSH-only and WSL-project hosts; structured chat in a subfolder).

Unit tests worth having: `buildNewTabAgentMenuRows` table (chat default, terminal default, not installed, no chat, remote host).

Acceptance: for Claude and Codex, with chat as default and with CLI as default, the new-tab menu shows both a Chat and a CLI action, visible without hovering, reachable by keyboard, each launching the right surface; agents with one surface show one; an agent not installed on the host shows the CLI action disabled with the reason; on an SSH-only machine "Chat" opens the CLI in chat view with the install banner; in a workspace subfolder "Chat" starts a structured chat whose working directory is the subfolder; the "No chat over SSH" and "No chat in subfolders" rows are gone. The rows of section 13 marked W6.

Test plan:

| #    | Scenario                                                                                                                | Spec |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---- |
| T6.1 | Default settings: open the `+` menu; screenshot; Claude row has Chat and CLI; click CLI: terminal tab runs the stub CLI | Yes  |
| T6.2 | `agentDefaultSurface: 'chat'`: same menu still has CLI; click Chat and CLI in turn                                      | Yes  |
| T6.3 | Keyboard only: open menu, move to Claude, choose CLI                                                                    | No   |
| T6.4 | Host without the Codex binary: CLI action disabled with the reason; Chat state per capability                           | No   |
| T6.5 | Docker SSH host without a server: Chat opens the stub Claude CLI in chat view, banner present; a message round-trips    | Yes  |
| T6.6 | Terminal in `src/` of a workspace, then `+` Chat: the stub reports its working directory as the subfolder               | Yes  |
| T6.7 | Windows runner or VM: Claude and Codex show both surfaces; Antigravity shows CLI with the reason                        | No   |

#### W7 Seal server on SSH machines (Phase 1)

Owns: `src/main/machines/**`, `src/shared/machines/**`, `components/machines/**` except `MachineSessionList.tsx` and `machine-live-sessions.ts`, `src/main/managed-server/service/**` (new, Seal-owned), `tests/e2e/fixtures/docker-ssh-host-systemd/**` (new), `tests/e2e/helpers/docker-ssh-host-systemd-target.ts` (new; spike S3 showed the plain helper cannot start this image). Upstream seams: `src/main/managed-server/install/orcad-remote-launch.ts`, `orcad-remote-runtime-control.ts`, `orcad-host-transport.ts` (the launch strategy), `src/main/orcad/host-lifecycle/idle-exit/orcad-managed-idle-exit.ts` (service mode), `src/main/ipc/ssh/ssh-connect-flow.ts` and `src/main/ssh/host-server/ssh-direct-connect-policy.ts` (policy and fallback), `src/cli/runtime/serve-service-unit.ts` (parameters).

Delivers: section 10: the Add machine checkbox and record field, the probe, the stable launcher, the four launch strategies, linger, the fallback to plain SSH with the reason, the notice and "Retry install", "Remove Seal server", background reconnect after an app update, and the migration behaviour for existing machines.

Unit tests worth having: manager selection table from probe results; unit and plist rendering for the managed launcher.

Acceptance:

- Adding a fresh Linux machine with the box ticked ends with the server installed, the service active, the machine connected through the server, and no port opened on the host.
- After the host restarts the server is running before any desktop connects (systemd with linger).
- A host with PM2 and no user systemd is managed through PM2; a host with neither runs detached as today.
- Each injected failure (no space, read-only home, unsupported architecture, blocked runtime upload, pairing failure) ends in a working plain SSH connection, the reason on the machine page, and a working "Retry install".
- Unticking the box connects over plain SSH and installs nothing.
- An older managed server is upgraded on connect and the service runs the new version; a newer server is not downgraded.
- An existing SSH-only machine with two projects and open tabs converts on request: workspace ids, tabs, pins and session record ids are unchanged; with a live terminal the conversion waits.
- An existing server machine is untouched.
- Two desktops against one host do not corrupt the install.
- The rows of section 13 marked W7.

Test plan (needs a real SSH target: the Docker hosts, or the loopback sshd where Docker is unavailable; systemd and launchd cases that cannot run in the tester's environment are reported as not run, never as passed):

| #     | Scenario                                                                                                                                 | Spec      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| T7.1  | systemd Docker host: add machine with defaults; assert `systemctl --user is-active seal-server`, linger on, machine connection is server | Yes       |
| T7.2  | Restart the container; without the desktop, assert the server answers on loopback; reconnect the desktop; sessions listed                | Yes       |
| T7.3  | Plain Docker host (no systemd) with PM2 installed: managed through PM2; without PM2: detached                                            | No        |
| T7.4  | Failure injection, one tester per failure: plain SSH works, reason shown, retry succeeds after the cause is removed                      | Yes (one) |
| T7.5  | Untick the box: nothing under `~/.orca-remote`, machine works over SSH, CLI tab works                                                    | No        |
| T7.6  | Install bundle version N−1, then connect with N: upgraded, service restarted; connect with N−1 again: not downgraded                     | No        |
| T7.7  | SSH-only machine with projects and tabs (seeded profile): accept the install notice; compare workspace ids, tabs, pins, session ids      | Yes       |
| T7.8  | Same with a live terminal: conversion deferred, notice text, "Move anyway"                                                               | No        |
| T7.9  | Two app instances with separate profiles connect to one host at once                                                                     | No        |
| T7.10 | macOS host (a Mac runner or Brian's machine): launchd agent installed over SSH, survives logout                                          | No        |

#### W4 Session tabs and chat view (Phase 2)

Owns: `components/live-sessions/open/**`, `components/live-sessions/chat/**` (new: external source, session header), `components/live-sessions/workspace/**`, `components/live-sessions/LiveSessionChat.tsx`, `LiveSessionComposer.tsx`, `LiveSessionAppSurface.tsx`, `use-live-transcript.ts`, `live-session-send.ts`, `live-session-pending-rows.ts`, `app-shell/AppWorkspaceShell.tsx` (the `sessions` branch only), the `sessions` view actions in `store/slices/ui`. Upstream seams: the new tab content type (the files the `simulator` type touches: `src/shared/tab-types.ts`, the workspace-session and workspace-layout schemas and commands, `runtime-mobile-session-tab-contracts.ts`, tab-bar item model and projection, `TabGroupPanel`, the pane overlay layers, main session-tab publication) and the header slot of `NativeChatView`.

Delivers: sections 6.2 and 6.3. `openAgentSession` resolving to the chat tab, the terminal tab or the external tab; the external source over the registry IPC; the shared session header; migration of open session tabs; deletion of the sessions view, its strip and store, the thin pane, chat and composer, `openLiveSessionView`, `liveSessionTabsStore` and the Active agents section (`components/live-sessions/active-agents/**`, its mount and fold state); the "Unassigned" sidebar group for sessions with no workspace, built from W3's `WorkspaceSessionRows` and `LiveSessionRow`. Spike S1 decided against the attach adapter (section 14.4, W0): the external tab is the new `external-agent-session` tab type.

Acceptance: a session row opens a tab in its workspace for all three surfaces; preview and keep; the external session tab has the full composer with unsupported controls hidden, the prompt card, find, links, image viewer, font zoom, footer, context indicator, recap, subagents and tasks; sending and retrying work over every route; the tab reorders, splits, closes and is restored after relaunch like any tab; an ended session's tab shows its transcript; there is no `sessions` view left and no caller of `openLiveSessionView`. The rows of section 13 marked W4.

Test plan:

| #     | Scenario                                                                                                                              | Run    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T4.1  | Click a chat row, a CLI row and an external row: each focuses or creates the right tab in the right workspace                         | Spec   |
| T4.2  | Single click then another row: the preview tab is reused; double click keeps it                                                       | No     |
| T4.3  | External tmux session (stub agent in tmux): type with mention and command, send, see it in the transcript; force a failed send, retry | Spec   |
| T4.4  | External session asks for permission and asks a question: answer both from the card                                                   | Spec   |
| T4.5  | Drag the external tab to reorder and to a split; no text selection; relaunch restores it                                              | Tester |
| T4.6  | Side by side screenshots of a project chat and an external session tab: same strip, composer, footer and indicator                    | No     |
| T4.7  | Find in transcript, file link click, image open, font zoom in an external session tab                                                 | No     |
| T4.8  | Recap, subagents and tasks from the header on a chat, a CLI session in chat view and an external session                              | No     |
| T4.9  | External session on the Docker SSH host and on a managed server: transcript pages, live updates, send                                 | Tester |
| T4.10 | Profile with open session tabs from before: they reappear as workspace tabs once                                                      | Tester |
| T4.11 | Session ends while its tab is open: status "Ended", transcript stays, composer offers resume or take over                             | No     |

#### W8 Workspace attachment and file tree (Phase 2)

Owns: `src/main/live-sessions/workspace-link/**` (new, carved out of W1's tree), `components/live-sessions/links/use-workspace-sessions.ts`, `components/live-sessions/take-over/**`, the discovery script's folder probe, the `autoCreated` mark on workspace and project records, the project merge action. Upstream seams: a `worktreeId` and host prop on `components/right-sidebar/file-explorer/**`'s entry component, and the mount of the tree panel in the workspace content.

Delivers: sections 5.3, 5.4 and 5.5: the link step in the registry, the probe on every transport, auto-creation with dedupe, the lifecycle of auto-created records, the "Unassigned" fallback (the group itself is W4's), merge and rename, take over finding its workspace, and the collapsible file tree.

Unit tests worth having: the link rule table (tab, path prefix with both separators, repository identity, non-repository, home directory); the auto-created clean-up rule.

Acceptance: a session started outside Seal in a registered workspace's folder appears under that workspace; in a clone of a registered project's repository on another machine it appears under that project in a new workspace on that machine; in an unknown repository a project and workspace appear; in a plain folder a folder workspace appears; home-directory sessions share one workspace per machine; when the last session leaves an untouched auto-created workspace it disappears, and a touched one stays; nothing is created twice; on SSH-only machines the same holds; a session that cannot be probed is listed under "Unassigned" and attaches later; the file tree opens and collapses per workspace, shows the workspace's files on local, SSH and server hosts, and opening a file works. The rows of section 13 marked W8.

Test plan:

| #    | Scenario                                                                                                                          | Run    |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T8.1 | Stub external session in a registered worktree folder and in its subfolder: listed under that workspace                           | Spec   |
| T8.2 | Same repository cloned on the Docker SSH host: session there appears under the same project, new workspace with the machine badge | Spec   |
| T8.3 | Unknown repository and a plain folder: project and workspace created, named sensibly; the session ends: both removed              | Spec   |
| T8.4 | Open a tab in an auto-created workspace, end the session: the workspace stays                                                     | No     |
| T8.5 | Two sessions start at once in one unknown folder: one workspace                                                                   | No     |
| T8.6 | Machine goes offline mid-probe: session under "Unassigned", attaches after reconnect                                              | Tester |
| T8.7 | Take over an external session in an unknown folder: succeeds into the created workspace                                           | Tester |
| T8.8 | File tree in two workspaces on different hosts: independent open state, lazy loading, open file, git decorations                  | Tester |
| T8.9 | Windows paths (unit table plus a Windows runner if available)                                                                     | No     |

#### W9 Phone and other consumers (Phase 2)

Owns: `mobile/src/seal/**`, the external source wiring in `mobile/src/session/native-chat` (seam), `components/home-overview/**`, `components/project-overview/**`, `components/machines/MachineSessionList.tsx`, `components/machines/machine-live-sessions.ts`, `components/live-sessions/palette/**`, `src/cli/live-sessions/**`, `src/cli/specs/seal-sessions.ts`, the session tools and open target in `src/main/home-chat/**`, `src/main/seal-mcp/**`, phone push for external sessions under `src/main/runtime/push/notifications/**` (seam).

Delivers: section 11.

Acceptance: the phone lists sessions by project and workspace with "Needs you" on top, and opens every session in the native chat view with send, answer, recap, take over and the account sheet; Home and the project overview group by workspace; Machines lists chats and all agents; the palette opens tabs and lists a session once; `seal sessions list` shows the new columns and filters; MCP and Home chat tools list and message chats; an external session that needs you pushes to the phone. The rows of section 13 marked W9.

Test plan:

| #    | Scenario                                                                                                                   | Run    |
| ---- | -------------------------------------------------------------------------------------------------------------------------- | ------ |
| T9.1 | Mobile web bundle against a seeded desktop: list grouping, "Needs you", open a chat, a CLI session and an external session | Spec   |
| T9.2 | On the phone: send to an external session, answer its prompt, open its recap, take it over                                 | Tester |
| T9.3 | Home, project overview and Machines screenshots with sessions of all three surfaces on two machines                        | No     |
| T9.4 | Palette: search a session title; one result; Enter opens its tab                                                           | Tester |
| T9.5 | `seal sessions list --json`, `--machine`, `--project`; MCP `list_sessions` and `message_session` against a chat            | Spec   |
| T9.6 | External session asks a question with the desktop window hidden: one push with the right title                             | Tester |

### 14.5 Known overlaps and how they are avoided

| Shared place                                      | Who touches it                                                                           | Rule                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/live-sessions/live-session-types.ts`  | W0 only                                                                                  | Frozen after Phase 0.                                                                                                                                                                                                                                                                                                                                         |
| Seal locale overlays                              | All                                                                                      | One key block per workstream; resolve by keeping both blocks.                                                                                                                                                                                                                                                                                                 |
| `components/tab-bar/**`                           | W6 (launch menu files), W4 (item model and projection), multi-pane build (drag and drop) | File-level split as listed; W4 waits for the multi-pane merge.                                                                                                                                                                                                                                                                                                |
| `components/live-sessions/links/**`               | W3 in Phase 1, W8 in Phase 2                                                             | W8 changes only `use-workspace-sessions.ts`.                                                                                                                                                                                                                                                                                                                  |
| `src/main/live-sessions/**`                       | W1; W2 (`transcripts/**`, notifier); W8 (`workspace-link/**`)                            | Sub-folder ownership as listed.                                                                                                                                                                                                                                                                                                                               |
| `src/main/live-sessions/live-session-registry.ts` | W1; W8 adds one decorator call                                                           | W8's call site is agreed in W0 as a hook in the publish pipeline: an optional `link?: (session: LiveSession) => LiveSession` on `LiveSessionRegistryDeps`, called in `publish()` after `annotate` and before the decorator. It returns the session with `workspace` set, or unchanged. W1 leaves that position free; W8 adds the dependency and the one call. |
| `components/machines/**`                          | W7; W9 (two session-list files)                                                          | As listed.                                                                                                                                                                                                                                                                                                                                                    |
| `.gitignore` (`docs/design/`)                     | This pull request, multi-pane design pull request                                        | Both un-ignore `docs/design/`; keep both lines on merge.                                                                                                                                                                                                                                                                                                      |

## 15. Coordination with other work in flight

| Work                                                                                                           | Where                                                                                                                     | What this plan needs from it, and gives it                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status sweep (false "waiting on you" during background work; one status source; `docs/design/agent-status.md`) | Agent `bc-03248f3f`, branch `cursor/agent-status-background-work-1937` (not pushed when this was written)                 | This plan reuses its status module and document as the single source of truth and defines no status logic of its own. W1 starts from its merge and adds only the evidence mappings of section 4.6 inside that module. If its entry points take transcript-shaped input only, W1 extends them there, with its tests, not beside them.                                                                                       |
| Multi-pane workspace design and build                                                                          | Design pull request #46 (`cursor/multi-pane-design-154a`), build agent `bc-541d5603` (`cursor/multi-pane-workspace-906c`) | Multi-pane owns panes, split layout and drop zones. This plan owns the session tab kinds, the chat view, the composer and the session rows. Drag sources it must accept: the workspace row and the session row (payload: record id; the drop calls `openAgentSession` with the target pane). Because sessions become ordinary workspace tabs, multi-pane needs no session-specific layout code. W4 starts after its merge. |
| E2E harness                                                                                                    | Agent `bc-946de5b6`                                                                                                       | Shared seeding helpers (stub agents, seeded sessions, SSH targets) should live there. Builders check it before adding helpers; W7's systemd image is offered to it.                                                                                                                                                                                                                                                        |
| Weekly upstream merge                                                                                          | `docs/upstream-sync.md`                                                                                                   | The seams this plan adds are listed there by the workstream that adds them. The largest is the external tab type; the rest are single registrations or props.                                                                                                                                                                                                                                                              |

## 16. Questions for Brian, and his answers

Answered by Brian on 15 November 2026: every default below is accepted, questions 4 and 5 included. The builders treat each default as the decision. Questions 10 and 11 name no separate default; the answer taken is what each describes (10: the fallback is acceptable; 11: a follow-up outside this plan, as section 5.4 says).

Separately, Brian corrected the plan on Active agents: "remember we still want the functionality we built, just merged in." Section 13.5 and the W3 entry carry that correction; W10 was later dropped (section 14.2).

The questions as they were asked, each with its default:

1. Delete upstream-owned code that Seal stops using (inline agent rows on cards, the dashboard; an estimated 5,000 to 8,000 lines)? Default: no, because of recurring merge conflicts. Saying yes makes the plan net negative in lines.
2. PM2 precedence. You said "or PM2 if PM2 is detected". Default: the native manager first (systemd user service, launchd), PM2 when detected and no native manager works, selectable in the advanced options. Should PM2 win whenever it is present?
3. Existing SSH-only machines (2299 on super9): offer the install with a one-time notice (default), or install automatically on the next connect? Conversion moves the machine's projects to the server, so the default asks first.
4. Auto-created workspaces and projects: remove them automatically when their last session leaves and you never touched them (default), or keep everything that was ever created? And sessions started in a home directory: one "~ on machine" workspace per machine (default)?
5. Ended sessions in the sidebar: one expandable "Recently finished · N" line per workspace (default), or full rows for a while, or not in the sidebar at all?
6. Compaction warning for CLI and external Claude sessions, where the real threshold is not readable: warn relative to the context window only (default), or assume Claude Code's default auto-compact point and label it "estimated"?
7. Opening an external session creates a persisted tab in its workspace (default, so it restores and shows on the phone). Acceptable, or should external tabs be temporary?
8. Rename `LiveSession` to `AgentSession` in code at the end (one mechanical commit touching about 250 files), or keep the name? Default: keep.
9. Notification settings: fold "Notify about agent sessions" into "Agent needs input" and "Agent finished" (default)?
10. WSL projects on a Windows desktop get chat through the CLI-in-chat-view fallback now and full chat only when upstream's WSL server support leaves its experimental flag. Acceptable?
11. Fold the Machines page's disk explorer into the shared file tree as a follow-up?

## 17. What was verified and what was not

Verified in code at `51496ea453d` and, where noted, in the running app:

- The three models, their ids, vocabularies and consumers (section 1). The accidental listing of a chat under Active agents was seen in the running app.
- Session rows always open the separate sessions view; its tab strip selects text on drag (running app).
- The new-tab menu has no labelled CLI action; the row model suppresses the CLI row for chat-runnable agents (code and running app).
- The reasons chat is refused, and that chat works on a paired server (code and existing specs).
- The managed server deploy, tunnel, pairing and update path; that Machines turns it off; that it is started with `nohup` and exits when idle; that a failed setup does not fall back to SSH (code).
- The registry's host id is the machine record id for both transports (code).
- The card template seam, the composer's transport seam, the registry's publish pipeline and the existing server-summaries fallback (code).
- All line counts in section 12.

Resolved in Phase 0 by the spikes (answers and evidence in section 14.4, W0), run on Linux in a cloud agent VM:

| Unknown                                                                  | Answer                                                                                                                               | How it was checked                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Whether the structured host can attach to a process it does not own (S1) | It runs, but the host then closes, interrupts and after a restart signals a process it does not own. Not used; W4 adds the tab type. | A scratch test against the real host, record store and journal with a process-less adapter; the rest read in code.             |
| Hook delivery for CLI tabs on SSH-only machines (S2)                     | None. Such a machine has no CLI tab at all, only the floating machine shell, and discovery is its one source.                        | An E2E spec against a loopback sshd with Seal's real hook script, run twice; the sshd debug log; code. Not a real remote host. |
| A systemd user manager with linger inside a container (S3)               | Works without `--privileged` in a cloud agent VM after installing Docker.                                                            | Built and run: SSH login, user unit, linger, restart, stop and start, `kill -9`. CI was not run.                               |
| Whether Codex rollouts carry the context window (S4)                     | Yes: `payload.info.model_context_window`, Codex's effective window.                                                                  | Rollouts written by the real 0.169.0 binary against a mock provider; upstream source. No real model turn.                      |

Phase 0 also verified: `pnpm tc`, `pnpm lint` and the changed-file checks pass; eight existing E2E spec files (tab launch from the tab bar, agent TUI launch, quit and relaunch, shell after agent exit, active view restore, project overview, sidebar agent row identity, sidebar workspace rows) gave the same results on the build before and the build after, 8 passed and 6 skipped by their own platform or build conditions in both.

Not verified, and assigned:

| Unknown                                                                                                                                                                                                                                                                                                                                                                                                                                     | Resolved by                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| The bridge fallback for SSH machines without the server (section 9.2, T6.5 and W6's acceptance line) assumes a terminal tab that does not exist there (S2). W0's proposal, not a decision: in Phase 1 W6 keeps the chat action on such a machine explained and tied to "Install Seal server", and the chat view of a CLI started through the machine shell is taken up with W4's external tab, launching inside tmux where the host has it. | The plan's owner and Brian, before W6 builds that part |
| The systemd fixture's run flags on the CI runners (AppArmor, Docker 28, the `systemd` cgroup driver)                                                                                                                                                                                                                                                                                                                                        | W7, on its first CI run                                |
| The window fallback for Claude CLI and external sessions: section 7 names a per-model default table shared with Home chat, and none exists                                                                                                                                                                                                                                                                                                  | W5                                                     |
| `chat.runtime` in the shared adapter table against the main-only runtime catalog, and `AgentSessionStatusEvidence` against the status module's input type                                                                                                                                                                                                                                                                                   | W1                                                     |
| The status-sweep module's final entry points (its branch was not pushed)                                                                                                                                                                                                                                                                                                                                                                    | W1                                                     |
| How the desktop receives hook rows for terminals on a paired server today, and their dedupe with federated records                                                                                                                                                                                                                                                                                                                          | W1                                                     |
| `launchctl bootstrap` from an SSH session without a GUI login                                                                                                                                                                                                                                                                                                                                                                               | W7                                                     |
| Whether every Windows build has the process start-time addon structured providers need                                                                                                                                                                                                                                                                                                                                                      | W6                                                     |
| What Brian's machine records (kessel-ml, 2299) contain on disk                                                                                                                                                                                                                                                                                                                                                                              | W7, with Brian                                         |
| Why one capture of the `+` menu listed five agents with chat off and only Claude and Codex with chat on (the capture's PATH changed between the two shots)                                                                                                                                                                                                                                                                                  | W6                                                     |
| ACP agents' context usage reports                                                                                                                                                                                                                                                                                                                                                                                                           | W5                                                     |

## Appendix: the systemd SSH host fixture from spike S3

W7 commits these two files under `tests/e2e/fixtures/docker-ssh-host-systemd/`. The first lines of the Dockerfile are those of the plain fixture, so the layers are shared.

`Dockerfile`:

```dockerfile
FROM node:22.23.4-bookworm@sha256:2bd396628eceb5c999a6e43731fab69d5fb98b94ba9d9d90b5f64575c5178765 AS patched-node
FROM node:22-bookworm@sha256:5647be709086c696ff32edaaf1c70cd26d1da6ab2b39c32f3c7b4c4a31957e37

COPY --from=patched-node /usr/local/bin/node /usr/local/bin/node

# Why: immutable snapshot inputs keep the SSH/Git fixture identical across rebuild dates.
RUN sed -i \
      -e 's|http://deb.debian.org/debian-security|https://snapshot.debian.org/archive/debian-security/20260713T000000Z|' \
      -e 's|http://deb.debian.org/debian|https://snapshot.debian.org/archive/debian/20260713T000000Z|' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      git=1:2.39.5-0+deb12u3 \
      openssh-server=1:9.2p1-2+deb12u10 \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /run/sshd /root/.ssh \
    && chmod 700 /root/.ssh

# uid 1000 is the node image's `node` user, so the SSH user is seal (1100).
# polkitd lets a user enable linger for itself; POLKIT= builds the host that refuses it.
# The systemd package bakes one machine-id into the image; it is removed so each container gets its own.
ARG POLKIT=polkitd=122-3
ARG SYSTEMD_VERSION=252.39-1~deb12u2
RUN apt-get -o Acquire::Check-Valid-Until=false update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      systemd=${SYSTEMD_VERSION} \
      systemd-sysv=${SYSTEMD_VERSION} \
      libpam-systemd=${SYSTEMD_VERSION} \
      dbus=1.14.10-1~deb12u1 \
      dbus-user-session=1.14.10-1~deb12u1 \
      ${POLKIT} \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1100 --create-home --shell /bin/bash seal \
    && install -d -m 700 -o seal -g seal /home/seal/.ssh \
    && systemctl set-default multi-user.target \
    && systemctl enable ssh.service \
    && systemctl mask \
      console-getty.service getty.target systemd-firstboot.service \
      apt-daily.timer apt-daily-upgrade.timer dpkg-db-backup.timer \
      e2scrub_all.timer e2scrub_reap.service fstrim.timer \
    && rm -f /etc/machine-id /var/lib/dbus/machine-id

COPY fixture-init /usr/local/sbin/seal-fixture-init
RUN chmod 755 /usr/local/sbin/seal-fixture-init

# systemd reads this to know it runs in a container; SIGRTMIN+3 is its clean-shutdown signal.
ENV container=docker
STOPSIGNAL SIGRTMIN+3
EXPOSE 22
ENTRYPOINT ["/usr/local/sbin/seal-fixture-init"]
```

`fixture-init`, the entrypoint. systemd does not pass the container's environment to services, so the per-test inputs are applied here before it starts:

```sh
#!/bin/sh
set -eu

# Written before systemd starts, so the id is stable across restarts.
if [ -n "${MACHINE_ID:-}" ]; then
  printf '%s\n' "$MACHINE_ID" > /etc/machine-id
elif [ ! -s /etc/machine-id ]; then
  tr -d '-' < /proc/sys/kernel/random/uuid > /etc/machine-id
fi

add_key() {
  # $1 home, $2 owner
  file="$1/.ssh/authorized_keys"
  install -d -m 700 -o "$2" -g "$2" "$1/.ssh"
  touch "$file"
  grep -qxF "$AUTHORIZED_KEY" "$file" || printf '%s\n' "$AUTHORIZED_KEY" >> "$file"
  chown "$2:$2" "$file"
  chmod 600 "$file"
}

if [ -n "${AUTHORIZED_KEY:-}" ]; then
  add_key /root root
  add_key /home/seal seal
fi

# FIXTURE_LINGER=1 is the host that already lingers; leave it unset to test that Seal enables linger.
if [ "${FIXTURE_LINGER:-}" = "1" ]; then
  mkdir -p /var/lib/systemd/linger
  : > /var/lib/systemd/linger/seal
fi

exec /lib/systemd/systemd
```

Start it with `docker run -d -p 127.0.0.1:<port>:22 -e AUTHORIZED_KEY=<public key> <flags> <image>`, where the flags are the first or second choice from the S3 table. Checks that need no login: `docker exec -u seal -e XDG_RUNTIME_DIR=/run/user/1100 <container> systemctl --user is-active <unit>` and `docker exec <container> loginctl show-user seal -p Linger`; `loginctl list-sessions --no-legend` printing nothing proves no login happened.
