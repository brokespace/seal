import type { SealAccountKey } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import {
  needsRefresh,
  parseClaudeOAuth
} from '../../shared/seal-accounts/seal-credential-freshness'
import { isLoginRefreshRejectedText } from '../../shared/usage-sign-in-required'
import { markClaudeRefreshRejected } from '../claude-accounts/runtime-auth/claude-refresh-rejections'
import {
  normalizeComparablePath,
  normalizeFsPath
} from '../usage/worktree-attribution/usage-path-comparison'
import { getSealAccountManager, type SealAccountManager } from './seal-account-manager'
import { readClaudeHomeCredentials } from './seal-claude-home-credentials'
import { reconcileClaudeLogin } from './seal-login-copies'

// Claude only tries to renew a token near expiry; a failure on a fresh one says nothing about it.
const RENEWAL_WINDOW_MS = 10 * 60_000

export type SealClaudeLoginFailure = {
  /** The Claude config dir the failing session ran in. */
  claudeConfigDir?: string
  /** The account the session was launched on, when it ran in a copy of that login. */
  accountKey?: SealAccountKey
  /** What Claude printed about the failure. */
  text: string
}

function samePath(a: string, b: string): boolean {
  return normalizeComparablePath(normalizeFsPath(a)) === normalizeComparablePath(normalizeFsPath(b))
}

function findAccount(
  manager: SealAccountManager,
  failure: SealClaudeLoginFailure
): { candidate: SealAccountCandidate; home: string } | null {
  const router = manager.services.claudeRuntimeAuth.router
  for (const candidate of manager.baseCandidates('claude')) {
    if (candidate.kind !== 'oauth') {
      continue
    }
    const home = candidate.localId
      ? router.accountHome(candidate.localId)
      : router.systemDefaultHome()
    const named =
      failure.accountKey !== undefined && sealAccountKeysMatch(candidate.key, failure.accountKey)
    if (named || (failure.claudeConfigDir && samePath(home, failure.claudeConfigDir))) {
      return { candidate, home }
    }
  }
  return null
}

async function verifyRefreshRejected(
  manager: SealAccountManager,
  failure: SealClaudeLoginFailure
): Promise<void> {
  const account = findAccount(manager, failure)
  if (account?.candidate.localId) {
    // A real refresh proves it: invalid_grant marks the token, success heals the login.
    await reconcileClaudeLogin(manager, {
      accountId: account.candidate.localId,
      accountKey: account.candidate.key,
      force: true
    })
    return
  }
  const systemHome = manager.services.claudeRuntimeAuth.router.systemDefaultHome()
  // A session's own copy may have rotated past the account's token; both are spent if refused.
  const homes = new Set([
    account?.home,
    failure.claudeConfigDir ?? (account ? undefined : systemHome)
  ])
  for (const home of homes) {
    if (!home) {
      continue
    }
    const json = await readClaudeHomeCredentials(home, { system: samePath(home, systemHome) })
    const oauth = json ? parseClaudeOAuth(json) : null
    // Seal never spends the system login's refresh token, so Claude's own report is the evidence.
    if (oauth?.refreshToken && needsRefresh(oauth.expiresAt, manager.now(), RENEWAL_WINDOW_MS)) {
      markClaudeRefreshRejected(oauth.refreshToken)
    }
  }
}

/** A Claude session hit a login failure: re-read login health now and, when its refresh was refused, prove it. */
export function reportSealClaudeLoginFailure(
  failure: SealClaudeLoginFailure,
  manager: SealAccountManager | null = getSealAccountManager()
): void {
  if (!manager) {
    return
  }
  manager.recheckLogins()
  if (!isLoginRefreshRejectedText(failure.text)) {
    return
  }
  void verifyRefreshRejected(manager, failure).catch((error: unknown) =>
    console.warn(
      '[seal-accounts] Could not check a failed login:',
      error instanceof Error ? error.message : 'unknown error'
    )
  )
}
