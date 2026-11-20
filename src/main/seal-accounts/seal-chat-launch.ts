import type { AgentSessionRecord } from '../../shared/agent-session/lifecycle/agent-session-record'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealLaunchPick } from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealSessionAssignment } from '../../shared/seal-accounts/seal-accounts-status'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import { getSealAccountManager, type SealAccountManager } from './seal-account-manager'
import { routeSealLaunch, type SealLaunchRoute } from './seal-spawn-account'
import { pickSealLaunch, sealProjectIdentity } from './seal-launch-pick-context'

/**
 * Seal chats (agent SDK sessions) take the same account pick as a terminal `claude` or `codex`:
 * the user's choice for the chat, the project and machine rules, then auto-swap. A chat relaunches
 * between turns when its pick moves, which is how switching and auto-swap reach it.
 */
type ChatRecord = Pick<AgentSessionRecord, 'sessionId' | 'provider' | 'location'>

/** `claudeAuth` is Claude's pinned config dir; null for Codex, whose pin travels in `env`. */
export type SealChatLaunch = SealLaunchRoute

function chatProvider(record: ChatRecord): SealProvider | null {
  // WSL chats keep Orca's own routing, as WSL terminal launches do.
  if (record.location.wslDistro) {
    return null
  }
  return record.provider === 'claude' || record.provider === 'codex' ? record.provider : null
}

export function sealChatAssignment(
  manager: Pick<SealAccountManager, 'store'>,
  sessionId: string
): SealSessionAssignment | null {
  return (
    manager.store.getState().sessions.find((entry) => entry.chat && entry.id === sessionId) ?? null
  )
}

function pickChatAccount(
  manager: SealAccountManager,
  provider: SealProvider,
  record: ChatRecord
): SealLaunchPick {
  const assignment = sealChatAssignment(manager, record.sessionId)
  return pickSealLaunch(manager, {
    provider,
    worktreeId: record.location.workspaceId || undefined,
    override: assignment?.choice ? { ref: assignment.choice, source: 'session-choice' } : null,
    autoRank: true,
    current: assignment?.accountKey ?? null
  })
}

function pickedAccount(pick: SealLaunchPick): SealAccountCandidate | null {
  return pick.kind === 'account' ? pick.candidate : null
}

/** A login the chat is pinned to; the host's selected account and API keys keep the host's home. */
function pinnedLogin(pick: SealLaunchPick): SealAccountCandidate | null {
  const candidate = pickedAccount(pick)
  return candidate && candidate.kind !== 'api-key' && !candidate.active ? candidate : null
}

function claudeAccountId(manager: SealAccountManager, candidate: SealAccountCandidate) {
  const router = manager.services.claudeRuntimeAuth.router
  return candidate.localId && !router.coveredBySystemDefault(candidate.localId)
    ? candidate.localId
    : null
}

function chatHome(
  manager: SealAccountManager,
  provider: SealProvider,
  candidate: SealAccountCandidate
): string {
  if (provider === 'claude') {
    const router = manager.services.claudeRuntimeAuth.router
    const accountId = claudeAccountId(manager, candidate)
    return accountId ? router.accountHome(accountId) : router.systemDefaultHome()
  }
  return candidate.localId
    ? manager.services.codexRuntimeHome.resolvePinnedHostAccountHome(candidate.localId)
    : getSystemCodexHomePath()
}

/** The home a chat's next launch runs in, read without side effects; null leaves the host's own. */
export function sealChatAccountHome(record: ChatRecord): string | null {
  const manager = getSealAccountManager()
  const provider = chatProvider(record)
  if (!manager || !provider) {
    return null
  }
  try {
    const candidate = pinnedLogin(pickChatAccount(manager, provider, record))
    return candidate ? chatHome(manager, provider, candidate) : null
  } catch (error) {
    console.warn('[seal-accounts] Could not read a chat’s account; using the selected one:', error)
    return null
  }
}

function recordChat(
  manager: SealAccountManager,
  provider: SealProvider,
  record: ChatRecord,
  pick: SealLaunchPick,
  account: SealAccountCandidate | null
): void {
  const project = sealProjectIdentity(manager, record.location.workspaceId || undefined)
  manager.store.updateState((next) => {
    const previous = next.sessions.find((entry) => entry.chat && entry.id === record.sessionId)
    const assignment: SealSessionAssignment = {
      ...previous,
      id: record.sessionId,
      chat: true,
      at: previous?.at ?? manager.now(),
      provider,
      accountKey: account?.key ?? null,
      accountLabel: account?.label ?? "This machine's login",
      reason: pick.kind === 'account' ? pick.reason : 'host-selection',
      worktreeId: record.location.workspaceId || null,
      tabId: null,
      paneKey: null,
      projectLabel: project?.displayName ?? project?.remoteKey ?? project?.repoId ?? null,
      machineKey: next.machineKey,
      warnings: pick.warnings,
      lastSeenAt: manager.now(),
      endedAt: null
    }
    next.sessions = [
      ...next.sessions.filter((entry) => !(entry.chat && entry.id === record.sessionId)),
      assignment
    ]
  })
}

/**
 * Routes one chat launch to its pick, as a terminal launch is routed, and records the account so
 * the chat's badge and the session list show it. Null keeps Orca's own routing.
 */
export async function prepareSealChatLaunch(
  record: ChatRecord,
  env: Record<string, string>
): Promise<SealChatLaunch | null> {
  const manager = getSealAccountManager()
  const provider = chatProvider(record)
  if (!manager || !provider) {
    return null
  }
  let pick: SealLaunchPick
  try {
    pick = pickChatAccount(manager, provider, record)
  } catch (error) {
    console.warn('[seal-accounts] Chat account pick failed; using the selected account:', error)
    return null
  }
  const picked = pickedAccount(pick)
  const account =
    picked ?? manager.candidates(provider).find((candidate) => candidate.active) ?? null
  recordChat(manager, provider, record, pick, account)
  if (!picked) {
    return null
  }
  // The same routing a terminal `claude` or `codex` gets, so both run on the picked account.
  return routeSealLaunch(
    manager,
    provider,
    picked,
    { env, claudeAuth: null },
    provider === 'claude'
  )
}
