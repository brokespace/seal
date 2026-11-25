import { describe, expect, it } from 'vitest'
import {
  recapNotAddressedRequests,
  recapRequestDisplay,
  recapTurnHasEnded
} from './session-recap-request-display'
import {
  emptySessionRecap,
  type RecapRequest,
  type RecapRequestJudgement
} from './session-recap-types'

const judged: RecapRequestJudgement = {
  at: 10,
  coveredTo: 900,
  model: '@cf/cloudflare/clef',
  questionBook: 'ba879810db9d',
  answers: { done: 0.02, did_part: 0.03, declined: 0.01, withdrawn: 0.01, left_undone: 0.97 },
  leftUndone: true,
  turnEnded: true,
  complete: true
}
const request = (patch: Partial<RecapRequest> = {}): RecapRequest => ({
  id: 'a1',
  text: 'add a test for the parser',
  messageId: 'o10',
  at: 1,
  status: 'open',
  statusAt: 1,
  judged,
  ...patch
})
const now = { coveredTo: 900, turnEnded: true, stale: false }

describe('recapRequestDisplay', () => {
  it('lists a request as not addressed only on the judge’s own verdict', () => {
    expect(recapRequestDisplay(request(), now)).toBe('not-addressed')
    expect(recapRequestDisplay(request({ judged: undefined }), now)).toBe('open')
    expect(recapRequestDisplay(request({ judged: { ...judged, leftUndone: false } }), now)).toBe(
      'open'
    )
  })

  it('holds a request at open when the evidence is incomplete, old, or from a running turn', () => {
    expect(recapRequestDisplay(request({ judged: { ...judged, complete: false } }), now)).toBe(
      'open'
    )
    expect(recapRequestDisplay(request({ judged: { ...judged, turnEnded: false } }), now)).toBe(
      'open'
    )
    expect(recapRequestDisplay(request(), { ...now, coveredTo: 1400 })).toBe('open')
    expect(recapRequestDisplay(request(), { ...now, stale: true })).toBe('open')
  })

  it('claims nothing about an open request while its turn runs', () => {
    expect(recapRequestDisplay(request(), { ...now, turnEnded: false })).toBe('in-progress')
  })

  it('shows a settled request as settled whatever the turn is doing', () => {
    const running = { ...now, turnEnded: false }
    expect(recapRequestDisplay(request({ status: 'addressed' }), running)).toBe('done')
    expect(recapRequestDisplay(request({ status: 'partly' }), now)).toBe('partly')
    expect(recapRequestDisplay(request({ status: 'declined' }), now)).toBe('declined')
    expect(recapRequestDisplay(request({ status: 'withdrawn' }), now)).toBe('withdrawn')
  })
})

describe('recapTurnHasEnded', () => {
  it('does not take a turn parked on background work or an approval for over', () => {
    expect(recapTurnHasEnded('waiting-subagent')).toBe(false)
    expect(recapTurnHasEnded('waiting-task')).toBe(false)
    expect(recapTurnHasEnded('needs-permission')).toBe(false)
    expect(recapTurnHasEnded('working')).toBe(false)
    expect(recapTurnHasEnded('running-shell')).toBe(false)
    expect(recapTurnHasEnded('your-turn')).toBe(true)
    expect(recapTurnHasEnded('idle')).toBe(true)
  })
})

describe('recapNotAddressedRequests', () => {
  it('leaves out what the user dismissed', () => {
    const recap = {
      ...emptySessionRecap(1),
      coveredTo: 900,
      requests: [request(), request({ id: 'a2' }), request({ id: 'a3', status: 'addressed' })]
    }
    const context = { turnEnded: true, stale: false }
    expect(recapNotAddressedRequests(recap, { a2: 'dismissed' }, context).map((r) => r.id)).toEqual(
      ['a1']
    )
  })
})
