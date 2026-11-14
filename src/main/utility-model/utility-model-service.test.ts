import { describe, expect, it, vi } from 'vitest'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'
import { UtilityModelService } from './utility-model-service'

const REQUEST = { messages: [{ role: 'user' as const, content: 'hello' }], maxTokens: 48 }
const PRIMARY = '@cf/zai-org/glm-5.3-flash'
const FALLBACK = '@cf/google/gemma-4-26b-a4b-it'
// 2026-03-04T10:00:00Z
const MORNING = Date.UTC(2026, 2, 4, 10)
const NEXT_UTC_DAY = Date.UTC(2026, 2, 5)

function serviceWith(complete: UtilityModelProvider['complete']) {
  const clock = { now: MORNING }
  const provider: UtilityModelProvider = {
    id: 'cloudflare-workers-ai',
    complete: vi.fn(complete),
    listModels: async () => []
  }
  const service = new UtilityModelService({
    backend: async () => ({ provider, models: [PRIMARY, FALLBACK] }),
    now: () => clock.now
  })
  return { service, provider, clock }
}

const planRefusal = (model: string) =>
  new UtilityModelError('plan-unavailable', 'Not available on the Workers Free plan.', { model })

describe('UtilityModelService', () => {
  it('falls back when the plan refuses the model and stops asking for it', async () => {
    const { service, provider } = serviceWith(async (model) => {
      if (model === PRIMARY) {
        throw planRefusal(model)
      }
      return 'ok'
    })

    const first = await service.complete(REQUEST)
    const second = await service.complete(REQUEST)

    expect(first).toEqual({ text: 'ok', model: FALLBACK, usedFallback: true })
    expect(second.model).toBe(FALLBACK)
    expect(vi.mocked(provider.complete).mock.calls.map(([model]) => model)).toEqual([
      PRIMARY,
      FALLBACK,
      FALLBACK
    ])
    expect(service.health().unavailableModels).toEqual([
      {
        kind: 'plan-unavailable',
        message: 'Not available on the Workers Free plan.',
        model: PRIMARY,
        at: MORNING
      }
    ])
  })

  it('holds every request until the next UTC day once the daily allocation is spent', async () => {
    const { service, provider, clock } = serviceWith(async () => {
      throw new UtilityModelError('rate-limited', 'daily free allocation used up', {
        dailyLimit: true
      })
    })

    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(service.health().pausedUntil).toBe(NEXT_UTC_DAY)

    clock.now = NEXT_UTC_DAY - 1
    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(provider.complete).toHaveBeenCalledTimes(1)

    clock.now = NEXT_UTC_DAY
    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(provider.complete).toHaveBeenCalledTimes(2)
  })

  it('pauses briefly for an ordinary 429 and for a day after three in a row', async () => {
    const { service, clock } = serviceWith(async () => {
      throw new UtilityModelError('rate-limited', 'Capacity temporarily exceeded', {
        retryAfterMs: 5_000
      })
    })

    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(service.health().pausedUntil).toBe(MORNING + 5_000)

    clock.now = MORNING + 5_000
    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    clock.now = MORNING + 10_000
    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })

    expect(service.health().pausedUntil).toBe(NEXT_UTC_DAY)
  })

  it('lets a test through a pause and lifts the pause when it succeeds', async () => {
    let limited = true
    const { service } = serviceWith(async () => {
      if (limited) {
        throw new UtilityModelError('rate-limited', 'daily free allocation used up', {
          dailyLimit: true
        })
      }
      return 'ready'
    })
    await expect(service.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })

    limited = false
    const result = await service.test()

    expect(result).toMatchObject({ ok: true, model: PRIMARY, reply: 'ready', usedFallback: false })
    expect(service.health()).toEqual({
      unavailableModels: [],
      pausedUntil: null,
      lastFailure: null
    })
  })

  it('reports not-configured without a provider', async () => {
    const service = new UtilityModelService({ backend: async () => null })

    expect(await service.test()).toMatchObject({ ok: false, failure: { kind: 'not-configured' } })
  })
})
