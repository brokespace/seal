import { useMemo } from 'react'
import { Loader2, X } from 'lucide-react'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import { SidebarSectionHeader } from '@/components/sidebar/SidebarSectionHeader'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../live-session-clock'
import { useLiveSessions } from '../live-session-registry-store'
import { SessionMachineFilter } from './SessionMachineFilter'
import { SessionSelectionBar } from './SessionSelectionBar'
import { SessionStatusFilter } from './SessionStatusFilter'
import { SessionsOptionsMenu } from './SessionsOptionsMenu'
import {
  sidebarSessionFilterStore,
  useSidebarSessionFilters,
  type SidebarSessionFilters,
  type SidebarSessionStatusFilter
} from './sidebar-session-filter-store'
import {
  buildSidebarSessionsToolbar,
  sidebarSessionStatusFilterLabel
} from './sidebar-sessions-toolbar-model'

export type SidebarSessionsToolbarViewProps = {
  /** False until the first scan answers. */
  loaded: boolean
  sessions: readonly LiveSession[]
  hostErrors: Readonly<Record<string, string>>
  filters: SidebarSessionFilters
  now: number
  onMachineChange: (hostId: string | null) => void
  onStatusChange: (status: SidebarSessionStatusFilter | null) => void
  /** Shown last, while sessions are being selected. */
  selectionBar?: React.ReactNode
}

function FilterChip({
  filter,
  label,
  onClear
}: {
  filter: 'machine' | 'status'
  label: string
  onClear: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <button
      type="button"
      data-session-filter-chip={filter}
      onClick={onClear}
      title={t('auto.components.live-sessions.sessionRows.clearFilter', 'Clear filter')}
      className="flex h-5 max-w-full min-w-0 items-center gap-1 rounded-full bg-agent-working/15 px-2 text-2xs leading-none text-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none"
    >
      <span className="min-w-0 truncate">{label}</span>
      <X className="size-3 shrink-0" />
    </button>
  )
}

export function SidebarSessionsToolbarView(
  props: SidebarSessionsToolbarViewProps
): React.JSX.Element {
  const t = useTranslate()
  const machineName = useSessionMachineName()
  const { loaded, sessions, hostErrors, filters, now } = props
  const model = useMemo(
    () => buildSidebarSessionsToolbar(sessions, hostErrors, filters, now),
    [sessions, hostErrors, filters, now]
  )
  const title = t('auto.components.live-sessions.sessionRows.toolbarTitle', 'Sessions')
  const loading = t('auto.components.live-sessions.workspace.loading', 'Looking for sessions')
  const chosenMachine = model.machines.find((machine) => machine.hostId === filters.machine)
  const filtered = chosenMachine !== undefined || filters.status !== null
  return (
    <div data-sidebar-sessions-toolbar role="toolbar" aria-label={title} className="flex flex-col">
      <SidebarSectionHeader
        title={title}
        section="sessions"
        toggle={
          loaded ? (
            <span
              data-sidebar-sessions-count
              className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums"
            >
              {model.activeCount}
            </span>
          ) : (
            <Loader2
              aria-hidden
              className="ml-1 size-3 shrink-0 animate-spin text-muted-foreground"
            />
          )
        }
        actions={
          // Why here: the buttons take the muted colour of the Projects header's from their container.
          <div className="flex items-center gap-1 text-muted-foreground">
            <SessionMachineFilter
              machines={model.machines}
              total={model.activeCount}
              selected={filters.machine}
              onChange={props.onMachineChange}
            />
            <SessionStatusFilter
              counts={model.statusCounts}
              selected={filters.status}
              onChange={props.onStatusChange}
            />
            <SessionsOptionsMenu
              label={t('auto.components.live-sessions.sessionRows.options', 'Session options')}
              data-sidebar-sessions-menu
            />
          </div>
        }
      />
      <div className="flex flex-col gap-1 px-3 pb-1 empty:hidden">
        {loaded ? null : (
          // Why its own line: beside the title the sentence is cut at every usual sidebar width.
          <p role="status" className="px-1 text-2xs text-muted-foreground">
            {loading}
          </p>
        )}
        {filtered ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {chosenMachine ? (
              <FilterChip
                filter="machine"
                label={machineName(chosenMachine.machine)}
                onClear={() => props.onMachineChange(null)}
              />
            ) : null}
            {filters.status ? (
              <FilterChip
                filter="status"
                label={sidebarSessionStatusFilterLabel(filters.status)}
                onClear={() => props.onStatusChange(null)}
              />
            ) : null}
          </div>
        ) : null}
        {loaded && model.noMatch ? (
          <p data-sidebar-sessions-no-match className="px-1 text-2xs text-muted-foreground">
            {t('auto.components.live-sessions.sidebar.noMatch', 'No sessions match.')}
          </p>
        ) : null}
        {props.selectionBar}
      </div>
    </div>
  )
}

/** Pinned under the Projects header: how many sessions run, which of them the sidebar lists, and what applies to all. */
export function SidebarSessionsToolbar(): React.JSX.Element {
  const registry = useLiveSessions()
  const filters = useSidebarSessionFilters()
  const now = useLiveSessionClock()
  return (
    <SidebarSessionsToolbarView
      loaded={registry.loaded}
      sessions={registry.sessions}
      hostErrors={registry.hostErrors}
      filters={filters}
      now={now}
      onMachineChange={(hostId) => sidebarSessionFilterStore.setMachine(hostId)}
      onStatusChange={(status) => sidebarSessionFilterStore.setStatus(status)}
      selectionBar={<SessionSelectionBar />}
    />
  )
}
