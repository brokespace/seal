import type { SealAccountKey, SealProvider } from './seal-accounts-config'

export type SealUsageWindow = {
  usedPercent: number
  resetsAt: number | null
}

export type SealModelWindow = SealUsageWindow & { name: string }

export type SealAccountUsage = {
  session: SealUsageWindow | null
  weekly: SealUsageWindow | null
  /** Per-model weekly windows, e.g. Claude Fable or Codex model buckets. */
  models: SealModelWindow[]
  planType: string | null
  updatedAt: number
  error: string | null
}

export type SealAccountKind = 'oauth' | 'api-key' | 'system'

/** One account this host could launch an agent with, as Seal's policy and swap logic see it. */
export type SealAccountCandidate = {
  key: SealAccountKey
  provider: SealProvider
  kind: SealAccountKind
  /** The id this host's account service knows it by; null for the provider's own login. */
  localId: string | null
  email: string | null
  label: string
  plan: string | null
  priority: number
  disabled: boolean
  active: boolean
  /** Holds a login on this host and runs here (not a WSL-only account). */
  launchable: boolean
  /** The last usage read failed because the login is dead (expired/revoked/missing). */
  authFailure: boolean
  usage: SealAccountUsage | null
  sessionThreshold: number | null
  weeklyThreshold: number | null
}

export const DEFAULT_SEAL_ACCOUNT_PRIORITY = 100
