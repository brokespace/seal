import { AgentStateDot } from '@/components/AgentStateDot'
import { SessionSummaryLine } from '@/components/session-summaries/SessionSummaryLine'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { HomeSession } from './home-overview-model'
import {
  formatHomeDuration,
  homeSessionDotState,
  homeSessionStateLabel
} from './home-overview-presentation'

function sessionElapsed(session: HomeSession, now: number): string | null {
  const live =
    session.state === 'working' || session.state === 'waiting' || session.state === 'permission'
  return live || session.finishedAt === null
    ? formatHomeDuration(session.startedAt, now)
    : formatHomeDuration(session.finishedAt, now)
}

export function HomeSessionRow({
  session,
  now,
  onOpen
}: {
  session: HomeSession
  now: number
  onOpen: (session: HomeSession) => void
}): React.JSX.Element {
  const t = useTranslate()
  const stateLabel = homeSessionStateLabel(session.state, t)
  const elapsed = sessionElapsed(session, now)
  const ask =
    session.state === 'waiting' || session.state === 'permission' ? session.askSummary : undefined
  // An approval prompt is the literal ask; otherwise the host's summary stands in for the raw message.
  const summary = session.state === 'permission' && ask ? undefined : session.summary
  const message = ask ?? session.lastMessage?.text
  const meta = [session.agentLabel, session.model, session.account, session.workspaceName].filter(
    (part): part is string => Boolean(part)
  )
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(session)}
        aria-label={`${session.title}: ${stateLabel}`}
        className="group flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <AgentStateDot state={homeSessionDotState(session.state)} title={stateLabel} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-[13px] text-foreground',
                session.unseen && 'font-semibold'
              )}
            >
              {session.title}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground tabular-nums">
              {stateLabel}
              {elapsed ? ` · ${elapsed}` : ''}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-2xs text-muted-foreground">
            {meta.join(' · ')}
          </span>
          {summary ? (
            <SessionSummaryLine summary={summary} className="mt-1" />
          ) : message ? (
            <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">
              {session.lastMessage?.role === 'user' && message === session.lastMessage.text
                ? `${t('home.overview.session.you', 'You')}: ${message}`
                : message}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  )
}
