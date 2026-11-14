import type { SealAccountKey, SealAccountsConfig, SealProvider } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import type { SealLaunchPickReason } from './seal-launch-account-pick'
import type { SealSwapReason } from './seal-auto-swap-decision'

export type SealSwapEvent = {
  at: number
  provider: SealProvider
  from: SealAccountKey | null
  to: SealAccountKey
  toLabel: string
  reason: SealSwapReason | 'manual'
}

export type SealSessionLiveSwapMode = 'inherit' | 'on' | 'off'

/** How a running session took a new account: credentials rewritten live, or a resume on it. */
export type SealSessionSwapDelivery = 'live' | 'resume' | 'failed'

export type SealSessionSwapEntry = {
  at: number
  from: SealAccountKey | null
  fromLabel: string
  to: SealAccountKey
  toLabel: string
  reason: SealSwapReason | 'manual'
  delivery: SealSessionSwapDelivery
  note?: string
}

/** Which account one launched session runs on; recorded when the launch picks it. */
export type SealSessionAssignment = {
  id: string
  at: number
  provider: SealProvider
  accountKey: SealAccountKey | null
  accountLabel: string
  reason: SealLaunchPickReason | 'host-selection'
  worktreeId: string | null
  tabId: string | null
  projectLabel: string | null
  machineKey: string
  warnings: string[]
  /** The terminal pane the session runs in (`tabId:leafId`). */
  paneKey?: string | null
  /** The session's own Claude config dir or CODEX_HOME, which a live swap rewrites. */
  profileHome?: string | null
  liveSwap?: SealSessionLiveSwapMode
  history?: SealSessionSwapEntry[]
  lastSwapAt?: number | null
  /** When its pane was last seen open, and first seen gone (cleared if it comes back). */
  lastSeenAt?: number | null
  endedAt?: number | null
}

export type SealQuarantineEntry = { until: number; reason: string }

export type SealWorkspacePins = Record<string, Partial<Record<SealProvider, SealAccountKey>>>

export type SealProviderStatus = {
  candidates: SealAccountCandidate[]
  /** This machine's allow-list and default, before any project rule. */
  machineAllow: SealAccountKey[] | null
  machineDefault: SealAccountKey | null
  lastDecision: { at: number; summary: string } | null
}

/** The machine's own CLI login, whether or not Seal lists it. */
export type SealSystemLogin = {
  key: SealAccountKey
  email: string
  orgName: string | null
  /** `listed`: shown as an account. `dismissed`: removed from Seal until re-imported. */
  state: 'listed' | 'dismissed'
}

/** What the one-time merge of Orca's saved accounts into the vault changed on this machine. */
export type SealMigrationNotice = {
  at: number
  merged: { provider: SealProvider; label: string; removed: number }[]
}

export type SealAccountsStatus = {
  machineKey: string
  config: SealAccountsConfig
  providers: Record<SealProvider, SealProviderStatus>
  quarantine: Record<SealAccountKey, SealQuarantineEntry>
  swapLog: SealSwapEvent[]
  sessions: SealSessionAssignment[]
  workspacePins: SealWorkspacePins
  /** Logins this machine pushed, by the machine now holding a copy. */
  fleetCopies?: Record<string, SealAccountKey[]>
  systemLogins?: Record<SealProvider, SealSystemLogin | null>
  migrationNotice?: SealMigrationNotice | null
  secretStorage: { available: boolean; protectionGap: string | null }
}
