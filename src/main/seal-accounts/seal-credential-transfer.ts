import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import type { SealAccountsImportCredential } from '../../shared/rpc-contract/seal-accounts-params'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { sealAccountKeysMatch, oauthAccountKey } from '../../shared/seal-accounts/seal-account-key'
import {
  claudeKeychainService,
  readActiveClaudeKeychainCredentialsStrict
} from '../claude-accounts/runtime-auth/keychain'
import { claudeStateFile } from '../claude-accounts/sign-in/claude-account-folder'
import { execSecurityCommand } from '../macos-keychain/generic-password'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import type { ProviderAccountServices } from '../providers/accounts/provider-account-services'
import type { SealAccountManager } from './seal-account-manager'

type ClaudeCredential = Extract<SealAccountsImportCredential, { provider: 'claude' }>
type CodexCredential = Extract<SealAccountsImportCredential, { provider: 'codex' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

async function readJsonObject(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null)
}

async function readClaudeCredentialsJson(configDir: string, isSystem: boolean): Promise<string> {
  if (process.platform === 'darwin') {
    const fromKeychain = await readActiveClaudeKeychainCredentialsStrict(
      isSystem ? undefined : configDir
    )
    if (fromKeychain) {
      return fromKeychain
    }
  }
  const fromFile = await readOptionalFile(join(configDir, '.credentials.json'))
  if (fromFile !== null) {
    return fromFile
  }
  throw new Error('No Claude credentials were found for this account on this machine.')
}

/** The login a remote host needs to run this Claude account; never logged or persisted by Seal. */
export async function exportClaudeCredential(
  services: Pick<ProviderAccountServices, 'claudeRuntimeAuth'>,
  candidate: SealAccountCandidate
): Promise<ClaudeCredential> {
  const router = services.claudeRuntimeAuth.router
  const isSystem = candidate.localId === null
  const configDir = isSystem
    ? router.systemDefaultHome()
    : router.accountHome(candidate.localId ?? '')
  const state = await readJsonObject(claudeStateFile(isSystem ? router.userConfigDir() : configDir))
  const account = state?.oauthAccount
  if (!isRecord(account)) {
    throw new Error('This Claude account has no saved login on this machine.')
  }
  return {
    provider: 'claude',
    email: String(account.emailAddress ?? candidate.email ?? ''),
    organizationUuid:
      typeof account.organizationUuid === 'string' ? account.organizationUuid : null,
    organizationName:
      typeof account.organizationName === 'string' ? account.organizationName : null,
    credentialsJson: await readClaudeCredentialsJson(configDir, isSystem),
    oauthAccountJson: JSON.stringify(account)
  }
}

export async function exportCodexCredential(
  candidate: SealAccountCandidate,
  managedHome: (accountId: string) => string | null
): Promise<CodexCredential> {
  const home =
    candidate.localId === null ? getSystemCodexHomePath() : managedHome(candidate.localId)
  const authJson = home ? await readOptionalFile(join(home, 'auth.json')) : null
  if (authJson === null) {
    throw new Error('No Codex login was found for this account on this machine.')
  }
  return { provider: 'codex', authJson }
}

async function writeMacKeychainCredential(
  configDir: string,
  credentialsJson: string
): Promise<void> {
  const user = process.env.USER || userInfo().username
  await execSecurityCommand([
    'add-generic-password',
    '-U',
    '-s',
    claudeKeychainService(configDir),
    '-a',
    user,
    '-w',
    credentialsJson
  ]).catch(() => {
    throw new Error('Could not save the Claude login to this Mac’s keychain.')
  })
}

/** Saves a Claude login pushed from the managing desktop as a managed account on this host. */
export async function importClaudeCredential(
  services: Pick<ProviderAccountServices, 'claudeAccounts'>,
  credential: ClaudeCredential
): Promise<string> {
  const wanted = oauthAccountKey('claude', credential.email, credential.organizationUuid)
  const existing = services.claudeAccounts
    .listAccounts()
    .accounts.find(
      (account) =>
        account.managedAuthRuntime !== 'wsl' &&
        sealAccountKeysMatch(
          oauthAccountKey('claude', account.email, account.organizationUuid),
          wanted
        )
    )
  const signIn = await services.claudeAccounts.beginSignIn(
    existing ? { accountId: existing.id } : { runtime: 'host' }
  )
  try {
    JSON.parse(credential.credentialsJson)
    const oauthAccount: unknown = JSON.parse(credential.oauthAccountJson)
    const statePath = claudeStateFile(signIn.configDir)
    const state = (await readJsonObject(statePath)) ?? {}
    writeSecureFile(statePath, JSON.stringify({ ...state, oauthAccount }, null, 2))
    writeSecureFile(join(signIn.configDir, '.credentials.json'), credential.credentialsJson)
    if (process.platform === 'darwin') {
      await writeMacKeychainCredential(signIn.configDir, credential.credentialsJson)
    }
    await services.claudeAccounts.finishSignIn({ accountId: signIn.accountId, runtime: 'host' })
    return signIn.accountId
  } catch (error) {
    if (!existing) {
      await services.claudeAccounts
        .cancelSignIn({ accountId: signIn.accountId, runtime: 'host' })
        .catch(() => {})
    }
    throw error
  }
}

function codexIdentity(authJson: string): { email: string | null; workspace: string | null } {
  try {
    const auth: unknown = JSON.parse(authJson)
    const tokens = isRecord(auth) ? auth.tokens : null
    const idToken = isRecord(tokens) ? tokens.id_token : null
    const payload = typeof idToken === 'string' ? idToken.split('.')[1] : undefined
    if (!payload) {
      return { email: null, workspace: null }
    }
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!isRecord(claims)) {
      return { email: null, workspace: null }
    }
    const openai = claims['https://api.openai.com/auth']
    return {
      email: typeof claims.email === 'string' ? claims.email : null,
      workspace:
        isRecord(openai) && typeof openai.chatgpt_account_id === 'string'
          ? openai.chatgpt_account_id
          : null
    }
  } catch {
    return { email: null, workspace: null }
  }
}

/** Saves a Codex login pushed from the managing desktop; an account already here gets fresh tokens. */
export async function importCodexCredential(
  services: Pick<ProviderAccountServices, 'codexAccounts'>,
  credential: CodexCredential,
  managedHome: (accountId: string) => string | null
): Promise<void> {
  JSON.parse(credential.authJson)
  const identity = codexIdentity(credential.authJson)
  const existing = identity.email
    ? services.codexAccounts
        .listAccounts()
        .accounts.find(
          (account) =>
            account.managedHomeRuntime !== 'wsl' &&
            sealAccountKeysMatch(
              oauthAccountKey('codex', account.email, account.workspaceAccountId),
              oauthAccountKey('codex', identity.email ?? '', identity.workspace)
            )
        )
    : undefined
  const existingHome = existing ? managedHome(existing.id) : null
  if (existingHome) {
    writeSecureFile(join(existingHome, 'auth.json'), credential.authJson)
    return
  }
  const staging = await mkdtemp(join(tmpdir(), 'seal-codex-'))
  try {
    writeSecureFile(join(staging, 'auth.json'), credential.authJson)
    await services.codexAccounts.addAccountFromHome(staging)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function importSealCredential(
  manager: Pick<SealAccountManager, 'services' | 'codexHome' | 'refreshUsage'>,
  credential: SealAccountsImportCredential
): Promise<void> {
  await (credential.provider === 'claude'
    ? importClaudeCredential(manager.services, credential)
    : importCodexCredential(manager.services, credential, (id) => manager.codexHome(id)))
  await manager.refreshUsage().catch(() => {})
}
