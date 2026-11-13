import { readFileSync, rmSync, statSync } from 'node:fs'
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

let codexRead: { mtimeMs: number; size: number; identity: SealSystemIdentity | null } | null = null

function codexAuthPath(): string {
  return join(getSystemCodexHomePath(), 'auth.json')
}

/** The ChatGPT login in `~/.codex`; an API-key auth file names no account. */
function readCodexSystemLogin(): SealSystemIdentity | null {
  const path = codexAuthPath()
  let stat: { mtimeMs: number; size: number }
  try {
    stat = statSync(path)
  } catch {
    codexRead = null
    return null
  }
  if (codexRead?.mtimeMs === stat.mtimeMs && codexRead.size === stat.size) {
    return codexRead.identity
  }
  let identity: SealSystemIdentity | null = null
  try {
    const parsed = readCodexAuthIdentity(readFileSync(path, 'utf8'))
    identity = parsed?.email
      ? { email: parsed.email, scope: parsed.workspaceAccountId, orgName: parsed.workspaceLabel }
      : null
  } catch {
    identity = null
  }
  codexRead = { ...stat, identity }
  return identity
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
    codex: readCodexSystemLogin()
  }
}

/** What `claude auth logout` does, for a machine where the CLI cannot run. */
async function clearClaudeSystemLogin(services: SystemLoginServices): Promise<void> {
  const router = services.claudeRuntimeAuth.router
  rmSync(join(router.systemDefaultHome(), '.credentials.json'), { force: true })
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
  if (readCodexSystemLogin()) {
    rmSync(codexAuthPath(), { force: true })
  }
  if (readCodexSystemLogin()) {
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
