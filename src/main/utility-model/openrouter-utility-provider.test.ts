import { describe, expect, it, vi } from 'vitest'
import {
  OpenRouterAccountStore,
  createOpenRouterProvider,
  listOpenRouterModels,
  type OpenRouterKeyStore
} from './openrouter-utility-provider'
import { UtilityModelError } from './utility-model-provider'

const API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const MODEL = 'google/gemma-4-26b-a4b-it:free'
const REQUEST = {
  messages: [
    { role: 'system' as const, content: 'One sentence.' },
    { role: 'user' as const, content: 'hello' }
  ],
  maxTokens: 48
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

function providerAnswering(response: Response) {
  const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => response)
  return { provider: createOpenRouterProvider(API_KEY, { fetchImpl }), fetchImpl }
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

function memoryKeyStore(initial: string | null = null): OpenRouterKeyStore {
  let value = initial
  return {
    read: () => value,
    save: (next) => {
      value = next
    },
    clear: () => {
      value = null
    },
    protection: () => 'sealed'
  }
}

describe('OpenRouter provider', () => {
  it('posts one chat completion with the key as a bearer token and reads the first choice', async () => {
    const { provider, fetchImpl } = providerAnswering(
      json(200, { choices: [{ message: { role: 'assistant', content: ' Waiting on review. ' } }] })
    )

    const reply = await provider.complete(MODEL, REQUEST)

    expect(reply).toBe('Waiting on review.')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${API_KEY}`)
    expect(JSON.parse(String(init.body))).toEqual({
      reasoning: { enabled: false },
      model: MODEL,
      messages: REQUEST.messages,
      max_tokens: 48,
      stream: false
    })
  })

  it('drops a leading think block from a reasoning model reply', async () => {
    const { provider } = providerAnswering(
      json(200, {
        choices: [{ message: { content: '<think>the user wants one line</think>\nTests pass.' } }]
      })
    )

    expect(await provider.complete(MODEL, REQUEST)).toBe('Tests pass.')
  })

  it('reads the free-models daily cap as a spent day that lifts at the reset time', async () => {
    const { provider } = providerAnswering(
      json(429, {
        error: {
          message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock more.',
          code: 429,
          metadata: { headers: { 'X-RateLimit-Reset': '1772755200000' } }
        }
      })
    )

    const failure = await failureOf(provider.complete(MODEL, REQUEST))

    expect(failure.kind).toBe('rate-limited')
    expect(failure.detail).toMatchObject({
      model: MODEL,
      dailyLimit: true,
      resetAt: 1772755200000
    })
    expect(failure.detail.modelScoped).toBeUndefined()
  })

  it('reads an upstream host limit as this model only, in the host own words', async () => {
    const { provider } = providerAnswering(
      json(
        429,
        {
          error: {
            message: 'Provider returned error',
            code: 429,
            metadata: { raw: `${MODEL} is temporarily rate-limited upstream.` }
          }
        },
        { 'retry-after': '12' }
      )
    )

    const failure = await failureOf(provider.complete(MODEL, REQUEST))

    expect(failure.kind).toBe('rate-limited')
    expect(failure.message).toBe(`${MODEL} is temporarily rate-limited upstream.`)
    expect(failure.detail).toMatchObject({ modelScoped: true, retryAfterMs: 12_000 })
  })

  it.each([
    [401, 'No auth credentials found', 'unauthorized'],
    [402, 'Insufficient credits', 'plan-unavailable'],
    [400, 'not/real is not a valid model ID', 'model-not-found'],
    [404, 'No endpoints found for not/real.', 'model-not-found']
  ] as const)('classifies HTTP %i "%s" as %s', async (status, message, kind) => {
    const { provider } = providerAnswering(json(status, { error: { message, code: status } }))

    const failure = await failureOf(provider.complete(MODEL, REQUEST))

    expect(failure.kind).toBe(kind)
    expect(failure.message).not.toContain(API_KEY)
  })

  it('treats an error body on HTTP 200 as the failure it names', async () => {
    const { provider } = providerAnswering(
      json(200, { error: { message: 'Upstream model is overloaded', code: 503 } })
    )

    const failure = await failureOf(provider.complete(MODEL, REQUEST))

    expect(failure.kind).toBe('bad-response')
    expect(failure.detail.modelScoped).toBe(true)
  })

  it('reports an unreachable host without the request URL or key', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://openrouter.ai/?key=${API_KEY}`)
    })
    const provider = createOpenRouterProvider(API_KEY, { fetchImpl })

    const failure = await failureOf(provider.complete(MODEL, REQUEST))

    expect(failure.kind).toBe('network')
    expect(failure.message).toBe('Could not reach OpenRouter')
  })

  it('lists text models from the public catalog, free ones first and flagged', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      json(200, {
        data: [
          {
            id: 'openai/gpt-paid',
            name: 'Paid',
            pricing: { prompt: '0.000001', completion: '0.000002' }
          },
          { id: 'zeta/model:free', name: 'Zeta (free)', pricing: { prompt: '0', completion: '0' } },
          {
            id: 'openrouter/free',
            name: 'Free Models Router',
            pricing: { prompt: '0', completion: '0' }
          },
          {
            id: 'image/only',
            name: 'Image',
            architecture: { output_modalities: ['image'] },
            pricing: { prompt: '0', completion: '0' }
          }
        ]
      })
    )

    const models = await listOpenRouterModels({ fetchImpl })

    expect(fetchImpl.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models')
    expect(new Headers(fetchImpl.mock.calls[0][1].headers).has('authorization')).toBe(false)
    expect(models).toEqual([
      { id: 'openrouter/free', description: 'Free Models Router', free: true },
      { id: 'zeta/model:free', description: 'Zeta (free)', free: true },
      { id: 'openai/gpt-paid', description: 'Paid', free: false }
    ])
  })
})

describe('OpenRouter account store', () => {
  it('prefers the saved key, falls back to the environment, and shows only a hint', () => {
    const store = new OpenRouterAccountStore({
      saved: memoryKeyStore(),
      env: () => 'sk-or-v1-from-environment-wxyz'
    })

    expect(store.load()).toEqual({
      apiKey: 'sk-or-v1-from-environment-wxyz',
      source: 'environment',
      hint: 'wxyz',
      protection: null
    })

    store.save(` ${API_KEY} `)
    expect(store.load()).toEqual({
      apiKey: API_KEY,
      source: 'settings',
      hint: 'cdef',
      protection: 'sealed'
    })

    store.clear()
    expect(store.load().source).toBe('environment')
  })
})
