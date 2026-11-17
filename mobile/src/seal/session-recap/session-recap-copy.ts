import { translate } from '../../i18n/mobile-i18n'
import type {
  RecapItem,
  RecapJudgeCriterion,
  SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'
import {
  recapIsChecking,
  type RecapNewsSection,
  type RecapRequestAction,
  type RecapRequestReason,
  type RecapRequestRowState
} from '../../../../src/shared/session-recap/session-recap-view'

/** A moment as the phone writes it: the time today, the date and time otherwise. */
export function recapClockTime(at: number): string {
  return new Date(at).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function recapItemKindLabel(section: RecapNewsSection, item: RecapItem): string {
  switch (section) {
    case 'decisions':
      return translate('seal.sessionRecap.kind.decision', 'Decision')
    case 'ignored':
      return translate('seal.sessionRecap.request.state.notAddressed', 'Not addressed')
    case 'did':
      return item.state === 'in-progress'
        ? translate('seal.sessionRecap.kind.inProgress', 'In progress')
        : item.state === 'blocked'
          ? translate('seal.sessionRecap.kind.blocked', 'Blocked')
          : translate('seal.sessionRecap.kind.done', 'Done')
  }
}

/** The word on a request's chip. */
export function recapRequestStateLabel(state: RecapRequestRowState): string {
  switch (state) {
    case 'not-addressed':
      return translate('seal.sessionRecap.request.state.notAddressed', 'Not addressed')
    case 'partly':
      return translate('seal.sessionRecap.request.state.partly', 'Partly done')
    case 'open':
      return translate('seal.sessionRecap.request.state.open', 'Open')
    case 'in-progress':
      return translate('seal.sessionRecap.request.state.inProgress', 'In progress')
    case 'declined':
      return translate('seal.sessionRecap.request.state.declined', 'Declined')
    case 'done':
      return translate('seal.sessionRecap.request.state.done', 'Done')
    case 'withdrawn':
      return translate('seal.sessionRecap.request.state.withdrawn', 'Withdrawn')
    case 'dismissed':
      return translate('seal.sessionRecap.request.state.dismissed', 'Dismissed')
  }
}

function recapJudgedLabel(criterion: RecapJudgeCriterion, percent: number): string {
  switch (criterion) {
    case 'left_undone':
      return translate(
        'seal.sessionRecap.request.reason.leftUndone',
        'Judged still waiting to be done \u00b7 {{percent}}%',
        { percent }
      )
    case 'did_part':
      return translate(
        'seal.sessionRecap.request.reason.didPart',
        'Judged done in part \u00b7 {{percent}}%',
        { percent }
      )
    case 'declined':
      return translate(
        'seal.sessionRecap.request.reason.declined',
        'Judged declined by the agent \u00b7 {{percent}}%',
        { percent }
      )
    case 'withdrawn':
      return translate(
        'seal.sessionRecap.request.reason.withdrawn',
        'Judged taken back by you \u00b7 {{percent}}%',
        { percent }
      )
    case 'done':
      return translate('seal.sessionRecap.request.reason.done', 'Judged done \u00b7 {{percent}}%', {
        percent
      })
  }
}

/** Why a request stands where its chip says, under the request. */
export function recapRequestReasonLabel(reason: RecapRequestReason): string {
  switch (reason.by) {
    case 'judge':
      return recapJudgedLabel(reason.criterion, Math.round(reason.score * 100))
    case 'user':
      return translate('seal.sessionRecap.request.reason.marked', 'Marked done by you')
    case 'nobody':
      return translate('seal.sessionRecap.request.reason.unjudged', 'Not checked yet')
  }
}

/** What a request's action does, with the request, for a screen reader. */
export function recapRequestActionLabel(action: RecapRequestAction, item: string): string {
  switch (action) {
    case 'done':
      return translate('seal.sessionRecap.request.action.done', 'Mark done: {{item}}', { item })
    case 'not-done':
      return translate('seal.sessionRecap.request.action.notDone', 'Not done: {{item}}', { item })
    case 'dismiss':
      return translate('seal.sessionRecap.dismiss', 'Dismiss: {{item}}', { item })
    case 'restore':
      return translate('seal.sessionRecap.restore', 'Bring back: {{item}}', { item })
  }
}

/** Why the recap is not fresh, in words; null when it is, or while it is being written. */
export function recapStateNote(view: SessionRecapView): string | null {
  switch (view.state) {
    case 'paused':
      return view.pausedUntil === null
        ? translate(
            'seal.sessionRecap.state.paused',
            'The model provider\u2019s limit was reached. The recap resumes when it resets.'
          )
        : translate(
            'seal.sessionRecap.state.pausedUntil',
            'The model provider\u2019s limit was reached. The recap resumes at {{time}}.',
            { time: recapClockTime(view.pausedUntil) }
          )
    case 'over-budget':
      return translate(
        'seal.sessionRecap.state.overBudget',
        'Today\u2019s budget for recaps is used. It resets at midnight UTC.'
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
        'Recaps are off, or the model provider chosen for them is not set up on the computer that runs this session.'
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
      if (recapIsChecking(view)) {
        return translate(
          'seal.sessionRecap.state.checking',
          'Checking the last turn. Until it is read, no request is called not addressed.'
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
