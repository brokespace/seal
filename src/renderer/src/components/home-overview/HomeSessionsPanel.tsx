import { useMemo } from 'react'
import { Folder, Monitor, Server } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { groupHomeSessions } from '../../../../shared/home-overview/home-overview-derivations'
import type { HomeSession } from './home-overview-model'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty } from './HomeOverviewRow'
import { HomeSessionRow } from './HomeSessionRow'

export function HomeSessionsPanel({
  sessions,
  now,
  onOpen
}: {
  sessions: readonly HomeSession[]
  now: number
  onOpen: (session: HomeSession) => void
}): React.JSX.Element {
  const t = useTranslate()
  const groups = useMemo(() => groupHomeSessions(sessions), [sessions])
  return (
    <PageCard
      title={t('home.overview.sessions.title', 'Sessions')}
      action={
        <span className="text-2xs text-muted-foreground tabular-nums">{sessions.length}</span>
      }
    >
      {groups.length === 0 ? (
        <HomeOverviewEmpty>
          {t(
            'home.overview.sessions.empty',
            'No agent sessions yet. Start an agent in a workspace and it shows up here.'
          )}
        </HomeOverviewEmpty>
      ) : (
        <div className="divide-y divide-border">
          {groups.map((machine) => {
            const MachineIcon = machine.machineId === 'local' ? Monitor : Server
            return (
              <div key={machine.machineId} className="px-2 py-2">
                <h3 className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-foreground">
                  <MachineIcon className="size-3.5 text-muted-foreground" />
                  <span className="truncate">{machine.machineLabel}</span>
                  <span className="text-2xs font-normal text-muted-foreground tabular-nums">
                    {machine.sessionCount}
                  </span>
                </h3>
                {machine.projects.map((project) => (
                  <div key={project.projectId} className="mt-1">
                    <h4 className="flex items-center gap-1.5 px-2 pt-1 text-2xs text-muted-foreground">
                      <Folder className="size-3" />
                      <span className="truncate">{project.projectName}</span>
                    </h4>
                    <ul>
                      {project.sessions.map((session) => (
                        <HomeSessionRow
                          key={session.id}
                          session={session}
                          now={now}
                          onOpen={onOpen}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </PageCard>
  )
}
