import type {
  HostAccountSignInChannel,
  HostAccountSignInStatus
} from '../../shared/host-account-sign-in-types'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { oauthAccountKey, sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'
import { findCandidateByRef } from '../../shared/seal-accounts/seal-launch-account-pick'
import type { SealSignInOutcome, SealSignInRequest } from '../../shared/seal-accounts/seal-sign-in'
import {
  claudeStateFile,
  readClaudeFolderLogin
} from '../claude-accounts/sign-in/claude-account-folder'
import { runClaudeCommandProcess } from '../claude-accounts/sign-in/claude-command-process'
import { runClaudeLoginSession } from '../claude-accounts/sign-in/claude-login-session'
import { runClaudePastedCodeLogin } from '../claude-accounts/sign-in/claude-pasted-code-login'
import { HostAccountSignInFlows } from '../runtime/agent-session/environment/host-account-sign-in-flows'
import type { SealAccountManager } from './seal-account-manager'
import { dedupeSealAccounts } from './seal-account-migration'
import { selectSealFallbackAccount } from './seal-account-removal'
import { readClaudeHomeCredentials } from './seal-claude-home-credentials'
import { importClaudeCredential } from './seal-credential-transfer'
import { refreshSealSystemLogins } from './seal-system-login'

const CLAUDE_NO_LOGIN_MESSAGE = 'Claude finished without signing in. Start the sign-in again.'
const CODEX_NO_LOGIN_MESSAGE = 'Codex finished without signing in. Start the sign-in again.'

function expectedAccount(
  manager: SealAccountManager,
  request: SealSignInRequest
): SealAccountCandidate | null {
  return request.account
    ? findCandidateByRef(manager.candidates(request.provider), request.account)
    : null
}

function outcomeFor(
  manager: SealAccountManager,
  provider: SealProvider,
  key: string,
  existed: boolean,
  expected: SealAccountCandidate | null
): SealSignInOutcome {
  const candidate = manager
    .candidates(provider)
    .find((entry) => sealAccountKeysMatch(entry.key, key))
  return {
    accountKey: candidate?.key ?? key,
    label: candidate?.label ?? key,
    email: candidate?.email ?? null,
    outcome: existed ? 'refreshed' : 'added',
    ...(expected && !sealAccountKeysMatch(expected.key, key) ? { expected: expected.label } : {})
  }
}

async function runClaudeLogin(
  configDir: string,
  channel: HostAccountSignInChannel,
  openBrowser: boolean
): Promise<void> {
  const folder = { windowsPath: configDir, linuxPath: null, wslDistro: null }
  if (process.platform !== 'win32') {
    await runClaudePastedCodeLogin(folder, runClaudeCommandProcess, channel, () => {}, {
      openBrowser
    })
    return
  }
  // Windows logins own a console window, so the code is pasted there instead of relayed.
  let cancel: (() => boolean) | null = null
  const abort = (): void => {
    cancel?.()
  }
  channel.signal.addEventListener('abort', abort, { once: true })
  try {
    await runClaudeLoginSession(folder, {
      runCommand: runClaudeCommandProcess,
      setCancel: (next) => {
        cancel = next
        if (next && channel.signal.aborted) {
          next()
        }
      }
    })
  } finally {
    channel.signal.removeEventListener('abort', abort)
  }
}

/**
 * Claude signs in inside a fresh account folder. A login Seal already holds takes the new tokens
 * instead of becoming a second row.
 */
async function signInClaude(
  manager: SealAccountManager,
  request: SealSignInRequest,
  channel: HostAccountSignInChannel
): Promise<SealSignInOutcome> {
  const { claudeAccounts } = manager.services
  const expected = expectedAccount(manager, request)
  const signIn = await claudeAccounts.beginSignIn({ runtime: 'host' })
  const staged = { accountId: signIn.accountId, runtime: 'host' } as const
  try {
    await runClaudeLogin(signIn.configDir, channel, request.openBrowser)
    const login = readClaudeFolderLogin(claudeStateFile(signIn.configDir))
    if (!login) {
      throw new Error(CLAUDE_NO_LOGIN_MESSAGE)
    }
    const key = oauthAccountKey('claude', login.email, login.organizationUuid)
    const saved = manager
      .baseCandidates('claude')
      .find(
        (entry) =>
          entry.kind === 'oauth' && !entry.wslDistro && sealAccountKeysMatch(entry.key, key)
      )
    if (saved) {
      const credentialsJson = await readClaudeHomeCredentials(signIn.configDir)
      if (!credentialsJson) {
        throw new Error(CLAUDE_NO_LOGIN_MESSAGE)
      }
      await importClaudeCredential(
        manager.services,
        {
          provider: 'claude',
          email: login.email,
          organizationUuid: login.organizationUuid,
          organizationName: login.organizationName,
          credentialsJson,
          oauthAccountJson: JSON.stringify({
            emailAddress: login.email,
            organizationUuid: login.organizationUuid,
            organizationName: login.organizationName
          })
        },
        { force: true }
      )
      await claudeAccounts.cancelSignIn(staged)
    } else {
      await claudeAccounts.finishSignIn(staged)
    }
    return outcomeFor(manager, 'claude', key, saved !== undefined, expected)
  } catch (error) {
    await claudeAccounts.cancelSignIn(staged).catch((cleanupError: unknown) => {
      console.warn('[seal-accounts] Could not delete an unfinished sign-in folder:', cleanupError)
    })
    throw error
  }
}

/** `codex login` selects the account it adds; a sign-in should not move what launches use. */
async function restoreCodexSelection(
  manager: SealAccountManager,
  previous: string | null,
  systemLoginListed: boolean
): Promise<void> {
  const { codexAccounts } = manager.services
  const state = codexAccounts.listAccounts()
  if (state.activeAccountId === previous) {
    return
  }
  if (previous === null ? systemLoginListed : state.accounts.some((a) => a.id === previous)) {
    await codexAccounts.selectAccount(previous)
  }
}

async function signInCodex(
  manager: SealAccountManager,
  request: SealSignInRequest,
  channel: HostAccountSignInChannel,
  onLoginUrl: (listener: ((url: string) => void) | null) => void
): Promise<SealSignInOutcome> {
  const { codexAccounts } = manager.services
  const expected = expectedAccount(manager, request)
  const before = codexAccounts.listAccounts()
  const knownIds = new Set(before.accounts.map((account) => account.id))
  await refreshSealSystemLogins()
  const systemLoginListed = manager.baseCandidates('codex').some((entry) => entry.kind === 'system')
  const knownKeys = manager
    .baseCandidates('codex')
    .filter((entry) => entry.kind === 'oauth')
    .map((entry) => entry.key)
  let signedInId: string | null = null
  if (request.method === 'device-code') {
    await codexAccounts.addAccountWithDeviceCode(channel)
  } else {
    const abort = (): void => {
      codexAccounts.cancelPendingLogin()
    }
    channel.signal.addEventListener('abort', abort, { once: true })
    onLoginUrl((url) => channel.onPrompt({ url, userCode: null, needsCode: false }))
    try {
      // A saved account signs in again in place, so its sessions keep their CODEX_HOME.
      if (expected?.kind === 'oauth' && expected.localId && !expected.wslDistro) {
        await codexAccounts.reauthenticateAccount(expected.localId)
        signedInId = expected.localId
      } else {
        await codexAccounts.addAccount({ runtime: 'host' })
      }
    } finally {
      onLoginUrl(null)
      channel.signal.removeEventListener('abort', abort)
    }
  }
  const after = codexAccounts.listAccounts()
  const account = after.accounts.find((entry) =>
    signedInId ? entry.id === signedInId : !knownIds.has(entry.id)
  )
  if (!account) {
    throw new Error(CODEX_NO_LOGIN_MESSAGE)
  }
  const key = oauthAccountKey('codex', account.email, account.workspaceAccountId)
  const existed = knownKeys.some((entry) => sealAccountKeysMatch(entry, key))
  // `codex login` never refuses a login it already holds; keep the copy that just signed in.
  await dedupeSealAccounts(manager)
  await restoreCodexSelection(manager, before.activeAccountId, systemLoginListed)
  return outcomeFor(manager, 'codex', key, existed, expected)
}

export type SealSignInFlows = HostAccountSignInFlows<SealSignInRequest>

/** Seal's sign-in flows for one host: one at a time, each ending with its CLI process gone. */
export function createSealSignInFlows(manager: SealAccountManager): SealSignInFlows {
  let codexLoginUrl: ((url: string) => void) | null = null
  manager.services.codexAccounts.onPendingLoginUrlChanged((url) => {
    if (url) {
      codexLoginUrl?.(url)
    }
  })
  return new HostAccountSignInFlows<SealSignInRequest>(
    async (provider, channel, request): Promise<Pick<HostAccountSignInStatus, 'seal'>> => {
      const signIn: SealSignInRequest = request ?? {
        provider,
        method: 'browser',
        openBrowser: false
      }
      const seal = await (provider === 'claude'
        ? signInClaude(manager, signIn, channel)
        : signInCodex(manager, signIn, channel, (listener) => {
            codexLoginUrl = listener
          }))
      manager.loginExpiry.invalidate()
      manager.usage.forget(seal.accountKey)
      manager.store.updateState((next) => {
        delete next.quarantine[seal.accountKey]
      })
      await selectSealFallbackAccount(manager, provider).catch(() => null)
      void manager.refreshUsage().catch(() => {})
      return { seal }
    },
    process.platform,
    { windowsHosts: true }
  )
}
