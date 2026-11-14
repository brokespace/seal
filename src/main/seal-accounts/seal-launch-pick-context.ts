import { randomUUID } from 'node:crypto'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealProjectIdentity } from '../../shared/seal-accounts/seal-account-policy'
import {
  pickLaunchAccount,
  type SealLaunchOverride,
  type SealLaunchPick
} from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealSessionAssignment } from '../../shared/seal-accounts/seal-accounts-status'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { SealAccountManager } from './seal-account-manager'

/** Folder workspaces and SSH repos match by path and name too, not only by git remote. */
export function sealProjectIdentity(
  manager: SealAccountManager,
  worktreeId: string | undefined
): SealProjectIdentity | null {
  if (!worktreeId) {
    return null
  }
  const repoId = getRepoIdFromWorktreeId(worktreeId)
  const repo = manager.deps.store.getRepo(repoId)
  return repo
    ? {
        repoId,
        path: repo.path,
        displayName: repo.displayName,
        remoteKey: repo.gitRemoteIdentity?.canonicalKey ?? null
      }
    : { repoId }
}

export function pickSealLaunch(
  manager: SealAccountManager,
  args: {
    provider: SealProvider
    worktreeId?: string
    override: SealLaunchOverride | null
    autoRank: boolean
  }
): SealLaunchPick {
  const state = manager.store.getState()
  const pinned = args.worktreeId ? state.workspacePins[args.worktreeId]?.[args.provider] : undefined
  const settings = manager.getConfig().autoSwap[args.provider]
  return pickLaunchAccount({
    candidates: manager.candidates(args.provider),
    policy: manager.policy(args.provider, sealProjectIdentity(manager, args.worktreeId)),
    override: args.override ?? (pinned ? { ref: pinned, source: 'workspace-pin' } : null),
    settings: args.autoRank ? settings : { ...settings, enabled: false },
    quarantine: state.quarantine,
    now: manager.now()
  })
}

export function recordSealSession(
  manager: SealAccountManager,
  assignment: Omit<SealSessionAssignment, 'id' | 'at' | 'machineKey'> & { id?: string }
): void {
  manager.store.updateState((next) => {
    next.sessions.push({
      ...assignment,
      id: assignment.id ?? randomUUID(),
      at: manager.now(),
      machineKey: next.machineKey
    })
  })
}
