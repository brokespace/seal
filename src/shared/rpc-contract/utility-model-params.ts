import { z } from 'zod'

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
