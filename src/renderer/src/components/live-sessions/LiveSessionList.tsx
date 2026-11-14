import { Laptop, Server } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { SessionSummaryLine } from '@/components/session-summaries/SessionSummaryLine'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionSummaryView } from '../../../../shared/session-summaries/live-session-summary-view'
import {
  groupByMachine,
  liveSessionDotState,
  liveSessionProviderLabel,
  liveSessionStatusLabel,
  liveSessionTitle
} from './live-session-presentation'

function LiveSessionSummary({ session }: { session: LiveSession }): React.JSX.Element | null {
  const summary = liveSessionSummaryView(session)
  return summary ? <SessionSummaryLine summary={summary} className="mt-0.5" /> : null
}

export function LiveSessionList({
  sessions,
  hostErrors,
  selectedId,
  onSelect,
  checked,
  onCheck,
  now
}: {
  sessions: readonly LiveSession[]
  hostErrors: Readonly<Record<string, string>>
  selectedId: string | null
  onSelect: (sessionId: string) => void
  /** Set while picking sessions to remove together; rows toggle instead of opening. */
  checked: ReadonlySet<string> | null
  onCheck: (sessionId: string) => void
  now: number
}): React.JSX.Element {
  const t = useTranslate()
  const groups = groupByMachine(sessions)
  // Only connected hosts are scanned, so this stays as short as the connection list.
  const scanErrors = Object.entries(hostErrors).filter(
    ([id]) => !groups.some((g) => g.hostId === id)
  )
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
                onClick={() => (checked ? onCheck(session.id) : onSelect(session.id))}
                data-current={session.id === selectedId ? 'true' : undefined}
                aria-current={session.id === selectedId ? 'true' : undefined}
                aria-pressed={checked ? checked.has(session.id) : undefined}
                className={cn(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent',
                  session.id === selectedId && 'bg-accent'
                )}
              >
                {checked ? (
                  <span className="flex h-5 shrink-0 items-center">
                    <Checkbox
                      checked={checked.has(session.id)}
                      tabIndex={-1}
                      aria-hidden
                      className="pointer-events-none"
                    />
                  </span>
                ) : null}
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
                      <Badge variant="outline" className="shrink-0">
                        {t('auto.components.live-sessions.LiveSessionList.sealPane', 'Seal pane')}
                      </Badge>
                    ) : null}
                  </span>
                  <LiveSessionSummary session={session} />
                </span>
              </button>
            ))}
          </section>
        )
      })}
      {scanErrors.map(([id, message]) => (
        <p key={id} className="px-2 text-xs text-destructive">
          {message}
        </p>
      ))}
    </nav>
  )
}
