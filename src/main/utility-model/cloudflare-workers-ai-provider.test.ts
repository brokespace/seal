import { describe, expect, it, vi } from 'vitest'
import { createCloudflareWorkersAiProvider } from './cloudflare-workers-ai-provider'
import { UtilityModelError } from './utility-model-provider'
import { UtilityModelService } from './utility-model-service'

const CREDENTIALS = { accountId: 'a'.repeat(32), apiToken: 'cf-token-value-0123456789' }
const REQUEST = { messages: [{ role: 'user' as const, content: 'hello' }], maxTokens: 48 }

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function providerAnswering(response: Response) {
  const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => response)
  return { provider: createCloudflareWorkersAiProvider(CREDENTIALS, fetchImpl), fetchImpl }
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

describe('Cloudflare Workers AI provider', () => {
  it('posts the chat to the account run endpoint with thinking off and reads result.response', async () => {
    const { provider, fetchImpl } = providerAnswering(
      json(200, { success: true, result: { response: ' Fixed the login redirect. ' } })
    )

    const reply = await provider.complete('@cf/zai-org/glm-4.7-flash', REQUEST)

    expect(reply).toBe('Fixed the login redirect.')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/run/@cf/zai-org/glm-4.7-flash'
    )
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer cf-token-value-0123456789')
    expect(JSON.parse(String(init.body))).toEqual({
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 48,
      chat_template_kwargs: { enable_thinking: false }
    })
  })

  it('falls back to the OpenAI-shaped choices when result.response is absent', async () => {
    const { provider } = providerAnswering(
      json(200, {
        success: true,
        result: { choices: [{ message: { role: 'assistant', content: 'Needs your approval.' } }] }
      })
    )

    expect(await provider.complete('@cf/google/gemma-4-26b-a4b-it', REQUEST)).toBe(
      'Needs your approval.'
    )
  })

  it('reports a model the Workers Free plan cannot run as plan-unavailable', async () => {
    const { provider } = providerAnswering(
      json(403, {
        success: false,
        errors: [{ code: 5018, message: 'This model is not available on the Workers Free plan.' }]
      })
    )

    const error = await failureOf(provider.complete('@cf/zai-org/glm-5.3-flash', REQUEST))

    expect(error.kind).toBe('plan-unavailable')
    expect(error.message).toBe('This model is not available on the Workers Free plan.')
    expect(error.detail.model).toBe('@cf/zai-org/glm-5.3-flash')
  })

  it('reports a 403 that is not about the plan as rejected credentials', async () => {
    const { provider } = providerAnswering(
      json(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] })
    )

    expect((await failureOf(provider.complete('@cf/zai-org/glm-4.7-flash', REQUEST))).kind).toBe(
      'unauthorized'
    )
  })

  it('marks a spent daily allocation on a 429 and passes on a retry-after hint otherwise', async () => {
    const spent = providerAnswering(
      json(429, {
        success: false,
        errors: [
          { code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }
        ]
      })
    )
    const busy = providerAnswering(
      json(
        429,
        { success: false, errors: [{ message: 'Capacity temporarily exceeded' }] },
        { 'retry-after': '7' }
      )
    )

    const spentError = await failureOf(
      spent.provider.complete('@cf/zai-org/glm-4.7-flash', REQUEST)
    )
    const busyError = await failureOf(busy.provider.complete('@cf/zai-org/glm-4.7-flash', REQUEST))

    expect(spentError.kind).toBe('rate-limited')
    expect(spentError.detail.dailyLimit).toBe(true)
    expect(busyError.kind).toBe('rate-limited')
    expect(busyError.detail.dailyLimit).toBe(false)
    expect(busyError.detail.retryAfterMs).toBe(7000)
  })

  it('never puts the token in a failure it reports', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect failed for Bearer ${CREDENTIALS.apiToken}`)
    })
    const provider = createCloudflareWorkersAiProvider(CREDENTIALS, fetchImpl)

    const error = await failureOf(provider.complete('@cf/zai-org/glm-4.7-flash', REQUEST))

    expect(error.kind).toBe('network')
    expect(error.message).toBe('Could not reach Cloudflare')
  })

  it('has the next model answer when one fails on its server or does not answer in time', async () => {
    const answered = { success: true, result: { response: 'Fixed the login redirect.' } }
    const failing = (fail: (init: RequestInit) => Promise<Response>) =>
      new UtilityModelService({
        backend: async () => ({
          provider: createCloudflareWorkersAiProvider(CREDENTIALS, (url, init) =>
            url.endsWith('glm-4.7-flash') ? fail(init) : Promise.resolve(json(200, answered))
          ),
          models: ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it']
        })
      })
    const erroring = failing(async () =>
      json(500, { success: false, errors: [{ message: 'Internal server error' }] })
    )
    const silent = failing(
      (init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    )

    const afterError = await erroring.complete(REQUEST)
    const afterSilence = await silent.complete({ ...REQUEST, timeoutMs: 5 })

    expect(afterError.model).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(afterSilence.model).toBe('@cf/google/gemma-4-26b-a4b-it')
  })

  it('posts a decision model its own body and reads the answers and the tokens billed', async () => {
    const { provider, fetchImpl } = providerAnswering(
      json(200, {
        success: true,
        result: { answers: { done: { noul: 0.91 } }, usage: { input_tokens: 812 } }
      })
    )
    const body = { model: 'clef', state: { request: 'r' }, questions: { done: { type: 'noul' } } }

    const decision = await provider.decide?.('@cf/cloudflare/clef', { body })

    expect(decision).toEqual({ answers: { done: { noul: 0.91 } }, inputTokens: 812 })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/run/@cf/cloudflare/clef'
    )
    expect(JSON.parse(String(init.body))).toEqual(body)
  })

  it('reports a decision reply without answers as a bad response', async () => {
    const { provider } = providerAnswering(json(200, { success: true, result: {} }))

    const failure = await failureOf(
      provider.decide?.('@cf/cloudflare/clef', { body: {} }) ?? Promise.resolve()
    )

    expect(failure.kind).toBe('bad-response')
  })

  it('lists the account text-generation models by id', async () => {
    const { provider, fetchImpl } = providerAnswering(
      json(200, {
        success: true,
        result: [
          { name: '@cf/zai-org/glm-4.7-flash', description: 'Fast multilingual model' },
          { name: '@cf/google/gemma-4-26b-a4b-it' },
          { id: 'no-name' }
        ]
      })
    )

    const models = await provider.listModels()

    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/models/search?task=Text%20Generation&per_page=100'
    )
    expect(models).toEqual([
      { id: '@cf/google/gemma-4-26b-a4b-it', description: null },
      { id: '@cf/zai-org/glm-4.7-flash', description: 'Fast multilingual model' }
    ])
  })
})
