import { z } from 'zod'
import { UTILITY_MODEL_PROVIDER_IDS } from '../utility-model/utility-model-types'

const ModelId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^@?[\w.-]+(\/[\w.-]+)+$/, 'Not a model id')

/** Omitted fields keep what is saved; credentials only ever travel towards the host. */
export const UtilityModelSetCloudflareParams = z
  .object({
    accountId: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{32}$/i, 'A Cloudflare account id is 32 hex characters')
      .optional(),
    apiToken: z.string().trim().min(20).max(400).regex(/^\S+$/, 'A token has no spaces').optional(),
    model: ModelId.optional(),
    fallbackModel: ModelId.optional()
  })
  .strict()

const ProviderId = z.enum(UTILITY_MODEL_PROVIDER_IDS)

/** Every provider names models its own way (`haiku`, `openrouter/free`, `@cf/…`): only spaces are ruled out. */
const ChosenModelId = z.string().trim().min(1).max(200).regex(/^\S+$/, 'A model id has no spaces')

/** No provider means Cloudflare Workers AI, the only one older clients know. */
export const UtilityModelProviderParams = z.object({ provider: ProviderId.optional() }).strict()

export const UtilityModelTestParams = z
  .object({
    provider: ProviderId.optional(),
    model: ChosenModelId.nullable().optional(),
    fallbackModel: ChosenModelId.nullable().optional()
  })
  .strict()

/** The key only ever travels towards the host. */
export const UtilityModelSetOpenRouterParams = z
  .object({
    apiKey: z.string().trim().min(20).max(400).regex(/^\S+$/, 'A key has no spaces')
  })
  .strict()

export const UtilityModelChoiceParams = z
  .object({
    provider: ProviderId,
    model: ChosenModelId.nullable(),
    fallbackModel: ChosenModelId.nullable()
  })
  .strict()
