import { AgentStateDot } from '@/components/AgentStateDot'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import { activeAgentsFilterStore } from '../active-agents/active-agents-filter-store'
import type { ActiveAgentsScope } from '../active-agents/active-agents-model'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { useLiveSessionLinks } from './use-live-session-links'

/**
 * On a project or workspace row: how many live sessions it has and what the most urgent one needs.
 * The sessions themselves are rows in Active agents; pointing here marks them, clicking filters to them.
 */
export function LiveSessionsBadge({
  scope
}: {
  scope: ActiveAgentsScope
}): React.JSX.Element | null {
  const t = useTranslate()
  const { byWorktree, byProject } = useLiveSessionLinks()
  const tabs = useLiveSessionTabs()
  const showingSessions = useAppStore((state) => state.activeView === 'sessions')
  const badge = (scope.kind === 'worktree' ? byWorktree : byProject).get(scope.id)
  if (!badge) {
    return null
  }
  const current =
    showingSessions && tabs.activeId !== null && badge.sessionIds.includes(tabs.activeId)
  const status = liveSessionStatusLabel(badge.status)
  return (
    <button
      type="button"
      data-live-sessions-badge={scope.kind}
      data-status={badge.status}
      data-current={current ? 'true' : undefined}
      title={
        badge.count === 1
          ? t('auto.components.live-sessions.badge.one', '1 agent session: {{status}}', { status })
          : t('auto.components.live-sessions.badge.many', '{{count}} agent sessions: {{status}}', {
              count: badge.count,
              status
            })
      }
      onPointerEnter={() => liveSessionMarksStore.highlight(badge.sessionIds)}
      onPointerLeave={() => liveSessionMarksStore.highlight([])}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        activeAgentsFilterStore.setScope(scope)
        liveSessionMarksStore.reveal(badge.sessionIds[0])
      }}
      className={cn(
        'flex h-4 shrink-0 items-center gap-1 rounded-full border border-worktree-sidebar-border px-1 text-2xs leading-none text-muted-foreground tabular-nums transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-worktree-sidebar-ring focus-visible:outline-none',
        current && 'border-agent-working/60 text-foreground'
      )}
    >
      <AgentStateDot state={liveSessionDotState(badge.status)} title={null} />
      {badge.count}
    </button>
  )
}
