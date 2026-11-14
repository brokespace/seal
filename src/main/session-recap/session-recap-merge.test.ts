import { describe, expect, it } from 'vitest'
import { emptySessionRecap } from '../../shared/session-recap/session-recap-types'
import type { RecapDelta } from './session-recap-delta'
import { applyRecapDelta } from './session-recap-merge'

const HOUR = 3_600_000

function titled(title: string | null): RecapDelta {
  return {
    title,
    goal: null,
    standing: null,
    add: { asked: [], did: [], questions: [], ignored: [], actions: [], decisions: [] },
    update: [],
    resolve: []
  }
}

function recapTitled(title: string, changedAt: number) {
  return { ...emptySessionRecap(changedAt), title, titleChangedAt: changedAt }
}

describe('recap title', () => {
  it('keeps the title when the model only rephrases it', () => {
    const recap = recapTitled('Fix login redirect loop', 0)

    const next = applyRecapDelta(recap, titled('Fixing the login redirect'), {
      now: HOUR,
      refs: new Map()
    })

    expect(next.title).toBe('Fix login redirect loop')
    expect(next.titleChangedAt).toBe(0)
  })

  it('takes a new title when the session is about something else', () => {
    const recap = recapTitled('Fix login redirect loop', 0)

    const next = applyRecapDelta(recap, titled('Migrate billing to Stripe'), {
      now: HOUR,
      refs: new Map()
    })

    expect(next.title).toBe('Migrate billing to Stripe')
    expect(next.titleChangedAt).toBe(HOUR)
  })

  it('does not change the title again minutes after it changed', () => {
    const recap = recapTitled('Fix login redirect loop', 0)

    const next = applyRecapDelta(recap, titled('Migrate billing to Stripe'), {
      now: 5 * 60_000,
      refs: new Map()
    })

    expect(next.title).toBe('Fix login redirect loop')
  })
})

describe('applyRecapDelta', () => {
  it('does not add an item the recap already has', () => {
    const first = applyRecapDelta(
      emptySessionRecap(0),
      {
        ...titled(null),
        add: { ...titled(null).add, actions: [{ text: 'Review PR #18', ref: 'm1' }] }
      },
      { now: 1, refs: new Map([['m1', 'o40']]) }
    )

    const second = applyRecapDelta(
      first,
      {
        ...titled(null),
        add: { ...titled(null).add, actions: [{ text: 'review PR #18.', ref: 'm2' }] }
      },
      { now: 2, refs: new Map([['m2', 'o90']]) }
    )

    expect(second.actions).toEqual([{ id: 't1', text: 'Review PR #18', messageId: 'o40', at: 1 }])
  })
})
