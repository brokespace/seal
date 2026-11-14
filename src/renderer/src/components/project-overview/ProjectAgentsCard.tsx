import { useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from '@/components/home-overview/HomeOverviewRow'
import { SessionSummariesPausedNote } from '@/components/session-summaries/SessionSummariesPausedNote'
import { buildActiveAgents } from '@/components/live-sessions/active-agents/active-agents-model'
import { useLiveSessionLinks } from '@/components/live-sessions/links/use-live-session-links'
import { showScopeInActiveAgents } from '@/components/live-sessions/links/show-scope-in-active-agents'
import { LiveSessionMachineGroups } from '@/components/live-sessions/row/LiveSessionMachineGroups'
import { LiveSessionRows } from '@/components/live-sessions/row/LiveSessionRows'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import type { Repo } from '../../../../shared/repo-types'

/** The project's agents: running ones under their machine, then the ones that ended in the last day. */
export function ProjectAgentsCard({
  repo,
  sessions,
  now
}: {
  repo: Repo
  /** Already narrowed to this project. */
  sessions: readonly LiveSession[]
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const { links } = useLiveSessionLinks()
  const view = useMemo(() => buildActiveAgents(sessions, null, links, now), [sessions, links, now])
  const finishedLabel = t('auto.components.live-sessions.sidebar.finished', 'Recently finished')
  const empty = view.machines.length === 0 && view.finished.length === 0
  return (
    <PageCard
      title={t('seal.projectOverview.agents.title', 'Agents')}
      action={
        <span className="flex items-center gap-2">
          <SessionSummariesPausedNote />
          {view.activeCount > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-project-overview-filter-agents
              // The sidebar badge's own click, so both lead to the same list and leave the page up.
              onClick={() =>
                showScopeInActiveAgents(
                  { kind: 'project', id: repo.id, label: repo.displayName },
                  view.machines[0]?.sessions[0]?.id
                )
              }
            >
              {t('seal.projectOverview.agents.showInActiveAgents', 'Show in Active agents')}
            </Button>
          ) : null}
          {/* Recently finished has its own count below, so this one says it leaves them out. */}
          <span
            data-project-overview-agents-count
            className="text-2xs text-muted-foreground tabular-nums"
          >
            {t('seal.projectOverview.agents.running', '{{count}} running', {
              count: view.activeCount
            })}
          </span>
        </span>
      }
    >
      {empty ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.agents.empty',
            'No agents are running in this project. Start one with New agent.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <div className="divide-y divide-border">
          {view.machines.length > 0 ? (
            <LiveSessionMachineGroups machines={view.machines} now={now} />
          ) : null}
          {view.finished.length > 0 ? (
            <div data-project-overview-finished className="p-2">
              <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
                <span className="truncate">{finishedLabel}</span>
                <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                  {view.finished.length}
                </span>
              </h3>
              <LiveSessionRows
                sessions={view.finished}
                label={finishedLabel}
                now={now}
                layout="card"
              />
            </div>
          ) : null}
        </div>
      )}
    </PageCard>
  )
}
