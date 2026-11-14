# Information architecture

Seal shows the same few things in many places: the sidebar, Home, the workspace board, the Machines tab, tabs and panes, the command palette, the mobile app, the CLI and the Home chat tools. This document says what those things are, which surface owns each one, and how every other surface refers to it.

The rule behind all of it: **each thing has one record, one canonical home, and one set of handlers. Other surfaces link to it or show a count; they never keep a second list with its own status, ordering or actions.**

## Entities

```
Machine
└─ Project                      a repo or a plain folder
   └─ Workspace                 a git worktree, or the folder itself
      ├─ Tabs and panes         terminals, editors, browsers, chats
      └─ Agent session          one Claude Code or Codex conversation
         ├─ Subagents
         ├─ Background tasks
         └─ Todos
```

| Entity                              | Record                                                           | Where the record lives                                                                               |
| ----------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Machine                             | `MachineSummary` (`src/shared/machines/`)                        | `seal-machines.json`; see [machines.md](./machines.md). One machine, whichever transport reaches it. |
| Project                             | `Repo` and project groups                                        | App store (`repos`).                                                                                 |
| Workspace                           | `Worktree`, or a folder workspace                                | App store (`worktreesByRepo`). Not every workspace is a git worktree.                                |
| Tab, pane                           | Tab and pane layout; a pane is `tabId:leafId` (its `paneKey`)    | App store.                                                                                           |
| Agent session                       | `LiveSession` (`src/shared/live-sessions/live-session-types.ts`) | The live-session registry: `LiveSessionRegistry` in main, `liveSessionRegistryStore` in the window.  |
| Subagents, background tasks, todos  | `LiveSessionActivity` on the session                             | Part of the session record.                                                                          |
| Work item (issue, PR, Linear, Jira) | Provider records                                                 | The Tasks page. Unrelated to a session's background tasks despite the name.                          |

### One session record

An agent session is one `LiveSession`, however it started and wherever it is shown.

- **A session Seal launched** runs in a terminal pane. Its record carries `origin: 'seal'` and an input route `{ kind: 'seal-pane', paneKey }`. The pane is where it runs; the record is still the registry's. The agent hooks in that pane are a _status source_ for the record, not a second session.
- **An external session** (Claude Code or Codex started in any terminal on any machine) is the same record with `origin: 'external'`, found by the scanner. See [live-sessions-hosts.md](./live-sessions-hosts.md).
- **A board card or sidebar card** is a workspace. It does not hold sessions; it shows a badge for the registry's sessions whose folder is inside that workspace (`useLiveSessionLinks`).

The registry covers Claude Code and Codex. Other terminal agents (Gemini, OpenCode and so on) have no session record yet; they exist only as pane status (`agentStatusByPaneKey`) and show as inline rows on their workspace card. When a pane does have a session record, the card leaves it to the badge (`agentRowsWithoutSessionPanes`).

### One status model

`src/shared/live-sessions/live-session-status.ts` is the only place that interprets a session's status. It is shared by main, the window, the CLI and mobile.

| Status                                           | Group       | Meaning                 |
| ------------------------------------------------ | ----------- | ----------------------- |
| `needs-permission`, `waiting-input`, `errored`   | `attention` | Waiting on you.         |
| `working`, `waiting-subagent`, `waiting-task`    | `working`   | Busy.                   |
| `idle`                                           | `idle`      | Alive, nothing running. |
| `done`, or any status once the process has ended | `finished`  | No longer running.      |

- `liveSessionStatusGroup` gives the group; `isActiveLiveSession` says whether it is still running.
- `compareLiveSessions` orders by urgency. `compareListedLiveSessions` puts pinned sessions first. `groupLiveSessionsByMachine` puts this computer first. Every list uses these (`src/shared/live-sessions/live-session-summary.ts`).
- `countLiveSessionGroups` and `liveSessionsNeedingAttention` produce every count and every "needs attention" list.
- `liveSessionsOnMachine` decides which sessions belong to a machine, on either transport.

No surface may switch over raw statuses to pick a colour, a label or an order.

### One name and one count per machine

A machine is called what the Machines tab calls it, everywhere. This computer is "This computer" (`useLocalMachineName`); wherever a session shows its machine (group headings, the session header, previews, the palette) the name comes from `useSessionMachineName` or `sessionMachineName`, and a group heading keeps the host name as its tooltip. A machine's session count is its running sessions (`isActiveLiveSession`) matched by `liveSessionsOnMachine`, so the Machines list, Home and Active agents show the same number.

## Canonical homes

| Entity                             | Canonical home                                                                                    | Other surfaces link to it by                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Machine                            | **Machines tab**                                                                                  | Machine headings in Active agents and Home; the Home machines panel opens the tab.                  |
| Project                            | **Projects** in the sidebar                                                                       | Home and the palette open the project there.                                                        |
| Workspace                          | **Projects** in the sidebar. The **workspace board** is the same cards arranged by workflow lane. | Machines lists a machine's workspaces and opens them; the palette jumps to them.                    |
| Agent session                      | **Active agents** in the sidebar (the list) and **session tabs** (the view)                       | Badges on project rows and workspace cards; rows on Home and Machines; the palette; CLI; Home chat. |
| Subagents, background tasks, todos | The session view's activity panel                                                                 | The status pill (`waiting-subagent`, `waiting-task`) and the row's detail line.                     |
| Terminal                           | The workspace's tabs                                                                              | Machines counts them; a Seal-launched session's menu jumps to its pane.                             |
| Work item                          | **Tasks** page                                                                                    | Workspace cards show the linked issue or PR.                                                        |

### Shared building blocks

Anything that shows a session uses these and nothing else.

| Piece                   | File (under `src/renderer/src/components/live-sessions/` unless noted)                | Use                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Registry hook           | `live-session-registry-store.ts` (`useLiveSessions`)                                  | The only source of sessions in the window.                         |
| Status pill             | `status/LiveSessionStatusPill.tsx`                                                    | Every status dot and label.                                        |
| Session row             | `row/LiveSessionRow.tsx`                                                              | One session in any list.                                           |
| Session list            | `row/LiveSessionRows.tsx`                                                             | A plain list of rows with the shared state, open handler and menu. |
| Row state               | `row/use-live-session-row-state.ts`                                                   | Workspace name, account, unread and current markers for a row.     |
| Menu                    | `menu/LiveSessionMenuItems.tsx`, `menu/live-session-menu-effects.ts`                  | Open, rename, pin, take over, stop, delete.                        |
| Open                    | `openLiveSessionFromRow`, `openLiveSessionView` (`menu/live-session-menu-effects.ts`) | Click previews, double-click pins a tab.                           |
| Confirmations           | `menu/live-session-dialog-store.ts`, `menu/LiveSessionDialogs.tsx`                    | Stop and delete confirm once, from anywhere.                       |
| Workspace/project badge | `links/LiveSessionsBadge.tsx`, `links/use-live-session-links.ts`                      | Count and top status of a workspace's or project's sessions.       |
| By-machine grouping     | `active-agents/active-agents-model.ts` (`buildActiveAgents`)                          | Active agents and Home.                                            |
| Workspace card          | `sidebar/workspace-card/surface/WorktreeCard.tsx`                                     | Sidebar and board render the same card and the same context menu.  |

## Flows

### Starting an agent

Every entry point ends in the same place: an agent running in a pane of a workspace, which the registry reports as one session with a `seal-pane` route.

| Entry point                                         | What it does                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Project **+**                                       | Opens the composer in agent-session mode: runs in the project folder, or in a new worktree if you tick the toggle. |
| Sidebar header **+**, board lane **+**              | Opens the same composer in workspace mode (the board presets the lane).                                            |
| Agent button in a workspace's tab bar               | Launches into a new pane of that workspace.                                                                        |
| `seal agent launch`, `seal worktree create --agent` | The same launch over RPC.                                                                                          |
| Home chat `start_session`                           | Runs those CLI commands.                                                                                           |

Once the agent starts, the session appears, without any surface adding it, in Active agents under its machine, on the workspace card's badge (sidebar and board), on the project row's badge, on Home, on the machine's page, in the palette, in `seal sessions list` and on mobile.

### Opening a session

`openLiveSessionView(sessionId, mode)` is the only way to open one. A click or Enter previews; a double-click pins a tab. A badge on a workspace or project scopes Active agents to that workspace or project instead of opening its own list.

### Stopping and deleting

- **Session**: every menu is `LiveSessionMenuItems`. Stop and delete go through `liveSessionMenuEffects.confirm` → `liveSessionDialogStore` → `window.api.liveSessions.remove`. Home chat and the CLI call the same service in main.
- **Workspace**: the sidebar card and the board card are the same component with the same context menu, so delete runs the one deletion flow (`sidebar/workspace-actions/deletion/`). Deleting a workspace closes its panes; sessions that ran there end and move to "Recently finished".

### Board, Active agents and Projects

- A board card **is** the workspace card. A lane is the workspace's workflow status (todo, in progress, in review, done), which you set. It is not agent activity.
- Agent activity on a card is the sessions badge, from the same registry and status model as Active agents. Clicking it scopes Active agents to that workspace.
- So the three views answer three questions about the same records: Projects, "what do I have?"; the board, "where is each workspace in my process?"; Active agents, "what is running right now, and what needs me?".

## Per-surface rules

| Surface          | Shows                                                                                                                                                                             | Must not                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Projects sidebar | Projects and workspace cards with session badges.                                                                                                                                 | List sessions under a workspace.                                                          |
| Active agents    | Every running session by machine, plus recently finished.                                                                                                                         | —                                                                                         |
| Workspace board  | Workspace cards by lane.                                                                                                                                                          | Derive lanes from agent state, or draw its own card.                                      |
| Home             | Counts, a "needs attention" strip and a by-machine list, all built from registry rows.                                                                                            | Keep its own session type, status mapping or click handler.                               |
| Machines tab     | A machine's resources, workspaces, terminals and its sessions as rows.                                                                                                            | Match sessions to machines with its own rules.                                            |
| Tabs and panes   | The running terminal of a Seal-launched session; session tabs for the session view.                                                                                               | Present a pane's agent as a separate session.                                             |
| Command palette  | Sessions from the registry (`palette/live-session-palette-source.tsx`), opening through `openLiveSessionView`.                                                                    | Add actions the menu does not have.                                                       |
| Mobile           | Workspaces with pane agents today; the Sessions screen (branch `seal/mobile`) reads the same registry over RPC.                                                                   | Interpret statuses itself: import `live-session-status.ts` and `live-session-summary.ts`. |
| CLI              | `seal sessions list` prints the registry grouped and ordered as Active agents. `seal agent launch` starts a session.                                                              | Format its own ordering.                                                                  |
| Home chat tools  | `list_sessions`, `read_session`, `message_session`, `take_over_session` over the live-session service; `start_session` over the CLI launch; `open_in_seal` reveals Active agents. | Reach around the service.                                                                 |

## Duplication audit

What the audit found on `seal/all` before this model, and what happened to each.

| #   | Duplication or contradiction                                                                                                                                                                                                                | Resolution                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Three session lists: the Agent Sessions page, the sidebar's Activity "agents" list (bell) and inline agent rows under each workspace card. Each had its own rows, order and menu.                                                           | One list: Active agents. The page and the bell are gone; cards show a badge.                                           |
| 2   | Home had its own session type (`HomeSession`), its own state names and dot colours, and merged pane agents with registry sessions, so a Seal-launched Claude could appear twice.                                                            | Home renders registry rows with the shared row, pill and grouping.                                                     |
| 3   | Home's "Sessions" link opened the Agent Sessions page; the sidebar bell opened a different list of the same agents.                                                                                                                         | Both lead to Active agents.                                                                                            |
| 4   | The Machines tab listed "agent sessions" from pane status with its own row, so external sessions running on that machine were missing and a row had none of the session actions.                                                            | Machines renders registry rows; `liveSessionsOnMachine` decides which are the machine's.                               |
| 5   | Four status vocabularies: the registry's statuses, Home's states, the Agent Dashboard's states and the workspace card's dot.                                                                                                                | One module, `live-session-status.ts`. Pane status remains only for agents without a session record.                    |
| 6   | The experimental Agent Dashboard drawer was a fourth list of the same agents.                                                                                                                                                               | Retired: the toggle is removed and an earlier opt-in is cleared on load. Upstream modules stay for merge-friendliness. |
| 7   | The upstream Activity page was reachable only from Home chat's `open_in_seal`, and showed a fifth view.                                                                                                                                     | `open_in_seal` reveals Active agents.                                                                                  |
| 8   | Project **+** created a workspace while the header **+** did the same; nothing started "an agent here".                                                                                                                                     | Project **+** is "New agent session" with an optional worktree (`seal/projects-fixes`).                                |
| 9   | Stopping an agent meant different things: closing a pane, the Sessions page's remove, the dashboard's dismiss.                                                                                                                              | One menu and one confirmation for sessions; closing a pane still ends what runs in it.                                 |
| 10  | The board and the sidebar agreed on the card but disagreed on activity: the sidebar listed agents inline, the board hid them.                                                                                                               | Same card and the same badge in both.                                                                                  |
| 11  | The CLI could launch an agent but had no way to list sessions; `seal account sessions` lists a different thing (the account vault's ledger).                                                                                                | `seal sessions list` reads the registry.                                                                               |
| 12  | Mobile (branch `seal/mobile`) has its own switch over statuses.                                                                                                                                                                             | Rule above; to be applied when that branch merges.                                                                     |
| 13  | This computer had three names ("This computer" on Machines, "Local Linux" on Home, its host name in Active agents), and Home counted only busy sessions as a machine's "active" while Machines and Active agents counted every running one. | One name (`useLocalMachineName`) and one count (`liveSessionsOnMachine` over running sessions).                        |

## Known boundaries

- The registry knows Claude Code and Codex. Other agents stay pane-only until they gain a session source; when they do, they join the registry rather than a new list.
- "Task" means two things: a session's background tasks, and work items on the Tasks page. They are unrelated records.
- `seal account sessions` is the account vault's ledger of which account each launched session used. It has its own ids and is not a list of running agents.
- Upstream Orca modules for the Activity list and the Agent Dashboard are unmounted, not deleted, so upstream merges stay cheap ([UPSTREAM.md](./UPSTREAM.md)).
