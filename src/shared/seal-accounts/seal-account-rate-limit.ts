import { rateLimitSpentUntil } from '../rate-limit-spent-windows'
import type { SealAccountCandidate } from './seal-account-candidates'

/** How long an agent's printed limit stop counts when no reading names the window's reset. */
export const LIMIT_STOP_HOLD_MS = 60 * 60_000

export type SealAccountRateLimit = {
  /** When the limit lifts; null when the provider gave no reset time. */
  resetsAt: number | null
}

/**
 * Whether an account is out of quota right now. Only two things say so: a usage window read as
 * spent that has not reset yet, or a limit stop an agent on the account printed that no later
 * reading contradicts, until that window resets. A throttled or failed usage check never does.
 */
export function sealAccountRateLimit(
  candidate: Pick<SealAccountCandidate, 'limits'>,
  options: {
    now: number
    /** When an agent running on this account last printed a limit stop. */
    limitStopAt?: number | null
  }
): SealAccountRateLimit | null {
  const { now } = options
  const limits = candidate.limits
  const spentUntil = limits ? rateLimitSpentUntil(limits) : undefined
  if (spentUntil === null || (spentUntil !== undefined && spentUntil > now)) {
    return { resetsAt: spentUntil }
  }
  const stopAt = options.limitStopAt ?? null
  // A good reading taken after the stop shows room, so the stop no longer describes the account.
  if (stopAt === null || (limits?.status === 'ok' && limits.updatedAt > stopAt)) {
    return null
  }
  const sessionReset = limits?.session?.resetsAt ?? null
  const resetsAt =
    sessionReset !== null && sessionReset > stopAt ? sessionReset : stopAt + LIMIT_STOP_HOLD_MS
  return resetsAt > now ? { resetsAt } : null
}
