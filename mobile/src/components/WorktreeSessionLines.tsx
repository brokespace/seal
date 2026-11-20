import { useSharedNow } from '../hooks/use-now'
import {
  liveSessionDotState,
  liveSessionStatusLabel,
  liveSessionTitle
} from '../seal/live-sessions/live-session-presentation'
import type { LiveSession } from '../seal/live-sessions/live-session-schemas'
import { formatTimeAgo } from '../worktree/agent-row-display'
import { AgentActivityLine } from './WorktreeAgentRow'

/** A workspace's sessions outside Seal's panes, one line each like its agents. */
export function WorktreeSessionLines({
  sessions,
  isReadOnly,
  onPress
}: {
  sessions: readonly LiveSession[]
  isReadOnly?: boolean
  onPress?: (session: LiveSession) => void
}) {
  const now = useSharedNow(30_000)
  return sessions.map((session) => {
    const detail = session.permission?.question ?? session.summary ?? session.statusDetail
    return (
      <AgentActivityLine
        key={session.id}
        dotState={liveSessionDotState(session.status)}
        agentId={session.provider}
        time={formatTimeAgo(session.lastActivityAt, now)}
        disabled={isReadOnly}
        onPress={onPress ? () => onPress(session) : undefined}
      >
        {[liveSessionTitle(session), detail ?? liveSessionStatusLabel(session.status)].join(' · ')}
      </AgentActivityLine>
    )
  })
}
