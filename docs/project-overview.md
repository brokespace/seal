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

- The chevron is a real button (`aria-expanded`, labelled "Collapse project" / "Expand project"). It was a hover-only, `aria-hidden` glyph while the whole row toggled; now that the row navigates, the fold needs its own target. It sits at the right edge of the header and is always visible, so a folded list is never a surprise and the fold never hides behind hover; the hover actions (`⋯`, `+`) appear to its left. A header that shows the sessions badge makes room for them at the end of its title while they show (the pointer over the header, focus on one of them, or their menu open), so they never cover the badge; at rest the name has that room. The name cannot be selected as text, so a drag only moves the project. Headers keep their indent, icon and upstream's layout.
- The name is the link, and looks like one: over it the cursor is a pointer, the name underlines (the sidebar's text-link hover, as on a workspace card's reference title) and a tooltip says "Open project overview". The rest of the row still opens the overview on a click, but it is also where a drag to reorder starts, so it keeps the grab cursor; the name takes the grab cursor too once a drag is under way. On a project that lives on several machines the row's own tooltip (name and machine) gives way to the name's while the pointer is over the name.
- Only project headers change. Project groups, status sections, Pinned and "All" have no overview and keep folding on click.
- The header of the project whose overview is open is the current row (`aria-current="page"`, `bg-worktree-sidebar-accent`), the same as any other current sidebar row.
- A press that starts on the chevron or a hover action and is released elsewhere on the header does nothing: it neither folds nor navigates.
- A project registered on several machines has one header per machine. Each opens the overview for that machine's registration; the overview lists every registration under "Location".

## Navigation model

`'project'` is a top-level view (`TopLevelView`), like `'machines'` or `'sessions'`. The UI slice carries `projectOverviewTarget: { repoId, hostId } | null` with `openProjectOverview(repo)` and `closeProjectOverview()`, following the `previousViewBefore…` pattern of every other page. The target is host-scoped because two machines may register the same repo id.

- `activeView` is persisted; the target is kept in `localStorage` next to it, so a reload lands back on the same overview.
- A target whose project is gone (removed, or its machine forgotten) renders an empty state with a way back; it never blanks the main surface.
- `Esc` goes back to the view the overview was opened from. There is no close button: like Home and Machines, the page is a destination reached from the sidebar, and the sidebar stays visible. The `Esc` that closes Settings opened from the page lands on the page; it does not also close it.
- `Esc` works while a tooltip or a hover preview is showing. Radix marks the press that closes one as handled, the same as one a dialog took, so the page-level handlers (`useMobilePageEscape`, Settings, Artifacts) ask `isEscapeHandledAbovePage` (`lib/overlay-interaction/hover-layer-escape.ts`) instead of reading `defaultPrevented`: a press only a tooltip or a hover card took still closes the page, unless a dialog or menu is open under it or a control took the press.
- A list that is part of a page is not a popup. `hasVisibleOverlay` counts every `role="listbox"` as an open popup unless it carries `data-focus-behavior="page"`, so the session lists (`LiveSessionRows`, Active agents) carry it. Without it the Agents card kept `Esc` from closing the page while a tooltip showed, and an expanded Active agents section kept the sidebar's arrow keys from moving.
- Opening an agent from the page replaces it with the session view. The session tab strip then starts with "Back to <project>", which returns to the page (`closeAgentSessionTabs`); it stays while the session view is the one entered from the overview. Closing tabs leads back too (`closeLiveSessionView`): closing the last tab returns to the page, and so does closing the session on screen when it was the last tab opened from the overview, even with tabs from before still in the strip. A tab closed in the background, or beside a split, leaves the view where it is. In a narrow column the label shortens and then gives way to the arrow, so the tabs keep their room.
- Two closable pages opened from each other (Tasks and Automations, or the overview and Tasks) still lead back to each other on `Esc`: that is the shared `previousViewBefore…` pattern every page uses, and it is not changed here.
- The way back never loops. An overview opened from a session that the overview itself opened keeps its own way out, and a session opened from an overview that a session opened leads back past that session (`openAgentSessionTabs`, `openProjectOverview`), so `Esc` and Back always end on the view the round started from.
- The right sidebar is hidden on the page (it describes the active workspace, which the page is not about).

## Layout

The page is Home's layout with a project scope, built from `components/page-layout/` only:

```
PageLayout
  PageHeader   [icon] Name · 2 working · 1 blocked on you · …    [New agent] [Open in …▾] [⋯]
  PageScrollContent
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

| Section             | Shows                                                                                                                                                                                                                                              | Reuses                                                                                                                                                | Click                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Agents              | Running sessions grouped by machine, then the ones that ended in the last day, each with its status dot and label, AI summary and recap. The header says "N active", the sidebar's word for the same sessions; Recently finished has its own count | `buildActiveAgents` with the project scope, `LiveSessionMachineGroups` (extracted from Home's Sessions card), `LiveSessionRows` in the `card` layout  | Opens the session; the row menu is the shared session menu                                                                         |
| Workspaces          | Every worktree or folder workspace of the project, in the sidebar's order                                                                                                                                                                          | `WorktreeCard`, with its own context menu; `rankWorktreesForSort`, `orderMainWorktreeFirst` and `buildWorktreeOccurrencePlan`, the sidebar's ordering | Opens the workspace (click, or `Enter`/`Space` on the focused card); right-click or the menu key manages it (rename, pin, delete…) |
| Agent configuration | Instructions, skills, MCP servers, plugins and settings the project gives its agents                                                                                                                                                               | `ProjectAgentConfigPanel` (the body of the project Settings section) around `AgentConfigPanel`                                                        | Edits in place; "Edit in settings" opens the project's pane at its Agent configuration section                                     |
| README              | The project's README, rendered, in a capped box, re-read every 15 s                                                                                                                                                                                | `window.api.machines.listDir` and `readFile`, `MarkdownPreview`                                                                                       | "Open" opens it in the editor                                                                                                      |
| Location            | Path and machine of each registration, kind, default base branch, fork parent                                                                                                                                                                      | `useMachinesInventory`, `getRepoExecutionHostId`                                                                                                      | Copy path, reveal in the file manager, open the machine                                                                            |
| Changes             | Per workspace: branch, files changed with lines added and removed, how many are staged, untracked or conflicted, ahead/behind its upstream; re-read every 5 s                                                                                      | `getRuntimeGitStatus` through `resolveDeleteTargetGitContext`, the store's `gitStatusByWorktree` when already loaded                                  | Opens the workspace                                                                                                                |
| Pull requests       | Open pull requests of the repository, naming the workspace on each one's branch; a read that fails says so instead of reading as none                                                                                                              | `fetchWorkItems`, `openAppHttpLink`                                                                                                                   | Opens the pull request                                                                                                             |
| Recent commits      | The last commits on the primary checkout, with author and age: the project's code timeline                                                                                                                                                         | `getRuntimeGitHistory`                                                                                                                                | —                                                                                                                                  |
| Usage               | Sessions, tokens and estimated cost in the last 30 days for Claude and Codex, summed over the project's workspaces                                                                                                                                 | `window.api.claudeUsage` / `codexUsage` snapshots, `formatTokens`, `formatCost`                                                                       | "Details" opens Stats                                                                                                              |

Header actions:

- **New agent**: `openHeaderCreateComposer`, the sidebar `+`. The composer already picks the agent (provider), account, machine and base branch, so the page does not grow a second launcher.
- **Open in editor**: `MachineEditorButton` and `openMachinePathInEditor`, the same button the Machines page uses, so a project on an SSH machine opens over Remote SSH and a server-only machine explains why it cannot.
- **`⋯`**: open a terminal on the project's machine, reveal in the file manager (local projects), copy path, project settings.

### Workspace order and keyboard

- The list follows the sidebar (`use-project-worktrees.ts`): the same sort mode (`sortBy`), ranked by the sidebar's own `rankWorktreesForSort`, with the main checkout first unless the order is Manual. Changes lists the first twelve in that order.
- The ranking is held between the sidebar's sort epochs, as the sidebar holds its own: a rename or new activity does not move a card until the sidebar re-ranks, and a workspace created in between is listed last.
- A workspace created from another one comes right after its parent, where the sidebar nests it (`getSidebarLineageChildren` and `buildWorktreeOccurrencePlan`, the sidebar's own). Outside Manual the family stands where its first-ranked member ranks: a child that ranks ahead of its parent pulls the parent up to it (`addVisibleLineageAncestors`, the sidebar's own step); in Manual the parent's place stands. The page has no Pinned section, so a pinned workspace stays in its place.
- A card outside the sidebar's listbox is its own tab stop (`affiliateListMode` in `worktree-card-surface.tsx`): `Tab` reaches it, `Enter` or `Space` opens the workspace, the menu key opens its context menu, and it shows the focus ring. Closing that menu puts focus back on the card. A folder workspace's list of worktrees gets the same.

### Live cards

Changes and README stay current without a control, the way the Machines page keeps its details live: `useProjectOverviewLoad` takes an interval and repeats the read through `installWindowVisibilityInterval` (paused while the window is hidden, four times slower while it is unfocused). A repeat never overlaps the one before it, and one that fails keeps the last answer on screen. A repeat replaces the rows in place. Changes is keyed by which workspaces it lists, not by their order or head, and keeps the rows it has read while a changed list is read again (`keepLast`): a commit, a branch switch that re-sorts the list, or a workspace added or removed never blanks the card; only a new workspace's own row says "Reading…" until its first answer. A workspace whose read fails (git reports an error, as while `.git` is being rewritten, or its machine drops off) keeps the last answer it gave, followed by its age ("3 files changed · as of 2m ago"); the age is the time from that answer to the latest failed read, and it goes away with the next read that succeeds. The last answers are kept for the app's run, so leaving the page and coming back while git still fails shows them too. "Status unavailable" is left for a workspace that has given no answer at all. The README's directory listing is read fresh each time (`force`), so an added or deleted README shows on the next read. Recent commits and Pull requests are still read once per visit and when the checkout's head moves.

### Sessions and status

Session status is not interpreted on this page; it is `LiveSession.status` as [session-status.md](./session-status.md) defines it, drawn by the components Home uses:

- Rows are `LiveSessionRow`s in the `card` layout, through `LiveSessionMachineGroups`, the list Home's Sessions card renders. Each leads with the large `LiveSessionStatusDot` and carries the status label from `liveSessionStatusText`, so a session shows the same dot, color and words here, on Home and in Active agents.
- The header line is `useLiveSessionCountsLine`, shared with Home: "N working · N blocked on you · N waiting on you · N idle", counted over the project's running sessions only. The header also holds the page's actions, so a long project name truncates and, on a page under 60rem, the line gives way to the name (the Agents card below says the same). On a page too narrow for the name and the actions side by side, the actions drop under the name, and the editor button drops its label by the header's own width (the shared button goes by the window's, which the sidebar makes too generous here).
- Running or finished is `isActiveLiveSession`, the shared rule: a session at a permission prompt or a question is running even when its process was not seen, so it is never under "Recently finished". A prompt or a "working" left in an agent's hook file by an agent that was killed no longer counts: the scan reads the session as ended once the host's process list shows the agent gone.
- There is no separate "needs attention" strip. Home dropped it when the large dots arrived: a session that blocks on the user sorts first and wears a haloed dot.

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

- Store: opening, reopening for another project, closing back to the previous view, restoring the target after a reload, and the way out of a session and an overview that opened each other. Session tabs: which closed tab ends a visit from the overview (`live-session-tabs-store.test.ts`).
- Sidebar header: clicking the name opens the overview and leaves the fold alone; the chevron folds and does not navigate; group and status headers still fold.
- Models: which sessions and workspaces belong to a project, the order the sidebar's sort mode gives them, a child after its parent, the order held until the sidebar ranks again, the change summary of a git status, usage summed over a project's workspaces.
- Shared: a prompt or a question with no process seen still needs attention (`live-session-summary.test.ts`); a hook that outlived its agent ends the session (`session-assembly.test.ts`, and against the real `ps` in `host-session-scanner.test.ts`); an Escape that only closed a tooltip closes the page (`use-mobile-page-escape.test.tsx`).
- Page: the project's agents are listed and open their session; "New agent" opens the composer for the project; a missing project shows the empty state.
- Real app (Playwright over the e2e build): click a project name, see the overview, fold with the chevron, open an agent, start a new agent.
