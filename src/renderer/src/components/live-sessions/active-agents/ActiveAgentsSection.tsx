import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { ChevronRight, Ellipsis, Loader2 } from 'lucide-react'
import { useAppStore } from '@/store/index'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessions } from '../live-session-registry-store'
import { liveSessionAccountLabel, useLocalSealAccounts } from '../menu/live-session-accounts'
import { liveSessionMenuEffects, openLiveSessionView } from '../menu/live-session-menu-effects'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import { ActiveAgentsGroups, type ActiveAgentsRowState } from './ActiveAgentsGroups'
import { ActiveAgentsToolbar } from './ActiveAgentsToolbar'
import {
  ACTIVE_AGENTS_COLLAPSE_KEY,
  buildActiveAgents,
  visibleSessionIds
} from './active-agents-model'
import { activeAgentsUiStore, isUnread, useActiveAgentsUi } from './active-agents-ui-store'
import { useLiveSessionLinks } from './use-live-session-links'

const MACHINE_KEY = 'active-agents:machine:'
/** Present while the group is open: ended sessions start folded away. */
const FINISHED_OPEN_KEY = 'active-agents:finished-open'

function rowIn(list: HTMLElement | null, sessionId: string): HTMLElement | null {
  return list?.querySelector(`[data-active-agent-row="${CSS.escape(sessionId)}"]`) ?? null
}

/** Every agent session on every machine, below Projects: the one place session rows live. */
const ActiveAgentsSection = React.memo(function ActiveAgentsSection() {
  const t = useTranslate()
  const registry = useLiveSessions()
  const { links } = useLiveSessionLinks()
  const accounts = useLocalSealAccounts()
  const ui = useActiveAgentsUi()
  const tabs = useLiveSessionTabs()
  const now = useLiveSessionClock()
  const collapsedGroups = useAppStore((state) => state.collapsedGroups)
  const toggleCollapsedGroup = useAppStore((state) => state.toggleCollapsedGroup)
  const showingSessions = useAppStore((state) => state.activeView === 'sessions')
  const activeWorktreeId = useAppStore((state) =>
    state.activeView === 'terminal' ? state.activeWorktreeId : null
  )
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
    () => buildActiveAgents(registry.sessions, ui, links, now),
    [registry.sessions, ui, links, now]
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
  const reveal = ui.reveal
  useEffect(() => {
    const session = reveal ? byId.get(reveal.sessionId) : null
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
    const fade = setTimeout(() => activeAgentsUiStore.highlight([]), 4000)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(fade)
    }
    // Only a new request moves the list; later session updates must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce])

  const onOpen = useCallback(
    (session: LiveSession, event: React.MouseEvent | React.KeyboardEvent) => {
      openLiveSessionView(session.id, event.type === 'dblclick' ? 'tab' : 'preview')
    },
    []
  )
  const onPick = useCallback(
    (session: LiveSession, range: boolean) => {
      const from = range && anchor.current ? order.indexOf(anchor.current) : -1
      const to = order.indexOf(session.id)
      if (from !== -1 && to !== -1) {
        const picked = new Set(activeAgentsUiStore.getState().picked)
        for (const id of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
          picked.add(id)
        }
        activeAgentsUiStore.setPicked(picked)
        return
      }
      anchor.current = session.id
      activeAgentsUiStore.togglePicked(session.id)
    },
    [order]
  )
  const tabStop = tabs.activeId && order.includes(tabs.activeId) ? tabs.activeId : order[0]
  const rowState = useCallback(
    (session: LiveSession): ActiveAgentsRowState => {
      const link = links.get(session.id)
      return {
        workspaceName: link?.name ?? null,
        account: liveSessionAccountLabel(session, accounts),
        unread: isUnread(session, ui.seenAt),
        current: showingSessions && (session.id === tabs.activeId || session.id === tabs.splitId),
        highlighted:
          ui.highlighted.has(session.id) ||
          (activeWorktreeId !== null && link?.worktreeId === activeWorktreeId),
        picked: ui.picked ? ui.picked.has(session.id) : null,
        tabStop: session.id === tabStop
      }
    },
    [
      links,
      accounts,
      ui.seenAt,
      ui.highlighted,
      ui.picked,
      showingSessions,
      tabs,
      activeWorktreeId,
      tabStop
    ]
  )

  const focusRow = (sessionId: string | undefined): void => {
    if (sessionId) {
      rowIn(list.current, sessionId)?.focus()
    }
  }
  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-active-agent-row]')
    const at = row ? order.indexOf(row.dataset.activeAgentRow ?? '') : -1
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
    } else if (event.key === 'Escape' && ui.picked) {
      event.preventDefault()
      activeAgentsUiStore.setPicked(null)
    }
  }

  const pickedSessions = ui.picked
    ? [...ui.picked].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    : []
  const filtering = ui.query !== '' || ui.chips.size > 0 || ui.scope !== null
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
      aria-label={t('auto.components.live-sessions.sidebar.title', 'Active agents')}
      className={cn(
        'flex shrink-0 flex-col border-t border-worktree-sidebar-border px-2 py-1',
        open && 'max-h-[50%] min-h-24'
      )}
    >
      <div className="flex h-7 shrink-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          data-active-agents-toggle
          onClick={() => toggleCollapsedGroup(ACTIVE_AGENTS_COLLAPSE_KEY)}
          className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs font-semibold text-muted-foreground/80 transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none focus-visible:ring-inset"
        >
          <ChevronRight
            className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">
            {t('auto.components.live-sessions.sidebar.title', 'Active agents')}
          </span>
          <span className="shrink-0 font-normal tabular-nums">{view.activeCount}</span>
          {!registry.loaded ? <Loader2 className="size-3 shrink-0 animate-spin" /> : null}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
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
              onSelect={() => activeAgentsUiStore.setPicked(ui.picked ? null : new Set())}
            >
              {ui.picked
                ? t('auto.components.live-sessions.sidebar.stopPicking', 'Done selecting')
                : t('auto.components.live-sessions.sidebar.startPicking', 'Select sessions')}
            </DropdownMenuItem>
            {filtering ? (
              <DropdownMenuItem onSelect={() => activeAgentsUiStore.clearFilters()}>
                {t('auto.components.live-sessions.sidebar.clearFilters', 'Clear filters')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={openAgentSettings}>
              {t(
                'auto.components.live-sessions.sidebar.settings',
                'Idle sessions and notifications…'
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {open ? (
        <>
          <ActiveAgentsToolbar
            ui={ui}
            pickedSessions={pickedSessions}
            onQuery={(query) => activeAgentsUiStore.setQuery(query)}
            onChip={(chip) => activeAgentsUiStore.toggleChip(chip)}
            onClearScope={() => activeAgentsUiStore.setScope(null)}
            onBulk={(danger, sessions) => liveSessionMenuEffects.confirm(danger, sessions)}
            onStopPicking={() => activeAgentsUiStore.setPicked(null)}
            onEnterList={() => focusRow(tabStop)}
          />
          <div
            ref={list}
            role="listbox"
            aria-multiselectable={ui.picked !== null}
            aria-label={t('auto.components.live-sessions.sidebar.title', 'Active agents')}
            onKeyDown={onListKeyDown}
            className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto pb-1 outline-none"
          >
            {empty ? (
              <p className="px-1.5 py-1 text-2xs text-muted-foreground">
                {filtering
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
              onOpen={onOpen}
              onPick={onPick}
            />
          </div>
        </>
      ) : null}
    </section>
  )
})

export default ActiveAgentsSection
