import { isUtilityModelProviderId, type UtilityModelProviderId } from './utility-model-types'

/** What Seal's own chores run on: session status summaries, and session recaps. */
export const UTILITY_MODEL_TASKS = ['summaries', 'recaps'] as const
export type UtilityModelTask = (typeof UTILITY_MODEL_TASKS)[number]

export function isUtilityModelTask(value: unknown): value is UtilityModelTask {
  return UTILITY_MODEL_TASKS.some((task) => task === value)
}

export type UtilityModelChoice = {
  provider: UtilityModelProviderId
  /** Null runs the provider's own default model. */
  model: string | null
  /** Tried when the model is refused or limited; null leaves that to the provider's defaults. */
  fallbackModel: string | null
}

export type SessionSummaryModels = {
  summaries: UtilityModelChoice
  /** Null: recaps run on whatever summaries run on. */
  recaps: UtilityModelChoice | null
}

/** Before providers could be chosen, everything ran on Cloudflare with the models saved beside its account. */
export const DEFAULT_UTILITY_MODEL_CHOICE: UtilityModelChoice = {
  provider: 'cloudflare-workers-ai',
  model: null,
  fallbackModel: null
}

function modelId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function choiceOf(value: unknown): UtilityModelChoice | null {
  if (typeof value !== 'object' || value === null || !('provider' in value)) {
    return null
  }
  if (!isUtilityModelProviderId(value.provider)) {
    return null
  }
  return {
    provider: value.provider,
    model: 'model' in value ? modelId(value.model) : null,
    fallbackModel: 'fallbackModel' in value ? modelId(value.fallbackModel) : null
  }
}

/**
 * The saved choice, or the one every install had before there was a choice. Settings written by an
 * older Seal have no `sessionSummaryModels`, and a provider this build does not know reads as unset.
 */
export function normalizeSessionSummaryModels(value: unknown): SessionSummaryModels {
  const saved = typeof value === 'object' && value !== null ? value : {}
  return {
    summaries:
      ('summaries' in saved ? choiceOf(saved.summaries) : null) ?? DEFAULT_UTILITY_MODEL_CHOICE,
    recaps: 'recaps' in saved ? choiceOf(saved.recaps) : null
  }
}

export function utilityModelChoiceFor(
  models: SessionSummaryModels,
  task: UtilityModelTask
): UtilityModelChoice {
  return task === 'recaps' ? (models.recaps ?? models.summaries) : models.summaries
}

/** The models a request tries, preferred first: the chosen ones, then the provider's own defaults. */
export function utilityModelCandidates(
  choice: Pick<UtilityModelChoice, 'model' | 'fallbackModel'>,
  providerDefaults: readonly string[]
): string[] {
  const ordered = [
    choice.model ?? providerDefaults[0],
    choice.fallbackModel,
    ...providerDefaults
  ].filter((model): model is string => typeof model === 'string' && model !== '')
  return [...new Set(ordered)]
}
