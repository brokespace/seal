import { sealLoginUsable } from '../../../../shared/seal-accounts/seal-account-health'
import type { SealAccountCandidate } from '../../../../shared/seal-accounts/seal-account-candidates'
import type { SealSessionAssignment } from '../../../../shared/seal-accounts/seal-accounts-status'

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
      sealLoginUsable(candidate)
  )
}

/** The newest still-open session Seal launched in this tab. */
export function sessionForTab(
  sessions: SealSessionAssignment[],
  tabId: string
): SealSessionAssignment | null {
  let newest: SealSessionAssignment | null = null
  for (const session of sessions) {
    if (
      !session.chat &&
      session.tabId === tabId &&
      !session.endedAt &&
      (!newest || session.at > newest.at)
    ) {
      newest = session
    }
  }
  return newest
}

/** The account a Seal chat (agent SDK session) runs on. */
export function sessionForChat(
  sessions: SealSessionAssignment[],
  sessionId: string
): SealSessionAssignment | null {
  return sessions.find((session) => session.chat && session.id === sessionId) ?? null
}
