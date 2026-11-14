import { useMemo } from 'react'
import { Monitor, Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import {
  buildActiveAgents,
  NO_ACTIVE_AGENTS_FILTER
} from '../live-sessions/active-agents/active-agents-model'
import { useLiveSessionLinks } from '../live-sessions/links/use-live-session-links'
import { LiveSessionRows } from '../live-sessions/row/LiveSessionRows'
import { HomeOverviewEmpty, HomeOverviewPanel } from './HomeOverviewPanel'

/** Active agents' machines and rows, on Home: the same sessions in the same order. */
export function HomeSessionsPanel({
  sessions,
  now
}: {
  sessions: readonly LiveSession[]
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const { links } = useLiveSessionLinks()
  const view = useMemo(
    () => buildActiveAgents(sessions, NO_ACTIVE_AGENTS_FILTER, links, now),
    [sessions, links, now]
  )
  return (
    <HomeOverviewPanel
      title={t('home.overview.sessions.title', 'Sessions')}
      action={
        <span className="text-2xs text-muted-foreground tabular-nums">{view.activeCount}</span>
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
        <div className="divide-y divide-border">
          {view.machines.map((machine) => {
            const MachineIcon = machine.kind === 'local' ? Monitor : Server
            return (
              <div key={machine.hostId} data-home-sessions-machine={machine.hostId} className="p-2">
                <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
                  <MachineIcon className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{machine.label}</span>
                  <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                    {machine.sessions.length}
                  </span>
                </h3>
                <LiveSessionRows sessions={machine.sessions} label={machine.label} now={now} />
              </div>
            )
          })}
        </div>
      )}
    </HomeOverviewPanel>
  )
}
