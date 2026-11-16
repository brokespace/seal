# Split view: several workspaces, agents and projects side by side

Status: **implemented.** Built on branch `cursor/multi-pane-workspace-906c` from the build plan below. [As built](#as-built) records the results of the three build gates, the answers used for the open questions, where the build differs from this text, the touch points on the agent-session page, and what is still open. The rest of this document is the reviewed design, unchanged: the designer's draft was reviewed against the code on `seal/all` at `51496ea453d` (the merge of PR #45), and [Review](#review) lists every finding and how this document resolves it.

How far to trust it: every line of the [End-to-end test plan](#end-to-end-test-plan) was run in the real app by eight parallel testers, in several rounds, each on its own hidden app instance with real mouse and keyboard input. The pull request carries the results per lane.

## The ask

> I want a way so that I can basically take any of my active agents or workspaces and sort of open them up in tabs. […] Say like one workspace in the top left, another in the top right, another agent session in the bottom right. […] I could drag and drop everything everywhere, and I can resize them. I can fully like multiplex. […] I can select in the left hand sidebar, just drag it up into a position. That would actually be best.

Today the main area shows exactly one thing: one workspace (with its own terminal, editor and browser tabs), or the agent-session page, or one project's overview. This design lets the main area show several of those at once in a resizable grid. Every cell of the grid has its own tab strip, and cells are filled by dragging rows out of the left sidebar.

## Vocabulary

| Term             | Meaning                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Item**         | Something the sidebar opens: a **workspace** (git worktree or folder workspace), an **agent session** (a row in Active agents), or a **project** (its overview page). |
| **Pane**         | One rectangle of the grid. It has a strip of chips and shows the active one.                                                                                          |
| **Chip**         | One item in a pane's strip. Called a chip here only to keep it apart from a workspace's own tabs; in the UI it is a tab.                                              |
| **Split view**   | The grid of panes. It exists while two or more chips are open in it; otherwise the main area is exactly what it is today.                                             |
| **Focused pane** | The pane that keyboard input and the rest of the app (sidebar highlight, right sidebar, shortcuts) follow.                                                            |
| **Visible**      | A workspace is visible when it is the active chip of a pane that is on screen. Several workspaces can be visible; at most one is focused.                             |
| **Current item** | What the app's existing state says it is showing: the active workspace, the active session tab, or the open project, according to `activeView`.                       |

A workspace's own tabs and its own splits (terminals, editors, browsers, agent chats) are untouched and keep working inside the pane that shows that workspace. Split view is one level above them: it arranges whole workspaces, sessions and projects.

## Where it lives: the existing main area, not a new page

Split view is a mode of the existing main area. There is no new page, no new sidebar destination and no new `TopLevelView`.

- It is what was asked for ("just drag it up into a position. That would actually be best").
- A separate page would be a second home for the same workspaces and sessions. `docs/information-architecture.md` rules that out: each thing has one record, one canonical home and one set of handlers.
- It costs nothing when unused. With no split view the main area renders today's components unchanged.
- The other pages (Home, Settings, Machines, Tasks and so on) are not items and never enter the grid. Visiting one hides the grid; returning to a workspace, session or project shows it again as it was left.

## What the main area renders

This section is the fix for the review's main blocker. Today the retained workbench (the one component that owns every workspace's terminals, editors and browsers) is on screen only while `activeView === 'terminal'` and a workspace is active. Focusing a session or project pane sets `activeView` to `sessions` or `project`, so without the rules below every workspace pane would disappear the moment focus left it.

One derived boolean, **`splitViewShowing`**, decides the composition. It is true when all of these hold:

1. the split-view store has a layout (two or more chips);
2. `activeView` is `terminal`, `sessions` or `project`;
3. the workspace-creation surface is not showing (`selectWorktreeCreationSurfaceShown`).

Which pane is focused, and what kind of item it holds, is not part of the condition.

| Part of the main area                                                                     | Single view (today, unchanged)                                                                | While `splitViewShowing`                                                                                                               |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Titlebar                                                                                  | Workspace chrome (tab strips reach the top) for a workspace; the standard row for other pages | Always the standard titlebar row                                                                                                       |
| Workbench container (`TerminalWorkbenchContainer`)                                        | On screen only for `terminal` with an active workspace; otherwise `hidden` and `inert`        | On screen and not `inert`, whichever pane is focused                                                                                   |
| Workspace surfaces                                                                        | The active workspace fills the area; every other mounted workspace is hidden                  | Every visible workspace is shown over its pane's slot; every other mounted workspace is hidden as today                                |
| The page (`ActivePage`: `LiveSessionWorkspace`, `ProjectOverviewPage`, the Home fallback) | Rendered according to `activeView`                                                            | Not rendered for `terminal`, `sessions` or `project`. Session and project content is rendered by the grid, inside panes                |
| Grid layer                                                                                | Not mounted                                                                                   | Mounted over the workbench: pane strips, splitters, session and project pane bodies, placeholders, and empty slots for workspace panes |
| Right sidebar                                                                             | Per view (shown for `terminal` and `sessions`, hidden for `project`)                          | Shown if open, whichever pane is focused, so moving focus never resizes the grid                                                       |

Rules that follow from the table:

- **Whether a workspace is visible never depends on `activeView`.** In split view it is decided by the slot map alone. The places that test `activeView === 'terminal'` for visibility today are listed in [Visible and focused](#visible-and-focused).
- **`workspaceChromeActive` is split into two facts.** Today `use-app-chrome-layout.ts` uses one boolean for both "draw workspace chrome" and "a workspace is what the user is working in". Chrome consumers (titlebar layout, the floating right-sidebar toggle, `terminalWorkbenchVisible`, the titlebar expand button) take the split-view-aware value. Command consumers (`tab.rename` and `workspace.rename` in `app-command-handlers.ts`) keep the original meaning, which stays correct: it is true exactly when a workspace pane is focused.
- **Stacking.** The grid layer's root does not take pointer events. Strips, splitters, session and project pane bodies and placeholders do. A workspace pane's slot is empty and click-through, so the workspace surface beneath it receives the pointer directly.
- **Narrow main area.** When the main area is narrower than two minimum panes (480 px) the grid shows only the focused pane, as if maximized. Workspaces in the other panes are then not visible and follow the hidden-workspace rules.

## Interaction model

### Dragging from the sidebar

Three kinds of sidebar row can be dragged onto the main area:

- a **workspace** card (git worktree or folder workspace),
- an **Active agents** row (agent session),
- a **project** header (the item is that project's overview page).

Other rows are not drag sources for split view: host headers, project-group headers, status and pinned section headers, pending creations, and the inline agent rows that workspace cards show for agents with no session record.

The main area accepts the drag whenever it is showing an item. While the pointer is over it, the pane under the pointer shows a **drop preview**: a tinted rectangle over the half the item would take, or over the whole pane for a tab drop, with a text label ("Split right", "Split down", "Split left", "Split up", "Add as tab").

```
+-----------------------------------+
| strip: drop here = tab at this    |
|        position                   |
+--------+-----------------+--------+
|        |       up        |        |
|        +-----------------+        |
|  left  |     center      | right  |
|        |    (as a tab)   |        |
|        +-----------------+        |
|        |      down       |        |
+--------+-----------------+--------+
```

- **Zones.** The center zone is the inner 40 % × 40 % of the pane. Outside it, the left third of the pane is "left", the right third is "right", and the middle third is "up" above the midline and "down" below it. This is the geometry of the existing `resolveDropZone` with its edge share raised from 10 % to 30 %; corners go to left or right, as they do there. The strip is a separate, precise target for "add as a tab at this position".
- **Single view is one implicit pane.** Before any split exists the grid layer is not mounted. The drop-target module treats the main content area as one pane showing the current item, so the first drop works the same way as every later one.
- Releasing over a zone commits. Releasing anywhere else, or pressing `Esc`, cancels with no change.
- **The first drop creates split view.** What the main area was showing becomes the first pane, and the dropped item becomes the second pane (edge zones) or a second chip (center). If the first pane was the agent-session page, every session tab open on that page comes along as a chip, so no open tab disappears. A two-up on that page becomes two panes.
- **After a drop the dropped item is focused** and is the active chip of its pane. Dropped chips are kept (not previews).
- An item is in the grid at most once. Dropping an item that is already there moves it. A workspace is identified by its worktree id: one workspace surface exists per id, so the same id on a second host is the same item.
- A split is refused, and the zone falls back to "Add as tab", when the pane is too small to halve: under 2 × 240 px wide for left/right, or 2 × 160 px tall for up/down.
- **A multi-selected drag places every dragged workspace.** The sidebar already drags a multi-selection as one gesture with a count badge. All of them land in the target: as chips in that pane for a center or strip drop, or as the chips of one new pane for an edge drop. The row that was grabbed becomes the active chip.
- **Sidebar reordering keeps working.** The same drag reorders while the pointer is over the sidebar and targets panes once it is over the main area. Only one of the two commits.
- **Home accepts a drop as a plain open.** On Home (and on the empty landing shown when no workspace is active) the whole main area is one "Open" zone: dropping an item there does what clicking it does. Without this, a drag from the page the app usually starts on would do nothing. On the other non-item pages (Tasks, Machines, Skills and so on) the main area is not a drop target and drags behave as today.

Drags are pointer-based, like every existing sidebar drag, so one ghost and one set of rules cover all three row kinds. The Projects rows are virtualized (`@tanstack/react-virtual`), which is why the sidebar does not use native HTML5 drags; Active agents rows are not virtualized, they render as an ordinary list in the same scroll container.

**Conflict with the Workspace Board.** Today the first frame of any workspace-card drag opens a ghosted Workspace Board drawer over the main area so the card can be dropped on a status column (`pointer-flush.ts`), and the drawer becomes solid once the pointer enters it. That drawer covers exactly the surface this design drops onto. The rule this design assumes: **wherever the main area is a drop target, a card drag does not open the board by itself.** The board still takes the drop when it is already open (opened first with its toolbar button or the `workspace.openBoard` shortcut), and a workspace's status can still be changed from its context menu. On pages where the main area is not a drop target the drag is unchanged. This removes an existing shortcut, so it is the first [open question for Brian](#open-questions-for-brian).

One detail the rule depends on: a workspace card that is alone in its group is draggable today only because the board preview can open (`use-pointer-drag.ts` returns early otherwise). Being able to drop on a pane must count as a reason to start the drag, or single-card groups could not be dragged into split view at all.

### Without a drag

Every drop has a menu equivalent:

- The workspace card's context menu, the Active agents row's context menu and the project header's actions menu gain **Open in split view ▸ Right / Down / Left / Up / As a tab**, acting on the focused pane. Project headers have no context menu today; their actions are a dropdown (`RepoHeaderProjectActionsMenu`), and the entries go there.
- A chip's context menu has **Move to new pane ▸ Right / Down / Left / Up**, **Close**, **Close others** and **Close pane**. Session chips keep the session's own menu entries as well.
- The session menu's existing **Open in split** places the session in a new pane to the right of the focused pane. See [Agent-session tabs](#agent-session-tabs). From a chip's own menu it splits that chip's pane instead.

### Panes and their strips

Each pane has a 32 px strip, the height of a workspace's tab strip, with one chip per item: an icon (agent icon with its status dot, workspace glyph, or project icon), the title, and a close button. **Maximize** and **Close pane** sit at the right end.

- Clicking a chip shows that item and focuses the pane.
- Middle-click or × closes the chip. Closing destroys nothing: a workspace keeps its terminals running and a session keeps running. The item only leaves the grid.
- An item opened by plain navigation (sidebar click, `Cmd+K`, a notification) goes into the focused pane as a _preview_ chip (italic title) and replaces that pane's previous preview. Agent-session tabs and editor previews already work this way. Double-clicking the chip, dragging it, or opening the item through a split-view menu keeps it. Whether a plain click should add a tab at all, or replace what the pane shows, is the second [open question for Brian](#open-questions-for-brian).
- A workspace pane has two strips: the pane strip, then the workspace's own tab strip. Under the standard titlebar that is 36 + 32 + 32 = 100 px of chrome above a terminal. The pane strip is needed (it says which workspace this is, and it is the drag handle and the close button), so the cost is accepted. The two strips must be told apart at a glance in both themes; the test plan checks this with screenshots.
- **One strip, one chip, everywhere.** The pane strip and the agent-session page's strip are the same component with the same chip. The session page stops having its own strip markup.

### Dragging chips between panes

A chip can be dragged to reorder it within its strip, onto another pane's strip to move it there at that position, or onto any pane's zone to split. The preview and the rules are those of a sidebar drag. Moving the last chip out of a pane closes that pane. In a pane with one chip, dragging the chip moves the pane.

Dragging a pane with several chips as one unit is out of scope, and so is dragging a terminal or editor tab from one workspace into another: those tabs belong to their workspace.

### Resizing

Between two panes sits the splitter that workspaces already use for their tab groups (`ResizeHandle`), with the same hover tint and the same 15 %–85 % clamp. It writes sizes straight to the two panes while dragging and commits the ratio once on release, so a drag saves once. Ratios are stored in the split tree and persisted. The splitter gains no new behavior here: it has no keyboard resizing and no double-click-to-equalize today, and this design does not add them.

### Closing, collapsing, maximizing

- Closing a pane's last chip removes the pane, and its sibling grows into the space. The tree collapses with the tab-group algorithm (`removeGroupLayoutLeaf`).
- **Close pane** closes all of its chips at once.
- When one pane with one chip is left, split view ends and the main area is the ordinary single view of that item. One pane with several chips stays: that is the "open them up in tabs" case with no split.
- **Maximize** (strip button or shortcut) shows one pane across the whole area until toggled back. Nothing closes, and it is not persisted. While maximized, the maximized pane is always the focused one: moving focus to another pane shows that pane maximized instead.

### Focus

Exactly one pane is focused. Its strip has full-strength text and an accent line; the other strips are muted.

**Focus is navigation.** Focusing a pane does what clicking its item in the sidebar does today: that workspace becomes the active workspace, or that session the active session tab, or that project the open project. Everything that already follows "the active thing" therefore follows the focused pane without change: the sidebar highlight, the right sidebar, the window title, the status bar, `Cmd+T`, `Cmd+S`, tab-number shortcuts, zoom and every other workspace shortcut. None of those need to learn about split view. Only the code that decides what is _visible_ does.

What moves focus to a pane:

| Source                                                 | Where it is detected                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pointer down or keyboard focus in a session or project | The pane's body in the grid layer (capture phase)                                                                                                             |
| Pointer down or keyboard focus in a workspace          | The workspace's surface in the workbench (capture phase). The grid layer cannot see these: its slot is click-through                                          |
| Click inside an embedded browser page                  | The existing browser pointer-down channel (`onBrowserPagePointerDown`). Today it is subscribed only for the active workspace; it must cover every visible one |
| Chip click, split-view menu entry, split-view shortcut | The command itself                                                                                                                                            |
| Navigation from anywhere else (sidebar, palette, CLI)  | The settle step in [One invariant](#one-invariant-one-settle-step)                                                                                            |

Unfocused panes stay live: terminals render output and transcripts stream. Keyboard input goes where DOM focus is, and DOM focus is always inside the focused pane because focus entering a pane focuses that pane. For this to hold, code that puts focus somewhere by itself (a terminal focusing on mount or on tab switch, an editor, a composer) stays gated on _focused_, as it is today, never on _visible_.

A pointer press that focuses a pane must not move keyboard focus away from what was pressed: pressing an editor, a second tab group, a browser page or a composer in an unfocused pane leaves focus exactly there.

Two consequences:

- Focusing a workspace pane counts as visiting that workspace: it updates visit order and workspace history, as a sidebar click does.
- **A visible workspace counts as on screen for unread marks.** The app already clears attention for whatever is on screen rather than for whatever is focused: `onScreenWorkspaceIds` covers the active workspace and the floating panel, and every split group in view inside a workspace. Visible workspaces in split view join that list, so a workspace Brian is looking at does not show as unread in the sidebar. Visit order still changes only on focus.

### Navigation into the grid

Anything that navigates (sidebar click, palette, CLI `open`, a notification) lands in the grid by one rule: if the item is already in a pane, that pane gets focus and shows it; otherwise it opens as a preview chip in the focused pane.

Workspace history (`Mod+Alt+Left` / `Right`) keeps its meaning and still covers workspaces only. Going back to a workspace follows the rule above. As today, those two shortcuts do nothing while a session or project is focused.

### Keyboard shortcuts

Registered in the keybinding catalog (`src/shared/keybindings/`) and rebindable in Settings → Shortcuts, in a "Split view" group:

| Action (id)                                       | Title in Settings               | Default             |
| ------------------------------------------------- | ------------------------------- | ------------------- |
| `splitView.focusNextPane`                         | Split view: focus next pane     | `Mod+Alt+ArrowDown` |
| `splitView.focusPreviousPane`                     | Split view: focus previous pane | `Mod+Alt+ArrowUp`   |
| `splitView.toggleMaximize`                        | Split view: maximize / restore  | `Mod+Alt+Enter`     |
| `splitView.moveTabRight`, `splitView.moveTabDown` | Split view: move tab to a pane… | unbound             |
| `splitView.closePane`                             | Split view: close pane          | unbound             |

- The titles carry the "Split view" prefix because the catalog already has "Focus next pane" and "Focus previous pane" (`terminal.focusNextPane`, `Mod+]` / `Mod+[`) for the terminal panes inside one tab.
- "Next" and "previous" follow the split tree in order (first child before second), which reads left to right, top to bottom.
- None of the three defaults is taken in the catalog or in the main-process menu. `Mod+Alt+Left` / `Right` (workspace history) is taken and unchanged.
- The focus and maximize actions must work wherever focus is: they are marked `allowInTerminal` so the "terminal-first" shortcut policy still lets them leave a terminal, and they join `MAIN_PROCESS_INTERCEPTED_ACTIONS` so they work while an embedded browser page has keyboard focus.
- The defaults are the same on every platform. On Linux, `Ctrl+Alt+Up` / `Down` switches desktops on some GNOME setups; workspace history has the same exposure with `Ctrl+Alt+Left` / `Right` today, and all of them can be rebound.

## When things go away

| Event                                                                             | Result                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent session ends                                                                | Its chip stays and shows the transcript with the ended status, as a session tab does today.                                                                                                                                                                                        |
| Agent session is removed from the registry                                        | The chip stays and its pane shows the existing "This session is no longer on its machine" notice. The chip's × closes it. It is not closed silently.                                                                                                                               |
| Agent session is re-identified (resume gives it a new id)                         | The chip follows the rename (`liveSessionRegistryStore.onRename`, in `LiveSessionAppSurface` where the session tabs already follow it).                                                                                                                                            |
| Workspace removed or archived                                                     | Its chip closes. If it was the pane's only chip the pane collapses. If it was the focused item, focus goes to the grid's next chip; the existing "pick a successor workspace" logic (`active-worktree-removal-successor.ts`) must not open a workspace that was never in the grid. |
| Project removed                                                                   | The project's chip and every workspace chip of that project close, with the same focus rule.                                                                                                                                                                                       |
| Workspace asleep                                                                  | The chip stays. Showing it never wakes it. Focusing the pane wakes it through the normal activation path.                                                                                                                                                                          |
| A new workspace is being created                                                  | The creation surface takes the main area and the grid hides, as for any non-item page. When the workspace is created and activated it lands in the focused pane as a preview chip.                                                                                                 |
| Item not resolvable after a restart (remote host offline, catalog not loaded yet) | The pane shows a quiet "not available" placeholder with a Close button and fills in if the item appears. An item is pruned only after this run has seen it exist and then vanish, so slow-loading catalogs never empty a restored layout.                                          |
| Activation refused (workspace missing, folder path blocked)                       | The activation path shows its own message. The pane keeps its chip with the placeholder, and focus returns to the pane that held the current item.                                                                                                                                 |

## Persistence and restore

The split tree with its ratios, each pane's chips and active chip, and the focused pane are saved on every change and restored on launch. They are stored per device in the renderer (`localStorage`, key `seal.splitView.v1`), next to the agent-session tabs (`seal.liveSessionTabs.v1`) and the open project (`seal.projectOverviewTarget`). A window arrangement is local presentation, like sidebar width, and is deliberately not part of the synced workspace session that paired clients read. Remote Web is the same renderer in a browser and keeps its own layout in that browser's storage. The mobile app is a separate client and never shows split view.

- Saved state is parsed defensively: a malformed tree, an unknown item kind, or an item saved twice is dropped rather than trusted.
- Preview flags are not saved; restored chips are kept, as restored session tabs are today.
- A session chip whose session is missing from the saved session tabs is added back to them, so the two stores agree after a crash between two writes.
- On launch the app restores its last view and active item as it does today (`activeView` is persisted and restored). The pane holding that item becomes the focused pane. If the app starts on a non-item page the layout waits, hidden, until an item is opened.
- **Workspace panes other than the focused one.** Only the active workspace is prepared and mounted at launch. Every other restored workspace pane goes through the rule in [Workspaces that are visible but not loaded](#workspaces-that-are-visible-but-not-loaded). The same rule covers a workspace that becomes visible later without being focused.

## How it fits the existing layout

- **Titlebar.** While split view shows, the app uses the standard 36 px titlebar row that every non-workspace page has, so pane strips never dodge window controls and the row does not change when focus moves between pane kinds.
- **A workspace's strip inside a pane.** A workspace's tab strips are window-drag regions today (`[data-terminal-focus-release-surface]` sets `-webkit-app-region: drag`, and Electron's drag hit-testing ignores z-index), and the groups that touch the top corners reserve room for the collapsed-sidebar header and the window controls. Inside a pane the strips must not drag the window and must not reserve that room, and the 4 px drag strip and left seam that `TabGroupSplitLayout` draws around the tree go away. The floating terminal panel already composes the same parts (`WorkspaceTabDragLayer` + `TabGroupSplitNodeTree`) without the main-window chrome; the workspace surface does the same while it is in a slot.
- **Left sidebar.** Unchanged, apart from rows being draggable onto the main area and the new menu entries. It highlights the focused item only.
- **Right sidebar.** Stays where it is and describes the active workspace, which is the last workspace that had focus. That is what the agent-session page already does today. The only change is that a focused project pane no longer hides it.
- **Floating terminal, status bar, dialogs, command palette.** Unchanged.
- **Remote hosts.** A workspace item carries its execution host id and a project item its host id, because neither a worktree id nor a repo id is unique across hosts. A session id already contains its host. Workspace and project items open through the host-aware activation paths, so a grid can mix local and remote items. Pane ids come from `createNonSecureContextUuid`, not `crypto.randomUUID` (the lint rule bans it in the renderer, because Remote Web runs over plain HTTP).
- **Folder workspaces.** A workspace item is any workspace the sidebar lists. Nothing assumes a git worktree; `activateAndRevealWorkspace` already dispatches folder workspaces and worktrees.

## Architecture

### Model

```ts
type SplitViewItem =
  | { kind: 'workspace'; worktreeId: string; hostId: string | null } // identity: worktreeId
  | { kind: 'session'; sessionId: string } // the id embeds its host
  | { kind: 'project'; repoId: string; hostId: string } // identity: hostId + repoId

type SplitViewPane = { tabs: { item: SplitViewItem; preview: boolean }[]; activeKey: string | null }

type SplitViewState = {
  layout: TabGroupLayoutNode | null // leaf.groupId is a pane id; null = no split view
  panes: Record<string, SplitViewPane>
  focusedPaneId: string | null
  maximizedPaneId: string | null // not persisted
}
```

`layout` is the existing `TabGroupLayoutNode` tree from `src/shared/tab-types.ts`, edited with the existing pure operations in `src/shared/workspace-layout/tab-groups/tab-group-layout-tree.ts` (`buildSplitNode`, `replaceLeaf`, `removeGroupLayoutLeaf`, `findSiblingGroupId`, `updateSplitRatio`, `moveGroupLeafBeside`) and `collectTabGroupLayoutGroupIds` from `tab-group-moves.ts`. Those functions take only a tree and group ids. There is no second tree implementation.

State lives in one small external store shaped like `live-session-tabs-store.ts` (a class, `useSyncExternalStore`, `localStorage`). Its transitions are pure functions (place, reveal, activate, move, close, close others, close pane, prune, rename session, set ratio, toggle maximize, parse) so they can be tested with hard-coded trees. Every transition ends in one `settle` step that drops emptied panes, repairs focus, and returns the empty state once a single pane with at most one chip is left.

Split-view code never writes `activeView`, `activeWorktreeId` or any other app-store field. It calls the existing open functions.

### One invariant, one settle step

**Invariant: whenever split view is showing and nothing is mid-change, the current item is the active chip of the focused pane.** "Focus is navigation" is this invariant read in one direction; "navigation lands in the grid" is the other.

Two adapters keep it:

- `navigateToSplitViewItem(item)` calls the canonical open path: `activateAndRevealWorkspace` for a workspace (with `revealInSidebar: false` and `clearSidebarFilters: false`, so focusing a pane does not scroll the sidebar or drop its filters), `openLiveSessionView` for a session, `openProjectOverview` for a project (it takes the repo, resolved with `resolveProjectOverviewRepo`).
- One settle step, started once by the app shell, runs after any change to `activeView`, the active workspace, the session tabs' active id, the open project, or the split-view store.

The settle step, in order:

1. If `splitViewShowing` is false, do nothing. The layout is kept.
2. Read the current item. If there is none (the session page with no active tab, or the workspace view with no active workspace), navigate to the focused pane's active chip.
3. If the current item is the focused pane's active chip, do nothing.
4. If the current item is in the grid, focus its pane and make it that pane's active chip.
5. Otherwise open it in the focused pane as a preview chip, closing that pane's previous preview.

Three rules make this safe. The draft had none of them, and each closes a bug the review found:

- **Settle runs in a microtask, never inside a store notification.** The open paths change state in several synchronous writes: `activateAndRevealWorktreeWithOutcome` calls `setActiveView('terminal')` and then `setActiveWorktree(...)`; `openLiveSessionView` writes the session tabs and then the view. A subscriber that reacted to the first write would see the new view with the _old_ workspace and file that workspace as a chip. Coalescing to a microtask means settle only ever sees the finished state.
- **A grid command does its navigation and its store change in the same synchronous turn.** By the time settle runs, both are final.
- **Closing a chip picks the next focus from the grid and navigates there first, then closes.** The next focus is the neighbouring chip in the same pane, or else the active chip of the sibling pane, preferring an item that can be resolved. Only then is a session's tab closed. Otherwise `liveSessionTabsStore.close` picks the neighbouring session tab by itself, that tab may not be in the grid, and settle would open it as a chip the user never placed.

### Rendering workspaces without remounting terminals

A workspace's terminals, editors and browser webviews are owned by the single retained workbench, which keeps every opened workspace mounted and shows one. Re-parenting them into panes would remount xterm instances and reload webviews, so they do not move. The codebase already solves the same problem one level down: `RetainedPaneHost` keeps terminals and webviews in place and positions them over their tab group's body.

- A pane showing a workspace renders an empty **slot** and registers it with the geometry registry tab groups already use (`registerTabGroupBody` / `subscribeTabGroupBodyRect`). The registry is keyed by a string id; pane ids are UUIDs and cannot collide with tab-group ids.
- The workbench positions each visible workspace surface over its slot by writing `top/left/width/height` from that subscription. No React re-render and no remount on move, resize, split or maximize. Rects are measured relative to the surfaces' container, which fills the same area as the grid.
- The registry measures on resize, not on move. After any change to the split tree the grid asks it to measure again (it needs one exported re-measure call), so a pane that changes place without changing size is still followed.
- Terminals refit by themselves when their surface changes size: each pane has a `ResizeObserver` (`pane-fit-resize-observer.ts`), and `SYNC_FIT_PANES_EVENT` remains the explicit fit for everything listening.
- Agent-session and project panes are ordinary React content inside their pane. They render the inner pieces, not the pages: the session body (`LiveSessionPane`, or the "gone" / "looking for sessions" notice) and the project overview body. Neither has page-level key handlers: the session page has none, and the project page's `Esc` handler lives in `ProjectOverviewPage`, outside the body.

The grid's own tree is drawn by the same recursive renderer as a workspace's tab groups. `TabGroupSplitNodeTree`'s `SplitNode` is turned into a generic split-tree renderer that takes "how to draw a leaf" and "what to do with a new ratio"; `ResizeHandle` requires the two panes to be its previous and next siblings, and that structure then exists once.

### Visible and focused

"Visible" and "focused" become two separate facts. One value, the set of visible workspace ids with the pane each belongs to (`null` in single view), flows from the workbench's foundation hook. In single view the set is exactly today's "the active workspace while `activeView === 'terminal'`", so behaviour without split view does not change.

Everything that tests "is this the active workspace" has to pick one meaning. The rule: **what the user can see and click follows _visible_; what the keyboard and commands act on follows _focused_.**

| Concern                                                                         | Uses                                                 | Where                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbench on screen                                                             | `splitViewShowing`, or single workspace view         | `use-app-chrome-layout.ts` (`terminalWorkbenchVisible`), `TerminalWorkbenchContainer`                                                                                                                                               |
| Workbench wrappers that hide when no workspace is active                        | any workspace visible                                | `TerminalSurface`, `TerminalSplitWorkspaceSurfaces` (outer `div`)                                                                                                                                                                   |
| Which surfaces render, and `inert` / `aria-hidden`                              | visible                                              | `TerminalSplitWorkspaceSurfaces`, `TerminalWorktreeSplitSurface`, `RetainedPaneHost` via its `isVisible`                                                                                                                            |
| Terminal parking and parked-tab watchers                                        | visible                                              | `terminal-parking-pass-candidates.ts`, `use-terminal-parking-pass.ts`, `use-terminal-watcher-effects.ts`, `use-terminal-parking-foundation.ts`, `use-manual-terminal-worktree-parking.ts`                                           |
| Browser webview eviction                                                        | visible (never evict a shown workspace)              | `use-terminal-browser-retention.ts`                                                                                                                                                                                                 |
| Foreground terminal tabs, which protects agents from hibernation                | the active terminal tab of every visible workspace   | `use-terminal-workspace-projection.ts`. Today it is the one active tab plus Activity portals                                                                                                                                        |
| On-screen attention (unread marks, auto-acknowledge)                            | visible                                              | `hooks/agent-auto-ack-targets.ts` (`onScreenWorkspaceIds`, `resolveAutoAckTabTargets`)                                                                                                                                              |
| Dragging a workspace's own tabs                                                 | visible                                              | `WorkspaceTabDragLayer` `enabled`                                                                                                                                                                                                   |
| Clicks inside an embedded browser page                                          | visible                                              | `BrowserPaneOverlayLayer` (the `onBrowserPagePointerDown` subscription)                                                                                                                                                             |
| Editor content rendering                                                        | visible                                              | `TabGroupPanel` → `EditorPanel` `isVisible`                                                                                                                                                                                         |
| Keyboard ownership, shortcut scope, the focused tab group and its accent border | focused                                              | `TabGroupSplitNodeTree` (`isFocused`), `WorkspacePaneOverlayLayers`, `TerminalPaneOverlayLayer`, `StructuredAgentSessionPaneOverlayLayer`, `BrowserPaneOverlayLayer` (Find, the native-chat toggle), `EditorPanel` `isCmdSaveOwner` |
| Putting focus somewhere without a user gesture                                  | focused                                              | terminal, editor and composer auto-focus; `queueWorkspaceActivationTerminalFocus`                                                                                                                                                   |
| Blurring a focused webview on a workspace switch                                | skipped when the target workspace is already visible | `set-active-worktree.ts` (`moveFocusToRendererBeforeFocusedWebviewHidden`). Without the skip, clicking into a page in another pane blurs the page that was just clicked                                                             |
| Full-area notices for the active workspace                                      | confined to that workspace's slot                    | `WslHostStoppedWorkspaceNotice`                                                                                                                                                                                                     |
| Titlebar and chrome                                                             | `splitViewShowing`                                   | `use-app-chrome-layout.ts`, `AppWorkspaceShell.tsx`, `right-sidebar-visibility.ts`                                                                                                                                                  |
| Everything else that reads `activeView === 'terminal'`                          | unchanged (it means "a workspace is focused")        | Tab-number shortcuts, `Cmd+S` target, zoom target, quick actions, workspace IPC shortcuts, history controls, link placement, creation flow                                                                                          |

`isWorktreeActive` is one prop today and means both things. It is passed down as two (`isVisible`, `isFocused`) from `TerminalWorktreeSplitSurface` through `TabGroupSplitLayout`, `TabGroupSplitNodeTree`, `TabGroupPanel` and the overlay layers.

The legacy surfaces (`TerminalLegacyTerminalPanes`, `TerminalLegacyBrowserPanes`) render only while no mounted workspace has a tab-group layout. They are not positioned over slots; a visible workspace with no layout yet shows the pane placeholder until it has one.

### Workspaces that are visible but not loaded

A workspace becomes ready for display when it is activated: its tab model is reconciled, its root tab group and first terminal are prepared, and its surface is admitted to the workbench. That work is done for one workspace at a time: `applyTerminalColdActivation` admits only the active workspace into the mounted set. The draft said restored panes would go "through the cold-activation path"; that path cannot do it.

A workspace can be visible without having been activated in this run in two cases: a restored pane that is not the focused one, and a chip revealed in an unfocused pane (for example by closing the chip in front of it).

A workspace pane is therefore in one of three states:

| State           | What the pane shows                                                           | How it leaves the state                      |
| --------------- | ----------------------------------------------------------------------------- | -------------------------------------------- |
| **Ready**       | The workspace, over its slot                                                  |                                              |
| **Loading**     | A quiet placeholder with the workspace's name                                 | The surface mounts and has a layout          |
| **Unavailable** | The "not available" placeholder with a Close button (see the lifecycle table) | The workspace appears, or the chip is closed |

Loading uses the mechanism the app already has for mounting a workspace that is not the active one: `requestBackgroundTerminalWorktreeMount({ worktreeId })`, which the CLI, agent wake and creation flows use. Together with the visible set it gives a mounted, shown, unparked surface without changing the active workspace.

Two things must stay true, and the build plan's first gate checks them before anything else is built:

- **Showing a workspace never spawns a shell and never wakes an agent by itself.** Hover prewarm already holds this line ("Prewarm must never spawn a shell or wake an agent"). A whole-workspace background mount leaves sleeping agents asleep, but mounting a terminal tab whose session is gone starts a new shell. If a visible, unfocused workspace has tabs that cannot be reattached, those tabs stay unmounted until the pane is focused, which is the normal activation.
- **A workspace prepared this way looks the same as one that was activated**: same tabs, same scrollback, no duplicate terminals.

If the gate fails, the fallback is that a not-yet-activated workspace stays in the Loading state with a "Load" action and loads on first focus. That is a visible downgrade of restore and is the conditional third [open question for Brian](#open-questions-for-brian).

### Drag and drop

One module owns pane drop targets. Given a pointer position and the dragged items it resolves pane, zone and strip index by hit-testing pane elements (or the main content area in single view), drives the preview with `TabGroupDropOverlay`, and commits. It has three callers:

- the sidebar's existing workspace-card pointer drag, which hands over to it while the pointer is over the main area. The hand-off points are `flushWorktreePointerDragFrame` (skip the reorder preview and the board auto-open) and `commitWorktreePointerDrop` (skip the reorder commit when the pane took the drop);
- the project-header drag (`project-header-drag.ts`), with the same hand-off;
- one generic pointer drag used by Active agents rows, which have no drag today, and by chips. It uses the sidebar's threshold (4 px), `Esc` and window blur cancel, `swallowNextClickOnDragHandle` for the trailing click, `createSidebarDragPreview` for the ghost and `setSidebarPointerDragDocumentStyles` for the cursor.

`resolveDropZone` gains an edge-share parameter that defaults to today's 10 %, so its one existing caller (`AiVaultSessionDropLayer`) is unchanged. `TabGroupDropOverlay` gains an optional label; today it can only say "New split". Workspace tab drags are a different path (`resolvePaneColumnEdgeZone`, 20 % bands) and are not touched.

While a drag is over the main area, embedded webviews must let the pointer through; `acquireWebviewsDragPassthrough` does this and is reference-counted.

### Agent-session tabs

`liveSessionTabsStore` remains the owner of which sessions are open and of their focus requests. The grid records only where they are shown. A session chip is an open session tab, and closing the chip closes that tab.

- **Preview belongs to the grid while a layout exists.** The session tabs have their own preview slot: a plain open replaces the previous preview tab in place. In split view that would remove a session from the open tabs, and with it a chip that may sit in a different pane. So while a layout exists, `openLiveSessionView` opens sessions in the tabs store as kept tabs and the grid alone decides what is a preview; when the layout is created, the tabs store's preview is cleared.
- **Sessions open on the session page but not in the grid stay open there.** They are not pulled into the grid when a split is created from a workspace, and they are on the session page again when split view ends. The alternatives (closing them, or filling the first pane with them) both surprise.
- **Closing a session chip does not run the "back to the project" step.** `closeLiveSessionView` returns to the project overview when the last tab of a visit that began there closes. In split view the grid chooses the next focus, so that step is skipped while a layout exists.
- **The session page's two-up goes away.** It is a second, smaller split: a `splitId` in the tabs store and a second `LiveSessionPane` beside the first, with no splitter. "Open in split" places the session in a pane instead, `splitId` and `closeSplit` are removed, and a two-up saved by an earlier version becomes two panes at launch.
- **One session body.** The part of `LiveSessionWorkspace` that shows a session, or the "gone" or "looking for sessions" notice, becomes one component used by the page and by panes.

### What is reused

| Need                                    | Reused                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Split tree and its operations           | `TabGroupLayoutNode`, `tab-group-layout-tree.ts`, `collectTabGroupLayoutGroupIds`                            |
| Drawing a split tree                    | The recursion in `TabGroupSplitNodeTree.tsx`, made generic and shared                                        |
| Splitter                                | `ResizeHandle` from `TabGroupSplitNodeTree.tsx` and its CSS (`tab-group-split-resize-handle`)                |
| Drop zones                              | `resolveDropZone` in `tab-drop-zone.ts`, with an edge-share parameter                                        |
| Drop preview                            | `TabGroupDropOverlay`, with a label                                                                          |
| Slot geometry                           | `tab-group-body-geometry.ts`                                                                                 |
| Workspace content                       | The retained workbench surfaces, same instances                                                              |
| Workspace strip without window chrome   | The floating panel's composition: `WorkspaceTabDragLayer` + `TabGroupSplitNodeTree`                          |
| Mounting a workspace that is not active | `requestBackgroundTerminalWorktreeMount`                                                                     |
| Agent-session content                   | `LiveSessionPane`, `useLiveSessions`, `liveSessionTabsStore`, `useLiveSessionClock`                          |
| Project content                         | `ProjectOverview` and `ProjectOverviewMissing` in `ProjectOverviewPage.tsx`, exported                        |
| Chip and strip                          | `SessionTab` and the strip in `LiveSessionWorkspace.tsx`, extracted and shared                               |
| Drag ghost, cursor, click swallow       | `createSidebarDragPreview`, `setSidebarPointerDragDocumentStyles`, `swallowNextClickOnDragHandle`            |
| Webview pass-through while dragging     | `acquireWebviewsDragPassthrough`                                                                             |
| Open paths                              | `activateAndRevealWorkspace`, `openLiveSessionView`, `openProjectOverview`                                   |
| On-screen attention                     | `onScreenWorkspaceIds`, `resolveAutoAckTabTargets`                                                           |
| Menus                                   | The workspace context menu, the project actions dropdown and the session menu, with new entries only         |
| Shortcuts                               | The keybinding catalog, `GROUP_COPY` for the group title, the dispatcher, `MAIN_PROCESS_INTERCEPTED_ACTIONS` |
| Persistence pattern                     | `live-session-tabs-store.ts`                                                                                 |
| Pane ids                                | `createNonSecureContextUuid`                                                                                 |

## Performance

What the code does today, which bounds what split view can cost:

- A hidden workspace's terminals are parked (their xterm renderers unmounted, output still watched) after 30 s; up to 4 hidden workspaces are kept warm for 5 minutes; at most 6 WebGL contexts are retained for hidden terminals; a terminal that loses its WebGL context falls back to the DOM renderer. **Nothing caps terminals that are visible**, because until now only one workspace could be.
- Browser webviews of hidden workspaces are evicted least recently used first, never the active workspace's.

What split view adds:

- Cost scales with the number of _visible_ panes, not open chips. A workspace behind another chip in the same pane is hidden and follows the parking rules above.
- Every visible workspace keeps all terminals in its own visible tab groups live. Six workspace panes with two terminal splits each is twelve live renderers.
- A session pane mounts only for the active chip of its pane; each one holds a transcript watch and a recap subscription. A project pane polls what the project page polls (README, changes, pull requests).
- Layout changes remount nothing. Splitter drags write styles directly and commit once.
- The grid layer is lazy-loaded and not mounted without a split layout, so it stays out of the renderer's boot graph. The store and the `splitViewShowing` boolean are small and load with the shell.
- Focusing a pane runs the same activation as a sidebar click. Because the workspace is already on screen, there is nothing to reveal.

The number of panes is not capped by this design; the minimum pane size and the splitter clamp bound it in practice. The test plan measures six workspace panes with streaming output against a budget. If the budget is missed, the builder reports the numbers and a cap becomes a question for Brian; it is not decided here on a guess.

## Accessibility

- Strips are `tablist` / `tab` with roving focus and arrow-key movement, as the session strip is today. Each pane is a labelled group named after its active item.
- `inert` and `aria-hidden` follow _visible_: a workspace shown in an unfocused pane is reachable by keyboard and assistive technology, and moving into it focuses its pane.
- Every drag has a menu equivalent, and shortcuts cover moving focus and maximizing.
- Focus indication does not rely on color alone (accent line plus text weight), and drop previews carry a text label.
- No animated pane transitions.
- Known gap: splitters cannot be moved from the keyboard, as in workspaces today. Fixing that belongs in the shared `ResizeHandle` so both places gain it.

## Out of scope

- Dragging a workspace's terminal or editor tabs into another workspace.
- Dragging a pane with several chips as one unit.
- More than one window, and syncing the layout to other devices.
- Named or saved layouts.
- Non-item pages (Home, Settings, Tasks and so on) as panes.
- Keyboard resizing and double-click-to-equalize on splitters.
- Showing in the sidebar which items are in the grid but not focused.
- Board cards and the inline agent rows on workspace cards as drag sources.

## Build plan

Ordered so that the riskiest facts are proven first and every step can be exercised in the real app before the next one starts. Menus come before drag and drop for that reason: from step 5 on, items can be placed without a drag.

**Constraints that shape every step**

- The line-count limit (300 counted lines for `.ts`, 400 for `.tsx`, `.oxlintrc.json`) is enforced with a baseline that may only shrink. These files are at or near it and cannot grow in place: `project-header-drag.ts` (296), `TabGroupPanel.tsx` (397), `use-global-keybindings.ts` (290), `use-terminal-parking-pass.ts` (292), `use-terminal-watcher-effects.ts` (285). New behaviour goes into new modules that those files call.
- New code lives under `src/renderer/src/components/split-view/`, in files named after what they hold (types, layout transitions, saved-state parsing, the store, the navigation settle step, the drop target, the layer, the pane, the strip). No `helpers` or `utils` files.
- Other gates this change touches: `check:terminal-parking-ownership-ratchet`, `check:layout-writer-ratchets` (split view adds no writer of `activeWorktreeId` or of any workspace's tab and layout state), `check:zustand-selector-fanout` (the settle step's subscription), `verify:renderer-boot-graph`, the localization catalog (`pnpm sync:localization-catalog`), `check:e2e-typecheck-ratchet`, and the terminal layout parity run described in `tests/e2e/AGENTS.md`.
- Run `pnpm check:changed` after the last edit before every push. Never `--no-verify`.

**Step 1. Gate: prove the composition and the load path.** Build the thinnest slice that can show a grid: a store that can hold a layout (filled from the developer console, with no drag and no menus), `splitViewShowing`, the composition in [What the main area renders](#what-the-main-area-renders), the visible set, slot positioning, and bare session and project bodies in panes. Steps 2 to 5 then finish each of these properly. Check, in the real app:

- G1. A 2 × 2 grid of two workspaces, one agent session and one project. Focus each pane in turn. All four stay painted; the workbench is never `hidden` or `inert`; the titlebar and right sidebar do not move.
- G2. Restart with that grid. The unfocused workspace pane loads through the background mount with its previous tabs and scrollback, no extra shell is started, and a sleeping agent stays asleep.
- G3. Six workspace panes with streaming output stay inside the performance budget in the test plan.

If G1 fails the design is wrong; stop and report. If G2 fails, switch to the "Load" fallback and raise the third open question. If G3 fails, report the numbers.

**Step 2. Model and store.** Types, pure transitions, saved-state parsing, the persisted store. Unit tests for the transitions with hard-coded expected trees: place in each zone, move, close and collapse down to single view, close with next-focus choice, preview replacement, prune, parse of malformed input.

**Step 3. Shared split-tree renderer.** Make the recursion in `TabGroupSplitNodeTree.tsx` generic and use it for workspaces and the grid. This must not change workspace behaviour: run the terminal layout parity gate. Add the edge-share parameter to `resolveDropZone` and the label to `TabGroupDropOverlay`.

**Step 4. Visible and focused through the workbench.** Every row of the table in [Visible and focused](#visible-and-focused). Split `isWorktreeActive` into two props. The workspace surface's in-pane chrome (no window drag region, no reserved corners, no outer strip and seam).

**Step 5. Panes, strips and menus.** The grid layer, the shared strip and chip, the session body and project body in panes, placeholders, the "Open in split view" entries in the three menus, the chip menu, close / close others / close pane, maximize, the narrow rule. Remove the session page's two-up and migrate a saved `splitId`.

**Step 6. Navigation.** `navigateToSplitViewItem`, the settle step with its three rules, the focus sources in [Focus](#focus), the changes to `openLiveSessionView` and `closeLiveSessionView`, the removal-successor rule, the webview-blur skip.

**Step 7. Persistence and restore.** Save on change, defensive parse, placeholders for unresolved items, pruning only after an item was seen and then vanished, reconciliation with the session tabs, the loading path from step 1.

**Step 8. Drag and drop.** The drop-target module, including single view and Home. The sidebar hand-off for workspace cards (with the board rule and the single-card-group fix) and project headers. The generic pointer drag for Active agents rows and chips. Multi-selection.

**Step 9. Shortcuts.** Catalog entries, the group title, the dispatcher, main-process interception, `allowInTerminal`.

**Step 10. Finish.** Strings through the localization catalog, the accessibility roles, one end-to-end spec for the core loop (drop → split → resize → restart → restored) modelled on `tests/e2e/active-view-restart-restore.spec.ts` and `tests/e2e/worktree-card-downward-drag.spec.ts`, then the full test plan below.

Tests to write, and no more (the repository's rule is that a test must fail if the change is reverted and must hard-code its expected values): the unit tests of step 2 and the one end-to-end spec of step 10.

## End-to-end test plan

The builder runs this in the real app, with parallel testers, before asking for review. Reading the code or passing unit tests is not evidence for any line of it.

**How to run it**

- Build once in e2e mode (`pnpm exec electron-vite build --mode e2e`), which exposes `window.__store` for setup. Rebuild after every code change; a stale build is not a valid test.
- Every tester launches its own app instance with its own profile directory, in the background (`ORCA_BACKGROUND_LAUNCH=1`), and drives it over CDP with real pointer and keyboard events. No window is shown or focused: no `show()`, `showInactive()`, `bringToFront()` or `app.focus()`. Evidence is CDP screenshots of the hidden renderer plus DOM assertions on what the user would see. State may be _set up_ through `window.__store`; it must not be the thing asserted.
- Testers run in parallel, one lane each. A lane reports pass or fail per case with a screenshot. The builder fixes failures, re-runs the failed lane, and at the end re-runs **every** lane on the final commit.
- Seed data for every lane: at least four workspaces across two projects, including one folder workspace and one git worktree; two live agent sessions (the fake agents in `tests/e2e/helpers/` are enough); one workspace with an embedded browser tab; one workspace with two tab groups. Lane 6 also needs a remote host (the Docker SSH host in `tests/e2e/helpers/`) if one can be started.

**Lane 1. Composition and focus (the blocker).**

- Build a 2 × 2 grid: workspace top left, workspace top right, project bottom left, agent session bottom right.
- Focus each pane by click, then by shortcut, in every order. After every focus change all four panes are painted (terminals show their text, the session shows its transcript, the project shows its cards), no workspace surface is `hidden`, `inert` or zero-sized, and the titlebar, the grid and the right sidebar have not moved.
- Type into the focused terminal while another pane streams output: only the focused terminal receives the keys.
- In an unfocused pane, press on: a terminal, an editor, the second tab group of a workspace, a browser page, the session composer. Each press focuses that pane and keyboard focus stays on what was pressed; typing goes there.
- Workspace shortcuts (new terminal, save, tab numbers, rename) act on the focused workspace pane and do nothing to a workspace while a session or project pane is focused.
- The sidebar highlight, window title and right sidebar follow the focused pane. A workspace that is visible but unfocused shows no unread mark while new output arrives in it.
- A workspace's tab strip inside a pane does not drag the window.

**Lane 2. Dragging from the sidebar.**

- Each row kind (workspace card, Active agents row, project header) onto each zone (left, right, up, down, center, a strip position): the preview shows the right rectangle and label, and the drop gives the right layout.
- The first drop from a workspace view, from the session page with three tabs open (all three come along), and from a project page.
- A multi-selection of three workspace cards onto an edge and onto a center.
- A workspace card that is the only card in its group.
- `Esc` and release outside both cancel. A drag that stays inside the sidebar still reorders, and a drag that goes out and comes back reorders too.
- A pane too small to halve falls back to "Add as tab".
- The pointer passes over an embedded browser page during the drag and the preview keeps following.
- Home: dropping opens the item. Tasks: the main area is not a target and the drag behaves as before.
- Workspace Board, closed: a card drag does not open it. Open: the board takes the drop and status changes as before.
- An item already in the grid moves instead of duplicating.

**Lane 3. Chips, panes and menus.**

- Reorder chips in a strip, move a chip to another strip at a position, drag a chip to each edge.
- Close a chip, close others, close a pane, middle-click; close down to one pane with several chips (grid stays) and to one chip (single view returns, with workspace chrome for a workspace).
- Preview: a plain sidebar click adds an italic chip; the next plain click replaces it; double-click keeps it. A preview session chip in one pane is not removed by opening another session into a different pane.
- Close a session chip while other session tabs are open on the session page but not in the grid: no chip appears that the user did not place.
- Close a session chip that was opened from a project pane: focus goes to the grid's next chip.
- Every menu entry: the three sidebar menus, the chip menu, "Open in split" on the session menu.
- Maximize and restore by button and shortcut; focus moves while maximized.

**Lane 4. Resizing and terminals.**

- Drag every splitter in a nested grid. Terminals refit: `stty size` in each matches its pane; a full-screen program (`vim`, `htop`) redraws correctly.
- Nothing remounts on split, move, resize, maximize or pane close: scrollback is intact, a running program keeps running, an embedded page does not reload (a counter in the page keeps its value).
- Window resize, both sidebars toggled, and a window narrow enough to trigger the one-pane rule and wide again.

**Lane 5. Persistence and restore.**

- Quit and relaunch with a 2 × 2 grid: tree, ratios, chips, active chips and focused pane are back.
- Unfocused workspace panes come back loaded (or as "Load" placeholders if the fallback was taken), with no extra shells (compare the PTY list before and after) and with sleeping agents still asleep.
- Relaunch after quitting on Home: the grid is hidden; opening an item shows it.
- Corrupt `seal.splitView.v1` by hand in three ways (not JSON, an unknown item kind, the same item twice): the app starts and drops only the bad part.
- A two-up saved by the previous version of the session page becomes two panes.
- An item removed while the app was closed; a remote host that is offline at launch and comes back.

**Lane 6. Lifecycle.**

- A session ends, is removed, is resumed under a new id.
- A workspace is removed and archived, once focused and once unfocused; a project is removed. No workspace that was never in the grid appears.
- A sleeping workspace in an unfocused pane stays asleep until its pane is focused.
- Create a workspace while split view shows: the creation surface replaces the grid, and the new workspace lands as a preview chip.
- Open Settings and come back; the grid is as it was.
- Navigate with the palette, a notification click, the CLI and workspace history back / forward: each lands by the one navigation rule.
- A grid mixing a local workspace, a remote workspace and a folder workspace.

**Lane 7. Performance.**

- Six workspace panes, each with a terminal printing continuously, plus two session panes.
- Budget, relative to single view measured on the same machine in the same run: typing latency in the focused terminal (the method of `tests/e2e/terminal-typing-latency.spec.ts`) at the 95th percentile no worse than 1.5×; no long task over 50 ms attributable to split view while dragging a splitter; no terminal left blank after a WebGL context loss.
- A workspace hidden behind another chip is parked after 30 s and comes back intact when its chip is selected.
- Report the numbers whether or not the budget is met.

**Lane 8. Keyboard, themes and accessibility.**

- Every shortcut from inside a terminal (under both terminal shortcut policies), an editor, a composer and an embedded browser page.
- Keyboard only: reach a strip, move between chips with the arrow keys, open the chip menu, split, close.
- Light and dark screenshots of a workspace pane: the pane strip and the workspace's own strip are distinguishable, and the focused pane is identifiable without relying on color.
- An accessibility snapshot shows `tablist`, `tab` with `aria-selected`, and a labelled group per pane; hidden workspaces are `aria-hidden` and visible ones are not.

**Gates to run on the final commit, in addition to the lanes**

- `pnpm tc`, `pnpm lint`, `pnpm check:changed`.
- `pnpm test:changed --maxWorkers=2`.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e:terminal-layout-parity` and the layout oracles named in `tests/e2e/AGENTS.md`, because steps 3 and 4 touch how workspaces are laid out.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm run test:e2e:terminal-perf`.
- The new end-to-end spec.

## Review

The draft's direction was right and is kept: a mode of the main area, focus as navigation, workspace surfaces positioned over slots instead of re-parented, and reuse of the tab-group tree, splitter and geometry registry. The findings below are what the review changed or added. Each names the evidence in the code and the section that now resolves it.

### Blockers

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Resolution                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **Focusing a session or project pane hides every workspace pane.** `use-app-chrome-layout.ts` sets `terminalWorkbenchVisible` to `activeView === 'terminal' && hasActiveWorktree && !creationLayoutActive`; `TerminalWorkbenchContainer` then applies `hidden` and `inert`. `TerminalSplitWorkspaceSurfaces` also requires `activeView === 'terminal'` per surface, and `TerminalSurface` hides when no workspace is active. The prototype only ever placed workspaces. | New section [What the main area renders](#what-the-main-area-renders): `splitViewShowing` decides the composition, and workspace visibility comes from the slot map alone. Gate G1 and test lane 1. |
| R2  | **The page would render next to the grid.** `ActivePage` in `AppWorkspaceShell.tsx` mounts `LiveSessionWorkspace` for `sessions`, `ProjectOverviewPage` for `project`, and the Home fallback for `terminal` with no active workspace, in the same flex column as the workbench. The draft said panes render "the inner pieces, not the pages" but never said the pages stop rendering.                                                                                  | Same section: the page is not rendered for item views while split view shows.                                                                                                                       |
| R3  | **Restored workspace panes cannot load the way the draft said.** `applyTerminalColdActivation` admits only `renderedActiveWorktreeId` to the mounted set, with one `lastActivationWorktreeIdRef`. The draft treated "the cold-activation path" as available for other workspaces.                                                                                                                                                                                       | [Workspaces that are visible but not loaded](#workspaces-that-are-visible-but-not-loaded): three pane states, the background-mount mechanism, two conditions, a fallback. Gate G2.                  |
| R4  | **The navigation subscriber would file the wrong workspace.** Activation writes `activeView` and then the active workspace as two synchronous store updates (`worktree-activation.ts`); `openLiveSessionView` writes the tabs and then the view. A subscriber sees the half-finished state.                                                                                                                                                                             | [One invariant, one settle step](#one-invariant-one-settle-step): settle in a microtask; commands navigate and update in one turn.                                                                  |
| R5  | **Closing a session chip could open a different one.** `liveSessionTabsStore.close` moves `activeId` to the neighbouring tab, which may not be in the grid; the subscriber would then add it as a chip. `closeLiveSessionView` may also jump to the project overview.                                                                                                                                                                                                   | Same section (navigate first, then close) and [Agent-session tabs](#agent-session-tabs). Test lane 3.                                                                                               |
| R6  | **Two preview mechanisms collide.** The tabs store replaces its preview tab in place (`open(..., 'preview')`), which removes a session from the open tabs and would close a chip in another pane.                                                                                                                                                                                                                                                                       | [Agent-session tabs](#agent-session-tabs): the grid owns preview while a layout exists.                                                                                                             |

### Major

| #   | Finding                                                                                                                                                                                                                                                                                                                                                                 | Resolution                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R7  | **The visible / focused table was incomplete.** Missing: on-screen attention (`agent-auto-ack-targets.ts`), the workbench wrappers, the browser pointer-down subscription (active workspace only today), workspace tab dragging, auto-focus, the WSL notice, the legacy surfaces. `terminal-cold-activation` was listed as if it took a visible set.                    | [Visible and focused](#visible-and-focused) is rebuilt from a search of every `activeView === 'terminal'` test, with one rule for choosing.                                |
| R8  | **Unread marks: the draft asked whether a visible workspace should stay unread.** The code already answers it: attention clears for what is on screen (`onScreenWorkspaceIds`, including the floating panel and every split group in view).                                                                                                                             | Decided in [Focus](#focus): visible counts as on screen; visit order changes only on focus.                                                                                |
| R9  | **Clicking into a browser page in another pane would blur it.** `setActiveWorktree` calls `moveFocusToRendererBeforeFocusedWebviewHidden` on every change of active workspace. The draft listed the skip; it is now a required behaviour with a test.                                                                                                                   | [Visible and focused](#visible-and-focused), test lane 1.                                                                                                                  |
| R10 | **A workspace's strips are window-drag regions and reserve room for window controls.** `[data-terminal-focus-release-surface]` is `-webkit-app-region: drag`; `TabGroupPanel` reserves corner space; `TabGroupSplitLayout` adds a 4 px strip and a seam. The draft named the outcome but not the mechanism, and `TabGroupPanel.tsx` is 3 counted lines under its limit. | [How it fits the existing layout](#how-it-fits-the-existing-layout): follow the floating panel's composition.                                                              |
| R11 | **Single-card groups cannot be dragged without the board.** `use-pointer-drag.ts` returns early for a card alone in its group unless the board preview is available. The draft's board rule would have made those cards undraggable.                                                                                                                                    | [Dragging from the sidebar](#dragging-from-the-sidebar).                                                                                                                   |
| R12 | **Multi-selection.** The sidebar drags a multi-selection as one gesture with a count badge (`dragged-worktree-copies.ts`). The draft placed only the grabbed row and silently dropped the rest.                                                                                                                                                                         | All dragged workspaces are placed. Test lane 2.                                                                                                                            |
| R13 | **Project headers have no context menu.** Their actions are a dropdown (`repo-header-project-actions.tsx`).                                                                                                                                                                                                                                                             | [Without a drag](#without-a-drag): the entries go in the dropdown.                                                                                                         |
| R14 | **The drop-zone claims were off.** `resolveDropZone` is not what tab-group drags use (they use `resolvePaneColumnEdgeZone`, 20 %); its only caller is `AiVaultSessionDropLayer`. It does not pick "the nearest edge": corners go left or right. `TabGroupDropOverlay` can only label "New split".                                                                       | [Dragging from the sidebar](#dragging-from-the-sidebar) describes the real geometry; [Drag and drop](#drag-and-drop) keeps the existing caller unchanged and adds a label. |
| R15 | **First drop in single view.** The grid layer is not mounted before a split exists, so there is no pane to hit-test.                                                                                                                                                                                                                                                    | Single view is one implicit pane.                                                                                                                                          |
| R16 | **A drag from Home did nothing.** Home is where the app usually starts, and Brian's ask starts with a drag from the sidebar.                                                                                                                                                                                                                                            | Home accepts a drop as a plain open. Small call made by the review.                                                                                                        |
| R17 | **Focus inside a workspace pane cannot be detected by the grid layer**, whose slot is click-through. Auto-focus must stay tied to _focused_, or a visible terminal could take the keyboard by itself.                                                                                                                                                                   | The focus-source table in [Focus](#focus).                                                                                                                                 |
| R18 | **Showing a workspace must not start shells or wake agents.** Mounting a terminal tab whose session is gone spawns a shell; prewarm has an explicit rule against this.                                                                                                                                                                                                  | [Workspaces that are visible but not loaded](#workspaces-that-are-visible-but-not-loaded), gate G2, test lane 5.                                                           |
| R19 | **Agent hibernation.** The foreground set is the one active terminal tab plus Activity portals, not "terminals of the active workspace".                                                                                                                                                                                                                                | The active terminal tab of every visible workspace.                                                                                                                        |
| R20 | **Removing the focused workspace** runs `active-worktree-removal-successor.ts`, which activates another workspace; settle would add it as a chip.                                                                                                                                                                                                                       | [When things go away](#when-things-go-away), test lane 6.                                                                                                                  |
| R21 | **Shortcut names and reach.** "Focus next pane" already exists for terminal panes. Shortcuts pressed inside an embedded page only reach the app if main intercepts them; under "terminal-first" only `allowInTerminal` actions fire inside a terminal.                                                                                                                  | [Keyboard shortcuts](#keyboard-shortcuts).                                                                                                                                 |
| R22 | **A second tree renderer.** The draft reused the tree operations but implied a new recursive component for the grid.                                                                                                                                                                                                                                                    | The recursion in `TabGroupSplitNodeTree.tsx` is made generic and shared (build step 3), behind the layout parity gate.                                                     |
| R23 | **Slot geometry misses moves.** The registry re-measures on resize, not on a move without a resize.                                                                                                                                                                                                                                                                     | Re-measure after every tree change.                                                                                                                                        |
| R24 | **Performance had no numbers.** Hidden terminals are budgeted (30 s, 4 workspaces, 6 WebGL contexts); visible ones are not.                                                                                                                                                                                                                                             | [Performance](#performance) states the existing limits and a budget; gate G3 and test lane 7 measure it.                                                                   |

### Minor and corrections

| #   | Finding                                                                                                                                                                                                                                    | Resolution                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| R25 | The right sidebar is shown on the session page today and hidden on the project page, so "keep showing the last workspace" was already the session behaviour.                                                                               | Shown for every pane kind; decided, not asked.    |
| R26 | The session page's two-up is not a split system with a splitter: it is `splitId` and a second pane at equal width.                                                                                                                         | Removal is small; described accurately.           |
| R27 | "Phone layouts" do not exist in the renderer; the mobile app is a separate client. Minimum window size is 600 × 400.                                                                                                                       | Wording fixed.                                    |
| R28 | Active agents rows are not virtualized; they are portaled into the same scroll container (PR #45). The sidebar threshold is 4 px, not 5.                                                                                                   | Wording fixed; the generic drag uses 4 px.        |
| R29 | A worktree id is not unique across hosts and a workspace surface is keyed by worktree id alone.                                                                                                                                            | Item identity for a workspace is the worktree id. |
| R30 | The "session is gone" notice has no close action of its own.                                                                                                                                                                               | The chip's × closes it.                           |
| R31 | `live-session-tabs-store.ts` is a class with mutating methods, not pure reducers; `openProjectOverview` takes a repo, not ids.                                                                                                             | [Model](#model) and the adapters say so.          |
| R32 | Two strips looked alike on different pages: the session page's strip is `bg-muted/40`, the proposed pane strip `bg-tab-bar`.                                                                                                               | One shared strip and chip.                        |
| R33 | Dragging onto the board's toolbar button to open it was new behaviour nobody asked for.                                                                                                                                                    | Dropped. Open the board first.                    |
| R34 | The line-limit note was right but partial: `use-global-keybindings.ts` is also at the limit, and the baseline cannot grow. The terminal layout parity gate was not mentioned.                                                              | [Build plan](#build-plan), constraints.           |
| R35 | Maximize did not say what happens when focus moves.                                                                                                                                                                                        | The maximized pane follows focus.                 |
| R36 | Open questions the review closed by making the small call: Linux default shortcuts (same everywhere), edge-band size (30 %, tune in testing), session tabs outside the grid (they stay on the session page), the pane cap (measure first). | See the sections named in each.                   |

### Claims checked and found correct

The tab-group tree type and its operations are pure and take only a tree and ids. `ResizeHandle` clamps at 15 %–85 %, writes sizes directly and commits once. `registerTabGroupBody` / `subscribeTabGroupBodyRect` exist and report rects relative to a container. Nothing under `components/live-sessions/` adds window or document listeners, and the session page already mounts two `LiveSessionPane`s for its two-up. The session id embeds its host. The session tabs follow renames (`LiveSessionAppSurface`). Apart from launch restore, the `sessions` and `project` views are entered only through `openAgentSessionTabs` and `openProjectOverview`. The three default shortcuts are free. `createSidebarDragPreview`, `setSidebarPointerDragDocumentStyles` and `acquireWebviewsDragPassthrough` exist and are generic. The Workspace Board opens on the first frame of any card drag. The sidebar stays on screen for session and project views. `activeView` is persisted and restored. There is no rule against a new `localStorage` key.

## Verified and unverified

This is the state before the build. Every item of the "not yet shown to work" list below has since been run in the real app; [As built](#as-built) has the outcome.

**Run in the real app (by the designer's prototype, since discarded):** two and then three workspaces, placed through the store rather than by dragging, render side by side with live terminals, each retained surface positioned on its slot without being re-parented; each pane shows its strip above the workspace's own strip; the standard titlebar and the right sidebar stay intact. Remounts were not measured.

**Checked by reading the code (this review):** every claim the draft made about existing code, and everything in [Review](#review). Nothing in the review was run.

**Not yet shown to work anywhere, in order of risk:**

1. agent-session and project panes beside workspace panes, with focus moving between them (gate G1);
2. loading a workspace that is visible but not active, at restart and otherwise (gate G2);
3. many visible terminals at once (gate G3);
4. the settle step's three rules under real navigation;
5. all drags, the drop preview and the Workspace Board rule;
6. terminal refit after splitter drags, maximize and pane close;
7. the visible / focused split for browser eviction, hibernation, attention and webview blur;
8. shortcuts, narrow windows, themes.

## As built

### The three gates of step 1

- **G1 passed.** A 2 × 2 grid of two workspaces, one agent session and one project keeps all four painted while focus moves round them. The workbench is never `hidden` or `inert`, and the titlebar and right sidebar do not move.
- **G2 passed for the normal restart and uses the "Load" fallback for a cold one.** When the terminal daemon still holds a workspace's shells (quit and relaunch), every unfocused workspace pane reattaches through the background mount with its tabs and scrollback, no shell is started, and a sleeping workspace stays asleep. When the shells are gone (the daemon was stopped, or a shell died while the app was closed), mounting a terminal would start a shell in a pane nobody asked for. Such a pane shows a short "paused" notice with a **Load** button instead and starts nothing until Load is pressed or the pane is focused by a click or a shortcut. The focused pane always loads. A workspace whose front tab is not a terminal (a file, a page) shows that tab at once and only its terminals wait. This is the fallback of open question 3, limited to the one case where restoring live would have started processes.
- **G3 passed.** Eight panes (six workspaces, five of them streaming a line every 50 ms, and two agent sessions) against single view, on the same machine in the same run, 1280 keys each: typing latency in the focused terminal 4.4 / 13.8 / 61.8 ms (median / 95th percentile / worst) against 4.4 / 10.8 / 43.1 ms, a ratio of 1.28 at the 95th percentile for a budget of 1.5. Six splitter drags across the streaming grid: no long task, no long animation frame, frames at 16.7 ms at the 95th percentile and 33.4 ms at worst. Memory: 1618 MB for the grid with five streams against 1278 MB for single view with one. A terminal behind a chip, or in a workspace that left the grid, stops painting. No pane cap is proposed.

### Answers used for the open questions

1. A card drag no longer opens the Workspace Board. Open the board first to drop on it; status stays in the card's menu.
2. A plain sidebar click while split view is showing opens the item as a reusable preview tab in the focused pane. A double click, a drag of the chip or a drop keeps it.
3. See G2: one click to load, only for unfocused workspace panes after a cold start.
4. Not needed; G3 passed.

### Where the build differs from the text above

- **Minimum pane size.** A split that would leave a pane under 480 px wide or 320 px tall adds the item as a tab instead, and the drop preview says "Add as tab". The size is the pane's share of the grid, not what is drawn, so a maximized pane and the single pane of a narrow window follow the same rule.
- **Narrow main area.** Under 480 px the main area draws only the focused pane; the grid comes back unchanged when it widens. Maximize is not offered there.
- **Keyboard follows pane focus.** When focus moves to a pane by shortcut, by navigation, or because a tab closed, the keyboard goes to what that pane has in front: the terminal, the code or Markdown editor, the browser page, or the session or project body. A press on a pane's strip (a tab, its close button, Maximize, Close pane) never takes the keyboard itself: it stays where it was, or goes to the content of the tab that was pressed. A tab reached with Tab keeps it, and the arrow keys move between tabs; the one exception is Enter on a tab of another pane whose front is a terminal, where the workspace focuses its terminal as it becomes the current one.
- **A press inside a workspace pane.** A press inside a workspace pane that is not focused focuses the pane at once, and the press itself decides where the keyboard goes. The pane checks only after the release, and brings the keyboard to what it has in front if the press left it outside the pane or on a workspace tab (a tab pressed or dragged holds the keyboard itself). Without the wait, a browser page in front took the keyboard during the press, and a workspace tab pressed there was not brought to the front.
- **A splitter.** A press or drag on a splitter leaves the keyboard where it is. This is in the shared `ResizeHandle`, so the splitters between tab groups inside a workspace do the same. Before, a terminal gave up the keyboard on the press and nothing took it afterwards.
- **A tab's menu.** Closing the menu returns the keyboard to where it was. An entry that moves pane focus (Move to new pane, Open in split, a close that removes the focused pane) takes the keyboard along to the pane that is focused afterwards.
- **Shortcuts stand down under overlays.** The split-view shortcuts do nothing while a dialog or a menu is open.
- **Sleep.** Putting the focused pane's workspace to sleep moves focus to the nearest pane that is awake; the slept pane stays in the grid and wakes when it is focused.
- **Unavailable panes.** A pane whose workspace or project is gone cannot take focus (nothing in it can be the current item); the focus shortcuts pass over it and its Close button removes it.
- **Not saved.** The maximized pane and preview flags are not restored, as the text says; a restored grid comes back with every pane drawn and every chip kept.

### Touch points on the agent-session page

Kept to what the panes need, because a separate effort is merging the session page's tab strip and composer with the project view's.

- `LiveSessionWorkspace.tsx` no longer draws its own two-up. Its tab strip is now `split-view/ItemTabStrip.tsx`, the same strip every pane uses, with the session menu unchanged. A saved `splitId` becomes a two-pane layout on first launch.
- `LiveSessionBody.tsx` is new: one session's chat or the notice that explains why there is none. The session page and the panes both draw it. It wraps `LiveSessionPane` and changes nothing inside it.
- `LiveSessionPane.tsx` lost the "Close split" button and its `onCloseSplit` prop. Nothing else in the pane, the transcript or the composer changed.
- `live-session-tabs-store.ts` lost `splitId`; the `'split'` open mode now places the session in a split-view pane.
- `live-session-menu-effects.ts`: `openLiveSessionView` and `closeLiveSessionView` go through the grid when it is showing.
- `LiveSessionRow.tsx` gained the pointer-drag start and the "Open in split view" menu entries; `use-live-session-row-state.ts` no longer reads `splitId`.
- `StructuredAgentSessionPaneOverlayLayer.tsx` takes a separate `isWorktreeFocused` prop, as every workbench layer does after step 4.

### Still open

- **A real GPU process crash leaves WebGL terminals blank** until the terminal GPU setting is toggled. Measured with software GL and the setting forced on. It needs more than one WebGL terminal mounted, so single view with terminal splits has it too, but a grid makes it likelier. Context loss through `WEBGL_lose_context` recovers in every pane.
- **Hidden terminals are not unmounted after 30 s** when their tab still has a pending start and a live shell. `seal/all` behaves the same with the same steps in single view; they do stop painting.
- **A pane squeezed through nested splits** below about 70 px (the clamp is 15 % per split, so two nested clamps multiply) lets its terminal overflow its box. The minimum-size rule prevents new splits there but does not stop splitter drags.
- **Quitting with an unsaved file moves pane focus.** The app shows the unsaved file to ask about it, as it does in single view, and pane focus follows what the app shows. After the restart the pane with that file is the focused one. With every file saved, the pane focused at quit is focused again.
- **A pane focused at quit whose workspace was removed while the app was closed** comes back as the focused pane, showing "not available", until another pane is clicked.
- **Sleep from a card's menu leaves the keyboard on the sidebar list**, in split view as in single view.
- **A session or project pane is drawn again when the grid around it changes shape** (a neighbouring pane closed, or the pane itself split). A message typed but not sent in a session's composer is lost and the keyboard lands on the pane rather than the composer. The composer keeps its text in the component, as on the session page, where switching session tabs loses it the same way. Keeping the text per session belongs with the composer, which the parity work owns. Workspace panes are not affected: their content lives in the workbench.
- **A press on a pane's strip shorter than about 30 ms with the keyboard in a browser page** (a scripted click; any real click is longer) can leave the keyboard nowhere until the page is clicked: the page gives up the keyboard a moment after the press, and only a press that is still down then sees it and hands it back.
- **Splitters are mouse-only.** They are `role="separator"` with an orientation but take no keys.
- **Menus inside a workspace, in split view as in single view.** After a terminal's own menu is closed with Esc, the next key typed into that terminal is lost (`seal/all` does the same in single view). After the "+" menu of a workspace's tab row is closed with Esc, the keyboard is nowhere until the pane is pressed.
- **Remote hosts were not tested.** The machine the testers ran on has no container runtime or SSH server. A pane stores which host its workspace runs on, and local workspaces were checked on every route.
- **The session composer** was only typed into where the test profile allowed it; sessions that run outside a Seal pane have a disabled composer.

## Open questions for Brian

Answered for this build in [As built](#as-built). The questions as the review left them:

1. **Workspace Board and card drags.** Today, dragging a workspace card opens the Workspace Board over the main area so the card can be dropped on a status column. Split view needs that same area for its drop zones. Recommended: a card drag no longer opens the board by itself; to drop on the board, open it first (toolbar button or shortcut), and status can still be changed from the card's menu. Alternatives: hold a modifier key while dragging to get the board instead of the panes; or keep today's behaviour and place items in split view only through menus, which gives up "just drag it up into a position".
2. **What a plain sidebar click does while split view is showing.** Recommended: it opens the item as a tab in the focused pane, in a reusable "preview" slot so that browsing does not pile up tabs (double-click keeps it). The alternative is that a click replaces what the focused pane shows, so panes change only by drag or menu. The first matches "open them up in tabs"; the second keeps an arrangement more stable.
3. **Only if gate G2 fails: restoring workspace panes.** If a workspace cannot be shown safely without activating it, then after a restart the focused pane comes back live and each other workspace pane needs one click to load. Session and project panes are not affected. Acceptable for a first version, or should the build stop until every pane restores live?
4. **Only if gate G3 fails: a cap on panes.** If many visible terminals miss the performance budget, the builder will report the measurements and propose a limit.
