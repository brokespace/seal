import type { Translate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import type {
  RecapItem,
  RecapSection,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'

export function recapUpdatedLabel(updatedAt: number, now: number, t: Translate): string {
  const age = formatShortTimeAgo(updatedAt, now)
  return age === 'now'
    ? t('seal.sessionRecap.updatedNow', 'Updated just now')
    : t('seal.sessionRecap.updatedAgo', 'Updated {{age}} ago', { age })
}

/** The kind of thing an item is, where items of several sections share one list. */
export function recapItemKindLabel(section: RecapSection, item: RecapItem, t: Translate): string {
  switch (section) {
    case 'questions':
      return t('seal.sessionRecap.kind.question', 'Question')
    case 'actions':
      return t('seal.sessionRecap.kind.action', 'To do')
    case 'decisions':
      return t('seal.sessionRecap.kind.decision', 'Decision')
    case 'ignored':
      return t('seal.sessionRecap.kind.ignored', 'Not addressed')
    case 'asked':
      return t('seal.sessionRecap.kind.asked', 'Asked')
    case 'did':
      return item.state === 'in-progress'
        ? t('seal.sessionRecap.kind.inProgress', 'In progress')
        : item.state === 'blocked'
          ? t('seal.sessionRecap.kind.blocked', 'Blocked')
          : t('seal.sessionRecap.kind.done', 'Done')
  }
}

/** Why the recap is not fresh, in words; null when it is, or while it is being written. */
export function recapStateNote(view: SessionRecapView, t: Translate): string | null {
  switch (view.state) {
    case 'paused': {
      const time =
        view.pausedUntil === null
          ? null
          : new Date(view.pausedUntil).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit'
            })
      return time
        ? t(
            'seal.sessionRecap.state.pausedUntil',
            'Cloudflare\u2019s free limit for today is used up. The recap resumes at {{time}}.',
            { time }
          )
        : t(
            'seal.sessionRecap.state.paused',
            'Cloudflare\u2019s free limit for today is used up. The recap resumes when it resets.'
          )
    }
    case 'over-budget':
      return t(
        'seal.sessionRecap.state.overBudget',
        'Today\u2019s share of the free Cloudflare allocation for recaps is used. It resets at midnight UTC.'
      )
    case 'failed':
      return view.failure
        ? t('seal.sessionRecap.state.failedWhy', 'The last update failed: {{reason}}', {
            reason: view.failure
          })
        : t('seal.sessionRecap.state.failed', 'The last update failed.')
    case 'unavailable':
      return t(
        'seal.sessionRecap.state.unavailable',
        'Recaps are off, or no Cloudflare Workers AI account is set up on this computer.'
      )
    case 'empty':
      return t(
        'seal.sessionRecap.state.empty',
        'Nothing to recap yet. A recap is written when the agent stops or waits for you.'
      )
    case 'ready':
      if (view.recap?.degraded) {
        return t(
          'seal.sessionRecap.state.degraded',
          'The model\u2019s last reply could not be used, so the newest part lists only what you asked. Refresh to try again.'
        )
      }
      return view.stale
        ? t('seal.sessionRecap.state.stale', 'The session has moved on since this was written.')
        : null
    case 'updating':
      return null
  }
}
