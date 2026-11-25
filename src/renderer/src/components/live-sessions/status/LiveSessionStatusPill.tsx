import { cn } from '@/lib/class-names'
import {
  liveSessionStatusGroup,
  liveSessionStatusTone
} from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionStatusText } from '../live-session-presentation'
import { LIVE_SESSION_TONE_TEXT, LiveSessionStatusDot } from './LiveSessionStatusDot'

/**
 * A session's status wherever one is shown: the dot and what it waits on, each in the status's
 * color. `dot={false}` is for a row that already shows the dot large.
 */
export function LiveSessionStatusPill({
  session,
  dot = true,
  className
}: {
  session: Pick<LiveSession, 'status' | 'activity'>
  dot?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      data-live-session-status={session.status}
      data-status-group={liveSessionStatusGroup(session.status)}
      className={cn(
        'flex min-w-0 items-center gap-1',
        LIVE_SESSION_TONE_TEXT[liveSessionStatusTone(session.status)],
        className
      )}
    >
      {dot ? <LiveSessionStatusDot status={session.status} /> : null}
      <span className="min-w-0 truncate">{liveSessionStatusText(session)}</span>
    </span>
  )
}
