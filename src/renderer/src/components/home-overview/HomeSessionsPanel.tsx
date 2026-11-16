import { useMemo } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { SessionSummariesPausedNote } from '@/components/session-summaries/SessionSummariesPausedNote'
import { PageCard } from '@/components/page-layout/PageCard'
import { liveSessionsNeedingAttention } from '../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { LiveSessionRows } from '../live-sessions/row/LiveSessionRows'
import { LiveSessionWorkspaceGroups } from '../live-sessions/row/LiveSessionWorkspaceGroups'
import { HomeOverviewEmpty } from './HomeOverviewRow'

/** Running sessions on Home: the ones that need the user first, the rest under their project and workspace. */
export function HomeSessionsPanel({
  sessions,
  now
}: {
  /** Already narrowed to running sessions. */
  sessions: readonly LiveSession[]
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const needsYou = useMemo(() => liveSessionsNeedingAttention(sessions), [sessions])
  // A session is listed once: the strip takes it out of its workspace.
  const rest = useMemo(
    () => sessions.filter((session) => !needsYou.includes(session)),
    [sessions, needsYou]
  )
  const needsYouLabel = t('auto.components.live-sessions.sessionRows.statusAttention', 'Needs you')
  return (
    <PageCard
      title={t('home.overview.sessions.title', 'Sessions')}
      action={
        <span className="flex items-center gap-2">
          <SessionSummariesPausedNote />
          <span className="text-2xs text-muted-foreground tabular-nums">{sessions.length}</span>
        </span>
      }
    >
      {sessions.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'home.overview.sessions.empty',
            'No agent sessions yet. Start an agent in a workspace and it shows up here.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <div className="divide-y divide-border">
          {needsYou.length > 0 ? (
            <div data-home-needs-you className="p-2">
              <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
                <span className="truncate">{needsYouLabel}</span>
                <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                  {needsYou.length}
                </span>
              </h3>
              <LiveSessionRows sessions={needsYou} label={needsYouLabel} now={now} layout="card" />
            </div>
          ) : null}
          {rest.length > 0 ? <LiveSessionWorkspaceGroups sessions={rest} now={now} /> : null}
        </div>
      )}
    </PageCard>
  )
}
