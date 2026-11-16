import { AgentStateDot } from '@/components/AgentStateDot'
import { useAppStore } from '@/store/index'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import type { ActiveAgentsScope } from '../active-agents/active-agents-model'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { showScopeInActiveAgents } from './show-scope-in-active-agents'
import { useLiveSessionLinks } from './use-live-session-links'

/**
 * On a project's header: how many live sessions it has and what the most urgent one needs.
 * The sessions themselves are rows under their workspaces; pointing here rings them, clicking
 * unfolds the project down to the first of them and rings them all.
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
        showScopeInActiveAgents(scope, badge.sessionIds[0])
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
