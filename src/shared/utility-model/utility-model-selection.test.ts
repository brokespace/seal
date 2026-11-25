import { describe, expect, it } from 'vitest'
import {
  normalizeSessionSummaryModels,
  utilityModelCandidates,
  utilityModelChoiceFor
} from './utility-model-selection'

describe('session summary model selection', () => {
  it('reads settings saved before providers could be chosen as Cloudflare with its own models', () => {
    expect(normalizeSessionSummaryModels(undefined)).toEqual({
      summaries: { provider: 'cloudflare-workers-ai', model: null, fallbackModel: null },
      recaps: null
    })
  })

  it('keeps a saved choice and drops a provider this build does not know', () => {
    const models = normalizeSessionSummaryModels({
      summaries: { provider: 'openrouter', model: ' openrouter/free ', fallbackModel: '' },
      recaps: { provider: 'retired-provider', model: 'x' }
    })

    expect(models).toEqual({
      summaries: { provider: 'openrouter', model: 'openrouter/free', fallbackModel: null },
      recaps: null
    })
  })

  it('runs recaps on the summaries choice until they are given their own', () => {
    const summaries = { provider: 'claude' as const, model: 'haiku', fallbackModel: null }
    const recaps = { provider: 'openrouter' as const, model: null, fallbackModel: null }

    expect(utilityModelChoiceFor({ summaries, recaps: null }, 'recaps')).toBe(summaries)
    expect(utilityModelChoiceFor({ summaries, recaps }, 'recaps')).toBe(recaps)
    expect(utilityModelChoiceFor({ summaries, recaps }, 'summaries')).toBe(summaries)
  })

  it('orders the models to try: chosen, chosen fallback, then the provider defaults', () => {
    const defaults = ['@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it']

    expect(utilityModelCandidates({ model: null, fallbackModel: null }, defaults)).toEqual(defaults)
    expect(utilityModelCandidates({ model: null, fallbackModel: 'spare' }, defaults)).toEqual([
      '@cf/zai-org/glm-4.7-flash',
      'spare',
      '@cf/google/gemma-4-26b-a4b-it'
    ])
    expect(
      utilityModelCandidates({ model: 'chosen', fallbackModel: defaults[0] }, defaults)
    ).toEqual(['chosen', '@cf/zai-org/glm-4.7-flash', '@cf/google/gemma-4-26b-a4b-it'])
  })
})
