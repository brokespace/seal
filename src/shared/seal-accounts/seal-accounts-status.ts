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

export type SealAccountsStatus = {
  machineKey: string
  config: SealAccountsConfig
  providers: Record<SealProvider, SealProviderStatus>
  quarantine: Record<SealAccountKey, SealQuarantineEntry>
  swapLog: SealSwapEvent[]
  sessions: SealSessionAssignment[]
  workspacePins: SealWorkspacePins
  secretStorage: { available: boolean; protectionGap: string | null }
}
