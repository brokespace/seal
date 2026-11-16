import { useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SessionSummariesPausedNote } from '@/components/session-summaries/SessionSummariesPausedNote'
import { PageCard } from '@/components/page-layout/PageCard'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { buildActiveAgents } from '../live-sessions/row/live-session-machine-listing'
import { LiveSessionMachineGroups } from '../live-sessions/row/LiveSessionMachineGroups'
import { HomeOverviewEmpty } from './HomeOverviewRow'

/** Active agents' machines and rows, on Home: the same sessions in the same order. */
export function HomeSessionsPanel({
  sessions,
  now
}: {
  sessions: readonly LiveSession[]
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const view = useMemo(() => buildActiveAgents(sessions, now), [sessions, now])
  return (
    <PageCard
      title={t('home.overview.sessions.title', 'Sessions')}
      action={
        <span className="flex items-center gap-2">
          <SessionSummariesPausedNote />
          <span className="text-2xs text-muted-foreground tabular-nums">{view.activeCount}</span>
        </span>
      }
    >
      {view.machines.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'home.overview.sessions.empty',
            'No agent sessions yet. Start an agent in a workspace and it shows up here.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <LiveSessionMachineGroups machines={view.machines} now={now} />
      )}
    </PageCard>
  )
}
