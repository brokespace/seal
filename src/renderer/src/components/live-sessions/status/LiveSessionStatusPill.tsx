import { AgentStateDot } from '@/components/AgentStateDot'
import { cn } from '@/lib/class-names'
import { liveSessionStatusGroup } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionDotState, liveSessionStatusText } from '../live-session-presentation'

/**
 * A session's status wherever one is shown: the dot and what it waits on, blue while it works or
 * waits on its own subagents and tasks, the attention color when it needs the user.
 */
export function LiveSessionStatusPill({
  session,
  className
}: {
  session: Pick<LiveSession, 'status' | 'activity'>
  className?: string
}): React.JSX.Element {
  const group = liveSessionStatusGroup(session.status)
  return (
    <span
      data-live-session-status={session.status}
      data-status-group={group}
      className={cn(
        'flex min-w-0 items-center gap-1',
        group === 'working' && 'text-agent-working',
        group === 'attention' && 'text-agent-question-text',
        className
      )}
    >
      <AgentStateDot state={liveSessionDotState(session.status)} title={null} />
      <span className="min-w-0 truncate">{liveSessionStatusText(session)}</span>
    </span>
  )
}
