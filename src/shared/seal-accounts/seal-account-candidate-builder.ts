import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../managed-account-types'
import type {
  ProviderRateLimits,
  RateLimitState,
  UsageRateLimitFailureKind
} from '../rate-limit-types'
import type {
  SealAccountKey,
  SealAccountProfile,
  SealAccountsConfig,
  SealProvider
} from './seal-accounts-config'
import {
  DEFAULT_SEAL_ACCOUNT_PRIORITY,
  type SealAccountCandidate,
  type SealAccountKind,
  type SealAccountUsage,
  type SealModelWindow
} from './seal-account-candidates'
import { apiKeyAccountKey, oauthAccountKey, sealAccountKeysMatch } from './seal-account-key'

const WEEK_MINUTES = 7 * 24 * 60

const DEAD_LOGIN_FAILURES: ReadonlySet<UsageRateLimitFailureKind> = new Set([
  'stale-token',
  'missing-credentials',
  'refreshable-credentials-without-token'
])

export function usageFromRateLimits(limits: ProviderRateLimits | null): SealAccountUsage | null {
  if (!limits) {
    return null
  }
  const models: SealModelWindow[] = []
  if (limits.fableWeekly) {
    models.push({
      name: 'Fable',
      usedPercent: limits.fableWeekly.usedPercent,
      resetsAt: limits.fableWeekly.resetsAt
    })
  }
  for (const bucket of limits.buckets ?? []) {
    if (bucket.windowMinutes >= WEEK_MINUTES) {
      models.push({ name: bucket.name, usedPercent: bucket.usedPercent, resetsAt: bucket.resetsAt })
    }
  }
  const window = (value: ProviderRateLimits['session']) =>
    value ? { usedPercent: value.usedPercent, resetsAt: value.resetsAt } : null
  return {
    session: window(limits.session),
    weekly: window(limits.weekly),
    models,
    planType: limits.planType ?? null,
    updatedAt: limits.updatedAt,
    error: limits.error
  }
}

function isDeadLogin(limits: ProviderRateLimits | null): boolean {
  const kind = limits?.usageMetadata?.failureKind
  return limits?.status === 'error' && kind !== undefined && DEAD_LOGIN_FAILURES.has(kind)
}

export function findSealProfile(
  config: Pick<SealAccountsConfig, 'profiles'>,
  key: SealAccountKey
): SealAccountProfile | undefined {
  if (config.profiles[key]) {
    return config.profiles[key]
  }
  const match = Object.keys(config.profiles).find((saved) => sealAccountKeysMatch(saved, key))
  return match ? config.profiles[match] : undefined
}

type CandidateSeed = {
  key: SealAccountKey
  provider: SealProvider
  kind: SealAccountKind
  localId: string | null
  email: string | null
  fallbackLabel: string
  active: boolean
  launchable: boolean
  limits: ProviderRateLimits | null
}

function toCandidate(seed: CandidateSeed, config: SealAccountsConfig): SealAccountCandidate {
  const profile = findSealProfile(config, seed.key)
  const usage = usageFromRateLimits(seed.limits)
  return {
    key: seed.key,
    provider: seed.provider,
    kind: seed.kind,
    localId: seed.localId,
    email: seed.email,
    label: profile?.alias || seed.email || seed.fallbackLabel,
    plan: profile?.plan || usage?.planType || null,
    priority: profile?.priority ?? DEFAULT_SEAL_ACCOUNT_PRIORITY,
    disabled: profile?.disabled === true,
    active: seed.active,
    launchable: seed.launchable,
    authFailure: isDeadLogin(seed.limits),
    usage,
    sessionThreshold: profile?.sessionThreshold ?? null,
    weeklyThreshold: profile?.weeklyThreshold ?? null
  }
}

function inactiveLimits(
  entries: RateLimitState['inactiveClaudeAccounts'] | undefined,
  accountId: string
): ProviderRateLimits | null {
  return entries?.find((entry) => entry.accountId === accountId)?.rateLimits ?? null
}

export type SealCandidateSources = {
  config: SealAccountsConfig
  claude: ClaudeRateLimitAccountsState
  codex: CodexRateLimitAccountsState
  rateLimits: RateLimitState | null
  /** API-key vault ids whose secret this host can decrypt. */
  storedApiKeyIds: ReadonlySet<string>
}

function claudeCandidates(sources: SealCandidateSources): SealAccountCandidate[] {
  const { claude, rateLimits, config } = sources
  const hostSelection = claude.activeAccountIdsByRuntime?.host ?? claude.activeAccountId
  const activeLimits =
    rateLimits?.claudeTarget.runtime === 'wsl' ? null : (rateLimits?.claude ?? null)
  const seeds: CandidateSeed[] = claude.accounts.map((account) => {
    const active = hostSelection === account.id
    return {
      key: oauthAccountKey('claude', account.email, account.organizationUuid),
      provider: 'claude',
      kind: 'oauth',
      localId: account.id,
      email: account.email,
      fallbackLabel: account.email,
      active,
      launchable: account.managedAuthRuntime !== 'wsl' && account.needsSignIn !== true,
      limits: active ? activeLimits : inactiveLimits(rateLimits?.inactiveClaudeAccounts, account.id)
    }
  })
  const systemEmail = claude.systemDefaultEmail
  if (systemEmail) {
    const key = oauthAccountKey('claude', systemEmail, claude.systemDefaultOrganizationUuid)
    if (!seeds.some((seed) => sealAccountKeysMatch(seed.key, key))) {
      seeds.push({
        key,
        provider: 'claude',
        kind: 'system',
        localId: null,
        email: systemEmail,
        fallbackLabel: systemEmail,
        active: hostSelection === null,
        launchable: true,
        limits: hostSelection === null ? activeLimits : null
      })
    }
  }
  return seeds.map((seed) => toCandidate(seed, config))
}

function codexCandidates(sources: SealCandidateSources): SealAccountCandidate[] {
  const { codex, rateLimits, config } = sources
  const hostSelection = codex.activeAccountIdsByRuntime?.host ?? codex.activeAccountId
  const activeLimits =
    rateLimits?.codexTarget.runtime === 'wsl' ? null : (rateLimits?.codex ?? null)
  const seeds: CandidateSeed[] = codex.accounts.map((account) => {
    const active = hostSelection === account.id
    return {
      key: oauthAccountKey('codex', account.email, account.workspaceAccountId),
      provider: 'codex',
      kind: 'oauth',
      localId: account.id,
      email: account.email,
      fallbackLabel: account.email,
      active,
      launchable: account.managedHomeRuntime !== 'wsl',
      limits: active ? activeLimits : inactiveLimits(rateLimits?.inactiveCodexAccounts, account.id)
    }
  })
  const system = codex.systemDefault
  if (system?.authKind === 'oauth' && system.email) {
    const key = oauthAccountKey('codex', system.email, system.providerAccountId)
    if (!seeds.some((seed) => sealAccountKeysMatch(seed.key, key))) {
      seeds.push({
        key,
        provider: 'codex',
        kind: 'system',
        localId: null,
        email: system.email,
        fallbackLabel: system.email,
        active: hostSelection === null,
        launchable: true,
        limits: hostSelection === null ? activeLimits : null
      })
    }
  }
  return seeds.map((seed) => toCandidate(seed, config))
}

function apiKeyCandidates(
  sources: SealCandidateSources,
  provider: SealProvider
): SealAccountCandidate[] {
  return sources.config.apiKeys
    .filter((entry) => entry.provider === provider)
    .map((entry) =>
      toCandidate(
        {
          key: apiKeyAccountKey(provider, entry.id),
          provider,
          kind: 'api-key',
          localId: entry.id,
          email: null,
          fallbackLabel: entry.label,
          active: false,
          launchable: sources.storedApiKeyIds.has(entry.id),
          limits: null
        },
        sources.config
      )
    )
}

export function buildSealCandidates(
  sources: SealCandidateSources,
  provider: SealProvider
): SealAccountCandidate[] {
  const oauth = provider === 'claude' ? claudeCandidates(sources) : codexCandidates(sources)
  return [...oauth, ...apiKeyCandidates(sources, provider)]
}
