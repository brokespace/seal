import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { SidebarSectionHeader } from '@/components/sidebar/SidebarSectionHeader'
import {
  revealInSidebarScrollSection,
  SIDEBAR_STICKY_SECTION_HEADER_CLASS,
  useSidebarScrollSectionHosts
} from '@/components/sidebar/sidebar-scroll-sections'
import {
  offerSidebarSectionKeyboardCursor,
  SIDEBAR_KEYBOARD_SECTION_PROPS,
  useSidebarSectionKeyboardEntry
} from '@/components/sidebar/sidebar-section-keyboard-handoff'
import { ProjectsCollapseAllButton } from '@/components/sidebar/worktree-list/controls/ProjectsCollapseAllButton'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessions } from '../live-session-registry-store'
import { openLiveSessionFromRow } from '../menu/live-session-menu-effects'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import { ActiveAgentsGroups, type ActiveAgentsRowState } from './ActiveAgentsGroups'
import {
  ACTIVE_AGENTS_COLLAPSE_KEY,
  buildActiveAgents,
  isListedLiveSession,
  visibleSessionIds
} from './active-agents-model'
import { useLiveSessionMarks } from '../live-session-marks-store'
import { useLiveSessionRowState } from '../row/use-live-session-row-state'
import { useUnassignedSessions } from '../links/use-workspace-sessions'
import { SessionsOptionsMenu } from '../workspace-rows/SessionsOptionsMenu'
import { SidebarSessionsToolbar } from '../workspace-rows/SidebarSessionsToolbar'
import { useSidebarSessionRowKeyboard } from '../workspace-rows/session-row-keyboard'
import { pickSidebarSessionRow } from '../workspace-rows/session-row-picking'
import {
  unhideSessionRow,
  useSessionRowRevealRequest,
  useWorkspaceSessionRowReveal
} from '../workspace-rows/session-row-reveal'
import {
  matchesSidebarSessionFilters,
  useSidebarSessionFilters
} from '../workspace-rows/sidebar-session-filter-store'

const MACHINE_KEY = 'active-agents:machine:'
/** Present while the group is open: ended sessions start folded away. */
const FINISHED_OPEN_KEY = 'active-agents:finished-open'

function rowIn(list: HTMLElement | null, sessionId: string): HTMLElement | null {
  return list?.querySelector(`[data-live-session-row="${CSS.escape(sessionId)}"]`) ?? null
}

/** The agent sessions no workspace holds, on every machine; a workspace's own are rows on its card. */
const UnassignedActiveAgents = React.memo(function UnassignedActiveAgents() {
  const t = useTranslate()
  const registry = useLiveSessions()
  const unassigned = useUnassignedSessions()
  const filters = useSidebarSessionFilters()
  const sharedRowState = useLiveSessionRowState()
  const marks = useLiveSessionMarks()
  const tabs = useLiveSessionTabs()
  const now = useLiveSessionClock()
  const hosts = useSidebarScrollSectionHosts()
  const collapsedGroups = useAppStore((state) => state.collapsedGroups)
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const list = useRef<HTMLDivElement>(null)
  const pinned = useRef<HTMLDivElement>(null)
  // Why after the first commit: the Projects header is portaled into the same host and must stay ahead of the toolbar.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useSidebarSessionRowKeyboard()
  useWorkspaceSessionRowReveal()

  const open = !collapsedGroups.has(ACTIVE_AGENTS_COLLAPSE_KEY)
  const finishedOpen = collapsedGroups.has(FINISHED_OPEN_KEY)
  const collapsedMachines = useMemo(
    () =>
      new Set(
        [...collapsedGroups]
          .filter((key) => key.startsWith(MACHINE_KEY))
          .map((key) => key.slice(MACHINE_KEY.length))
      ),
    [collapsedGroups]
  )
  const sessions = useMemo(
    () => unassigned.filter((session) => matchesSidebarSessionFilters(session, filters)),
    [unassigned, filters]
  )
  const view = useMemo(() => buildActiveAgents(sessions, now), [sessions, now])
  const order = useMemo(
    () => visibleSessionIds(view, { machines: collapsedMachines, finished: !finishedOpen }),
    [view, collapsedMachines, finishedOpen]
  )

  // A row asked for from elsewhere (a fresh launch, the palette) is unfolded and shown.
  useSessionRowRevealRequest((session, worktreeId) => {
    // A workspace's session is revealed on its card.
    if (worktreeId) {
      return null
    }
    unhideSessionRow(session, FINISHED_OPEN_KEY)
    const { collapsedGroups: collapsed, toggleCollapsedGroup: toggle } = useAppStore.getState()
    for (const key of [ACTIVE_AGENTS_COLLAPSE_KEY, MACHINE_KEY + session.machine.hostId]) {
      if (collapsed.has(key)) {
        toggle(key)
      }
    }
    const frame = requestAnimationFrame(() => {
      const row = rowIn(list.current, session.id)
      if (row) {
        revealInSidebarScrollSection(row, pinned.current)
      }
    })
    return () => cancelAnimationFrame(frame)
  })

  const tabStop = tabs.activeId && order.includes(tabs.activeId) ? tabs.activeId : order[0]
  const rowState = useCallback(
    (session: LiveSession): ActiveAgentsRowState => ({
      ...sharedRowState(session),
      picked: marks.picked ? marks.picked.has(session.id) : null,
      tabStop: session.id === tabStop
    }),
    [sharedRowState, marks.picked, tabStop]
  )

  const focusRow = (sessionId: string | undefined): void => {
    const row = sessionId ? rowIn(list.current, sessionId) : null
    if (row) {
      // Why not the browser's focus scroll: it cannot see the header pinned over the rows.
      row.focus({ preventScroll: true })
      // The first row brings the label above it into view, as at the top of a list of its own.
      const target = sessionId === order[0] ? (list.current ?? row) : row
      revealInSidebarScrollSection(target, pinned.current)
    }
  }
  // Arrow keys run through the whole sidebar list: the Projects rows hand the cursor back here.
  useSidebarSectionKeyboardEntry(
    () => list.current,
    (edge) => {
      const sessionId = edge === 'first' ? order[0] : order.at(-1)
      focusRow(sessionId)
      return sessionId !== undefined
    }
  )
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // A row's open menu is drawn outside the list; its keys reach here through React and are the menu's.
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
      return
    }
    const row =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-live-session-row]')
        : null
    const at = row ? order.indexOf(row.dataset.liveSessionRow ?? '') : -1
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = at + (event.key === 'ArrowDown' ? 1 : -1)
      // Past its own ends the cursor moves on through the sidebar list, or stays when no other section has a row.
      if (at === -1 || (next >= 0 && next < order.length)) {
        focusRow(order[Math.max(0, Math.min(next, order.length - 1))])
      } else {
        offerSidebarSectionKeyboardCursor(
          list.current,
          event.key === 'ArrowDown' ? 'down' : 'up',
          event.repeat
        )
      }
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(order[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(order.at(-1))
    }
  }

  const title = t('auto.components.live-sessions.sidebar.title', 'Active agents')
  const listable = (session: LiveSession): boolean => isListedLiveSession(session, now)
  const emptyText = (): string | null => {
    if (!registry.loaded) {
      return t('auto.components.live-sessions.workspace.loading', 'Looking for sessions')
    }
    if (unassigned.some(listable)) {
      // Its own sessions are only filtered out. With no row left anywhere the toolbar says so already.
      return registry.sessions.some(
        (session) => listable(session) && matchesSidebarSessionFilters(session, filters)
      )
        ? t('auto.components.live-sessions.sidebar.noMatch', 'No sessions match.')
        : null
    }
    return registry.sessions.some(listable)
      ? t(
          'auto.components.live-sessions.sessionRows.allUnderWorkspaces',
          'Every session is listed under its workspace.'
        )
      : t(
          'auto.components.live-sessions.sidebar.empty',
          'No Claude Code or Codex sessions are running on this machine, a connected SSH host or a paired server.'
        )
  }
  const empty = view.machines.length === 0 && view.finished.length === 0 ? emptyText() : null
  // The total, whatever the filters, as the toolbar's count is.
  const activeCount = unassigned.filter(isActiveLiveSession).length

  return (
    <>
      <section data-testid="active-agents" data-open={open} aria-label={title}>
        <div ref={pinned} className={SIDEBAR_STICKY_SECTION_HEADER_CLASS}>
          <SidebarSectionHeader
            title={title}
            section="active-agents"
            toggle={
              <>
                <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
                  {activeCount}
                </span>
                {!registry.loaded ? (
                  <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                <span data-active-agents-toggle className="flex shrink-0">
                  <ProjectsCollapseAllButton
                    allCollapsed={!open}
                    onToggle={() => toggleCollapsedGroup(ACTIVE_AGENTS_COLLAPSE_KEY)}
                    label={
                      open
                        ? t(
                            'auto.components.live-sessions.sidebar.collapse',
                            'Collapse active agents'
                          )
                        : t('auto.components.live-sessions.sidebar.expand', 'Expand active agents')
                    }
                    pinned={!open}
                  />
                </span>
              </>
            }
            actions={
              <SessionsOptionsMenu
                label={t('auto.components.live-sessions.sidebar.options', 'Active agents options')}
                data-active-agents-menu
              />
            }
          />
        </div>
        {open ? (
          <div className="px-2 pb-1">
            <div
              ref={list}
              role="listbox"
              // Sidebar chrome, not a popup: Escape and arrow keys stay with the page beside it.
              data-focus-behavior="page"
              aria-multiselectable={marks.picked !== null}
              aria-label={title}
              {...SIDEBAR_KEYBOARD_SECTION_PROPS}
              onKeyDown={onListKeyDown}
              className="flex flex-col pb-1 outline-none"
            >
              {empty ? <p className="px-1.5 py-1 text-2xs text-muted-foreground">{empty}</p> : null}
              <ActiveAgentsGroups
                view={view}
                collapsedMachines={collapsedMachines}
                finishedOpen={finishedOpen}
                hostErrors={registry.hostErrors}
                rowState={rowState}
                now={now}
                onToggleMachine={(hostId) => toggleCollapsedGroup(MACHINE_KEY + hostId)}
                onToggleFinished={() => toggleCollapsedGroup(FINISHED_OPEN_KEY)}
                onOpen={openLiveSessionFromRow}
                onPick={pickSidebarSessionRow}
              />
            </div>
          </div>
        ) : null}
      </section>
      {mounted && hosts ? createPortal(<SidebarSessionsToolbar />, hosts.pinnedHeader) : null}
    </>
  )
})

/** The sidebar list's first section. It also mounts the sessions toolbar pinned over the whole list. */
const ActiveAgentsSection = React.memo(function ActiveAgentsSection() {
  // Windows without the registry (a paired web client) have no sessions to list or filter.
  if (!window.api?.liveSessions?.onEvent) {
    return null
  }
  return <UnassignedActiveAgents />
})

export default ActiveAgentsSection
