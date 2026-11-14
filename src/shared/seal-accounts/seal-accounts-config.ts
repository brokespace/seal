import * as z from 'zod'

export const SEAL_PROVIDERS = ['claude', 'codex'] as const
export type SealProvider = (typeof SEAL_PROVIDERS)[number]

/**
 * Cross-machine account identity. OAuth logins are `<provider>:<email>` plus `#<org>` when the
 * provider names an organization/workspace; API keys are `<provider>-key:<vault id>`.
 */
export type SealAccountKey = string

const AccountKey = z.string().trim().min(3).max(512)
const Percent = z.number().min(1).max(100)

export const SealAccountProfileSchema = z
  .object({
    alias: z.string().trim().max(80).optional(),
    plan: z.string().trim().max(80).optional(),
    /** Lower is preferred. */
    priority: z.number().int().min(0).max(1000).optional(),
    /** Never chosen automatically; explicit overrides still work. */
    disabled: z.boolean().optional(),
    sessionThreshold: Percent.optional(),
    weeklyThreshold: Percent.optional()
  })
  .strict()
export type SealAccountProfile = z.infer<typeof SealAccountProfileSchema>

export const SealScopePolicySchema = z
  .object({
    /** Empty or absent allows every account. */
    allow: z.array(AccountKey).max(200).optional(),
    default: AccountKey.nullable().optional()
  })
  .strict()
export type SealScopePolicy = z.infer<typeof SealScopePolicySchema>

export const SealProjectRuleSchema = z
  .object({
    /** Git remote key (`github.com/owner/repo`), repo path, folder name or display name; `*` globs. */
    match: z.string().trim().min(1).max(512),
    label: z.string().trim().max(120).optional(),
    claude: SealScopePolicySchema.optional(),
    codex: SealScopePolicySchema.optional()
  })
  .strict()
export type SealProjectRule = z.infer<typeof SealProjectRuleSchema>

export const SealMachineRuleSchema = z
  .object({
    /** `local`, `runtime:<environment id>` or `ssh:<target id>`. */
    machine: z.string().trim().min(1).max(512),
    label: z.string().trim().max(120).optional(),
    claude: SealScopePolicySchema.optional(),
    codex: SealScopePolicySchema.optional()
  })
  .strict()
export type SealMachineRule = z.infer<typeof SealMachineRuleSchema>

export const SEAL_SWAP_STRATEGIES = ['best', 'weekly-first', 'consume-first', 'priority'] as const
export type SealSwapStrategy = (typeof SEAL_SWAP_STRATEGIES)[number]

export const SealAutoSwapSettingsSchema = z
  .object({
    enabled: z.boolean(),
    strategy: z.enum(SEAL_SWAP_STRATEGIES),
    sessionThreshold: Percent,
    weeklyThreshold: Percent,
    /** Extra headroom (points) a proactive swap target needs over the current account. */
    hysteresis: z.number().min(0).max(50),
    cooldownMinutes: z
      .number()
      .min(0)
      .max(24 * 60),
    failoverOnAuthError: z.boolean(),
    quarantineMinutes: z
      .number()
      .min(1)
      .max(7 * 24 * 60),
    /** Count per-model weekly windows (e.g. Claude Fable) against the weekly threshold. */
    respectModelLimits: z.boolean(),
    /** Let pay-as-you-go API keys catch launches when every subscription is exhausted. */
    apiKeyFallback: z.boolean(),
    /** Swap running sessions in place (or resume them on the new account); absent means on. */
    liveSessionSwap: z.boolean().optional(),
    /** Last resort: also swap when an agent prints a limit stop usage polling missed; absent means on. */
    rateLimitFallback: z.boolean().optional()
  })
  .strict()
export type SealAutoSwapSettings = z.infer<typeof SealAutoSwapSettingsSchema>

export const SealApiKeyAccountSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    provider: z.enum(SEAL_PROVIDERS),
    label: z.string().trim().min(1).max(80),
    /** Last four characters only; the key itself lives in the secret vault. */
    keyHint: z.string().max(8),
    createdAt: z.number(),
    /** Absent means a pay-as-you-go API key; a setup token is a long-lived subscription login. */
    credential: z.enum(['api-key', 'setup-token']).optional()
  })
  .strict()
export type SealApiKeyAccount = z.infer<typeof SealApiKeyAccountSchema>

export const SealAccountsConfigSchema = z
  .object({
    version: z.literal(1),
    profiles: z.record(AccountKey, SealAccountProfileSchema),
    apiKeys: z.array(SealApiKeyAccountSchema).max(100),
    projects: z.array(SealProjectRuleSchema).max(500),
    machines: z.array(SealMachineRuleSchema).max(200),
    autoSwap: z
      .object({ claude: SealAutoSwapSettingsSchema, codex: SealAutoSwapSettingsSchema })
      .strict(),
    updatedAt: z.number()
  })
  .strict()
export type SealAccountsConfig = z.infer<typeof SealAccountsConfigSchema>

export function defaultSealAutoSwapSettings(): SealAutoSwapSettings {
  return {
    enabled: false,
    // claude-swap's AutoSwitchSettings: threshold 90 on every window (no separate weekly line),
    // hysteresisPct 10, cooldownSeconds 300.
    strategy: 'best',
    sessionThreshold: 90,
    weeklyThreshold: 90,
    hysteresis: 10,
    cooldownMinutes: 5,
    failoverOnAuthError: true,
    quarantineMinutes: 60,
    respectModelLimits: true,
    apiKeyFallback: false,
    liveSessionSwap: true,
    rateLimitFallback: true
  }
}

export function defaultSealAccountsConfig(): SealAccountsConfig {
  return {
    version: 1,
    profiles: {},
    apiKeys: [],
    projects: [],
    machines: [],
    autoSwap: { claude: defaultSealAutoSwapSettings(), codex: defaultSealAutoSwapSettings() },
    updatedAt: 0
  }
}

/** Unknown or damaged files fall back to defaults rather than blocking launches. */
export function parseSealAccountsConfig(value: unknown): SealAccountsConfig {
  const parsed = SealAccountsConfigSchema.safeParse(value)
  return parsed.success ? parsed.data : defaultSealAccountsConfig()
}
