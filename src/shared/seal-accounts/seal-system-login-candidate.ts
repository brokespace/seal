import type { ProviderRateLimits } from '../rate-limit-types'
import type { SealAccountKey, SealProvider } from './seal-accounts-config'
import type { SealAccountKind, SealCredentialKind } from './seal-account-candidates'
import type { SealCandidateSources } from './seal-account-candidate-builder'
import { oauthAccountKey, sealAccountKeysMatch } from './seal-account-key'

/** One account before its profile, usage and health are applied. */
export type SealCandidateSeed = {
  key: SealAccountKey
  provider: SealProvider
  kind: SealAccountKind
  credential: SealCredentialKind
  localId: string | null
  email: string | null
  orgName: string | null
  fallbackLabel: string
  active: boolean
  launchable: boolean
  needsSignIn: boolean
  systemLogin: boolean
  wslDistro: string | null
  addedAt: number | null
  /** The rate-limit service's reading for this account; null when it holds none. */
  limits: ProviderRateLimits | null
  fetching: boolean
}

/** The identity the machine's own `claude` or `codex` CLI is signed in to. */
export type SealSystemIdentity = {
  email: string
  /** Claude organization uuid or Codex workspace id. */
  scope: string | null
  orgName: string | null
}

function isDismissed(sources: SealCandidateSources, key: SealAccountKey): boolean {
  return (sources.dismissedSystemLogins ?? []).some((entry) => sealAccountKeysMatch(entry, key))
}

/** Folds the machine's own login into the list: tagged on its saved twin, else its own row. */
export function withSystemLogin(
  seeds: SealCandidateSeed[],
  sources: SealCandidateSources,
  provider: SealProvider,
  system: SealSystemIdentity | null,
  hostSelection: string | null,
  activeLimits: ProviderRateLimits | null
): SealCandidateSeed[] {
  if (!system) {
    return seeds
  }
  const key = oauthAccountKey(provider, system.email, system.scope)
  const twin = seeds.findIndex((seed) => sealAccountKeysMatch(seed.key, key))
  if (twin !== -1) {
    return seeds.map((seed, index) =>
      index === twin
        ? { ...seed, systemLogin: true, orgName: seed.orgName ?? system.orgName }
        : seed
    )
  }
  if (isDismissed(sources, key)) {
    return seeds
  }
  const selected = hostSelection === null
  // Its own slot while another account is selected, and only when that reading is this login's.
  const kept = sources.rateLimits?.systemLoginUsage?.[provider]
  const unselected = kept && sealAccountKeysMatch(kept.identity, key) ? kept : null
  return [
    ...seeds,
    {
      key,
      provider,
      kind: 'system',
      credential: 'login',
      localId: null,
      email: system.email,
      orgName: system.orgName,
      fallbackLabel: system.email,
      active: selected,
      launchable: true,
      needsSignIn: false,
      systemLogin: true,
      wslDistro: null,
      addedAt: null,
      limits: selected ? activeLimits : (unselected?.rateLimits ?? null),
      fetching: selected ? activeLimits?.status === 'fetching' : unselected?.isFetching === true
    }
  ]
}

export function claudeSystemIdentity(sources: SealCandidateSources): SealSystemIdentity | null {
  if (sources.systemLogins && 'claude' in sources.systemLogins) {
    return sources.systemLogins.claude ?? null
  }
  const email = sources.claude.systemDefaultEmail
  return email
    ? { email, scope: sources.claude.systemDefaultOrganizationUuid ?? null, orgName: null }
    : null
}

export function codexSystemIdentity(sources: SealCandidateSources): SealSystemIdentity | null {
  if (sources.systemLogins && 'codex' in sources.systemLogins) {
    return sources.systemLogins.codex ?? null
  }
  const system = sources.codex.systemDefault
  return system?.authKind === 'oauth' && system.email
    ? { email: system.email, scope: system.providerAccountId, orgName: system.workspaceLabel }
    : null
}
