import type { ProviderRateLimits } from '../rate-limit-types'
import type { SealAccountKey, SealProvider } from './seal-accounts-config'
import type { SealAccountRateLimit } from './seal-account-rate-limit'
import type { SealSwapEstimate } from './seal-swap-estimate'

/** `system` is this machine's own CLI login used in place; `api-key` covers every secret Seal injects by env. */
export type SealAccountKind = 'oauth' | 'api-key' | 'system'

export type SealCredentialKind = 'login' | 'setup-token' | 'api-key'

export type SealAccountHealth =
  | { state: 'ok' }
  | { state: 'expiring'; expiresAt: number }
  | { state: 'dead'; reason: 'signed-out' | 'rejected' | 'expired' | 'missing-secret' }

/** One account this host could launch an agent with, as Seal's policy and swap logic see it. */
export type SealAccountCandidate = {
  key: SealAccountKey
  provider: SealProvider
  kind: SealAccountKind
  /** The id this host's account service knows it by; null for the provider's own login. */
  localId: string | null
  email: string | null
  /** Claude organization or Codex workspace name, when the login names one. */
  orgName?: string | null
  label: string
  plan: string | null
  /** A plan seat or metered API usage; null when the provider has not said. */
  billing?: 'subscription' | 'api' | null
  credential?: SealCredentialKind
  /** This identity is the machine's own `claude`/`codex` login (the row itself, or a saved twin). */
  systemLogin?: boolean
  health?: SealAccountHealth
  /** Set for an account that lives in a WSL distro rather than on the host. */
  wslDistro?: string | null
  addedAt?: number | null
  priority: number
  disabled: boolean
  active: boolean
  /** Holds a login on this host and runs here (not a WSL-only account). */
  launchable: boolean
  /** The last usage read proved the login needs a new sign-in (revoked or missing). */
  authFailure: boolean
  /** The rate-limit service's reading for this account: the object the usage popover shows. */
  limits: ProviderRateLimits | null
  /** The service is reading this account's usage right now. */
  usageFetching?: boolean
  /** Set while the account is out of quota, on real evidence only; absent on older hosts. */
  rateLimit?: SealAccountRateLimit | null
  sessionThreshold: number | null
  weeklyThreshold: number | null
  /** When Seal's usage poller reads this account next; absent while it is not polling. */
  nextPollAt?: number | null
  /** When this account (if in use) is expected to cross a switch line. */
  swapEstimate?: SealSwapEstimate | null
}

export const DEFAULT_SEAL_ACCOUNT_PRIORITY = 100
