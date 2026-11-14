import * as z from 'zod'
import { salvagingArray } from '../../../../src/shared/zod-salvage'
import { ProviderRateLimitsSchema } from '../../accounts/accounts-snapshot'

const Timestamp = z.number().finite()

const candidateSchema = z.looseObject({
  key: z.string().min(1),
  provider: z.string().min(1),
  kind: z.string(),
  email: z.string().nullable(),
  label: z.string(),
  plan: z.string().nullable(),
  priority: z.number(),
  disabled: z.boolean(),
  active: z.boolean(),
  launchable: z.boolean(),
  authFailure: z.boolean(),
  // The host's own usage reading, the object its usage popover and the accounts tab show.
  limits: ProviderRateLimitsSchema.nullish(),
  usageFetching: z.boolean().optional(),
  rateLimit: z.looseObject({ resetsAt: Timestamp.nullable() }).nullish(),
  sessionThreshold: z.number().nullable(),
  weeklyThreshold: z.number().nullable(),
  nextPollAt: Timestamp.nullish(),
  swapEstimate: z.looseObject({ at: Timestamp, window: z.string(), line: z.number() }).nullish()
})

const providerStatusSchema = z.looseObject({
  candidates: salvagingArray(candidateSchema),
  machineDefault: z.string().nullable(),
  lastDecision: z.looseObject({ at: Timestamp, summary: z.string() }).nullable()
})

const autoSwapSettingsSchema = z.looseObject({
  enabled: z.boolean(),
  strategy: z.string(),
  sessionThreshold: z.number(),
  weeklyThreshold: z.number(),
  failoverOnAuthError: z.boolean(),
  apiKeyFallback: z.boolean(),
  liveSessionSwap: z.boolean().optional(),
  rateLimitFallback: z.boolean().optional()
})

const sessionSwapEntrySchema = z.looseObject({
  at: Timestamp,
  fromLabel: z.string(),
  toLabel: z.string(),
  delivery: z.string()
})

const sessionAssignmentSchema = z.looseObject({
  id: z.string().min(1),
  at: Timestamp,
  provider: z.string().min(1),
  accountKey: z.string().nullable(),
  accountLabel: z.string(),
  projectLabel: z.string().nullable(),
  machineKey: z.string(),
  paneKey: z.string().nullish(),
  liveSwap: z.enum(['inherit', 'on', 'off']).optional(),
  history: salvagingArray(sessionSwapEntrySchema).optional(),
  endedAt: Timestamp.nullish()
})

const swapEventSchema = z.looseObject({
  at: Timestamp,
  provider: z.string(),
  toLabel: z.string(),
  reason: z.string()
})

export const sealAccountsStatusSchema = z.looseObject({
  machineKey: z.string(),
  config: z.looseObject({
    autoSwap: z.record(z.string(), autoSwapSettingsSchema)
  }),
  providers: z.record(z.string(), providerStatusSchema),
  quarantine: z.record(z.string(), z.looseObject({ until: Timestamp, reason: z.string() })),
  swapLog: salvagingArray(swapEventSchema),
  sessions: salvagingArray(sessionAssignmentSchema)
})

export type SealAccountsStatusRead = z.output<typeof sealAccountsStatusSchema>
export type SealCandidate = z.output<typeof candidateSchema>
export type SealAutoSwapRead = z.output<typeof autoSwapSettingsSchema>
export type SealSessionAssignmentRead = z.output<typeof sessionAssignmentSchema>
export type SealLiveSwapMode = NonNullable<SealSessionAssignmentRead['liveSwap']>
