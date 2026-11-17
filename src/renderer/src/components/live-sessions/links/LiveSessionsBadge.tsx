import { useMemo, useRef } from 'react'
import { isActiveLiveSession } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSessionStatus } from '../../../../../shared/live-sessions/live-session-types'
import { AgentStateDot } from '@/components/AgentStateDot'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { useLiveSessions } from '../live-session-registry-store'
import { useIsAgentSessionShowing } from '../open/use-agent-session-showing'
import { revealFirstListedSession } from '../workspace-rows/session-row-reveal'
import { liveSessionsBadge } from './live-session-links'
import { useLiveSessionLinks } from './use-live-session-links'
import { useSidebarSessionGroups } from './use-workspace-sessions'

/** How many sessions run and what the most urgent of them needs, in words. */
export function liveSessionsCountLabel(
  t: ReturnType<typeof useTranslate>,
  count: number,
  status: LiveSessionStatus
): string {
  const options = { count, status: liveSessionStatusLabel(status) }
  return count === 1
    ? t('auto.components.live-sessions.badge.one', '1 agent session: {{status}}', options)
    : t('auto.components.live-sessions.badge.many', '{{count}} agent sessions: {{status}}', options)
}

/**
 * On a project's header: how many live sessions it has and what the most urgent one needs.
 * The sessions themselves are rows under their workspaces or right under the header; pointing
 * here rings them, clicking unfolds the project down to the first of them and rings them all.
 */
export function LiveSessionsBadge({
  projectId,
  headerKey
}: {
  projectId: string
  headerKey: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const { byProject } = useLiveSessionLinks()
  const { places, byHeader } = useSidebarSessionGroups()
  const { sessions } = useLiveSessions()
  const isShowing = useIsAgentSessionShowing()
  // A click's ring fades by itself: the list scrolling the badge from under the pointer must not end it.
  const ringIsFromClick = useRef(false)
  const badge = useMemo(() => {
    const onCards = new Set(byProject.get(projectId)?.sessionIds)
    const underHeader = new Set(byHeader.get(headerKey)?.map((session) => session.id))
    return liveSessionsBadge(
      sessions.filter(
        (session) =>
          isActiveLiveSession(session) &&
          // A session moved to another project left its workspace's card, and this count.
          (underHeader.has(session.id) ||
            (onCards.has(session.id) && places.get(session.id)?.kind === 'workspace'))
      )
    )
  }, [byProject, byHeader, places, sessions, projectId, headerKey])
  if (!badge) {
    return null
  }
  const current = sessions.some(
    (session) => badge.sessionIds.includes(session.id) && isShowing(session)
  )
  const status = liveSessionStatusLabel(badge.status)
  return (
    <button
      type="button"
      data-live-sessions-badge="project"
      data-status={badge.status}
      data-current={current ? 'true' : undefined}
      title={liveSessionsCountLabel(t, badge.count, badge.status)}
      onPointerEnter={() => {
        ringIsFromClick.current = false
        liveSessionMarksStore.highlight(badge.sessionIds)
      }}
      onPointerLeave={() => {
        if (!ringIsFromClick.current) {
          liveSessionMarksStore.highlight([])
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        ringIsFromClick.current = true
        revealFirstListedSession(badge.sessionIds)
        // The reveal rings the one row it scrolls to; the badge counts them all.
        liveSessionMarksStore.highlight(badge.sessionIds)
      }}
      className={cn(
        'flex h-4 shrink-0 items-center gap-1 rounded-full border border-worktree-sidebar-border px-1 text-2xs leading-none text-muted-foreground tabular-nums transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none',
        current && 'border-agent-working/60 text-foreground'
      )}
    >
      <AgentStateDot state={liveSessionDotState(badge.status)} label={status} title={null} />
      {badge.count}
    </button>
  )
}
