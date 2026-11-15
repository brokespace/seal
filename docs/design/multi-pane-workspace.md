# Split view: several workspaces, agents and projects side by side

Status: **design proposal, not implemented.** Nothing on this branch but this document. A throwaway prototype was used to check the riskiest part of the design; [Verified and unverified](#verified-and-unverified) says exactly what it showed. [Open questions](#open-questions) lists what a reviewer should look at first.

## The ask

> I want a way so that I can basically take any of my active agents or workspaces and sort of open them up in tabs. […] Say like one workspace in the top left, another in the top right, another agent session in the bottom right. […] I could drag and drop everything everywhere, and I can resize them. I can fully like multiplex. […] I can select in the left hand sidebar, just drag it up into a position. That would actually be best.

Today the main area shows exactly one thing: one workspace (with its own terminal, editor and browser tabs), or the agent-session page, or one project's overview. This design lets the main area show several of those at once in a resizable grid. Every cell of the grid has its own tab strip, and cells are filled by dragging rows out of the left sidebar.

## Vocabulary

| Term             | Meaning                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Item**         | Something the sidebar opens: a **workspace** (git worktree or folder workspace), an **agent session** (a row in Active agents), or a **project** (its overview page). |
| **Pane**         | One rectangle of the grid. It has a strip of chips and shows the active one.                                                                                          |
| **Chip**         | One item in a pane's strip. Called a chip here only to keep it apart from a workspace's own tabs; in the UI it is a tab.                                              |
| **Split view**   | The grid of panes. It exists while two or more items are open in it; otherwise the main area is exactly what it is today.                                             |
| **Focused pane** | The pane that keyboard input and the rest of the app (sidebar highlight, right sidebar, shortcuts) follow.                                                            |

A workspace's own tabs and its own splits (terminals, editors, browsers, agent chats) are untouched and keep working inside the pane that shows that workspace. Split view is one level above them: it arranges whole workspaces, sessions and projects.

## Where it lives: the existing main area, not a new page

**Recommendation: split view is a mode of the existing main area.** No new page, no new sidebar destination, no new `TopLevelView`.

- It is what was asked for ("just drag it up into a position. That would actually be best").
- A separate page would be a second home for the same workspaces and sessions. `docs/information-architecture.md` rules that out: each thing has one record, one canonical home and one set of handlers. Every open path (sidebar click, `Cmd+K`, notifications, CLI, deep links) would need a second destination, and the sidebar would have to answer "is this open here or there?".
- It costs nothing when unused. With no split view the main area renders today's components unchanged.
- The other pages (Home, Settings, Machines, Tasks and so on) are not items and never enter the grid. Visiting one hides the grid; returning to a workspace, session or project shows it again as it was left.

## Interaction model

### Dragging from the sidebar

Three kinds of sidebar row can be dragged onto the main area:

- a **workspace** card (git worktree or folder workspace),
- an **Active agents** row (agent session),
- a **project** header (the item is that project's overview page).

The main area accepts the drag whenever it is showing an item. While the pointer is over it, the pane under the pointer shows a **drop preview**: a tinted rectangle over the half the item would take, or over the whole pane for a tab drop, with a text label ("Split right", "Split down", "Add as tab").

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

- Each edge band is **30 %** of the pane; the nearest edge wins; the rest is center. A drag out of the sidebar nearly always means "put this beside that", and the strip is already a precise target for "put this in that pane", so edges are generous. The existing tab-group resolver (`resolveDropZone`) uses 10 % bands, which made splits hard to hit from a long sidebar drag; give it an edge-share parameter rather than writing a second resolver.
- Releasing over a zone commits. Releasing anywhere else, or pressing `Esc`, cancels with no change.
- The first drop creates split view: what the main area was showing becomes the first pane, and the dropped item becomes the second pane (edge zones) or a second chip (center). If that first pane was the agent-session page, every session tab open on that page comes along as a chip, so no open tab disappears.
- An item is in the grid at most once. Dropping an item that is already there moves it.
- A split is refused, and the zone falls back to "Add as tab", when the pane is too small to halve: under 2 × 240 px wide for left/right, or 2 × 160 px tall for up/down.
- A multi-selected drag places only the row that was grabbed. Placing several items in one gesture has no obvious arrangement.
- Sidebar reordering keeps working. The same drag reorders while the pointer is over the sidebar and targets panes once it is over the main area. Only one of the two commits.
- On a page that is not an item (Home, Settings and so on) the main area is not a drop target, and drags behave as they do today.

Drags are pointer-based, like the sidebar's existing reorder drags. The list is virtualized, so native HTML5 drags lose their source row mid-drag.

**Conflict with the Workspace Board.** Today, starting any workspace-card drag opens a ghosted Workspace Board drawer over the main area so the card can be dropped on a status column, and the drawer becomes solid once the pointer enters it. That drawer covers exactly the surface this design drops onto. Proposed rule: while the main area is showing an item, a card drag no longer opens the board by itself. The board still takes the drop if it is already open, and dragging onto the board's toolbar button opens it. On non-item pages the drag is unchanged. This changes an existing feature and is the first [open question](#open-questions).

### Without a drag

Every drop has a menu equivalent:

- The context menus of workspace cards, Active agents rows and project headers gain **Open in split view ▸ Right / Down / Left / Up / As a tab**, acting on the focused pane.
- A chip's context menu has **Move to split ▸ Right / Down / Left / Up**, **Close**, **Close others** and **Close pane**.
- The session menu's existing **Open in split** places the session in a new pane to the right. See [Agent-session tabs](#agent-session-tabs).

### Panes and their strips

Each pane has a 32 px strip, the height and tokens of a workspace's tab strip, with one chip per item: an icon (agent icon with its status dot, workspace glyph, or project icon), the title, and a close button. **Maximize** and **Close pane** sit at the right end.

- Clicking a chip shows that item and focuses the pane.
- Middle-click or × closes the chip. Closing destroys nothing: a workspace keeps its terminals running and a session keeps running. The item only leaves the grid.
- An item opened by plain navigation (sidebar click, `Cmd+K`, a notification) goes into the focused pane as a _preview_ chip (italic title) and replaces that pane's previous preview. Agent-session tabs and editor previews already follow this rule. Double-clicking the chip, dragging it, or opening the item through a split-view menu keeps it.
- A workspace pane has two strips: the pane strip, then the workspace's own tab strip. They must be told apart at a glance in both themes. The pane strip uses the `bg-tab-bar` surface; whether that is enough contrast against the workspace strip has to be checked in the build.

### Dragging chips between panes

A chip can be dragged to reorder it within its strip, onto another pane's strip to move it there at that position, or onto any pane's edge zone to split. The preview and the rules are those of a sidebar drag. Moving the last chip out of a pane closes that pane.

Dragging a terminal or editor tab from one workspace into another is out of scope: those tabs belong to their workspace.

### Resizing

Between two panes sits the splitter that workspaces already use for their tab groups (`ResizeHandle`), with the same hover tint and the same 15 %–85 % clamp. Ratios are stored in the split tree and persisted. The splitter gains no new behavior here: it has no keyboard resizing and no double-click-to-equalize today, and this design does not add them.

### Closing, collapsing, maximizing

- Closing a pane's last chip removes the pane, and its sibling grows into the space. The tree collapses with the tab-group algorithm.
- **Close pane** closes all of its chips at once.
- When one pane with one chip is left, split view ends and the main area is the ordinary single view of that item. One pane with several chips stays: that is the "open them up in tabs" case with no split.
- **Maximize** (strip button or shortcut) shows one pane across the whole area until toggled back. Nothing closes, and it is not persisted.

### Focus

Exactly one pane is focused. Its strip has full-strength text and an accent line; the other strips are muted. Clicking in a pane or typing into it focuses it. This includes clicks inside an embedded browser page, which arrive through the existing browser pointer-down channel.

**Focus is navigation.** Focusing a pane does what clicking its item in the sidebar does today: that workspace becomes the active workspace, or that session the active session, or that project the open project. Everything that already follows "the active thing" therefore follows the focused pane without change: the sidebar highlight, the right sidebar, the window title, `Cmd+T` and every other workspace shortcut, the status bar.

Unfocused panes stay live. Terminals render output and transcripts stream, but they take no keyboard input and own no shortcut scope.

One consequence: focusing a workspace pane counts as visiting that workspace, so it updates visit order and clears its unread mark, as a sidebar click does. A workspace that is visible but not focused is not visited.

### Navigation into the grid

Anything that navigates (sidebar click, palette, CLI `open`, a notification) lands in the grid by one rule: if the item is already in a pane, that pane gets focus and shows it; otherwise it opens as a preview chip in the focused pane.

Workspace history (`Mod+Alt+Left` / `Right`) keeps its meaning and still covers workspaces only. Going back to a workspace follows the rule above.

### Keyboard shortcuts

Registered in the keybinding catalog and rebindable in Settings → Shortcuts, in a "Split view" group:

| Action                   | Default             |
| ------------------------ | ------------------- |
| Focus next pane          | `Mod+Alt+ArrowDown` |
| Focus previous pane      | `Mod+Alt+ArrowUp`   |
| Maximize / restore pane  | `Mod+Alt+Enter`     |
| Split focused item right | unbound             |
| Split focused item down  | unbound             |
| Close pane               | unbound             |

None of the three defaults is taken in the catalog. `Mod+Alt+Left` / `Right` (workspace history) is taken and unchanged. On Linux, `Ctrl+Alt+Up` / `Down` switches desktops on some GNOME setups; workspace history has the same exposure with `Ctrl+Alt+Left` / `Right` today.

## When things go away

| Event                                                                             | Result                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent session ends                                                                | Its chip stays and shows the transcript with the ended status, as a session tab does today.                                                                                                                                               |
| Agent session is removed from the registry                                        | The chip stays and shows the existing "session is gone" notice with its close action. It is not closed silently.                                                                                                                          |
| Agent session is re-identified (resume gives it a new id)                         | The chip follows the rename.                                                                                                                                                                                                              |
| Workspace removed or archived                                                     | Its chip closes. If it was the pane's only chip the pane collapses.                                                                                                                                                                       |
| Project removed                                                                   | The project's chip and every workspace chip of that project close.                                                                                                                                                                        |
| Workspace asleep                                                                  | The chip stays. Focusing the pane wakes it through the normal activation path.                                                                                                                                                            |
| Item not resolvable after a restart (remote host offline, catalog not loaded yet) | The pane shows a quiet "not available" placeholder with a Close button and fills in if the item appears. An item is pruned only after this run has seen it exist and then vanish, so slow-loading catalogs never empty a restored layout. |

## Persistence

The split tree with its ratios, each pane's chips and active chip, and the focused pane are saved on every change and restored on launch. They are stored per device in the renderer (`localStorage`, key `seal.splitView.v1`), next to the agent-session tabs (`seal.liveSessionTabs.v1`). A window arrangement is local presentation, like sidebar width, and is deliberately not part of the synced workspace session that phones and paired clients read.

Saved state is parsed defensively: a malformed tree, an unknown item kind, or an item saved twice is dropped rather than trusted. On launch the app restores its last active item as it does today, and the pane holding that item becomes the focused pane.

## How it fits the existing layout

- **Titlebar.** While split view shows, the app uses the standard titlebar row that every non-workspace page has, so pane strips never dodge window controls. A workspace's own tab strip, which normally merges into the titlebar, renders inside its pane without the top strip and seam, and is not a window drag region. Single view keeps today's chrome.
- **Left sidebar.** Unchanged, apart from rows being draggable onto the main area and the new menu entries.
- **Right sidebar.** Stays where it is and describes the focused workspace. While a session or project pane is focused it keeps showing the last focused workspace instead of hiding, so that moving focus never resizes the grid.
- **Floating terminal, status bar, dialogs, command palette.** Unchanged.
- **Narrow windows.** Panes compress to the splitter clamp and strips scroll horizontally. Splits that would make an unusable pane are refused (see above). When the main area is narrower than two minimum panes (480 px), it shows only the focused pane, as if maximized, and the layout is kept.
- **Phone layouts and the mobile app.** Never show split view. The layout is not synced, so they are unaffected.
- **Remote hosts.** Items carry their host id, and workspace and project items open through the host-aware activation paths, so a grid can mix local and remote items. The renderer also runs as Remote Web over plain HTTP, so pane ids must come from the non-secure-context UUID helper, not `crypto.randomUUID`.
- **Folder workspaces.** A workspace item is any workspace the sidebar lists. Nothing assumes a git worktree.

## Architecture

### Model

```ts
type SplitViewItem =
  | { kind: 'workspace'; worktreeId: string; hostId: string | null }
  | { kind: 'session'; sessionId: string }
  | { kind: 'project'; repoId: string; hostId: string }

type SplitViewPane = { tabs: { item: SplitViewItem; preview: boolean }[]; activeKey: string | null }

type SplitViewState = {
  layout: TabGroupLayoutNode | null // leaf.groupId is a pane id
  panes: Record<string, SplitViewPane>
  focusedPaneId: string | null
  maximizedPaneId: string | null // not persisted
}
```

`layout` is the existing `TabGroupLayoutNode` tree from `src/shared/tab-types.ts`, edited with the existing pure operations in `src/shared/workspace-layout/tab-groups/tab-group-layout-tree.ts` (`buildSplitNode`, `replaceLeaf`, `removeGroupLayoutLeaf`, `findSiblingGroupId`, `updateSplitRatio`). There is no second tree implementation.

State lives in one small external store: pure reducers (place, reveal, activate, move, close, close others, close pane, prune, rename session, set ratio, toggle maximize, parse) and a persisted wrapper, mirroring `live-session-tabs-store.ts`. Every reducer ends in one `settle` step that drops emptied panes, repairs focus, and returns the empty state once a single pane with at most one chip is left.

### Rendering workspaces without remounting terminals

A workspace's terminals, editors and browser webviews are owned by the single retained workbench, which keeps every opened workspace mounted and shows one. Re-parenting them into panes would remount xterm instances and reload webviews, so they do not move:

- The grid is a layer over the main area, above the workbench, and click-through except for its strips and splitters.
- A pane showing a workspace renders an empty **slot** and registers its rectangle with the geometry registry tab groups already use (`registerTabGroupBody` / `subscribeTabGroupBodyRect`).
- The workbench shows every workspace that has a slot, not only the active one, and positions each workspace surface over its slot by writing `top/left/width/height` from that subscription. No React re-render and no remount on move, resize, split or maximize.
- Agent-session and project panes are ordinary React content inside their pane: `LiveSessionPane` and the project overview body. They render the inner pieces, not the pages, so a pane has no page-level back button or `Esc` handler.

"Visible" and "focused" become two separate facts. A single value, the map of workspace → pane for the slots on screen (`null` in single view), flows from the workbench's foundation hook. Visible means "has a slot"; focused means "is the active workspace". Each place that today tests "is this the active workspace" has to pick one:

| Concern                                               | Uses                                     | Where                                                                                                                                                                      |
| ----------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which surfaces render                                 | visible                                  | `TerminalSplitWorkspaceSurfaces`, `TerminalWorktreeSplitSurface`                                                                                                           |
| Terminal parking and watchers                         | visible                                  | `terminal-parking-pass-candidates`, `use-terminal-parking-pass`, `use-terminal-watcher-effects`, `use-terminal-parking-foundation`, `use-manual-terminal-worktree-parking` |
| Mounting a workspace not yet activated in this run    | visible                                  | `terminal-cold-activation`                                                                                                                                                 |
| Browser webview eviction                              | visible (never evict a shown workspace)  | `use-terminal-browser-retention`                                                                                                                                           |
| Foreground terminal tabs for agent hibernation        | visible                                  | `use-terminal-workspace-projection`                                                                                                                                        |
| Keyboard ownership, shortcut scope, focused tab group | focused                                  | `WorkspacePaneOverlayLayers`, `TerminalPaneOverlayLayer`, `StructuredAgentSessionPaneOverlayLayer`, `BrowserPaneOverlayLayer`                                              |
| Blurring a focused webview before it hides            | skipped when the target is already shown | `set-active-worktree`                                                                                                                                                      |
| Titlebar and right sidebar                            | split view showing or not                | `use-app-chrome-layout`, `AppWorkspaceShell`, `use-global-keybindings`                                                                                                     |

### Focus and navigation

There are two adapters and no new navigation concept:

- `navigateToSplitViewItem(item)` calls the canonical open path: workspace activation (`activateAndRevealWorkspace`, without scrolling the sidebar or clearing its filters), `openLiveSessionView`, or `openProjectOverview`.
- One subscriber, started once by the app shell, watches what the app is showing (`activeView` plus the active workspace, active session or open project) and tells the store to reveal it. The same subscriber prunes vanished workspaces and projects and follows session renames.

A pane command changes the store and then navigates only if the focused item changed. The subscriber's reveal is idempotent. Data flows one way, so there is no loop.

### Drag and drop

One module owns pane drop targets. Given a pointer position and an item it resolves pane, zone and strip index by hit-testing pane elements, drives the preview, and commits. It has three callers:

- the sidebar's existing workspace-card pointer drag and project-header drag, which hand over to it while the pointer is over the main area and skip their reorder commit when it takes the drop,
- one small generic pointer drag (5 px threshold, `Esc` cancels, swallows the trailing click, reuses the sidebar drag ghost) used by Active agents rows, which have no drag today, and by chips.

While a drag is over the main area, embedded webviews must let the pointer through; the existing drag-passthrough for webviews does this.

### Agent-session tabs

`liveSessionTabsStore` remains the owner of which sessions are open and of their focus requests. The grid records only where they are shown. A session chip is an open session tab, and closing the chip closes that tab.

The session page's own two-up split is a second, smaller split system. It goes away: "Open in split" places the session in a pane, the two-up rendering is removed from `LiveSessionWorkspace`, and a two-up saved by an earlier version turns into two panes at launch.

The chip is the session tab's chip, extracted from `LiveSessionWorkspace` and shared by both strips.

### What is reused

| Need                                | Reused                                                                     |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Split tree and its operations       | `TabGroupLayoutNode`, `tab-group-layout-tree.ts`                           |
| Splitter                            | `ResizeHandle` from `TabGroupSplitNodeTree.tsx` and its CSS                |
| Drop zones                          | `resolveDropZone` in `tab-drop-zone.ts`, with an edge-share parameter      |
| Drop preview                        | `TabGroupDropOverlay`                                                      |
| Slot geometry                       | `tab-group-body-geometry.ts`                                               |
| Workspace content                   | the retained workbench surfaces, same instances                            |
| Agent-session content               | `LiveSessionPane`, `useLiveSessions`, `liveSessionTabsStore`               |
| Project content                     | the overview body in `ProjectOverviewPage.tsx`                             |
| Chip                                | the session tab chip from `LiveSessionWorkspace.tsx`, extracted            |
| Drag ghost and drag cursor          | `createSidebarDragPreview`, `setSidebarPointerDragDocumentStyles`          |
| Webview pass-through while dragging | `acquireWebviewsDragPassthrough`                                           |
| Open paths                          | `activateAndRevealWorkspace`, `openLiveSessionView`, `openProjectOverview` |
| Menus                               | the workspace, project and session context menus, with new entries only    |
| Shortcuts                           | the keybinding catalog and dispatcher                                      |
| Persistence pattern                 | `live-session-tabs-store.ts`                                               |

## Performance

- Cost scales with the number of _visible_ panes, not open chips. A workspace behind another chip in the same pane is hidden and follows the existing hidden-terminal parking rules.
- Layout changes remount nothing. Splitter drags resize through direct style writes; terminals must refit through the existing fit path when their slot changes size.
- A session pane mounts only for the active chip of its pane.
- The grid layer is lazy-loaded and not mounted without a split layout, so it stays out of the renderer's boot graph.
- Many visible terminals mean many live renderers at once. The number of panes is not capped by this design; whether it should be is an open question.

## Accessibility

- Strips are `tablist` / `tab` with roving focus and arrow-key movement. Panes are labelled regions.
- Every drag has a menu equivalent, and shortcuts cover moving focus and maximizing.
- Focus indication does not rely on color alone (accent line plus text weight), and drop previews carry a text label.
- No animated pane transitions.
- Known gap: splitters cannot be moved from the keyboard, as in workspaces today. Fixing that belongs in the shared `ResizeHandle` so both places gain it.

## Out of scope

- Dragging a workspace's terminal or editor tabs into another workspace.
- More than one window, and syncing the layout to other devices.
- Named or saved layouts.
- Non-item pages (Home, Settings, Tasks and so on) as panes.
- Keyboard resizing and double-click-to-equalize on splitters.

## Notes for the build

- The repo's line-count ratchet (300 lines for `.ts`, 400 for `.tsx`) rules out one model file. Split types and tree repair, tab commands, and saved-state parsing. `use-terminal-parking-pass.ts`, `use-terminal-watcher-effects.ts`, `use-pointer-drag.ts`, `project-header-drag.ts` and `TabGroupPanel.tsx` are all within a few lines of their limit.
- Other ratchets this change touches: terminal parking ownership, layout writers, zustand selector fan-out (the navigation subscriber), the renderer boot graph, and the localization catalog for the new strings.
- Tests worth having, and no more: the pure reducers (place, move, close and collapse, parse) with hard-coded expected trees, and one end-to-end spec for the core loop (drop → split → resize → restart → restored).

## Testing

End-to-end in the real app (Electron with a hidden window, driven over CDP):

- each drop zone, from each kind of sidebar row, with real pointer events;
- a 2 × 2 grid mixing workspaces, an agent session and a project;
- resizing, and terminals refitting afterwards;
- dragging chips within a strip, between strips, and onto edges;
- closing chips and panes down to single view;
- restart and restore, including workspace panes that were not focused at quit;
- many panes with live terminals;
- light and dark themes;
- narrow windows;
- the Workspace Board drag, with the board closed and with it already open;
- typing into one pane while another streams output, to confirm unfocused panes take no keys.

## Verified and unverified

A prototype of the grid layer was run in the real app and then discarded. It is not on this branch.

Shown to work, with two and then three workspaces placed through the store rather than by dragging:

- workspaces with live terminals render side by side, each retained surface positioned exactly on its slot without being re-parented (remounts were not measured);
- each pane shows its strip above the workspace's own tab strip;
- the standard titlebar and the right sidebar stay intact.

Written in the prototype but never run, so treat as unproven:

- sidebar drags of all three row kinds, the drop preview, and the Workspace Board rule;
- chip drags, the context-menu entries, and "Open in split" routing;
- browser-eviction, hibernation and webview-blur handling for visible workspaces.

Not attempted:

- agent-session and project panes in the real app;
- restart and restore;
- terminal refit after splitter drags, maximize and pane close;
- keyboard shortcuts, narrow windows, themes, and carrying session tabs into the first pane.

## Open questions

1. **Workspace Board drag.** Is it acceptable that a card drag stops opening the board by itself while the main area shows an item? Alternatives: a modifier key picks the board; or the board opens only when the pointer reaches the sidebar's right edge.
2. **Restoring workspace panes.** A workspace's root tab group and first terminal are prepared on activation. Restored panes that are not the focused one have not been activated in this run. The design mounts them through the cold-activation path; if that proves unreliable, the fallback is a "click to load" placeholder in the pane. This needs a real restart test before anything else is built on it.
3. **Right sidebar while a session or project pane is focused.** Keeping the last workspace's panel avoids resizing the grid, but shows a workspace that is not the focused pane. Hiding its content while keeping its width is the alternative.
4. **Visible but unfocused workspaces and unread marks.** A workspace on screen can still show as unread in the sidebar because only focus counts as a visit. Is that right?
5. **Default shortcuts on Linux.** Keep `Mod+Alt+ArrowUp` / `Down` despite the GNOME overlap, or ship them unbound there?
6. **A cap on panes.** Should the number of visible panes, or of visible terminals, be limited, and what happens to WebGL terminal renderers as the count grows? This needs measuring with many live terminals.
7. **Edge-band size.** 30 % is a judgment call. It leaves a 40 % × 40 % center for "add as tab", plus the strip.
8. **Session tabs outside the grid.** Sessions open on the session page but not in the grid are remembered there and return when split view ends. Should they join the grid instead?
