import type { SealAccountKey, SealAutoSwapSettings } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import { isAllowedByPolicy, type ResolvedSealPolicy } from './seal-account-policy'
import { rankCandidates } from './seal-account-ranking'
import {
  accountLines,
  bindingWindow,
  lineRoom,
  rawHeadroom,
  relevantWindows
} from './seal-usage-lines'

export type SealQuarantine = Readonly<Record<SealAccountKey, { until: number; reason: string }>>

/** `rate-limit` is the last-resort fallback: a session printed a limit stop usage polling missed. */
export type SealSwapReason = 'threshold' | 'auth-failure' | 'not-allowed' | 'rate-limit'

export type SealAutoSwapDecision =
  | {
      kind: 'stay'
      reason: 'disabled' | 'healthy' | 'cooldown' | 'no-candidate' | 'no-current'
    }
  | {
      kind: 'swap'
      from: SealAccountKey | null
      to: SealAccountCandidate
      reason: SealSwapReason
      /** Accounts to quarantine because their login died. */
      quarantine: SealAccountKey[]
    }

export type SealAutoSwapInput = {
  settings: SealAutoSwapSettings
  candidates: readonly SealAccountCandidate[]
  /** This machine's allow-list; launches with their own project rules pick per launch. */
  policy: Pick<ResolvedSealPolicy, 'allow'>
  quarantine: SealQuarantine
  lastSwapAt: number | null
  now: number
}

export function isQuarantined(
  quarantine: SealQuarantine,
  key: SealAccountKey,
  now: number
): boolean {
  const entry = quarantine[key]
  return entry !== undefined && entry.until > now
}

/** Accounts a swap or automatic launch pick may land on, before headroom is considered. */
export function eligibleTargets(
  candidates: readonly SealAccountCandidate[],
  options: {
    policy: Pick<ResolvedSealPolicy, 'allow'>
    quarantine: SealQuarantine
    now: number
  }
): SealAccountCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.launchable &&
      !candidate.disabled &&
      !candidate.authFailure &&
      candidate.kind !== 'api-key' &&
      isAllowedByPolicy(options.policy, candidate.key) &&
      !isQuarantined(options.quarantine, candidate.key, options.now)
  )
}

export function apiKeyFallbackTargets(
  candidates: readonly SealAccountCandidate[],
  policy: Pick<ResolvedSealPolicy, 'allow'>
): SealAccountCandidate[] {
  return candidates
    .filter(
      (candidate) =>
        candidate.kind === 'api-key' &&
        candidate.launchable &&
        !candidate.disabled &&
        isAllowedByPolicy(policy, candidate.key)
    )
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
}

type SealSwapTrigger = 'proactive' | 'escape'

/**
 * Whether `candidate` may take over from an account with `activeLineHeadroom`, per claude-swap's
 * `best` landing rules: it reports usage, can serve requests, sits under every one of its own
 * lines, and (on a proactive move) beats the current account by the hysteresis margin.
 */
export function isSwapLanding(
  candidate: SealAccountCandidate,
  options: {
    settings: SealAutoSwapSettings
    trigger: SealSwapTrigger
    activeLineHeadroom: number
    now: number
  }
): boolean {
  const { settings, now } = options
  const windows = relevantWindows(candidate, settings, now)
  const lines = accountLines(candidate, settings)
  const binding = bindingWindow(windows, lines)
  const raw = rawHeadroom(windows)
  if (!binding || raw === null || raw <= 0 || binding.over) {
    return false
  }
  if (options.trigger !== 'proactive') {
    return true
  }
  switch (settings.strategy) {
    case 'consume-first':
      return (lineRoom(windows, lines) ?? 0) >= settings.hysteresis
    case 'priority':
      return true
    case 'best':
    case 'weekly-first':
      return binding.lineHeadroom - options.activeLineHeadroom >= settings.hysteresis
  }
}

/**
 * claude-swap's `cswap auto` decision for one provider on one machine. Leave the current account
 * once any window crosses its line (5h against the session line, 7d and per-model windows against
 * the weekly line), immediately when a window is full or the login died, and land only on an
 * account under all of its lines. A proactive move waits out the cooldown and needs the
 * hysteresis margin of extra headroom, so two accounts near a line never ping-pong.
 */
export function decideAutoSwap(input: SealAutoSwapInput): SealAutoSwapDecision {
  const { settings, candidates, policy, quarantine, now } = input
  if (!settings.enabled) {
    return { kind: 'stay', reason: 'disabled' }
  }
  const current = candidates.find((candidate) => candidate.active) ?? null
  if (!current) {
    return { kind: 'stay', reason: 'no-current' }
  }
  const authDead = current.authFailure && settings.failoverOnAuthError && current.kind !== 'api-key'
  const notAllowed = !isAllowedByPolicy(policy, current.key)
  const windows = relevantWindows(current, settings, now)
  const binding = bindingWindow(windows, accountLines(current, settings))
  const raw = rawHeadroom(windows)
  const atLimit = raw !== null && raw <= 0
  const reason: SealSwapReason | null = authDead
    ? 'auth-failure'
    : notAllowed
      ? 'not-allowed'
      : binding?.over
        ? 'threshold'
        : null
  if (reason === null) {
    return { kind: 'stay', reason: 'healthy' }
  }
  const trigger: SealSwapTrigger = reason === 'threshold' && !atLimit ? 'proactive' : 'escape'
  const cooldownMs = settings.cooldownMinutes * 60_000
  if (trigger === 'proactive' && input.lastSwapAt !== null && now - input.lastSwapAt < cooldownMs) {
    return { kind: 'stay', reason: 'cooldown' }
  }
  const activeLineHeadroom = binding?.lineHeadroom ?? raw ?? 0
  const targets = eligibleTargets(candidates, { policy, quarantine, now }).filter(
    (candidate) =>
      candidate.key !== current.key &&
      isSwapLanding(candidate, { settings, trigger, activeLineHeadroom, now })
  )
  const [best] = rankCandidates(targets, settings.strategy, settings, now)
  if (!best) {
    return { kind: 'stay', reason: 'no-candidate' }
  }
  return {
    kind: 'swap',
    from: current.key,
    to: best,
    reason,
    quarantine: authDead ? [current.key] : []
  }
}

export function describeAutoSwapDecision(decision: SealAutoSwapDecision): string {
  if (decision.kind === 'swap') {
    return `Switched to ${decision.to.label} (${decision.reason}).`
  }
  switch (decision.reason) {
    case 'disabled':
      return 'Auto-swap is off.'
    case 'healthy':
      return 'The current account is within its thresholds.'
    case 'cooldown':
      return 'Over a threshold; waiting out the cooldown before switching again.'
    case 'no-candidate':
      return 'Over a threshold, but no other allowed account is comfortably under its limits.'
    case 'no-current':
      return 'No account is selected on this machine.'
  }
}
