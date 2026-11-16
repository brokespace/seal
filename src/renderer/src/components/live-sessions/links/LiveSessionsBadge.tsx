import type { LiveSessionStatus } from '../../../../../shared/live-sessions/live-session-types'
import { AgentStateDot } from '@/components/AgentStateDot'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { revealFirstListedSession } from '../workspace-rows/session-row-reveal'
import { useLiveSessionLinks } from './use-live-session-links'

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
 * The sessions themselves are rows under their workspaces; pointing here rings them, clicking
 * unfolds the project down to the first of them and rings them all.
 */
export function LiveSessionsBadge({ projectId }: { projectId: string }): React.JSX.Element | null {
  const t = useTranslate()
  const { byProject } = useLiveSessionLinks()
  const tabs = useLiveSessionTabs()
  const showingSessions = useAppStore((state) => state.activeView === 'sessions')
  const badge = byProject.get(projectId)
  if (!badge) {
    return null
  }
  const current =
    showingSessions && tabs.activeId !== null && badge.sessionIds.includes(tabs.activeId)
  const status = liveSessionStatusLabel(badge.status)
  return (
    <button
      type="button"
      data-live-sessions-badge="project"
      data-status={badge.status}
      data-current={current ? 'true' : undefined}
      title={liveSessionsCountLabel(t, badge.count, badge.status)}
      onPointerEnter={() => liveSessionMarksStore.highlight(badge.sessionIds)}
      onPointerLeave={() => liveSessionMarksStore.highlight([])}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
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
