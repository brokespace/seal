import type { SealAutoSwapSettings, SealSwapStrategy } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import {
  accountLines,
  bindingWindow,
  relevantWindows,
  SESSION_WINDOW_LABEL
} from './seal-usage-lines'

export type SealThresholdSettings = Pick<
  SealAutoSwapSettings,
  'sessionThreshold' | 'weeklyThreshold' | 'respectModelLimits'
>

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
  const windows = relevantWindows(candidate, settings, now)
  let session: number | null = null
  let weekly: number | null = null
  let weeklyResetsAt: number | null = null
  for (const window of windows) {
    if (window.label === SESSION_WINDOW_LABEL) {
      session = window.pct
    } else if (weekly === null || window.pct > weekly) {
      weekly = window.pct
      weeklyResetsAt = window.resetsAt
    }
  }
  return {
    session,
    weekly,
    weeklyResetsAt,
    sessionThreshold: candidate.sessionThreshold ?? settings.sessionThreshold,
    weeklyThreshold: candidate.weeklyThreshold ?? settings.weeklyThreshold,
    known: session !== null || weekly !== null
  }
}

export function isExhausted(pressure: SealAccountPressure): boolean {
  return (
    (pressure.session !== null && pressure.session >= pressure.sessionThreshold) ||
    (pressure.weekly !== null && pressure.weekly >= pressure.weeklyThreshold)
  )
}

function headroom(candidate: SealAccountCandidate, settings: SealThresholdSettings, now: number) {
  const binding = bindingWindow(
    relevantWindows(candidate, settings, now),
    accountLines(candidate, settings)
  )
  // Unknown usage ranks below any account known to have real room but stays usable for launches.
  return binding ? binding.lineHeadroom : 25
}

type Ranked = { candidate: SealAccountCandidate; pressure: SealAccountPressure; headroom: number }

function compareTieBreak(a: Ranked, b: Ranked): number {
  return (
    a.candidate.priority - b.candidate.priority || a.candidate.key.localeCompare(b.candidate.key)
  )
}

const COMPARATORS: Record<SealSwapStrategy, (a: Ranked, b: Ranked) => number> = {
  best: (a, b) => b.headroom - a.headroom || compareTieBreak(a, b),
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
    .map((candidate) => ({
      candidate,
      pressure: accountPressure(candidate, settings, now),
      headroom: headroom(candidate, settings, now)
    }))
    .sort(COMPARATORS[strategy])
    .map((ranked) => ranked.candidate)
}
