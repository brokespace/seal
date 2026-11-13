import type {
  SealAccountCandidate,
  SealUsageWindow
} from '../../../../shared/seal-accounts/seal-account-candidates'
import type { SealSessionAssignment } from '../../../../shared/seal-accounts/seal-accounts-status'

/** Percent of a window used as of `readAt`; a window past its reset counts as empty. */
export function windowUsedPercent(window: SealUsageWindow | null, readAt: number): number | null {
  if (!window) {
    return null
  }
  if (window.resetsAt !== null && window.resetsAt <= readAt) {
    return 0
  }
  return Math.round(window.usedPercent)
}

/** Accounts a running session can move to: live subscription logins that launch on its host. */
export function sessionSwapTargets(
  session: SealSessionAssignment,
  candidates: SealAccountCandidate[]
): SealAccountCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.provider === session.provider &&
      candidate.kind !== 'api-key' &&
      candidate.launchable &&
      !candidate.disabled &&
      !candidate.authFailure
  )
}

/** The newest still-open session Seal launched in this tab. */
export function sessionForTab(
  sessions: SealSessionAssignment[],
  tabId: string
): SealSessionAssignment | null {
  let newest: SealSessionAssignment | null = null
  for (const session of sessions) {
    if (session.tabId === tabId && !session.endedAt && (!newest || session.at > newest.at)) {
      newest = session
    }
  }
  return newest
}
