import {
  SEAL_PROVIDERS,
  type SealAccountKey,
  type SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import { rankCandidates } from '../../shared/seal-accounts/seal-account-ranking'
import { withoutAccountReferences } from '../../shared/seal-accounts/seal-accounts-config-edits'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealAccountManager } from './seal-account-manager'
import { removeSealApiKey } from './seal-api-key-accounts'
import { logOutSealSystemLogin, refreshSealSystemLogins } from './seal-system-login'
import { dismissSealSystemLogin } from './seal-system-login-listing'

export type SealRemoveAccountResult = {
  removed: SealAccountKey
  label: string
  /** The machine's own CLI was signed out as well. */
  loggedOut: boolean
  /** Why the sign-out failed; the account is removed from Seal either way. */
  logoutError: string | null
  /** The account launches moved to, when the removed one was selected. */
  nowUsing: string | null
}

function find(
  manager: SealAccountManager,
  ref: string,
  provider?: SealProvider
): SealAccountCandidate {
  for (const entry of provider ? [provider] : SEAL_PROVIDERS) {
    const candidate = findCandidateByRef(manager.candidates(entry), ref)
    if (candidate) {
      return candidate
    }
  }
  throw new Error(`No account matches "${ref}".`)
}

/** Launches must not fall back to a login the user just removed, so move to the best one left. */
export async function selectSealFallbackAccount(
  manager: SealAccountManager,
  provider: SealProvider
): Promise<string | null> {
  const settings = manager.getConfig().autoSwap[provider]
  const remaining = manager
    .candidates(provider)
    .filter(
      (candidate) => candidate.kind !== 'api-key' && candidate.launchable && !candidate.disabled
    )
  if (remaining.some((candidate) => candidate.active)) {
    return null
  }
  const next = rankCandidates(remaining, settings.strategy, settings, manager.now())[0]
  if (!next) {
    return null
  }
  await (provider === 'claude'
    ? manager.services.claudeAccounts.selectAccount(next.localId)
    : manager.services.codexAccounts.selectAccount(next.localId))
  return next.label
}

/**
 * Removes one account from Seal. The machine's own CLI login is only hidden (and stays hidden
 * until re-imported) unless `logout` also signs the CLI out.
 */
export async function removeSealAccount(
  manager: SealAccountManager,
  ref: string,
  options: { logout?: boolean; provider?: SealProvider } = {}
): Promise<SealRemoveAccountResult> {
  await refreshSealSystemLogins()
  const candidate = find(manager, ref, options.provider)
  const { provider, key } = candidate
  const result: SealRemoveAccountResult = {
    removed: key,
    label: candidate.label,
    loggedOut: false,
    logoutError: null,
    nowUsing: null
  }
  if (candidate.kind === 'api-key') {
    removeSealApiKey(manager, candidate.localId ?? '')
    manager.saveConfig(withoutAccountReferences(manager.getConfig(), key))
    return result
  }
  if (candidate.systemLogin) {
    // Recorded first: once its saved twin is gone the system row would otherwise come back.
    dismissSealSystemLogin(manager, key)
  }
  if (candidate.localId) {
    await (provider === 'claude'
      ? manager.services.claudeAccounts.removeAccount(candidate.localId)
      : manager.services.codexAccounts.removeAccount(candidate.localId))
  }
  if (options.logout && candidate.systemLogin) {
    try {
      await logOutSealSystemLogin(manager.services, provider)
      result.loggedOut = true
    } catch (error) {
      result.logoutError = error instanceof Error ? error.message : String(error)
    }
  }
  manager.saveConfig(withoutAccountReferences(manager.getConfig(), key))
  manager.store.updateState((next) => {
    delete next.quarantine[key]
    for (const [worktreeId, pins] of Object.entries(next.workspacePins)) {
      const pinned = pins[provider]
      if (pinned && sealAccountKeysMatch(pinned, key)) {
        delete pins[provider]
      }
      if (Object.keys(pins).length === 0) {
        delete next.workspacePins[worktreeId]
      }
    }
  })
  manager.loginExpiry.invalidate()
  result.nowUsing = await selectSealFallbackAccount(manager, provider).catch((error: unknown) => {
    console.warn('[seal-accounts] Could not select another account after a removal:', error)
    return null
  })
  return result
}
