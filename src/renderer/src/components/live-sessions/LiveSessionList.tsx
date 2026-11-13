import { Laptop, Server } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import {
  groupByMachine,
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionTitle
} from './live-session-presentation'

export function LiveSessionList({
  sessions,
  hostErrors,
  selectedId,
  onSelect,
  now
}: {
  sessions: readonly LiveSession[]
  hostErrors: Readonly<Record<string, string>>
  selectedId: string | null
  onSelect: (sessionId: string) => void
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const groups = groupByMachine(sessions)
  const erroredHosts = Object.keys(hostErrors).filter((id) => !groups.some((g) => g.hostId === id))
  return (
    <nav
      className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3"
      aria-label={t('auto.components.live-sessions.LiveSessionList.label', 'Agent sessions')}
    >
      {groups.map((group) => {
        const MachineIcon = group.sessions[0].machine.kind === 'local' ? Laptop : Server
        return (
          <section key={group.hostId} className="flex flex-col gap-0.5">
            <h2 className="flex items-center gap-1.5 px-2 py-1 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
              <MachineIcon className="size-3.5" />
              <span className="truncate">{group.label}</span>
            </h2>
            {hostErrors[group.hostId] ? (
              <p className="px-2 text-xs text-destructive">{hostErrors[group.hostId]}</p>
            ) : null}
            {group.sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session.id)}
                data-current={session.id === selectedId ? 'true' : undefined}
                aria-current={session.id === selectedId ? 'true' : undefined}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  session.id === selectedId && 'bg-accent'
                )}
              >
                <span className="flex h-5 shrink-0 items-center">
                  <AgentStateDot
                    state={liveSessionDotState(session.status)}
                    title={liveSessionStatusLabel(session.status)}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                      {liveSessionTitle(session)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {session.lastActivityAt
                        ? formatShortTimeAgo(session.lastActivityAt, now)
                        : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {[
                        liveSessionProviderLabel(session),
                        session.project,
                        liveSessionStatusLabel(session.status)
                      ]
                        .filter(Boolean)
                        .join(' \u00b7 ')}
                    </span>
                    {session.origin === 'seal' ? (
                      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-3xs">
                        {t('auto.components.live-sessions.LiveSessionList.sealPane', 'Seal pane')}
                      </Badge>
                    ) : null}
                  </span>
                </span>
              </button>
            ))}
          </section>
        )
      })}
      {erroredHosts.map((hostId) => (
        <p key={hostId} className="px-2 text-xs text-destructive">
          {hostErrors[hostId]}
        </p>
      ))}
    </nav>
  )
}
