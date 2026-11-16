import { useSyncExternalStore } from 'react'
import {
  liveSessionStatusGroup,
  type LiveSessionStatusGroup
} from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'

/** The status groups a running session can be in; the sidebar filters by one of them. */
export type SidebarSessionStatusFilter = Exclude<LiveSessionStatusGroup, 'finished'>

export const SIDEBAR_SESSION_STATUS_FILTERS: readonly SidebarSessionStatusFilter[] = [
  'attention',
  'working',
  'idle'
]

export type SidebarSessionFilters = {
  /** A machine's host id; null lists every machine. */
  machine: string | null
  status: SidebarSessionStatusFilter | null
}

const NO_FILTERS: SidebarSessionFilters = { machine: null, status: null }

/** Which session rows the sidebar lists, under workspaces and outside them: one machine, one status group. */
class SidebarSessionFilterStore {
  private state = NO_FILTERS
  private readonly listeners = new Set<() => void>()

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): SidebarSessionFilters => this.state

  setMachine(machine: string | null): void {
    this.set({ ...this.state, machine })
  }

  setStatus(status: SidebarSessionStatusFilter | null): void {
    this.set({ ...this.state, status })
  }

  clear(): void {
    this.set(NO_FILTERS)
  }

  private set(next: SidebarSessionFilters): void {
    if (next.machine === this.state.machine && next.status === this.state.status) {
      return
    }
    this.state = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const sidebarSessionFilterStore = new SidebarSessionFilterStore()

export function useSidebarSessionFilters(): SidebarSessionFilters {
  return useSyncExternalStore(
    sidebarSessionFilterStore.subscribe,
    sidebarSessionFilterStore.getState
  )
}

export function hasSidebarSessionFilters(filters: SidebarSessionFilters): boolean {
  return filters.machine !== null || filters.status !== null
}

export function matchesSidebarSessionFilters(
  session: Pick<LiveSession, 'status' | 'machine'>,
  filters: SidebarSessionFilters
): boolean {
  return (
    (filters.machine === null || session.machine.hostId === filters.machine) &&
    (filters.status === null || liveSessionStatusGroup(session.status) === filters.status)
  )
}
