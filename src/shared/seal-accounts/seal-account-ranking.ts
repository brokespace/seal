import type { SealAutoSwapSettings, SealSwapStrategy } from './seal-accounts-config'
import type { SealAccountCandidate, SealUsageWindow } from './seal-account-candidates'

export type SealThresholdSettings = Pick<
  SealAutoSwapSettings,
  'sessionThreshold' | 'weeklyThreshold' | 'respectModelLimits'
>

/** A window whose reset time has passed is empty again, whatever the last reading said. */
export function effectiveUsedPercent(window: SealUsageWindow | null, now: number): number | null {
  if (!window) {
    return null
  }
  if (window.resetsAt !== null && window.resetsAt <= now) {
    return 0
  }
  return Math.max(0, Math.min(100, window.usedPercent))
}

export type SealAccountPressure = {
  session: number | null
  /** The fullest weekly window, including model windows when they count. */
  weekly: number | null
  weeklyResetsAt: number | null
  sessionThreshold: number
  weeklyThreshold: number
  known: boolean
}

export function accountPressure(
  candidate: SealAccountCandidate,
  settings: SealThresholdSettings,
  now: number
): SealAccountPressure {
  const usage = candidate.usage
  const sessionThreshold = candidate.sessionThreshold ?? settings.sessionThreshold
  const weeklyThreshold = candidate.weeklyThreshold ?? settings.weeklyThreshold
  const session = effectiveUsedPercent(usage?.session ?? null, now)
  const weeklyWindows = [
    usage?.weekly ?? null,
    ...(settings.respectModelLimits ? (usage?.models ?? []) : [])
  ].filter((window): window is SealUsageWindow => window !== null)
  let weekly: number | null = null
  let weeklyResetsAt: number | null = null
  for (const window of weeklyWindows) {
    const used = effectiveUsedPercent(window, now)
    if (used !== null && (weekly === null || used > weekly)) {
      weekly = used
      weeklyResetsAt = window.resetsAt
    }
  }
  return {
    session,
    weekly,
    weeklyResetsAt,
    sessionThreshold,
    weeklyThreshold,
    known: session !== null || weekly !== null
  }
}

export function isExhausted(pressure: SealAccountPressure): boolean {
  return (
    (pressure.session !== null && pressure.session >= pressure.sessionThreshold) ||
    (pressure.weekly !== null && pressure.weekly >= pressure.weeklyThreshold)
  )
}

/** A swap target must sit `hysteresis` points under each threshold so two accounts cannot flap. */
export function hasComfortableHeadroom(pressure: SealAccountPressure, hysteresis: number): boolean {
  return (
    (pressure.session === null || pressure.session < pressure.sessionThreshold - hysteresis) &&
    (pressure.weekly === null || pressure.weekly < pressure.weeklyThreshold - hysteresis)
  )
}

function headroom(pressure: SealAccountPressure): number {
  // Unknown usage ranks below any account known to have real room but stays usable.
  if (!pressure.known) {
    return 25
  }
  const session = pressure.session === null ? 100 : pressure.sessionThreshold - pressure.session
  const weekly = pressure.weekly === null ? 100 : pressure.weeklyThreshold - pressure.weekly
  return Math.min(session, weekly)
}

type Ranked = { candidate: SealAccountCandidate; pressure: SealAccountPressure }

function compareTieBreak(a: Ranked, b: Ranked): number {
  return (
    a.candidate.priority - b.candidate.priority || a.candidate.key.localeCompare(b.candidate.key)
  )
}

const COMPARATORS: Record<SealSwapStrategy, (a: Ranked, b: Ranked) => number> = {
  best: (a, b) => headroom(b.pressure) - headroom(a.pressure) || compareTieBreak(a, b),
  'weekly-first': (a, b) =>
    (a.pressure.weekly ?? 50) - (b.pressure.weekly ?? 50) ||
    (a.pressure.session ?? 50) - (b.pressure.session ?? 50) ||
    compareTieBreak(a, b),
  // Spend the allowance that resets soonest first; it is lost at reset otherwise.
  'consume-first': (a, b) =>
    (a.pressure.weeklyResetsAt ?? Number.MAX_SAFE_INTEGER) -
      (b.pressure.weeklyResetsAt ?? Number.MAX_SAFE_INTEGER) || compareTieBreak(a, b),
  priority: compareTieBreak
}

export function rankCandidates(
  candidates: readonly SealAccountCandidate[],
  strategy: SealSwapStrategy,
  settings: SealThresholdSettings,
  now: number
): SealAccountCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, pressure: accountPressure(candidate, settings, now) }))
    .sort(COMPARATORS[strategy])
    .map((ranked) => ranked.candidate)
}
