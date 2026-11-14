import { AgentWorkingSpinner } from '@/components/AgentWorkingSpinner'
import { cn } from '@/lib/class-names'
import {
  liveSessionStatusTone,
  type LiveSessionStatusTone
} from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSessionStatus } from '../../../../../shared/live-sessions/live-session-types'

/** The text color that goes with each dot; see docs/session-status.md for the color code. */
export const LIVE_SESSION_TONE_TEXT: Record<LiveSessionStatusTone, string> = {
  busy: 'text-agent-working',
  waiting: 'text-agent-working',
  approval: 'text-status-warning-text',
  question: 'text-agent-question-text',
  turn: 'text-status-success',
  failed: 'text-destructive',
  quiet: 'text-muted-foreground'
}

const FILL: Record<Exclude<LiveSessionStatusTone, 'waiting'>, string> = {
  busy: 'bg-agent-working',
  approval: 'bg-status-warning',
  question: 'bg-agent-question',
  turn: 'bg-status-success',
  failed: 'bg-destructive',
  quiet: 'bg-muted-foreground/40'
}

/** A halo makes the large dot of a session that needs its user the first thing seen in a list. */
const HALO: Partial<Record<LiveSessionStatusTone, string>> = {
  approval: 'ring-[3px] ring-status-warning/25',
  question: 'ring-[3px] ring-agent-question/25',
  failed: 'ring-[3px] ring-destructive/25'
}

const SIZES = {
  sm: { box: 'size-2.5', dot: 'size-1.5', ring: 'border-[1.5px]' },
  lg: { box: 'size-4', dot: 'size-3', ring: 'border-2' }
} as const

/**
 * A session's status as one colored dot: spinning blue while it works, solid blue while its shell
 * command runs, a blue ring while it waits on its own subagents or tasks, amber for an approval,
 * orange for a question, green when the turn is the user's, red for an error, grey when quiet.
 */
export function LiveSessionStatusDot({
  status,
  size = 'sm',
  className
}: {
  status: LiveSessionStatus
  size?: keyof typeof SIZES
  className?: string
}): React.JSX.Element {
  const tone = liveSessionStatusTone(status)
  const { box, dot, ring } = SIZES[size]
  return (
    <span
      aria-hidden
      data-live-session-status-dot={tone}
      className={cn('inline-flex shrink-0 items-center justify-center', box, className)}
    >
      {status === 'working' ? (
        <AgentWorkingSpinner className={dot} />
      ) : (
        <span
          className={cn(
            'block rounded-full',
            dot,
            tone === 'waiting' ? cn(ring, 'border-agent-working') : FILL[tone],
            size === 'lg' && HALO[tone]
          )}
        />
      )}
    </span>
  )
}
