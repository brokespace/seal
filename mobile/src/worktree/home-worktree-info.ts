import type { AgentWorkingMode } from '../../../src/shared/agent-status/contracts/agent-status-types'
import type { RuntimeWorktreeAgentRow } from '../../../src/shared/runtime-types'

export type HomeWorktreeSummary = {
  worktreeId: string
  repo: string
  branch: string
  displayName: string
  liveTerminalCount: number
  status?: 'working' | 'active' | 'permission' | 'done' | 'inactive'
  hasHostSidebarActivity?: boolean
  unread?: boolean
  isArchived?: boolean
  isActive?: boolean
  lastOutputAt?: number
  sidebarStatus?: string
  workingMode?: AgentWorkingMode
  agents?: RuntimeWorktreeAgentRow[]
}

export type HostWorktreeInfo = {
  hostId: string
  totalWorktrees: number
  activeCount: number
  catalogUnavailable?: boolean
  // The counts are the last proven ones, kept across a failed refresh.
  staleCounts?: boolean
  // Epoch ms of the last proven counts.
  countsProvenAt?: number
}

/** One desktop's counts read, as its card sees it. */
export type HomeWorktreeRead = {
  data: { totalWorktrees: number; activeCount: number } | undefined
  dataUpdatedAt: number
  // The latest read failed; counts it had stay, as stale ones.
  failed: boolean
}

/** A card's worktree info, or undefined while nothing is known. */
export function homeWorktreeInfo(
  hostId: string,
  read: HomeWorktreeRead
): HostWorktreeInfo | undefined {
  const { data, failed } = read
  if (!data) {
    // Never claim a count the host has not proven (STA-3123).
    return failed
      ? { hostId, totalWorktrees: 0, activeCount: 0, catalogUnavailable: true }
      : undefined
  }
  return {
    hostId,
    totalWorktrees: data.totalWorktrees,
    activeCount: data.activeCount,
    ...(failed ? { catalogUnavailable: true, staleCounts: true } : {}),
    countsProvenAt: read.dataUpdatedAt
  }
}

/** Adds the workspaces on a desktop's servers to the card of a desktop whose own count is known. */
export function withServerWorktreeCounts(
  byHost: Readonly<Record<string, HostWorktreeInfo>>,
  servers: Readonly<Record<string, { totalWorktrees: number; activeCount: number }>>
): Record<string, HostWorktreeInfo> {
  return Object.fromEntries(
    Object.entries(byHost).map(([hostId, info]) => {
      const server = servers[hostId]
      return [
        hostId,
        server
          ? {
              ...info,
              totalWorktrees: info.totalWorktrees + server.totalWorktrees,
              activeCount: info.activeCount + server.activeCount
            }
          : info
      ]
    })
  )
}

/** The host card's worktree line, or null when nothing is known yet. */
export function homeHostWorktreeSummary(info: HostWorktreeInfo | undefined): string | null {
  if (!info) {
    return null
  }
  // Never claim a count the host has not proven (STA-3123).
  if (info.catalogUnavailable && !info.staleCounts) {
    return 'Worktree list unavailable'
  }
  // Retained counts read the same as fresh ones; a "Last known" prefix cost the row too much width.
  return `${info.totalWorktrees} worktree${info.totalWorktrees === 1 ? '' : 's'}${
    info.activeCount > 0 ? ` · ${info.activeCount} active` : ''
  }`
}
