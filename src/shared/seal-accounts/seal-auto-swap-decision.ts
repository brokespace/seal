import type { SealAccountKey, SealAutoSwapSettings } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import { isAllowedByPolicy, type ResolvedSealPolicy } from './seal-account-policy'
import {
  accountPressure,
  hasComfortableHeadroom,
  isExhausted,
  rankCandidates
} from './seal-account-ranking'

export type SealQuarantine = Readonly<Record<SealAccountKey, { until: number; reason: string }>>

/** `rate-limit` is a session that reported hitting its limit before usage polling saw it. */
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

/**
 * claude-swap's loop for one provider on one machine: leave an account once it crosses a
 * threshold (or its login dies, or policy forbids it), only for an account comfortably under
 * every threshold, and never twice within the cooldown unless the current login is dead.
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
  const exhausted = isExhausted(accountPressure(current, settings, now))
  const reason: SealSwapReason | null = authDead
    ? 'auth-failure'
    : notAllowed
      ? 'not-allowed'
      : exhausted
        ? 'threshold'
        : null
  if (reason === null) {
    return { kind: 'stay', reason: 'healthy' }
  }
  const cooldownMs = settings.cooldownMinutes * 60_000
  if (reason === 'threshold' && input.lastSwapAt !== null && now - input.lastSwapAt < cooldownMs) {
    return { kind: 'stay', reason: 'cooldown' }
  }
  const targets = eligibleTargets(candidates, {
    policy,
    quarantine,
    now
  }).filter(
    (candidate) =>
      candidate.key !== current.key &&
      hasComfortableHeadroom(accountPressure(candidate, settings, now), settings.hysteresis)
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
      return 'Over a threshold, but no other allowed account has room.'
    case 'no-current':
      return 'No account is selected on this machine.'
  }
}
