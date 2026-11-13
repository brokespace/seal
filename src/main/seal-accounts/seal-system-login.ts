import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealSystemIdentity } from '../../shared/seal-accounts/seal-system-login-candidate'
import { withCliRuntimeOnPath } from '../../shared/node-cli-command-resolution'
import { updateClaudeGlobalConfig } from '../claude/configuration/claude-folder-trust-file'
import { claudeKeychainService, getKeychainUser } from '../claude-accounts/runtime-auth/keychain'
import { claudeStateFileAsync } from '../claude-accounts/sign-in/claude-account-folder'
import { runClaudeCommandProcess } from '../claude-accounts/sign-in/claude-command-process'
import { readCodexAuthIdentity } from '../codex-accounts/credentials/codex-auth-identity'
import { resolveCodexCommand } from '../codex-cli/command'
import { getSystemCodexHomePath } from '../codex/configuration/homes/codex-home-paths'
import { execSecurityCommand } from '../macos-keychain/generic-password'
import { runAccountCliOnce } from '../provider-process/account-cli-one-shot'
import type { ProviderAccountServices } from '../providers/accounts/provider-account-services'

const SYSTEM_LOGIN_MAX_AGE_MS = 5_000
const LOGOUT_TIMEOUT_MS = 20_000

type SystemLoginServices = Pick<ProviderAccountServices, 'claudeRuntimeAuth' | 'codexRuntimeHome'>

type CodexAuthRead = { mtimeMs: number; size: number; identity: SealSystemIdentity | null }

let codexRead: CodexAuthRead | null = null
let codexReadAt = 0
let codexReading: Promise<SealSystemIdentity | null> | null = null

function codexAuthPath(): string {
  return join(getSystemCodexHomePath(), 'auth.json')
}

async function readCodexAuthFile(): Promise<CodexAuthRead | null> {
  const path = codexAuthPath()
  try {
    const { mtimeMs, size } = await stat(path)
    if (codexRead?.mtimeMs === mtimeMs && codexRead.size === size) {
      return codexRead
    }
    const parsed = readCodexAuthIdentity(await readFile(path, 'utf8'))
    // An API-key auth file names no account.
    const identity = parsed?.email
      ? { email: parsed.email, scope: parsed.workspaceAccountId, orgName: parsed.workspaceLabel }
      : null
    return { mtimeMs, size, identity }
  } catch {
    return null
  }
}

/** Re-reads the ChatGPT login in `~/.codex`. */
function refreshCodexSystemLogin(): Promise<SealSystemIdentity | null> {
  codexReading ??= readCodexAuthFile()
    .then((read) => {
      codexRead = read
      codexReadAt = Date.now()
      return read?.identity ?? null
    })
    .finally(() => {
      codexReading = null
    })
  return codexReading
}

/** The last read of `~/.codex`; an old one is re-read in the background for the next caller. */
function codexSystemLogin(): SealSystemIdentity | null {
  if (Date.now() - codexReadAt > SYSTEM_LOGIN_MAX_AGE_MS) {
    void refreshCodexSystemLogin()
  }
  return codexRead?.identity ?? null
}

/** Call before a listing that must reflect a login made or removed outside Seal a moment ago. */
export async function refreshSealSystemLogins(): Promise<void> {
  await refreshCodexSystemLogin()
}

/** The accounts this machine's own `claude` and `codex` CLIs are signed in to. */
export function readSealSystemLogins(
  services: SystemLoginServices
): Record<SealProvider, SealSystemIdentity | null> {
  const claude = services.claudeRuntimeAuth.router.systemDefaultLogin(SYSTEM_LOGIN_MAX_AGE_MS)
  return {
    claude: claude
      ? { email: claude.email, scope: claude.organizationUuid, orgName: claude.organizationName }
      : null,
    codex: codexSystemLogin()
  }
}

/** What `claude auth logout` does, for a machine where the CLI cannot run. */
async function clearClaudeSystemLogin(services: SystemLoginServices): Promise<void> {
  const router = services.claudeRuntimeAuth.router
  await rm(join(router.systemDefaultHome(), '.credentials.json'), { force: true })
  if (process.platform === 'darwin') {
    await execSecurityCommand([
      'delete-generic-password',
      '-s',
      claudeKeychainService(router.userConfigDir()),
      '-a',
      getKeychainUser()
    ]).catch(() => {})
  }
  await updateClaudeGlobalConfig(await claudeStateFileAsync(router.userConfigDir()), (config) => {
    if (!('oauthAccount' in config)) {
      return { kind: 'unchanged' }
    }
    const { oauthAccount: _removed, ...rest } = config
    return { kind: 'changed', config: rest }
  })
}

async function logOutClaude(services: SystemLoginServices): Promise<void> {
  const router = services.claudeRuntimeAuth.router
  const home = router.systemDefaultHome()
  try {
    await runClaudeCommandProcess(
      ['auth', 'logout'],
      { windowsPath: home, linuxPath: null, wslDistro: null },
      LOGOUT_TIMEOUT_MS,
      { systemLogin: { userConfigDir: router.userConfigDir() } }
    )
  } catch (error) {
    console.warn('[seal-accounts] `claude auth logout` failed; clearing the login directly:', error)
  }
  if (router.systemDefaultLogin()) {
    await clearClaudeSystemLogin(services)
  }
  if (router.systemDefaultLogin()) {
    throw new Error('Could not sign this machine out of Claude. Run `claude auth logout`.')
  }
}

async function logOutCodex(services: SystemLoginServices): Promise<void> {
  const command = resolveCodexCommand()
  const env = { ...process.env }
  // Without CODEX_HOME the CLI signs out of the machine's own `~/.codex`.
  delete env.CODEX_HOME
  try {
    await runAccountCliOnce({
      command,
      args: ['logout'],
      env: withCliRuntimeOnPath(command, env),
      timeoutMs: LOGOUT_TIMEOUT_MS
    })
  } catch (error) {
    console.warn('[seal-accounts] `codex logout` failed; clearing the login directly:', error)
  }
  if (await refreshCodexSystemLogin()) {
    await rm(codexAuthPath(), { force: true })
  }
  if (await refreshCodexSystemLogin()) {
    throw new Error('Could not sign this machine out of Codex. Run `codex logout`.')
  }
  // Seal's shared Codex home mirrors `~/.codex`; let it drop the login too.
  try {
    services.codexRuntimeHome.syncForCurrentSelection()
  } catch (error) {
    console.warn('[seal-accounts] Codex runtime home did not pick up the logout:', error)
  }
}

/** Signs the machine's own CLI out with one short command, falling back to removing the login. */
export function logOutSealSystemLogin(
  services: SystemLoginServices,
  provider: SealProvider
): Promise<void> {
  return provider === 'claude' ? logOutClaude(services) : logOutCodex(services)
}
