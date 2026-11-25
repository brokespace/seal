import type { Translate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import type {
  RecapJudgeCriterion,
  RecapItem,
  SessionRecapUnavailableReason,
  SessionRecapView
} from '../../../../shared/session-recap/session-recap-types'
import { utilityModelProvider } from '../../../../shared/utility-model/utility-model-provider-catalog'
import {
  recapIsChecking,
  type RecapNewsSection,
  type RecapRequestAction,
  type RecapRequestReason,
  type RecapRequestRowState
} from '../../../../shared/session-recap/session-recap-view'

export function recapUpdatedLabel(updatedAt: number, now: number, t: Translate): string {
  const age = formatShortTimeAgo(updatedAt, now)
  return age === 'now'
    ? t('seal.sessionRecap.updatedNow', 'Updated just now')
    : t('seal.sessionRecap.updatedAgo', 'Updated {{age}} ago', { age })
}

/** The kind of thing an item is, where items of several sections share one list. */
export function recapItemKindLabel(
  section: RecapNewsSection,
  item: RecapItem,
  t: Translate
): string {
  switch (section) {
    case 'decisions':
      return t('seal.sessionRecap.kind.decision', 'Decision')
    case 'ignored':
      return t('seal.sessionRecap.request.state.notAddressed', 'Not addressed')
    case 'did':
      return item.state === 'in-progress'
        ? t('seal.sessionRecap.kind.inProgress', 'In progress')
        : item.state === 'blocked'
          ? t('seal.sessionRecap.kind.blocked', 'Blocked')
          : t('seal.sessionRecap.kind.done', 'Done')
  }
}

/** The word on a request's chip. */
export function recapRequestStateLabel(state: RecapRequestRowState, t: Translate): string {
  switch (state) {
    case 'not-addressed':
      return t('seal.sessionRecap.request.state.notAddressed', 'Not addressed')
    case 'partly':
      return t('seal.sessionRecap.request.state.partly', 'Partly done')
    case 'open':
      return t('seal.sessionRecap.request.state.open', 'Open')
    case 'in-progress':
      return t('seal.sessionRecap.request.state.inProgress', 'In progress')
    case 'declined':
      return t('seal.sessionRecap.request.state.declined', 'Declined')
    case 'done':
      return t('seal.sessionRecap.request.state.done', 'Done')
    case 'withdrawn':
      return t('seal.sessionRecap.request.state.withdrawn', 'Withdrawn')
    case 'dismissed':
      return t('seal.sessionRecap.request.state.dismissed', 'Dismissed')
  }
}

function recapJudgedLabel(criterion: RecapJudgeCriterion, percent: number, t: Translate): string {
  switch (criterion) {
    case 'left_undone':
      return t(
        'seal.sessionRecap.request.reason.leftUndone',
        'Judged still waiting to be done \u00b7 {{percent}}%',
        { percent }
      )
    case 'did_part':
      return t(
        'seal.sessionRecap.request.reason.didPart',
        'Judged done in part \u00b7 {{percent}}%',
        { percent }
      )
    case 'declined':
      return t(
        'seal.sessionRecap.request.reason.declined',
        'Judged declined by the agent \u00b7 {{percent}}%',
        { percent }
      )
    case 'withdrawn':
      return t(
        'seal.sessionRecap.request.reason.withdrawn',
        'Judged taken back by you \u00b7 {{percent}}%',
        { percent }
      )
    case 'done':
      return t('seal.sessionRecap.request.reason.done', 'Judged done \u00b7 {{percent}}%', {
        percent
      })
  }
}

/** Why a request stands where its chip says, under the request. */
export function recapRequestReasonLabel(reason: RecapRequestReason, t: Translate): string {
  switch (reason.by) {
    case 'judge':
      return recapJudgedLabel(reason.criterion, Math.round(reason.score * 100), t)
    case 'user':
      return t('seal.sessionRecap.request.reason.marked', 'Marked done by you')
    case 'nobody':
      return t('seal.sessionRecap.request.reason.unjudged', 'Not checked yet')
  }
}

/** What a request's action is called, for its tooltip and, with the request, for a screen reader. */
export function recapRequestActionLabel(
  action: RecapRequestAction,
  t: Translate
): { title: string; label: (item: string) => string } {
  switch (action) {
    case 'done':
      return {
        title: t('seal.sessionRecap.request.action.doneTitle', 'Mark done'),
        label: (item) => t('seal.sessionRecap.request.action.done', 'Mark done: {{item}}', { item })
      }
    case 'not-done':
      return {
        title: t('seal.sessionRecap.request.action.notDoneTitle', 'Not done'),
        label: (item) =>
          t('seal.sessionRecap.request.action.notDone', 'Not done: {{item}}', { item })
      }
    case 'dismiss':
      return {
        title: t('seal.sessionRecap.dismissTitle', 'Dismiss'),
        label: (item) => t('seal.sessionRecap.dismiss', 'Dismiss: {{item}}', { item })
      }
    case 'restore':
      return {
        title: t('seal.sessionRecap.restoreTitle', 'Bring back'),
        label: (item) => t('seal.sessionRecap.restore', 'Bring back: {{item}}', { item })
      }
  }
}

/** What the user asked for and the host never answered. */
export function recapFailureNote(failed: 'refresh' | 'mark', t: Translate): string {
  return failed === 'refresh'
    ? t(
        'seal.sessionRecap.failed.refresh',
        'The refresh got no answer from the computer that keeps this recap. Try again.'
      )
    : t('seal.sessionRecap.failed.mark', 'That change was not saved. Try again.')
}

/** The exact cause, as one sentence; `where` names the computer or server that keeps the recap. */
function recapReasonNote(
  reason: SessionRecapUnavailableReason,
  t: Translate,
  where: string
): string {
  switch (reason.kind) {
    case 'recaps-off':
      return t('seal.sessionRecap.state.recapsOff', 'Recaps are off on {{where}}.', { where })
    case 'provider-not-set-up':
      return t(
        'seal.sessionRecap.state.providerNotSetUp',
        'No {{provider}} account is set up on {{where}} for recaps.',
        { provider: utilityModelProvider(reason.provider).label, where }
      )
    case 'provider-unchecked':
      return t(
        'seal.sessionRecap.state.providerUnchecked',
        'Seal is still checking the recap model on {{where}}.',
        { where }
      )
    case 'transcript-unreadable':
      return t(
        'seal.sessionRecap.state.transcriptUnreadable',
        'Seal cannot read this session\u2019s conversation on {{where}}.',
        { where }
      )
    case 'session-unknown':
      return t(
        'seal.sessionRecap.state.sessionUnknown',
        'This session is not listed on {{where}}.',
        { where }
      )
    case 'server-unreachable':
      return reason.message
        ? t('seal.sessionRecap.state.unreachableWhy', 'Could not reach {{where}}: {{message}}', {
            where,
            message: reason.message
          })
        : t('seal.sessionRecap.state.unreachable', 'Could not reach {{where}}.', { where })
  }
}

/**
 * Why the recap is not fresh, in words; null when it is, or while it is being written. `server`
 * names the Seal server that keeps the recap of a session it runs; null is this computer.
 */
export function recapStateNote(
  view: SessionRecapView,
  t: Translate,
  server: string | null = null
): string | null {
  const where = server ?? t('seal.sessionRecap.thisComputer', 'this computer')
  const { unavailableReason: reason } = view
  if (
    reason &&
    (view.state === 'unavailable' || view.state === 'empty' || view.state === 'failed')
  ) {
    return recapReasonNote(reason, t, where)
  }
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
            'The model provider\u2019s limit was reached. The recap resumes at {{time}}.',
            { time }
          )
        : t(
            'seal.sessionRecap.state.paused',
            'The model provider\u2019s limit was reached. The recap resumes when it resets.'
          )
    }
    case 'over-budget':
      return t(
        'seal.sessionRecap.state.overBudget',
        'Today\u2019s budget for recaps is used. It resets at midnight UTC.'
      )
    case 'failed':
      return view.failure
        ? t('seal.sessionRecap.state.failedWhy', 'The last update failed: {{reason}}', {
            reason: view.failure
          })
        : t('seal.sessionRecap.state.failed', 'The last update failed.')
    case 'unavailable':
      return t('seal.sessionRecap.state.noRecapYet', 'No recap from {{where}} yet.', { where })
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
      if (recapIsChecking(view)) {
        return t(
          'seal.sessionRecap.state.checking',
          'Checking the last turn. Until it is read, no request is called not addressed.'
        )
      }
      return view.stale
        ? t('seal.sessionRecap.state.stale', 'The session has moved on since this was written.')
        : null
    case 'updating':
      return null
  }
}
