import { useTranslate } from '@/i18n/use-translate'
import { countLiveSessionGroups } from '../../../../../shared/live-sessions/live-session-summary'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'

/** "2 working · 1 blocked on you · 0 waiting on you · 3 idle": the header line of a page of sessions. */
export function useLiveSessionCountsLine(sessions: readonly Pick<LiveSession, 'status'>[]): string {
  const t = useTranslate()
  const counts = countLiveSessionGroups(sessions)
  const yourTurn = sessions.filter((session) => session.status === 'your-turn').length
  return [
    t('home.overview.summary.working', '{{count}} working', { count: counts.working }),
    t('home.overview.summary.blocked', '{{count}} blocked on you', { count: counts.attention }),
    t('home.overview.summary.waiting', '{{count}} waiting on you', { count: yourTurn }),
    t('home.overview.summary.idle', '{{count}} idle', { count: counts.idle - yourTurn })
  ].join(' · ')
}
