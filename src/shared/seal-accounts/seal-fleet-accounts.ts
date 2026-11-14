import type { SealAccountKey, SealProvider } from './seal-accounts-config'
import type { SealAccountCandidate, SealAccountUsage } from './seal-account-candidates'
import { sealAccountKeysMatch } from './seal-account-key'

const DAY_MS = 24 * 60 * 60 * 1000

export type SealFleetReading = {
  machineKey: string
  machineLabel: string
  candidate: SealAccountCandidate
}

export type SealFleetMachinePresence = {
  machineKey: string
  machineLabel: string
  active: boolean
  launchable: boolean
}

export type SealFleetAccount = {
  key: SealAccountKey
  provider: SealProvider
  label: string
  plan: string | null
  usage: SealAccountUsage | null
  usageMachineLabel: string | null
  authFailure: boolean
  machines: SealFleetMachinePresence[]
}

/**
 * Whether a reading for the same login from another machine should replace the kept one: the
 * newest real figures win, and a failed read never hides real figures less than a day old.
 */
export function fleetUsageReplaces(
  current: SealAccountUsage | null,
  incoming: SealAccountUsage | null,
  now: number
): boolean {
  if (!incoming) {
    return false
  }
  if (!current) {
    return true
  }
  const incomingHasFigures = incoming.session !== null || incoming.weekly !== null
  const currentHasFigures = current.session !== null || current.weekly !== null
  if (!incomingHasFigures) {
    return !currentHasFigures || now - current.updatedAt > DAY_MS
  }
  if (!currentHasFigures) {
    return true
  }
  return incoming.updatedAt >= current.updatedAt
}

/** One row per login across every machine, so the same account signed in twice reads once. */
export function mergeFleetAccounts(
  readings: readonly SealFleetReading[],
  now: number
): SealFleetAccount[] {
  const merged: SealFleetAccount[] = []
  for (const { machineKey, machineLabel, candidate } of readings) {
    let row = merged.find(
      (entry) =>
        entry.provider === candidate.provider && sealAccountKeysMatch(entry.key, candidate.key)
    )
    if (!row) {
      row = {
        key: candidate.key,
        provider: candidate.provider,
        label: candidate.label,
        plan: candidate.plan,
        usage: null,
        usageMachineLabel: null,
        authFailure: false,
        machines: []
      }
      merged.push(row)
    }
    row.plan ??= candidate.plan
    if (fleetUsageReplaces(row.usage, candidate.usage, now)) {
      row.usage = candidate.usage
      row.usageMachineLabel = machineLabel
      row.authFailure = candidate.authFailure
    }
    row.machines.push({
      machineKey,
      machineLabel,
      active: candidate.active,
      launchable: candidate.launchable
    })
  }
  return merged
}
