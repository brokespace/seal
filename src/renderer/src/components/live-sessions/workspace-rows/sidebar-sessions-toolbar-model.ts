import { translate } from '@/i18n/i18n'
import {
  isActiveLiveSession,
  topLiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-status'
import {
  countLiveSessionGroups,
  groupLiveSessionsByMachine
} from '../../../../../shared/live-sessions/live-session-summary'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveSessionStatus
} from '../../../../../shared/live-sessions/live-session-types'
import {
  isRecentlyFinishedLiveSession,
  machineKnownByHostId
} from '../active-agents/active-agents-model'
import { liveSessionStatusLabel } from '../live-session-presentation'
import {
  hasSidebarSessionFilters,
  matchesSidebarSessionFilters,
  type SidebarSessionFilters,
  type SidebarSessionStatusFilter
} from './sidebar-session-filter-store'

export type SessionMachineOption = {
  hostId: string
  machine: Pick<LiveSessionMachine, 'kind' | 'label'>
  /** Active sessions on the machine. */
  count: number
  /** The most urgent of them. */
  topStatus: LiveSessionStatus | null
  /** Why the machine's last scan failed. */
  error: string | null
}

export type SidebarSessionsToolbarModel = {
  /** Active sessions on every machine, whatever the filters. */
  activeCount: number
  /** This computer first; includes hosts whose scan failed and the chosen machine, sessions or not. */
  machines: SessionMachineOption[]
  /** Active sessions per status group on the chosen machine. */
  statusCounts: Record<SidebarSessionStatusFilter, number>
  /** Filters are set and no listed session passes them. */
  noMatch: boolean
}

/** The dot that stands for a whole status group in the filter menu. */
export const SIDEBAR_SESSION_STATUS_FILTER_SAMPLES: Record<
  SidebarSessionStatusFilter,
  LiveSessionStatus
> = {
  attention: 'needs-permission',
  working: 'working',
  idle: 'idle'
}

export function sidebarSessionStatusFilterLabel(status: SidebarSessionStatusFilter): string {
  return status === 'attention'
    ? translate('auto.components.live-sessions.sessionRows.statusAttention', 'Needs you')
    : liveSessionStatusLabel(status)
}

export function buildSidebarSessionsToolbar(
  sessions: readonly LiveSession[],
  hostErrors: Readonly<Record<string, string>>,
  filters: SidebarSessionFilters,
  now: number
): SidebarSessionsToolbarModel {
  const active = sessions.filter(isActiveLiveSession)
  const machines: SessionMachineOption[] = groupLiveSessionsByMachine(active).map((group) => ({
    hostId: group.hostId,
    machine: { kind: group.kind, label: group.label },
    count: group.sessions.length,
    topStatus: topLiveSessionStatus(group.sessions.map((session) => session.status)),
    error: hostErrors[group.hostId] ?? null
  }))
  const withoutSessions = new Set(Object.keys(hostErrors))
  if (filters.machine !== null) {
    withoutSessions.add(filters.machine)
  }
  for (const hostId of withoutSessions) {
    if (machines.some((machine) => machine.hostId === hostId)) {
      continue
    }
    // An ended session still knows its machine's name; a remote host that only failed goes by its id.
    const known = sessions.find((session) => session.machine.hostId === hostId)?.machine
    machines.push({
      hostId,
      machine: known ?? machineKnownByHostId(hostId),
      count: 0,
      topStatus: null,
      error: hostErrors[hostId] ?? null
    })
  }
  const onMachine = active.filter(
    (session) => filters.machine === null || session.machine.hostId === filters.machine
  )
  return {
    activeCount: active.length,
    machines,
    statusCounts: countLiveSessionGroups(onMachine),
    noMatch:
      hasSidebarSessionFilters(filters) &&
      !sessions.some(
        (session) =>
          (isActiveLiveSession(session) || isRecentlyFinishedLiveSession(session, now)) &&
          matchesSidebarSessionFilters(session, filters)
      )
  }
}
