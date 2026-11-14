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
  type SealAccountUsage,
  type SealModelWindow
} from './seal-account-candidates'
import { apiKeyAccountKey, oauthAccountKey, sealAccountKeysMatch } from './seal-account-key'
import {
  claudeSystemIdentity,
  codexSystemIdentity,
  withSystemLogin,
  type SealCandidateSeed,
  type SealSystemIdentity
} from './seal-system-login-candidate'
import { sealAccountHealth, type SealLoginExpiry } from './seal-account-health'

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

function candidateBilling(seed: SealCandidateSeed): SealAccountCandidate['billing'] {
  if (seed.kind === 'api-key') {
    // A setup token is a subscription login; every other stored secret is a metered key.
    return seed.credential === 'setup-token' ? 'subscription' : 'api'
  }
  return seed.limits?.billing ?? null
}

function toCandidate(seed: SealCandidateSeed, sources: SealCandidateSources): SealAccountCandidate {
  const profile = findSealProfile(sources.config, seed.key)
  const usage = usageFromRateLimits(seed.limits)
  const authFailure = isDeadLogin(seed.limits)
  const secret = seed.kind === 'api-key'
  return {
    key: seed.key,
    provider: seed.provider,
    kind: seed.kind,
    credential: seed.credential,
    localId: seed.localId,
    email: seed.email,
    orgName: seed.orgName,
    label: profile?.alias || seed.email || seed.fallbackLabel,
    plan: profile?.plan || usage?.planType || null,
    billing: candidateBilling(seed),
    systemLogin: seed.systemLogin,
    health: sealAccountHealth({
      now: sources.now ?? Date.now(),
      authFailure,
      needsSignIn: seed.needsSignIn,
      missingSecret: secret && !seed.launchable,
      setupTokenCreatedAt: seed.credential === 'setup-token' ? seed.addedAt : null,
      expiry: secret ? null : (sources.loginExpiry?.(seed.key) ?? null)
    }),
    wslDistro: seed.wslDistro,
    addedAt: seed.addedAt,
    priority: profile?.priority ?? DEFAULT_SEAL_ACCOUNT_PRIORITY,
    disabled: profile?.disabled === true,
    active: seed.active,
    launchable: seed.launchable,
    authFailure,
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
  /** Seal's own per-account usage readings, preferred when newer than the usage bar's. */
  polled?: (key: SealAccountKey) => ProviderRateLimits | null
  /** The machine's own logins when the caller read them; otherwise the account services' view. */
  systemLogins?: Partial<Record<SealProvider, SealSystemIdentity | null>>
  /** System logins the user removed from Seal; they stay out until re-imported. */
  dismissedSystemLogins?: readonly SealAccountKey[]
  loginExpiry?: (key: SealAccountKey) => SealLoginExpiry | null
  now?: number
}

function freshest(
  service: ProviderRateLimits | null,
  polled: ProviderRateLimits | null | undefined
): ProviderRateLimits | null {
  if (!polled) {
    return service
  }
  return !service || polled.updatedAt >= service.updatedAt ? polled : service
}

function withPolled(seed: SealCandidateSeed, sources: SealCandidateSources): SealCandidateSeed {
  return { ...seed, limits: freshest(seed.limits, sources.polled?.(seed.key)) }
}

/** Two saved copies of one login read as one account: the selected copy, else the usable one. */
function withoutDuplicateLogins(seeds: SealCandidateSeed[]): SealCandidateSeed[] {
  const kept: SealCandidateSeed[] = []
  for (const seed of seeds) {
    const index = kept.findIndex((entry) => sealAccountKeysMatch(entry.key, seed.key))
    if (index === -1) {
      kept.push(seed)
      continue
    }
    const current = kept[index]
    const replaces =
      (seed.active && !current.active) ||
      (seed.active === current.active && seed.launchable && !current.launchable)
    if (replaces) {
      kept[index] = seed
    }
  }
  return kept
}

function claudeCandidates(sources: SealCandidateSources): SealAccountCandidate[] {
  const { claude, rateLimits } = sources
  const hostSelection = claude.activeAccountIdsByRuntime?.host ?? claude.activeAccountId
  const activeLimits =
    rateLimits?.claudeTarget.runtime === 'wsl' ? null : (rateLimits?.claude ?? null)
  const saved: SealCandidateSeed[] = claude.accounts.map((account) => {
    const active = hostSelection === account.id
    const wsl = account.managedAuthRuntime === 'wsl'
    return {
      key: oauthAccountKey('claude', account.email, account.organizationUuid),
      provider: 'claude',
      kind: 'oauth',
      credential: 'login',
      localId: account.id,
      email: account.email,
      orgName: account.organizationName ?? null,
      fallbackLabel: account.email,
      active,
      launchable: !wsl && account.needsSignIn !== true,
      needsSignIn: account.needsSignIn === true,
      systemLogin: false,
      wslDistro: wsl ? (account.wslDistro ?? null) : null,
      addedAt: account.createdAt,
      limits: active ? activeLimits : inactiveLimits(rateLimits?.inactiveClaudeAccounts, account.id)
    }
  })
  const seeds = withSystemLogin(
    withoutDuplicateLogins(saved),
    sources,
    'claude',
    claudeSystemIdentity(sources),
    hostSelection,
    activeLimits
  )
  return seeds.map((seed) => toCandidate(withPolled(seed, sources), sources))
}

function codexCandidates(sources: SealCandidateSources): SealAccountCandidate[] {
  const { codex, rateLimits } = sources
  const hostSelection = codex.activeAccountIdsByRuntime?.host ?? codex.activeAccountId
  const activeLimits =
    rateLimits?.codexTarget.runtime === 'wsl' ? null : (rateLimits?.codex ?? null)
  const saved: SealCandidateSeed[] = codex.accounts.map((account) => {
    const active = hostSelection === account.id
    const wsl = account.managedHomeRuntime === 'wsl'
    return {
      key: oauthAccountKey('codex', account.email, account.workspaceAccountId),
      provider: 'codex',
      kind: 'oauth',
      credential: 'login',
      localId: account.id,
      email: account.email,
      orgName: account.workspaceLabel ?? null,
      fallbackLabel: account.email,
      active,
      launchable: !wsl,
      needsSignIn: false,
      systemLogin: false,
      wslDistro: wsl ? (account.wslDistro ?? null) : null,
      addedAt: account.createdAt,
      limits: active ? activeLimits : inactiveLimits(rateLimits?.inactiveCodexAccounts, account.id)
    }
  })
  const seeds = withSystemLogin(
    withoutDuplicateLogins(saved),
    sources,
    'codex',
    codexSystemIdentity(sources),
    hostSelection,
    activeLimits
  )
  return seeds.map((seed) => toCandidate(withPolled(seed, sources), sources))
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
          credential: entry.credential ?? 'api-key',
          localId: entry.id,
          email: null,
          orgName: null,
          fallbackLabel: entry.label,
          active: false,
          launchable: sources.storedApiKeyIds.has(entry.id),
          needsSignIn: false,
          systemLogin: false,
          wslDistro: null,
          addedAt: entry.createdAt,
          limits: null
        },
        sources
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
