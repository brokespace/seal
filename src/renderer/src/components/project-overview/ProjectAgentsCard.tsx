import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from '@/components/home-overview/HomeOverviewRow'
import { SessionSummariesPausedNote } from '@/components/session-summaries/SessionSummariesPausedNote'
import { isListedLiveSession } from '@/components/live-sessions/active-agents/active-agents-model'
import { LiveSessionRows } from '@/components/live-sessions/row/LiveSessionRows'
import { LiveSessionWorkspaceGroups } from '@/components/live-sessions/row/LiveSessionWorkspaceGroups'
import { revealFirstListedSession } from '@/components/live-sessions/workspace-rows/session-row-reveal'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import { compareListedLiveSessions } from '../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'

/** The project's agents: running ones under their workspace, then the ones that ended in the last day. */
export function ProjectAgentsCard({
  sessions,
  now
}: {
  /** Already narrowed to this project. */
  sessions: readonly LiveSession[]
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const running = useMemo(
    () => sessions.filter(isActiveLiveSession).sort(compareListedLiveSessions),
    [sessions]
  )
  const finished = useMemo(
    () =>
      sessions
        .filter((session) => !isActiveLiveSession(session) && isListedLiveSession(session, now))
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
    [sessions, now]
  )
  const finishedLabel = t('auto.components.live-sessions.sidebar.finished', 'Recently finished')
  return (
    <PageCard
      title={t('seal.projectOverview.agents.title', 'Agents')}
      action={
        <span className="flex items-center gap-2">
          <SessionSummariesPausedNote />
          {running.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              data-project-overview-filter-agents
              // The sidebar badge's own reveal, so both lead to the same rows and leave the page up.
              onClick={() => {
                useAppStore.getState().setSidebarOpen(true)
                revealFirstListedSession(running.map((session) => session.id))
              }}
            >
              {t('seal.projectOverview.agents.showInSidebar', 'Show in sidebar')}
            </Button>
          ) : null}
          {/* Recently finished has its own count below, so this one says it leaves them out. */}
          <span
            data-project-overview-agents-count
            className="text-2xs text-muted-foreground tabular-nums"
          >
            {t('seal.projectOverview.agents.active', '{{count}} active', {
              count: running.length
            })}
          </span>
        </span>
      }
    >
      {running.length === 0 && finished.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'seal.projectOverview.agents.empty',
            'No agents are active in this project. Start one with New agent.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <div className="divide-y divide-border">
          {running.length > 0 ? (
            <LiveSessionWorkspaceGroups sessions={running} now={now} showProjects={false} />
          ) : null}
          {finished.length > 0 ? (
            <div data-project-overview-finished className="p-2">
              <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
                <span className="truncate">{finishedLabel}</span>
                <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                  {finished.length}
                </span>
              </h3>
              <LiveSessionRows sessions={finished} label={finishedLabel} now={now} layout="card" />
            </div>
          ) : null}
        </div>
      )}
    </PageCard>
  )
}
