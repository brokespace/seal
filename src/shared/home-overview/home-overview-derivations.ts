import { liveSessionMachineId } from '../live-sessions/live-session-machine-id'
import type { LiveSession } from '../live-sessions/live-session-types'
import type { HomeAccount, HomeMachine, HomeUsageWindow } from './home-overview-types'

export const ACCOUNT_NEAR_LIMIT_PERCENT = 80

export function peakUsageWindow(account: HomeAccount): HomeUsageWindow | null {
  let peak: HomeUsageWindow | null = null
  for (const window of account.windows) {
    if (!peak || window.usedPercent > peak.usedPercent) {
      peak = window
    }
  }
  return peak
}

export function accountNearLimit(account: HomeAccount): boolean {
  return (peakUsageWindow(account)?.usedPercent ?? 0) >= ACCOUNT_NEAR_LIMIT_PERCENT
}

/** Earliest future reset; for an account near its limit, the reset of the window that is close. */
export function accountNextReset(account: HomeAccount, now: number): number | null {
  const candidates = accountNearLimit(account)
    ? account.windows.filter((window) => window.usedPercent >= ACCOUNT_NEAR_LIMIT_PERCENT)
    : account.windows
  let next: number | null = null
  for (const window of candidates) {
    if (
      window.resetsAt !== null &&
      window.resetsAt > now &&
      (next === null || window.resetsAt < next)
    ) {
      next = window.resetsAt
    }
  }
  return next
}

/** Machines known to the machines provider plus any that only appear as a session's host. */
export function mergeSessionMachines(
  machines: readonly HomeMachine[],
  sessions: readonly Pick<LiveSession, 'machine'>[]
): HomeMachine[] {
  const merged = [...machines]
  const known = new Set(machines.map((machine) => machine.id))
  for (const { machine } of sessions) {
    const id = liveSessionMachineId(machine)
    if (!known.has(id)) {
      known.add(id)
      merged.push({
        id,
        label: machine.label,
        kind:
          machine.kind === 'local' ? 'local' : machine.connection === 'server' ? 'runtime' : 'ssh',
        // A host whose sessions are still being scanned is reachable.
        status: 'online'
      })
    }
  }
  return merged
}

export type HomeElapsed = { value: number; unit: 'second' | 'minute' | 'hour' | 'day' }

export function homeElapsed(fromMs: number, nowMs: number): HomeElapsed | null {
  if (!fromMs || fromMs > nowMs + 60_000) {
    return null
  }
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (seconds < 60) {
    return { value: seconds, unit: 'second' }
  }
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    return { value: minutes, unit: 'minute' }
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return { value: hours, unit: 'hour' }
  }
  return { value: Math.floor(hours / 24), unit: 'day' }
}
