import { describe, expect, it } from 'vitest'
import {
  emptySessionRecap,
  type RecapJudgeAnswers,
  type RecapRequest,
  type RecapRequestStatus,
  type SessionRecapView
} from './session-recap-types'
import {
  recapAttention,
  recapIsChecking,
  recapNewsSinceLastLook,
  recapRequestList,
  recapViewOnSession
} from './session-recap-view'

const UPDATED_AT = 10_000
const COVERED_TO = 900
const JUDGED_AT = 9_000

const NO_ANSWER: RecapJudgeAnswers = {
  done: 0.02,
  did_part: 0.02,
  declined: 0.02,
  withdrawn: 0.02,
  left_undone: 0.02
}

function request(
  id: string,
  status: RecapRequestStatus,
  answers: Partial<RecapJudgeAnswers> | null
): RecapRequest {
  return {
    id,
    text: `request ${id}`,
    messageId: null,
    at: 1_000,
    status,
    statusAt: status === 'open' ? 1_000 : JUDGED_AT,
    ...(answers
      ? {
          judged: {
            at: JUDGED_AT,
            coveredTo: COVERED_TO,
            model: '@cf/cloudflare/clef',
            questionBook: 'book',
            answers: { ...NO_ANSWER, ...answers },
            leftUndone: answers.left_undone !== undefined,
            turnEnded: true,
            complete: true
          }
        }
      : {})
  }
}

const REQUESTS = [
  request('done', 'addressed', { done: 0.97 }),
  request('declined', 'declined', { declined: 0.9 }),
  request('unjudged', 'open', null),
  request('withdrawn', 'withdrawn', { withdrawn: 0.6 }),
  request('partly', 'partly', { did_part: 0.8 }),
  request('missed', 'open', { left_undone: 0.91 })
]

function view(patch: Partial<SessionRecapView> = {}): SessionRecapView {
  return {
    sessionId: 's1',
    recap: {
      ...emptySessionRecap(UPDATED_AT),
      asked: REQUESTS.map(({ id, text, messageId, at }) => ({ id, text, messageId, at })),
      requests: REQUESTS,
      questions: [{ id: 'q1', text: 'Which region?', messageId: null, at: 2_000 }],
      coveredTo: COVERED_TO
    },
    marks: {},
    since: null,
    state: 'ready',
    stale: false,
    pausedUntil: null,
    failure: null,
    rev: 1,
    turnEnded: true,
    ...patch
  }
}

const states = (rows: readonly { id: string; state: string | null }[]): string[] =>
  rows.map((row) => `${row.id}:${row.state}`)

describe('recapRequestList', () => {
  it('lists what was missed first and folds what is settled, each with the answer that put it there', () => {
    const { shown, folded } = recapRequestList(view())

    expect(states(shown)).toEqual([
      'missed:not-addressed',
      'partly:partly',
      'unjudged:open',
      'declined:declined'
    ])
    expect(states(folded)).toEqual(['done:done', 'withdrawn:withdrawn'])
    expect(shown.map((row) => row.reason)).toEqual([
      { by: 'judge', criterion: 'left_undone', score: 0.91 },
      { by: 'judge', criterion: 'did_part', score: 0.8 },
      { by: 'nobody' },
      { by: 'judge', criterion: 'declined', score: 0.9 }
    ])
    expect(shown.map((row) => row.actions)).toEqual([
      ['done', 'dismiss'],
      ['done', 'dismiss'],
      ['done', 'dismiss'],
      ['done', 'dismiss']
    ])
    expect(folded.map((row) => row.actions)).toEqual([[], []])
  })

  it('lets the user’s tick or dismissal stand over the judge, each with its way back', () => {
    const { shown, folded } = recapRequestList(
      view({ marks: { missed: 'done', partly: 'dismissed' } })
    )

    expect(states(shown)).toEqual(['unjudged:open', 'declined:declined'])
    expect(folded.filter((row) => row.actions.length > 0)).toEqual([
      {
        id: 'partly',
        text: 'request partly',
        messageId: null,
        state: 'dismissed',
        reason: null,
        actions: ['restore']
      },
      {
        id: 'missed',
        text: 'request missed',
        messageId: null,
        state: 'done',
        reason: { by: 'user' },
        actions: ['not-done']
      }
    ])
  })

  it('lists the requests of a host that keeps no status for them as plain rows', () => {
    const base = view()
    const { shown, folded } = recapRequestList({
      ...base,
      recap: { ...base.recap!, requests: undefined },
      turnEnded: undefined
    })

    expect(states(shown)).toEqual([
      'done:null',
      'declined:null',
      'unjudged:null',
      'withdrawn:null',
      'partly:null',
      'missed:null'
    ])
    expect(shown.every((row) => row.actions.length === 0)).toBe(true)
    expect(folded).toEqual([])
  })
})

describe('recapViewOnSession', () => {
  it('calls nothing not addressed once the session works again', () => {
    const working = recapViewOnSession(view(), { status: 'working', lastActivityAt: UPDATED_AT })

    expect(states(recapRequestList(working).shown)).toEqual([
      'partly:partly',
      'unjudged:in-progress',
      'missed:in-progress',
      'declined:declined'
    ])
    expect(recapAttention(working).notAddressed).toBe(0)
    expect(recapIsChecking(working)).toBe(false)
  })

  it('holds the verdict back while a turn that ended after the recap is still unread', () => {
    const unread = recapViewOnSession(view(), {
      status: 'waiting-input',
      lastActivityAt: UPDATED_AT + 1
    })

    expect(states(recapRequestList(unread).shown)).toEqual([
      'partly:partly',
      'unjudged:open',
      'missed:open',
      'declined:declined'
    ])
    expect(recapIsChecking(unread)).toBe(true)
  })

  it('leaves a recap alone that the session has not moved past', () => {
    const current = view()

    expect(
      recapViewOnSession(current, { status: 'waiting-input', lastActivityAt: UPDATED_AT })
    ).toBe(current)
  })
})

describe('recapAttention', () => {
  it('counts the same from an open recap as from the brief on the session’s row', () => {
    const expected = { questions: 1, actions: 0, notAddressed: 1, total: 2 }

    expect(recapAttention(view())).toEqual(expected)
    expect(
      recapAttention({ title: null, rev: 1, questions: 1, actions: 0, notAddressed: 1 })
    ).toEqual(expected)
  })

  it('drops a request the user settled, and counts nothing for a host that sends no verdicts', () => {
    expect(recapAttention(view({ marks: { missed: 'dismissed', q1: 'done' } })).total).toBe(0)
    expect(recapAttention({ title: null, rev: 1, questions: 2, actions: 1 })).toEqual({
      questions: 2,
      actions: 1,
      notAddressed: 0,
      total: 3
    })
  })
})

describe('recapNewsSinceLastLook', () => {
  it('reports a request found not addressed since the last visit, from the requests alone', () => {
    const base = view({ since: JUDGED_AT - 1 })
    // The host's own list is for older clients; this one must not read it.
    const withStaleList = {
      ...base,
      recap: {
        ...base.recap!,
        ignored: [{ id: 'old', text: 'Stale claim', messageId: null, at: JUDGED_AT }]
      }
    }

    expect(recapNewsSinceLastLook(withStaleList)).toEqual([
      {
        section: 'ignored',
        item: { id: 'missed', text: 'request missed', messageId: null, at: JUDGED_AT }
      }
    ])
  })
})
