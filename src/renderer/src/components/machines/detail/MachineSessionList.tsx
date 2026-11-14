import { useTranslate } from '@/i18n/use-translate'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionClock } from '../../live-sessions/live-session-clock'
import { LiveSessionRows } from '../../live-sessions/row/LiveSessionRows'

/** The machine's sessions, as Active agents lists them. */
export function MachineSessionList({
  sessions
}: {
  sessions: readonly LiveSession[]
}): React.JSX.Element {
  const t = useTranslate()
  const now = useLiveSessionClock()
  if (sessions.length === 0) {
    return (
      <p className="text-2xs text-muted-foreground">
        {t('auto.components.machines.detail.noSessions', 'No agents running on this machine.')}
      </p>
    )
  }
  return (
    <LiveSessionRows
      sessions={sessions}
      label={t('auto.components.machines.detail.sessions', 'Agents on this machine')}
      now={now}
    />
  )
}
