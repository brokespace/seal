import type React from 'react'
import { useAppStore } from '@/store/index'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import { WorkspaceSessionRows } from './WorkspaceSessionRows'

/**
 * A workspace card's agents: one row per session. While a note picks the agent it goes to, the
 * card lists the agents that can take it in their place.
 */
export function WorkspaceCardSessions({
  worktreeId,
  hostId,
  sendTargets,
  className
}: {
  worktreeId: string
  hostId?: ExecutionHostId
  /** The card's list of agents a note can go to; null on a card set to list none. */
  sendTargets: React.ReactNode
  className?: string
}): React.ReactNode {
  const picking = useAppStore(
    (state) => state.agentSendPopoverTargetMode?.worktreeId === worktreeId
  )
  return picking && sendTargets ? (
    sendTargets
  ) : (
    <WorkspaceSessionRows worktreeId={worktreeId} hostId={hostId} className={className} />
  )
}
