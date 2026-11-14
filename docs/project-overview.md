# Project overview

A page for one project: where it lives, what state its code is in, which agents are working in it, and how its agents are configured. Clicking a project's name in the Projects sidebar opens it.

## Why

A project header in the sidebar was only a fold. Everything known about a project was spread over other surfaces: its path in Settings, its agents in Active agents, its branches on each workspace card, its skills and MCP servers in the project's Settings pane, its cost in Stats. The overview puts those side by side for one project and adds nothing new to keep in sync: every section reads a record that already exists and uses the component that already draws it.

## Opening it

| Gesture on a project header                 | Result                                     |
| ------------------------------------------- | ------------------------------------------ |
| Click the name or the row                   | Opens the project's overview               |
| Click the chevron                           | Folds or unfolds the project's workspaces  |
| Alt/Option-click the chevron                | Folds or unfolds every project (unchanged) |
| `Enter` on the focused header               | Opens the overview                         |
| `Space` on the focused header               | Folds or unfolds                           |
| "Project Overview" in the header's `⋯` menu | Opens the overview                         |
| Drag, `+`, `⋯`, session badge               | Unchanged                                  |

- The chevron is a real button (`aria-expanded`, labelled "Collapse project" / "Expand project"). It was a hover-only, `aria-hidden` glyph while the whole row toggled; now that the row navigates, the fold needs its own target. It sits at the right edge of the header and is always visible, so a folded list is never a surprise and the fold never hides behind hover; the hover actions (`⋯`, `+`) appear to its left. Headers keep their indent, icon and upstream's layout.
- Only project headers change. Project groups, status sections, Pinned and "All" have no overview and keep folding on click.
- The header of the project whose overview is open is the current row (`aria-current="page"`, `bg-worktree-sidebar-accent`), the same as any other current sidebar row.
- A project registered on several machines has one header per machine. Each opens the overview for that machine's registration; the overview lists every registration under "Location".

## Navigation model

`'project'` is a top-level view (`TopLevelView`), like `'machines'` or `'sessions'`. The UI slice carries `projectOverviewTarget: { repoId, hostId } | null` with `openProjectOverview(repo)` and `closeProjectOverview()`, following the `previousViewBefore…` pattern of every other page. The target is host-scoped because two machines may register the same repo id.

- `activeView` is persisted; the target is kept in `localStorage` next to it, so a reload lands back on the same overview.
- A target whose project is gone (removed, or its machine forgotten) renders an empty state with a way back; it never blanks the main surface.
- `Esc` goes back to the view the overview was opened from. There is no close button: like Home and Machines, the page is a destination reached from the sidebar, and the sidebar stays visible.
- The right sidebar is hidden on the page (it describes the active workspace, which the page is not about).

## Layout

The page is Home's layout with a project scope, built from `components/page-layout/` only:

```
PageLayout
  PageHeader   [icon] Name · 2 working · 1 waiting on you        [New agent] [Open in …▾] [⋯]
  PageScrollContent
    Needs attention strip                     (HomeAttentionStrip)
    grid: minmax(0,1fr) | 20rem               (same container query as Home)
      main column                             side column (PageCardGrid)
        Agents                                  Location
        Workspaces                              Changes
        Agent configuration                     Pull requests
        README                                  Recent commits
                                                Usage
```

Below 56rem of page width the side column drops under the main column, as on Home.

## Sections

Each section is one `PageCard`. A section with nothing to say for this kind of project is left out rather than drawn empty (a folder project has no branch, changes, pull requests or commits).

| Section             | Shows                                                                                                                          | Reuses                                                                                                                          | Click                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Needs attention     | The project's sessions that are blocked on the user or failed                                                                  | `HomeAttentionStrip`, `liveSessionsNeedingAttention`                                                                            | Opens the session                                                  |
| Agents              | Running sessions grouped by machine, then the ones that ended in the last day, each with its status pill, AI summary and recap | `buildActiveAgents` with the project scope, `LiveSessionMachineGroups` (extracted from Home's Sessions card), `LiveSessionRows` | Opens the session; the row menu is the shared session menu         |
| Workspaces          | Every worktree or folder workspace of the project                                                                              | `WorktreeCard`, with its own context menu                                                                                       | Opens the workspace; right-click manages it (rename, pin, delete…) |
| Agent configuration | Instructions, skills, MCP servers, plugins and settings the project gives its agents                                           | `ProjectAgentConfigPanel` (the body of the project Settings section) around `AgentConfigPanel`                                  | Edits in place; "Edit in settings" opens the project's pane        |
| README              | The project's README, rendered, in a capped box                                                                                | `window.api.machines.readFile`, `MarkdownPreview`                                                                               | "Open" opens it in the editor                                      |
| Location            | Path and machine of each registration, kind, default base branch, fork parent                                                  | `useMachinesInventory`, `getRepoExecutionHostId`                                                                                | Copy path, reveal in the file manager, open the machine            |
| Changes             | Per workspace: branch, files changed (staged, unstaged, untracked, conflicted), ahead/behind its upstream                      | `getRuntimeGitStatus` through `resolveDeleteTargetGitContext`, the store's `gitStatusByWorktree` when already loaded            | Opens the workspace                                                |
| Pull requests       | Open pull requests of the repository, and the ones linked to its workspaces                                                    | `fetchWorkItems`, `openAppHttpLink`                                                                                             | Opens the pull request                                             |
| Recent commits      | The last commits on the primary checkout, with author and age: the project's code timeline                                     | `getRuntimeGitHistory`                                                                                                          | —                                                                  |
| Usage               | Sessions, tokens and estimated cost in the last 30 days for Claude and Codex, summed over the project's workspaces             | `window.api.claudeUsage` / `codexUsage` snapshots, `formatTokens`, `formatCost`                                                 | "Details" opens Stats                                              |

Header actions:

- **New agent**: `openHeaderCreateComposer`, the sidebar `+`. The composer already picks the agent (provider), account, machine and base branch, so the page does not grow a second launcher.
- **Open in editor**: `MachineEditorButton` and `openMachinePathInEditor`, the same button the Machines page uses, so a project on an SSH machine opens over Remote SSH and a server-only machine explains why it cannot.
- **`⋯`**: open a terminal on the project's machine, reveal in the file manager (local projects), copy path, project settings.

### Sessions and status

Session status is not interpreted on this page. Rows are `LiveSessionRow`s with `LiveSessionStatusPill`; the header summary uses `countLiveSessionGroups`; the attention strip uses `liveSessionsNeedingAttention`. All of them sit on `src/shared/live-sessions/live-session-status.ts`. When the shared status dots and detection from `seal/session-status` land, they replace what those components draw and this page changes with Home, with no edit here.

Which sessions belong to a project is `useLiveSessionLinks()`, the same linking the sidebar badge and the Active agents scope use, so the three always agree on the count.

### Skills, MCP servers, plugins

The page does not read skills or MCP servers itself. It mounts the project agent-configuration panel, whose snapshot comes from `window.api.agentConfig`. A fix to skill discovery (`seal/fix-skills-config`) changes that snapshot and so shows up here and in Settings together.

## Considered and left out

- **A separate session timeline.** The information architecture gives each session one row. Agents (running, then recently finished, each with summary and recap) plus Recent commits already read as the project's timeline; a third list of the same sessions would break the one-row rule.
- **A per-project notes field.** There is no project note record, and adding one means a new persisted field, sync and mobile work. Workspace comments already show on the workspace cards; the README covers the project's own description.
- **A second "choose provider / account" launcher.** The composer owns that choice.
- **Worktree management buttons on the page.** `WorktreeCard`'s context menu already carries every action; repeating them as buttons would duplicate handlers and clutter the list.
- **Per-file diffs.** Source Control owns them. Changes shows counts and links into the workspace.
- **Usage for remote projects.** Usage logs are scanned on this computer only, so the card says so instead of showing zero.

## Cross-platform, remote, folders, mobile

- Paths are shown as stored and never parsed with `/`; path joins for the README use `joinMachinePath`.
- Git reads go through the runtime git client, so local, WSL, SSH and Seal-server projects all work; a machine that is offline shows "not connected" in the affected cards and the rest of the page still renders.
- Folder projects are not git repositories: the git cards are omitted and "Workspaces" lists the folder workspace.
- The page is desktop renderer only. The mobile app has its own project screens and is unchanged; the new view kind is added to the shared view validators so paired clients accept it.

## Tests

- Store: opening, reopening for another project, closing back to the previous view, and restoring the target after a reload.
- Sidebar header: clicking the name opens the overview and leaves the fold alone; the chevron folds and does not navigate; group and status headers still fold.
- Models: which sessions and workspaces belong to a project, the change summary of a git status, usage summed over a project's workspaces.
- Page: the project's agents are listed and open their session; "New agent" opens the composer for the project; a missing project shows the empty state.
- Real app (Playwright over the e2e build): click a project name, see the overview, fold with the chevron, open an agent, start a new agent.
