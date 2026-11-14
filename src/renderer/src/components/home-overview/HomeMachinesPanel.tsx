import { Monitor, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import { liveSessionsOnMachine } from '../../../../shared/live-sessions/live-session-machine-id'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import type { HomeMachine, HomeMachineStatus } from './home-overview-model'
import { homeMachineStatusLabel } from './home-overview-presentation'
import { PageCard } from '@/components/page-layout/PageCard'
import { HomeOverviewEmpty, HomeOverviewRowButton } from './HomeOverviewRow'

function statusDotClass(status: HomeMachineStatus): string {
  switch (status) {
    case 'online':
      return 'bg-status-success'
    case 'connecting':
      return 'bg-status-warning'
    case 'offline':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
  }
}

function loadLabel(machine: HomeMachine, t: Translate): string | null {
  const parts: string[] = []
  if (machine.load !== undefined) {
    parts.push(
      t('home.overview.machines.load', 'CPU {{percent}}%', {
        percent: Math.round(machine.load * 100)
      })
    )
  }
  if (machine.memoryUsedPercent !== undefined) {
    parts.push(
      t('home.overview.machines.memory', 'Mem {{percent}}%', {
        percent: Math.round(machine.memoryUsedPercent)
      })
    )
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export function HomeMachinesPanel({
  machines,
  sessions,
  onManage,
  onOpen
}: {
  machines: readonly HomeMachine[]
  sessions: readonly LiveSession[]
  onManage: () => void
  onOpen: (machine: HomeMachine) => void
}): React.JSX.Element {
  const t = useTranslate()
  const online = machines.filter((machine) => machine.status === 'online').length
  return (
    <PageCard
      title={t('home.overview.machines.title', 'Machines')}
      action={
        <Button variant="ghost" size="xs" onClick={onManage}>
          {t('home.overview.machines.manage', 'Manage')}
        </Button>
      }
    >
      {machines.length === 0 ? (
        <HomeOverviewEmpty>{t('home.overview.machines.empty', 'No machines.')}</HomeOverviewEmpty>
      ) : (
        <>
          <p className="px-3 pt-2 text-2xs text-muted-foreground tabular-nums">
            {t('home.overview.machines.summary', '{{online}} of {{total}} online', {
              online,
              total: machines.length
            })}
          </p>
          <ul className="px-1.5 py-1.5">
            {machines.map((machine) => {
              const Icon = machine.kind === 'local' ? Monitor : Server
              const load = loadLabel(machine, t)
              const active = liveSessionsOnMachine(sessions, machine).length
              return (
                <li key={machine.id}>
                  <HomeOverviewRowButton onClick={() => onOpen(machine)} className="px-1.5 py-1.5">
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-foreground">
                        {machine.label}
                      </span>
                      <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                        <span
                          aria-hidden
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            statusDotClass(machine.status)
                          )}
                        />
                        <span className="truncate tabular-nums">
                          {[homeMachineStatusLabel(machine.status, t), load]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </span>
                    {active > 0 ? (
                      <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
                        {t('home.overview.machines.active', '{{count}} active', { count: active })}
                      </span>
                    ) : null}
                  </HomeOverviewRowButton>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </PageCard>
  )
}
