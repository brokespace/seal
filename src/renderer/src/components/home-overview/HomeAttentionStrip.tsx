import { useTranslate } from '@/i18n/use-translate'
import { liveSessionAttentionReason } from '../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { liveSessionTitle } from '../live-sessions/live-session-presentation'
import { LiveSessionStatusPill } from '../live-sessions/status/LiveSessionStatusPill'

const CHIP_CLASS =
  'flex max-w-72 min-w-0 shrink-0 flex-col rounded-md border border-border bg-card px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

function AttentionChip({
  session,
  onOpen
}: {
  session: LiveSession
  onOpen: (session: LiveSession) => void
}): React.JSX.Element {
  const reason = liveSessionAttentionReason(session)
  return (
    <button
      type="button"
      data-home-attention={session.id}
      className={CHIP_CLASS}
      title={reason ?? undefined}
      onClick={() => onOpen(session)}
    >
      <span className="w-full truncate font-medium text-foreground">
        {liveSessionTitle(session)}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1 text-2xs text-muted-foreground">
        <LiveSessionStatusPill session={session} className="shrink-0" />
        <span className="min-w-0 truncate">
          {[reason, session.machine.label]
            .filter(Boolean)
            .map((part) => `\u00b7 ${part}`)
            .join(' ')}
        </span>
      </span>
    </button>
  )
}

/** The sessions blocked on the user or failed, wherever they run. */
export function HomeAttentionStrip({
  sessions,
  onOpen
}: {
  sessions: readonly LiveSession[]
  onOpen: (session: LiveSession) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <section
      aria-label={t('home.overview.attention.title', 'Needs attention')}
      className="flex min-h-12 items-center gap-3"
    >
      <h2 className="shrink-0 text-2xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t('home.overview.attention.title', 'Needs attention')}
        <span className="ml-1.5 tabular-nums">{sessions.length}</span>
      </h2>
      {sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('home.overview.attention.empty', 'Nothing is waiting on you.')}
        </p>
      ) : (
        <ul className="scrollbar-sleek flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {sessions.map((session) => (
            <li key={session.id} className="flex">
              <AttentionChip session={session} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
