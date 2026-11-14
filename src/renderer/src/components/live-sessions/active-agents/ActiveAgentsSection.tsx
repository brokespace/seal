import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Ellipsis, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTranslate } from '@/i18n/use-translate'
import { SidebarSectionHeader } from '@/components/sidebar/SidebarSectionHeader'
import { ProjectsCollapseAllButton } from '@/components/sidebar/worktree-list/controls/ProjectsCollapseAllButton'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { liveSessionRegistryStore, useLiveSessions } from '../live-session-registry-store'
import { liveSessionMenuEffects, openLiveSessionFromRow } from '../menu/live-session-menu-effects'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import { ActiveAgentsGroups, type ActiveAgentsRowState } from './ActiveAgentsGroups'
import { ActiveAgentsToolbar } from './ActiveAgentsToolbar'
import {
  ACTIVE_AGENTS_COLLAPSE_KEY,
  buildActiveAgents,
  visibleSessionIds
} from './active-agents-model'
import { activeAgentsScopeStore, useActiveAgentsScope } from './active-agents-scope-store'
import { liveSessionMarksStore, useLiveSessionMarks } from '../live-session-marks-store'
import { useLiveSessionRowState } from '../row/use-live-session-row-state'
import { useLiveSessionLinks } from '../links/use-live-session-links'

const MACHINE_KEY = 'active-agents:machine:'
/** Present while the group is open: ended sessions start folded away. */
const FINISHED_OPEN_KEY = 'active-agents:finished-open'

function rowIn(list: HTMLElement | null, sessionId: string): HTMLElement | null {
  return list?.querySelector(`[data-live-session-row="${CSS.escape(sessionId)}"]`) ?? null
}

/** Every agent session on every machine, below Projects: the one place session rows live. */
const ActiveAgentsSection = React.memo(function ActiveAgentsSection() {
  const t = useTranslate()
  const registry = useLiveSessions()
  const { links } = useLiveSessionLinks()
  const sharedRowState = useLiveSessionRowState()
  const scope = useActiveAgentsScope()
  const marks = useLiveSessionMarks()
  const tabs = useLiveSessionTabs()
  const now = useLiveSessionClock()
  const collapsedGroups = useAppStore((state) => state.collapsedGroups)
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const list = useRef<HTMLDivElement>(null)
  const anchor = useRef<string | null>(null)

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
  const view = useMemo(
    () => buildActiveAgents(registry.sessions, scope, links, now),
    [registry.sessions, scope, links, now]
  )
  const order = useMemo(
    () => visibleSessionIds(view, { machines: collapsedMachines, finished: !finishedOpen }),
    [view, collapsedMachines, finishedOpen]
  )
  const byId = useMemo(
    () => new Map(registry.sessions.map((session) => [session.id, session])),
    [registry.sessions]
  )

  // A row asked for from elsewhere (a Projects badge, a fresh launch, the palette) is unfolded and shown.
  const reveal = marks.reveal
  useEffect(() => {
    // Read at the moment of the request: later session updates must not move the list again.
    const session = reveal
      ? liveSessionRegistryStore.getState().sessions.find((s) => s.id === reveal.sessionId)
      : null
    if (!reveal || !session) {
      return
    }
    const { collapsedGroups: collapsed, toggleCollapsedGroup: toggle } = useAppStore.getState()
    for (const key of [ACTIVE_AGENTS_COLLAPSE_KEY, MACHINE_KEY + session.machine.hostId]) {
      if (collapsed.has(key)) {
        toggle(key)
      }
    }
    const frame = requestAnimationFrame(() =>
      rowIn(list.current, reveal.sessionId)?.scrollIntoView({ block: 'nearest' })
    )
    const fade = setTimeout(() => liveSessionMarksStore.highlight([]), 4000)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(fade)
    }
  }, [reveal])

  const onPick = useCallback(
    (session: LiveSession, range: boolean) => {
      const from = range && anchor.current ? order.indexOf(anchor.current) : -1
      const to = order.indexOf(session.id)
      if (from !== -1 && to !== -1) {
        const picked = new Set(liveSessionMarksStore.getState().picked)
        for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          picked.add(id)
        }
        liveSessionMarksStore.setPicked(picked)
        return
      }
      anchor.current = session.id
      liveSessionMarksStore.togglePicked(session.id)
    },
    [order]
  )
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
    if (sessionId) {
      rowIn(list.current, sessionId)?.focus()
    }
  }
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const row =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[data-live-session-row]')
        : null
    const at = row ? order.indexOf(row.dataset.liveSessionRow ?? '') : -1
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusRow(order[Math.min(at + 1, order.length - 1)])
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusRow(order[Math.max(at - 1, 0)])
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusRow(order[0])
    } else if (event.key === 'End') {
      event.preventDefault()
      focusRow(order.at(-1))
    } else if (event.key === 'Escape' && marks.picked) {
      event.preventDefault()
      liveSessionMarksStore.setPicked(null)
    }
  }

  const pickedSessions = marks.picked
    ? [...marks.picked].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    : []
  const title = t('auto.components.live-sessions.sidebar.title', 'Active agents')
  const empty = view.machines.length === 0 && view.finished.length === 0
  const openAgentSettings = (): void => {
    const store = useAppStore.getState()
    store.openSettingsPage()
    store.openSettingsTarget({ pane: 'agents', repoId: null })
  }

  // Windows without the registry (a paired web client) have no sessions to list.
  if (!window.api?.liveSessions?.onEvent) {
    return null
  }
  return (
    <section
      data-testid="active-agents"
      data-open={open}
      aria-label={title}
      className="flex min-h-0 flex-col border-t border-worktree-sidebar-border"
    >
      <SidebarSectionHeader
        className="mt-1"
        title={title}
        section="active-agents"
        toggle={
          <>
            <span className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums">
              {view.activeCount}
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
                    ? t('auto.components.live-sessions.sidebar.collapse', 'Collapse active agents')
                    : t('auto.components.live-sessions.sidebar.expand', 'Expand active agents')
                }
                pinned={!open}
              />
            </span>
          </>
        }
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                data-active-agents-menu
                aria-label={t(
                  'auto.components.live-sessions.sidebar.options',
                  'Active agents options'
                )}
              >
                <Ellipsis className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void window.api.liveSessions?.refresh()}>
                {t('auto.components.live-sessions.LiveSessionsPage.refresh', 'Scan again')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => liveSessionMarksStore.setPicked(marks.picked ? null : new Set())}
              >
                {marks.picked
                  ? t('auto.components.live-sessions.sidebar.stopPicking', 'Done selecting')
                  : t('auto.components.live-sessions.sidebar.startPicking', 'Select sessions')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={openAgentSettings}>
                {t(
                  'auto.components.live-sessions.sidebar.settings',
                  'Idle sessions and notifications…'
                )}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />
      {open ? (
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-1">
          <ActiveAgentsToolbar
            scope={scope}
            picked={marks.picked}
            pickedSessions={pickedSessions}
            onClearScope={() => activeAgentsScopeStore.setScope(null)}
            onBulk={(danger, sessions) => liveSessionMenuEffects.confirm(danger, sessions)}
            onStopPicking={() => liveSessionMarksStore.setPicked(null)}
          />
          <div
            ref={list}
            role="listbox"
            // Sidebar chrome, not a popup: Escape and arrow keys stay with the page beside it.
            data-focus-behavior="page"
            aria-multiselectable={marks.picked !== null}
            aria-label={title}
            onKeyDown={onListKeyDown}
            className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto pb-1 outline-none"
          >
            {empty ? (
              <p className="px-1.5 py-1 text-2xs text-muted-foreground">
                {scope
                  ? t('auto.components.live-sessions.sidebar.noMatch', 'No sessions match.')
                  : registry.loaded
                    ? t(
                        'auto.components.live-sessions.sidebar.empty',
                        'No Claude Code or Codex sessions are running on this machine, a connected SSH host or a paired server.'
                      )
                    : t('auto.components.live-sessions.workspace.loading', 'Looking for sessions')}
              </p>
            ) : null}
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
              onPick={onPick}
            />
          </div>
        </div>
      ) : null}
    </section>
  )
})

export default ActiveAgentsSection
