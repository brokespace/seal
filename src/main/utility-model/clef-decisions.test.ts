import { describe, expect, it } from 'vitest'
import { createClefDecisions, type ClefProviderId } from './clef-decisions'
import { UtilityModelError, type UtilityModelDecision } from './utility-model-provider'

const ASKED = {
  state: { request: 'add a retry', conversation: 'USER: add a retry\nAGENT: Added.' },
  questions: { done: { type: 'noul', instructions: 'Is it done?' } }
}
const ANSWER: UtilityModelDecision = { answers: { done: { noul: 0.9 } }, inputTokens: 700 }

/** An account per provider named; a provider left out has none. */
function clefOn(accounts: Partial<Record<ClefProviderId, () => Promise<UtilityModelDecision>>>) {
  const asked: { provider: ClefProviderId; model: string; body: unknown }[] = []
  const clef = createClefDecisions((provider) => ({
    decide: async (model, request) => {
      const account = accounts[provider]
      if (!account) {
        throw new UtilityModelError('not-configured', 'No utility model provider is configured')
      }
      asked.push({ provider, model, body: request.body })
      return account()
    }
  }))
  return { clef, asked }
}

async function failureOf(run: Promise<unknown>): Promise<UtilityModelError> {
  const error = await run.then(
    () => null,
    (thrown: unknown) => thrown
  )
  if (!(error instanceof UtilityModelError)) {
    throw new Error('expected a UtilityModelError')
  }
  return error
}

describe('Clef decisions', () => {
  it("asks OpenRouter first, for Cloudflare's own host, when both accounts are there", async () => {
    const { clef, asked } = clefOn({
      openrouter: async () => ANSWER,
      'cloudflare-workers-ai': async () => ANSWER
    })

    expect(await clef.decide('@cf/cloudflare/clef', { body: ASKED })).toEqual({
      ...ANSWER,
      provider: 'openrouter'
    })
    expect(asked).toEqual([
      {
        provider: 'openrouter',
        model: 'cloudflare/clef',
        body: { ...ASKED, model: 'cloudflare/clef', provider: { only: ['cloudflare'] } }
      }
    ])
  })

  it('asks Workers AI the same questions when OpenRouter fails', async () => {
    const { clef, asked } = clefOn({
      openrouter: async () => {
        throw new UtilityModelError('rate-limited', 'Rate limit exceeded')
      },
      'cloudflare-workers-ai': async () => ANSWER
    })

    const decision = await clef.decide('clef-flash', { body: { model: 'clef-flash', ...ASKED } })

    expect(decision.provider).toBe('cloudflare-workers-ai')
    expect(asked.map((call) => [call.provider, call.model])).toEqual([
      ['openrouter', 'cloudflare/clef-flash'],
      ['cloudflare-workers-ai', '@cf/cloudflare/clef-flash']
    ])
    // Byte for byte what Workers AI was sent before: recorded answers are keyed on it.
    expect(JSON.stringify(asked[1].body)).toBe(JSON.stringify({ model: 'clef-flash', ...ASKED }))
  })

  it('asks only the providers it is narrowed to', async () => {
    const { clef, asked } = clefOn({
      openrouter: async () => ANSWER,
      'cloudflare-workers-ai': async () => ANSWER
    })

    const decision = await clef.decide('clef', { body: ASKED }, undefined, {
      providers: ['cloudflare-workers-ai']
    })

    expect(decision.provider).toBe('cloudflare-workers-ai')
    expect(asked.map((call) => call.provider)).toEqual(['cloudflare-workers-ai'])
  })

  it('fails with what the account that was asked said, and with no account says so', async () => {
    const outOfCredits = clefOn({
      openrouter: async () => {
        throw new UtilityModelError('plan-unavailable', 'Insufficient credits.')
      }
    })
    expect((await failureOf(outOfCredits.clef.decide('clef', { body: ASKED }))).kind).toBe(
      'plan-unavailable'
    )
    expect((await failureOf(clefOn({}).clef.decide('clef', { body: ASKED }))).kind).toBe(
      'not-configured'
    )
  })

  it('never asks a model that is not Clef', async () => {
    const { clef, asked } = clefOn({ openrouter: async () => ANSWER })

    const failure = await failureOf(clef.decide('@cf/zai-org/glm-4.7-flash', { body: ASKED }))

    expect(failure.kind).toBe('model-not-found')
    expect(asked).toEqual([])
  })
})
