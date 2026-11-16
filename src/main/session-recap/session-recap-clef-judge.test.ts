import { describe, expect, it } from 'vitest'
import { SessionSummaryCache } from '../session-summaries/session-summary-cache'
import { UtilityModelError } from '../utility-model/utility-model-provider'
import { createClefRecapJudge, type RecapJudgeCall } from './session-recap-clef-judge'

const STATE = { request: 'add a retry', conversation: 'USER: add a retry\nAGENT: Added.' }
const GIVEN = {
  done: { noul: 0.9 },
  did_part: { noul: 0.1 },
  declined: { noul: 0.02 },
  withdrawn: { noul: 0.01 },
  left_undone: { noul: 0.05 }
}
const ANSWERS = { done: 0.9, did_part: 0.1, declined: 0.02, withdrawn: 0.01, left_undone: 0.05 }

function harness(decide: () => Promise<{ answers: unknown; inputTokens: number | null }>) {
  const asked: { model: string; body: unknown }[] = []
  const calls: RecapJudgeCall[] = []
  const spent: number[] = []
  const judge = createClefRecapJudge({
    decide: async (model, request) => {
      asked.push({ model, body: request.body })
      return decide()
    },
    cache: new SessionSummaryCache(null),
    spend: (neurons) => spent.push(neurons),
    record: (call) => calls.push(call),
    now: () => 7000
  })
  const ask = () => judge.ask(STATE, new AbortController().signal)
  return { ask, asked, calls, spent }
}

describe('Clef recap judge', () => {
  it('asks Clef every question about the state in one call', async () => {
    const { ask, asked } = harness(async () => ({ answers: GIVEN, inputTokens: 1000 }))
    expect(await ask()).toEqual({ answers: ANSWERS, cached: false })
    expect(asked.map((call) => call.model)).toEqual(['@cf/cloudflare/clef'])
    expect(asked[0].body).toMatchObject({ model: 'clef', state: STATE })
    expect(Object.keys(Object(asked[0].body).questions)).toEqual([
      'done',
      'did_part',
      'declined',
      'withdrawn',
      'left_undone'
    ])
  })

  it('answers an unchanged state from its cache, and logs both calls', async () => {
    const { ask, asked, calls, spent } = harness(async () => ({
      answers: GIVEN,
      inputTokens: 1000
    }))
    await ask()
    expect(await ask()).toEqual({ answers: ANSWERS, cached: true })
    expect(asked).toHaveLength(1)
    expect(spent).toEqual([21.818])
    expect(calls).toEqual([
      {
        at: 7000,
        model: '@cf/cloudflare/clef',
        questionBook: 'ba879810db9d',
        key: calls[0].key,
        cached: false,
        ms: 0,
        inputTokens: 1000,
        neurons: 21.818,
        outcome: 'answered'
      },
      {
        at: 7000,
        model: '@cf/cloudflare/clef',
        questionBook: 'ba879810db9d',
        key: calls[0].key,
        cached: true,
        ms: 0,
        inputTokens: null,
        neurons: 0,
        outcome: 'answered'
      }
    ])
    expect(JSON.stringify(calls)).not.toContain('retry')
  })

  it('fails without asking another model, and keeps nothing', async () => {
    const { ask, asked, calls } = harness(async () => {
      throw new UtilityModelError('network', 'Clef took too long')
    })
    expect(await ask()).toEqual({ failed: 'network' })
    expect(await ask()).toEqual({ failed: 'network' })
    expect(asked.map((call) => call.model)).toEqual(['@cf/cloudflare/clef', '@cf/cloudflare/clef'])
    expect(calls.map((call) => call.outcome)).toEqual(['network', 'network'])
  })

  it('takes a reply missing a question as no answer', async () => {
    const { done: _done, ...partial } = GIVEN
    const { ask } = harness(async () => ({ answers: partial, inputTokens: 900 }))
    expect(await ask()).toEqual({ failed: 'unusable-reply' })
  })

  it('does not run on wording its thresholds were not measured on', () => {
    const judge = createClefRecapJudge({
      decide: async () => ({ answers: GIVEN, inputTokens: 1 }),
      cache: new SessionSummaryCache(null),
      spend: () => undefined,
      record: () => undefined,
      calibration: {
        model: '@cf/cloudflare/clef',
        questionBook: 'someotherbook',
        cuts: { done: 0.5, did_part: 0.5, declined: 0.5, withdrawn: 0.5, left_undone: 0.5 }
      }
    })
    expect(judge.available()).toBe(false)
  })
})
