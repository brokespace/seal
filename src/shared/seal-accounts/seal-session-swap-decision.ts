import type { SealAccountKey, SealAutoSwapSettings, SealProvider } from './seal-accounts-config'
import type { SealAccountCandidate } from './seal-account-candidates'
import type { ResolvedSealPolicy } from './seal-account-policy'
import { sealAccountKeysMatch } from './seal-account-key'
import { decideAutoSwap, type SealQuarantine, type SealSwapReason } from './seal-auto-swap-decision'
import type { SealSessionLiveSwapMode, SealSessionSwapDelivery } from './seal-accounts-status'

/** What a running session can take: its own login rewritten in place, and/or a resume. */
export type SealSessionCapability = {
  provider: SealProvider
  /** Seal gave the session its own Claude config dir or CODEX_HOME. */
  isolatedHome: boolean
  /** The agent's conversation id and terminal are known, so it can be resumed elsewhere. */
  resumable: boolean
}

type SessionDelivery = Exclude<SealSessionSwapDelivery, 'failed'>

export type SealSessionSwapDecision =
  | {
      kind: 'stay'
      reason: 'disabled' | 'healthy' | 'cooldown' | 'no-candidate' | 'no-current' | 'not-swappable'
    }
  | {
      kind: 'swap'
      from: SealAccountKey
      to: SealAccountCandidate
      reason: SealSwapReason
      delivery: SessionDelivery
      quarantine: SealAccountKey[]
    }

export function sessionLiveSwapEnabled(
  settings: Pick<SealAutoSwapSettings, 'liveSessionSwap'>,
  mode: SealSessionLiveSwapMode | undefined
): boolean {
  if (mode === 'on' || mode === 'off') {
    return mode === 'on'
  }
  return settings.liveSessionSwap !== false
}

/**
 * Claude Code re-reads its credentials file when it changes, so an isolated home swaps live.
 * Codex keeps its token in memory and reloads `auth.json` only after a 401, so only a dead login
 * swaps live there; anything else resumes the conversation on the new account.
 */
export function sessionSwapDelivery(
  capability: SealSessionCapability,
  reason: SealSwapReason | 'manual'
): SessionDelivery | null {
  const live =
    capability.isolatedHome && (capability.provider === 'claude' || reason === 'auth-failure')
  if (live) {
    return 'live'
  }
  return capability.resumable ? 'resume' : null
}

export type SealSessionSwapInput = {
  session: {
    accountKey: SealAccountKey | null
    liveSwap: SealSessionLiveSwapMode | undefined
    lastSwapAt: number | null
    /** Fallback only: the agent printed a usage/rate-limit stop for this session. */
    rateLimited: boolean
  }
  capability: SealSessionCapability
  settings: SealAutoSwapSettings
  candidates: readonly SealAccountCandidate[]
  policy: Pick<ResolvedSealPolicy, 'allow'>
  quarantine: SealQuarantine
  now: number
}

/**
 * claude-swap's usage-based decision applied to one running session and its own account. Polled
 * 5h/7d usage is the trigger; a printed limit stop counts only as a last-resort fallback, when
 * polling saw nothing (e.g. a limit the usage endpoint has not reported yet).
 */
export function decideSessionSwap(input: SealSessionSwapInput): SealSessionSwapDecision {
  const { session } = input
  if (!sessionLiveSwapEnabled(input.settings, session.liveSwap)) {
    return { kind: 'stay', reason: 'disabled' }
  }
  // Running sessions follow their own switch; the host-wide toggle only moves new launches.
  const settings = { ...input.settings, enabled: true }
  const currentKey = session.accountKey
  const current = currentKey
    ? input.candidates.find((candidate) => sealAccountKeysMatch(candidate.key, currentKey))
    : undefined
  if (!current || current.kind === 'api-key') {
    return { kind: 'stay', reason: 'no-current' }
  }
  const asActive = (candidate: SealAccountCandidate) =>
    candidate.key === current.key ? { ...candidate, active: true } : { ...candidate, active: false }
  const candidates = input.candidates.map(asActive)
  const decide = (pool: SealAccountCandidate[]) =>
    decideAutoSwap({
      settings,
      candidates: pool,
      policy: input.policy,
      quarantine: input.quarantine,
      lastSwapAt: session.lastSwapAt,
      now: input.now
    })
  let decision = decide(candidates)
  let reason: SealSwapReason | null = decision.kind === 'swap' ? decision.reason : null
  if (
    decision.kind === 'stay' &&
    decision.reason === 'healthy' &&
    session.rateLimited &&
    settings.rateLimitFallback !== false
  ) {
    decision = decide(
      candidates.map((candidate) =>
        candidate.key === current.key ? withFullSessionWindow(candidate, input.now) : candidate
      )
    )
    reason = decision.kind === 'swap' ? 'rate-limit' : null
  }
  if (decision.kind === 'stay' || reason === null) {
    return decision.kind === 'stay' ? decision : { kind: 'stay', reason: 'healthy' }
  }
  const delivery = sessionSwapDelivery(input.capability, reason)
  if (!delivery) {
    return { kind: 'stay', reason: 'not-swappable' }
  }
  return {
    kind: 'swap',
    from: current.key,
    to: decision.to,
    reason,
    delivery,
    quarantine: decision.quarantine
  }
}

function withFullSessionWindow(candidate: SealAccountCandidate, now: number): SealAccountCandidate {
  const full = { usedPercent: 100, resetsAt: now + 60 * 60_000 }
  return {
    ...candidate,
    usage: {
      session: full,
      weekly: candidate.usage?.weekly ?? null,
      models: candidate.usage?.models ?? [],
      planType: candidate.usage?.planType ?? null,
      updatedAt: now,
      error: candidate.usage?.error ?? null
    }
  }
}

const RATE_LIMIT_PATTERNS = [
  /usage limit (?:reached|hit)/i,
  /\b(?:5-hour|weekly|session|opus|sonnet) limit reached\b/i,
  /you(?:'|\u2019)ve hit your (?:usage )?limit/i,
  /rate[_ -]limit(?:ed| exceeded|_error)/i
]

/** Whether an agent's last message is a limit stop (Claude "5-hour limit reached", Codex "usage limit"). */
export function isRateLimitStop(message: string | null | undefined): boolean {
  return Boolean(message) && RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message ?? ''))
}
