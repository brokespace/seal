// Adapted from claude-swap (MIT, https://github.com/realiti4/claude-swap), src/claude_swap/lines.py.
import type { SealAutoSwapSettings } from './seal-accounts-config'
import type { SealAccountCandidate, SealUsageWindow } from './seal-account-candidates'

export const SESSION_WINDOW_LABEL = '5h'
export const WEEKLY_WINDOW_LABEL = '7d'

export type SealUsageLineSettings = Pick<
  SealAutoSwapSettings,
  'sessionThreshold' | 'weeklyThreshold' | 'respectModelLimits'
>

export type SealWindowReading = { label: string; pct: number; resetsAt: number | null }

/** A window whose reset has passed is empty again, whatever the last reading said. */
export function windowPct(window: SealUsageWindow, now: number): number {
  if (window.resetsAt !== null && window.resetsAt <= now) {
    return 0
  }
  return Math.max(0, Math.min(100, window.usedPercent))
}

/** The 5h, 7d and (when they count) per-model windows an account reports. */
export function relevantWindows(
  candidate: Pick<SealAccountCandidate, 'usage'>,
  settings: Pick<SealUsageLineSettings, 'respectModelLimits'>,
  now: number
): SealWindowReading[] {
  const usage = candidate.usage
  if (!usage) {
    return []
  }
  const windows: SealWindowReading[] = []
  const push = (label: string, window: SealUsageWindow | null) => {
    if (window) {
      windows.push({ label, pct: windowPct(window, now), resetsAt: window.resetsAt })
    }
  }
  push(SESSION_WINDOW_LABEL, usage.session)
  push(WEEKLY_WINDOW_LABEL, usage.weekly)
  if (settings.respectModelLimits) {
    for (const model of usage.models) {
      push(model.name, model)
    }
  }
  return windows
}

export type SealAccountLines = { session: number; weekly: number }

export function accountLines(
  candidate: Pick<SealAccountCandidate, 'sessionThreshold' | 'weeklyThreshold'>,
  settings: SealUsageLineSettings
): SealAccountLines {
  return {
    session: candidate.sessionThreshold ?? settings.sessionThreshold,
    weekly: candidate.weeklyThreshold ?? settings.weeklyThreshold
  }
}

/** The 5h window has its own line; the 7d and per-model windows share the weekly one. */
export function windowLine(label: string, lines: SealAccountLines): number {
  return label === SESSION_WINDOW_LABEL ? lines.session : lines.weekly
}

/**
 * Policy headroom of one window on the 5h scale: `100 - pct` when the lines match; otherwise
 * linear through three anchors (0% -> 100, line -> 100 - threshold, 100% -> 0).
 */
export function lineHeadroom(pct: number, line: number, threshold: number): number {
  if (line === threshold) {
    return 100 - pct
  }
  if (pct <= line) {
    return 100 - threshold + (threshold * (line - pct)) / line
  }
  return ((100 - threshold) * (100 - pct)) / (100 - line)
}

export type SealBinding = {
  label: string
  pct: number
  line: number
  resetsAt: number | null
  lineHeadroom: number
  over: boolean
}

/** The window with the least policy headroom, over-line windows first; null with no readings. */
export function bindingWindow(
  windows: readonly SealWindowReading[],
  lines: SealAccountLines
): SealBinding | null {
  let binding: SealBinding | null = null
  for (const window of windows) {
    const line = windowLine(window.label, lines)
    const candidate: SealBinding = {
      ...window,
      line,
      lineHeadroom: lineHeadroom(window.pct, line, lines.session),
      over: window.pct >= line
    }
    if (
      !binding ||
      (candidate.over && !binding.over) ||
      (candidate.over === binding.over && candidate.lineHeadroom < binding.lineHeadroom)
    ) {
      binding = candidate
    }
  }
  return binding
}

/** Points left before the nearest line, each window in its own points; negative once over. */
export function lineRoom(
  windows: readonly SealWindowReading[],
  lines: SealAccountLines
): number | null {
  let room: number | null = null
  for (const window of windows) {
    const left = windowLine(window.label, lines) - window.pct
    room = room === null ? left : Math.min(room, left)
  }
  return room
}

/** `100 - max pct`: whether the account can serve requests at all, untouched by lines. */
export function rawHeadroom(windows: readonly SealWindowReading[]): number | null {
  if (windows.length === 0) {
    return null
  }
  return 100 - Math.max(...windows.map((window) => window.pct))
}
