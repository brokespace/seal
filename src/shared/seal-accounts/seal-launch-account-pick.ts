import type { SealAccountKey, SealAutoSwapSettings } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import { sealAccountKeysMatch } from './seal-account-key'
import {
  isAllowedByPolicy,
  policyConstrainsLaunch,
  type ResolvedSealPolicy
} from './seal-account-policy'
import { accountPressure, isExhausted, rankCandidates } from './seal-account-ranking'
import {
  apiKeyFallbackTargets,
  eligibleTargets,
  type SealQuarantine
} from './seal-auto-swap-decision'

export type SealLaunchOverride = {
  /** An account key, alias, email or this host's account id. */
  ref: string
  /** `session-choice` is the account picked in the New agent session dialog, for that launch only. */
  source: 'env' | 'session-choice' | 'workspace-pin'
}

export type SealLaunchPickReason =
  | 'env'
  | 'session-choice'
  | 'workspace-pin'
  | 'project-default'
  | 'machine-default'
  | 'selected'
  | 'auto'
  | 'api-key-fallback'
  | 'over-limit-fallback'

export type SealLaunchPick =
  | { kind: 'unchanged'; warnings: string[] }
  | {
      kind: 'account'
      candidate: SealAccountCandidate
      reason: SealLaunchPickReason
      warnings: string[]
    }

export function findCandidateByRef(
  candidates: readonly SealAccountCandidate[],
  ref: string
): SealAccountCandidate | null {
  const needle = ref.trim()
  if (!needle) {
    return null
  }
  const lower = needle.toLowerCase()
  return (
    candidates.find((candidate) => sealAccountKeysMatch(candidate.key, needle)) ??
    candidates.find((candidate) => candidate.localId === needle) ??
    candidates.find((candidate) => candidate.label.toLowerCase() === lower) ??
    candidates.find((candidate) => candidate.email?.toLowerCase() === lower) ??
    null
  )
}

function findByKey(
  candidates: readonly SealAccountCandidate[],
  key: SealAccountKey
): SealAccountCandidate | null {
  return candidates.find((candidate) => sealAccountKeysMatch(candidate.key, key)) ?? null
}

export type SealLaunchPickInput = {
  candidates: readonly SealAccountCandidate[]
  policy: ResolvedSealPolicy
  override: SealLaunchOverride | null
  settings: SealAutoSwapSettings
  quarantine: SealQuarantine
  now: number
}

/**
 * The account one new session runs on: an explicit override, then the project/machine default,
 * then the host's selected account, then the best allowed account with room. Hosts with no
 * rule and auto-swap off keep Orca's own selection untouched.
 */
export function pickLaunchAccount(input: SealLaunchPickInput): SealLaunchPick {
  const { candidates, policy, override, settings, quarantine, now } = input
  const warnings: string[] = []
  if (override) {
    const chosen = findCandidateByRef(candidates, override.ref)
    if (chosen?.launchable) {
      if (!isAllowedByPolicy(policy, chosen.key)) {
        warnings.push(`${chosen.label} is outside this project's allowed accounts.`)
      }
      if (isExhausted(accountPressure(chosen, settings, now))) {
        warnings.push(`${chosen.label} is near its usage limit.`)
      }
      return { kind: 'account', candidate: chosen, reason: override.source, warnings }
    }
    warnings.push(
      chosen
        ? `${chosen.label} is not signed in on this machine; using the policy instead.`
        : `No account matches "${override.ref}"; using the policy instead.`
    )
  }
  if (!policyConstrainsLaunch(policy) && !settings.enabled) {
    return { kind: 'unchanged', warnings }
  }
  const usable = eligibleTargets(candidates, { policy, quarantine, now }).filter(
    (candidate) => !isExhausted(accountPressure(candidate, settings, now))
  )
  const isUsable = (candidate: SealAccountCandidate | null): boolean =>
    candidate !== null && usable.some((entry) => entry.key === candidate.key)

  const preferred = policy.defaultKey ? findByKey(candidates, policy.defaultKey) : null
  if (preferred && isUsable(preferred)) {
    const reason = policy.defaultSource === 'project' ? 'project-default' : 'machine-default'
    return { kind: 'account', candidate: preferred, reason, warnings }
  }
  if (preferred) {
    warnings.push(`Default account ${preferred.label} is unavailable or near its limit.`)
  }
  const selected = candidates.find((candidate) => candidate.active) ?? null
  if (selected && isUsable(selected)) {
    return { kind: 'account', candidate: selected, reason: 'selected', warnings }
  }
  const [best] = rankCandidates(usable, settings.strategy, settings, now)
  if (best) {
    return { kind: 'account', candidate: best, reason: 'auto', warnings }
  }
  const [apiKey] = settings.apiKeyFallback ? apiKeyFallbackTargets(candidates, policy) : []
  if (apiKey) {
    return { kind: 'account', candidate: apiKey, reason: 'api-key-fallback', warnings }
  }
  // Every allowed login is near its limit: still run on an allowed one rather than a forbidden one.
  const allowed = candidates.filter(
    (candidate) =>
      candidate.launchable &&
      candidate.kind !== 'api-key' &&
      !candidate.authFailure &&
      isAllowedByPolicy(policy, candidate.key)
  )
  const fallback =
    (preferred && allowed.includes(preferred) ? preferred : null) ??
    (selected && allowed.includes(selected) ? selected : null) ??
    rankCandidates(allowed, settings.strategy, settings, now)[0]
  if (fallback) {
    warnings.push('Every allowed account is near its usage limit.')
    return { kind: 'account', candidate: fallback, reason: 'over-limit-fallback', warnings }
  }
  warnings.push('No allowed account is signed in on this machine; using the selected account.')
  return { kind: 'unchanged', warnings }
}
