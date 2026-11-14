import { useSyncExternalStore } from 'react'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SealSessionAssignment } from '../../../../../shared/seal-accounts/seal-accounts-status'
import { sessionSwapTargets } from '../../seal-session/seal-session-account-view'
import {
  sealHostSnapshot,
  subscribeSealHost,
  type SealHostSnapshot
} from '../../seal-session/seal-session-status-store'

const LOCAL: RuntimeClientTarget = { kind: 'local' }

const subscribeLocal = (listener: () => void): (() => void) => subscribeSealHost(LOCAL, listener)
const localSnapshot = (): SealHostSnapshot | null => sealHostSnapshot(LOCAL)

/** Seal's accounts on this machine, shared with the tab badges' poll. */
export function useLocalSealAccounts(): SealHostSnapshot | null {
  return useSyncExternalStore(subscribeLocal, localSnapshot)
}

function assignmentIn(
  snapshot: SealHostSnapshot | null,
  session: LiveSession
): SealSessionAssignment | null {
  const paneKeys = new Set(
    session.inputRoutes.flatMap((route) => (route.kind === 'seal-pane' ? [route.paneKey] : []))
  )
  if (!snapshot || paneKeys.size === 0) {
    return null
  }
  let newest: SealSessionAssignment | null = null
  for (const assignment of snapshot.status.sessions) {
    const inPane =
      (assignment.paneKey && paneKeys.has(assignment.paneKey)) ||
      (assignment.tabId !== null &&
        [...paneKeys].some((key) => key.startsWith(`${assignment.tabId}:`)))
    if (inPane && !assignment.endedAt && (!newest || assignment.at > newest.at)) {
      newest = assignment
    }
  }
  return newest
}

/** The account record of a session Seal launched in one of its panes on this machine. */
export function sealAssignmentFor(session: LiveSession): SealSessionAssignment | null {
  return assignmentIn(localSnapshot(), session)
}

/** `~/.seal/accounts/work` is the account "work"; the provider's own folder names none. */
function accountFromConfigDir(configDir: string | null | undefined): string | null {
  const name = configDir?.replace(/\/+$/, '').split('/').pop()
  return name && !name.startsWith('.') ? name : null
}

/** The account a session bills to: Seal's record for its own panes, else its config folder's name. */
export function liveSessionAccountLabel(
  session: LiveSession,
  snapshot: SealHostSnapshot | null
): string | null {
  return assignmentIn(snapshot, session)?.accountLabel || accountFromConfigDir(session.configDir)
}

/** Other logins a Seal-launched session can move to. */
export function liveSessionSwapTargets(
  session: LiveSession,
  snapshot: SealHostSnapshot | null
): { key: string; label: string; current: boolean }[] {
  const assignment = assignmentIn(snapshot, session)
  if (!snapshot || !assignment) {
    return []
  }
  return sessionSwapTargets(assignment, snapshot.status.providers[session.provider].candidates).map(
    (candidate) => ({
      key: candidate.key,
      label: candidate.label || candidate.email || candidate.key,
      current: candidate.key === assignment.accountKey
    })
  )
}
