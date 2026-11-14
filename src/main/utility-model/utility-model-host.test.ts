import { describe, expect, it, vi } from 'vitest'
import {
  normalizeSessionSummaryModels,
  utilityModelChoiceFor
} from '../../shared/utility-model/utility-model-selection'
import type { UtilityModelProviderId } from '../../shared/utility-model/utility-model-types'
import { OpenRouterAccountStore } from './openrouter-utility-provider'
import { UtilityModelHost } from './utility-model-host'
import { UtilityModelError, type UtilityModelProvider } from './utility-model-provider'
import type { UtilityModelProviderSource } from './utility-model-provider-sources'

const REQUEST = { messages: [{ role: 'user' as const, content: 'hello' }], maxTokens: 48 }
const API_KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'

function account(
  id: UtilityModelProviderId,
  defaultModels: string[],
  complete: UtilityModelProvider['complete']
): { source: UtilityModelProviderSource; provider: UtilityModelProvider } {
  const provider: UtilityModelProvider = {
    id,
    complete: vi.fn(complete),
    listModels: async () => []
  }
  return {
    provider,
    source: async () => ({
      configured: true,
      source: 'settings',
      accountHint: null,
      tokenProtection: null,
      defaultModels,
      provider
    })
  }
}

function memoryOpenRouter(): OpenRouterAccountStore {
  let saved: string | null = null
  return new OpenRouterAccountStore({
    env: () => undefined,
    saved: {
      read: () => saved,
      save: (value) => {
        saved = value
      },
      clear: () => {
        saved = null
      },
      protection: () => 'sealed'
    }
  })
}

describe('UtilityModelHost', () => {
  it('runs settings saved before providers could be chosen on the Cloudflare account and its saved models', async () => {
    const cloudflare = account(
      'cloudflare-workers-ai',
      ['@cf/saved/model', '@cf/saved/fallback'],
      async () => 'ok'
    )
    const host = new UtilityModelHost({ sources: { 'cloudflare-workers-ai': cloudflare.source } })
    const client = host.client(() =>
      utilityModelChoiceFor(normalizeSessionSummaryModels(undefined), 'recaps')
    )

    const reply = await client.complete(REQUEST)

    expect(reply).toEqual({
      text: 'ok',
      provider: 'cloudflare-workers-ai',
      model: '@cf/saved/model',
      usedFallback: false
    })
  })

  it('follows the choice on every call and keeps one provider pause from stopping another', async () => {
    const openRouter = account('openrouter', ['openrouter/free'], async (model) => {
      throw new UtilityModelError('rate-limited', 'free-models-per-day', {
        model,
        dailyLimit: true
      })
    })
    const claude = account('claude', ['haiku'], async () => 'from claude')
    const host = new UtilityModelHost({
      sources: { openrouter: openRouter.source, claude: claude.source }
    })
    let provider: UtilityModelProviderId = 'openrouter'
    const client = host.client(() => ({ provider, model: null, fallbackModel: null }))

    await expect(client.complete(REQUEST)).rejects.toMatchObject({ kind: 'rate-limited' })
    expect(client.health().pausedUntil).not.toBeNull()

    provider = 'claude'
    const reply = await client.complete(REQUEST)

    expect(reply).toMatchObject({ text: 'from claude', provider: 'claude', model: 'haiku' })
    expect(client.health().pausedUntil).toBeNull()
    expect((await host.providerStatus('openrouter')).pausedUntil).not.toBeNull()
  })

  it('lists a public catalog for a provider that has no account yet', async () => {
    const host = new UtilityModelHost({
      sources: {
        openrouter: async () => ({
          configured: false,
          source: null,
          accountHint: null,
          tokenProtection: null,
          defaultModels: ['openrouter/free'],
          provider: null,
          publicCatalog: async () => [{ id: 'some/model:free', description: null, free: true }]
        })
      }
    })

    expect(await host.provider('openrouter').listModels()).toEqual({
      ok: true,
      models: [{ id: 'some/model:free', description: null, free: true }]
    })
    expect(await host.providerStatus('openrouter')).toEqual({
      provider: 'openrouter',
      configured: false,
      source: null,
      accountHint: null,
      tokenProtection: null,
      defaultModels: ['openrouter/free'],
      unavailableModels: [],
      pausedUntil: null,
      lastFailure: null
    })
  })

  it('saves an OpenRouter key and reports only that one is there', async () => {
    const host = new UtilityModelHost({ openRouter: memoryOpenRouter() })

    expect((await host.providerStatus('openrouter')).configured).toBe(false)
    const status = await host.setOpenRouter(API_KEY)

    expect(status).toMatchObject({
      provider: 'openrouter',
      configured: true,
      source: 'settings',
      accountHint: 'cdef',
      tokenProtection: 'sealed',
      defaultModels: ['openrouter/free', 'google/gemma-4-26b-a4b-it:free']
    })
    expect(JSON.stringify(status)).not.toContain(API_KEY)
    expect((await host.clearOpenRouter()).configured).toBe(false)
  })
})
