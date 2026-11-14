import { translate } from '../../i18n/mobile-i18n'
import type {
  RecapItem,
  RecapSection,
  SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'

/** A moment as the phone writes it: the time today, the date and time otherwise. */
export function recapClockTime(at: number): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function recapItemKindLabel(section: RecapSection, item: RecapItem): string {
  switch (section) {
    case 'questions':
      return translate('seal.sessionRecap.kind.question', 'Question')
    case 'actions':
      return translate('seal.sessionRecap.kind.action', 'To do')
    case 'decisions':
      return translate('seal.sessionRecap.kind.decision', 'Decision')
    case 'ignored':
      return translate('seal.sessionRecap.kind.ignored', 'Not addressed')
    case 'asked':
      return translate('seal.sessionRecap.kind.asked', 'Asked')
    case 'did':
      return item.state === 'in-progress'
        ? translate('seal.sessionRecap.kind.inProgress', 'In progress')
        : item.state === 'blocked'
          ? translate('seal.sessionRecap.kind.blocked', 'Blocked')
          : translate('seal.sessionRecap.kind.done', 'Done')
  }
}

/** Why the recap is not fresh, in words; null when it is, or while it is being written. */
export function recapStateNote(view: SessionRecapView): string | null {
  switch (view.state) {
    case 'paused':
      return view.pausedUntil === null
        ? translate(
            'seal.sessionRecap.state.paused',
            'Cloudflare\u2019s free limit for today is used up. The recap resumes when it resets.'
          )
        : translate(
            'seal.sessionRecap.state.pausedUntil',
            'Cloudflare\u2019s free limit for today is used up. The recap resumes at {{time}}.',
            { time: recapClockTime(view.pausedUntil) }
          )
    case 'over-budget':
      return translate(
        'seal.sessionRecap.state.overBudget',
        'Today\u2019s share of the free Cloudflare allocation for recaps is used. It resets at midnight UTC.'
      )
    case 'failed':
      return view.failure
        ? translate('seal.sessionRecap.state.failedWhy', 'The last update failed: {{reason}}', {
            reason: view.failure
          })
        : translate('seal.sessionRecap.state.failed', 'The last update failed.')
    case 'unavailable':
      return translate(
        'seal.sessionRecap.state.unavailable',
        'Recaps are off, or no Cloudflare Workers AI account is set up on the computer running Seal.'
      )
    case 'empty':
      return translate(
        'seal.sessionRecap.state.empty',
        'Nothing to recap yet. A recap is written when the agent stops or waits for you.'
      )
    case 'ready':
      if (view.recap?.degraded) {
        return translate(
          'seal.sessionRecap.state.degraded',
          'The model\u2019s last reply could not be used, so the newest part lists only what you asked. Refresh to try again.'
        )
      }
      return view.stale
        ? translate(
            'seal.sessionRecap.state.stale',
            'The session has moved on since this was written.'
          )
        : null
    case 'updating':
      return null
  }
}
