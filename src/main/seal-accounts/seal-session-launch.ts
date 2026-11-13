import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { SEAL_CODEX_SESSION_HOME_ENV } from '../../shared/seal-accounts/seal-launch-env'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'
import type { SealAccountManager } from './seal-account-manager'
import { withClaudeConfigLocks } from './seal-claude-config-lock'
import {
  readClaudeHomeCredentials,
  readClaudeOAuthAccount,
  writeClaudeHomeCredentials,
  writeClaudeOAuthAccount
} from './seal-claude-home-credentials'
import { pinClaudeLaunchToHome } from './seal-claude-launch-pin'
import { credentialFreshness } from '../../shared/seal-accounts/seal-credential-freshness'
import { reconcileClaudeLogin, reconcileCodexLogin } from './seal-login-copies'
import { provisionClaudeSessionHome, provisionCodexSessionHome } from './seal-session-homes'

export type SealSessionLaunch = {
  env: Record<string, string>
  claudeAuth: ClaudeRuntimeAuthPreparation | null
  profileHome: string
}

export function sealSessionPointerName(sessionId: string): string {
  return `session-${sessionId}`
}

type LoginManager = Pick<
  SealAccountManager,
  'services' | 'store' | 'codexHome' | 'now' | 'machineKey'
>

/**
 * Puts a saved Claude login (tokens and account identity) into a session's config dir. When the
 * session ran on another saved account, any token it refreshed is first saved back to that
 * account, under the same locks, so moving the session never strands its old login.
 */
export async function copyClaudeLoginInto(
  manager: LoginManager,
  candidate: SealAccountCandidate,
  sessionHome: string,
  outgoing: SealAccountCandidate | null = null
): Promise<void> {
  const accountId = candidate.localId
  if (!accountId) {
    throw new Error('Only saved Claude accounts can move a running session.')
  }
  const router = manager.services.claudeRuntimeAuth.router
  const outgoingHome = outgoing?.localId ? router.accountHome(outgoing.localId) : null
  if (outgoing?.localId) {
    await reconcileClaudeLogin(manager, { accountId: outgoing.localId, accountKey: outgoing.key })
  }
  // Start from the freshest copy so the session never holds a refresh token already spent.
  await reconcileClaudeLogin(manager, { accountId, accountKey: candidate.key })
  const accountHome = router.accountHome(accountId)
  const credentials = await readClaudeHomeCredentials(accountHome)
  const oauthAccount = await readClaudeOAuthAccount(accountHome)
  if (!credentials || !oauthAccount) {
    throw new Error(`${candidate.label} is not signed in on this machine.`)
  }
  await withClaudeConfigLocks([sessionHome, ...(outgoingHome ? [outgoingHome] : [])], async () => {
    if (outgoingHome) {
      await backUpOutgoingLogin(sessionHome, outgoingHome)
    }
    await writeClaudeHomeCredentials(sessionHome, credentials)
    await writeClaudeOAuthAccount(sessionHome, oauthAccount)
  })
}

/** Saves a session's token back to its account if the session refreshed it since the last sync. */
async function backUpOutgoingLogin(sessionHome: string, accountHome: string): Promise<void> {
  const [session, account] = await Promise.all([
    readClaudeHomeCredentials(sessionHome),
    readClaudeHomeCredentials(accountHome)
  ])
  const [sessionIdentity, accountIdentity] = await Promise.all([
    readClaudeOAuthAccount(sessionHome),
    readClaudeOAuthAccount(accountHome)
  ])
  const sameLogin =
    typeof sessionIdentity?.emailAddress === 'string' &&
    sessionIdentity.emailAddress === accountIdentity?.emailAddress
  if (
    session &&
    sameLogin &&
    (credentialFreshness('claude', session) ?? -1) >
      (account ? (credentialFreshness('claude', account) ?? -1) : -1)
  ) {
    await writeClaudeHomeCredentials(accountHome, session)
  }
}

export async function codexLoginJson(
  manager: LoginManager,
  candidate: SealAccountCandidate
): Promise<{ accountHome: string; authJson: string }> {
  const accountHome = candidate.localId ? manager.codexHome(candidate.localId) : null
  if (!candidate.localId || !accountHome) {
    throw new Error('Only saved Codex accounts can move a running session.')
  }
  await reconcileCodexLogin(manager, { accountId: candidate.localId, accountKey: candidate.key })
  const authJson = await readFile(join(accountHome, 'auth.json'), 'utf8').catch(() => null)
  if (!authJson) {
    throw new Error(`${candidate.label} is not signed in on this machine.`)
  }
  return { accountHome, authJson }
}

/** Whether Seal can give this account's session its own home (a saved login, not System default). */
export function canIsolateSession(
  manager: Pick<SealAccountManager, 'services' | 'codexHome'>,
  provider: SealProvider,
  candidate: SealAccountCandidate
): boolean {
  if (candidate.kind !== 'oauth' || !candidate.localId) {
    return false
  }
  if (provider === 'codex') {
    return manager.codexHome(candidate.localId) !== null
  }
  const router = manager.services.claudeRuntimeAuth.router
  return (
    !router.coveredBySystemDefault(candidate.localId) && !!router.accountLogin(candidate.localId)
  )
}

/** Launches a session in its own home holding a copy of the account's login, ready to swap live. */
export async function launchInSessionHome(
  manager: SealAccountManager,
  args: {
    provider: SealProvider
    candidate: SealAccountCandidate
    sessionId: string
    env: Record<string, string>
    claudeAuth: ClaudeRuntimeAuthPreparation | null
    isClaudeLaunch: boolean
  }
): Promise<SealSessionLaunch> {
  if (args.provider === 'codex') {
    const { accountHome, authJson } = await codexLoginJson(manager, args.candidate)
    const home = await provisionCodexSessionHome(
      manager.dataRoot,
      args.sessionId,
      accountHome,
      authJson
    )
    return {
      env: { ...args.env, [SEAL_CODEX_SESSION_HOME_ENV]: home },
      claudeAuth: args.claudeAuth,
      profileHome: home
    }
  }
  const home = await provisionClaudeSessionHome(manager, args.sessionId)
  await copyClaudeLoginInto(manager, args.candidate, home)
  const pin = await pinClaudeLaunchToHome({
    dataRoot: manager.dataRoot,
    pin: sealSessionPointerName(args.sessionId),
    home,
    env: args.env
  })
  return {
    env: pin.env,
    claudeAuth: args.isClaudeLaunch ? pin.preparation : args.claudeAuth,
    profileHome: home
  }
}
