import { copyFile, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import { isAgentStatusHooksEnabledForAgent } from '../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { getClaudeAgentViewService } from '../claude/agent-view/agent-view-service'
import { probeRecentClaudeCliVersion } from '../claude/cli-capabilities/claude-hook-event-versions'
import { describeClaudeProfile } from '../claude-accounts/profiles/claude-profile-paths'
import { runClaudeProfileSetupInWorker } from '../claude-accounts/profiles/setup/claude-profile-setup-worker'
import { resolveClaudeCommand } from '../codex-cli/command'
import { claudeKeychainService, getKeychainUser } from '../claude-accounts/runtime-auth/keychain'
import { execSecurityCommand } from '../macos-keychain/generic-password'
import type { SealAccountManager } from './seal-account-manager'

type HomesManager = Pick<SealAccountManager, 'dataRoot' | 'services' | 'deps'>

/** Outside `claude-profiles`, so Orca never lists a session's home as an account. */
function sessionsRoot(dataRoot: string, provider: SealProvider): string {
  return join(dataRoot, 'seal-sessions', provider)
}

/**
 * A Claude config dir that belongs to one session: history, settings and hooks shared like an
 * account profile, but its own `.credentials.json` and `.claude.json`, so Seal can move just this
 * session to another login. The caller writes the login in.
 */
export async function provisionClaudeSessionHome(
  manager: HomesManager,
  sessionId: string
): Promise<string> {
  const root = sessionsRoot(manager.dataRoot, 'claude')
  const profile = describeClaudeProfile(root, sessionId, {
    executionHostId: 'local',
    runtime: 'host'
  })
  const router = manager.services.claudeRuntimeAuth.router
  const hooks = isAgentStatusHooksEnabledForAgent(manager.deps.store.getSettings(), 'claude')
  const claudeVersion = hooks ? await probeRecentClaudeCliVersion(resolveClaudeCommand()) : null
  const report = await runClaudeProfileSetupInWorker({
    dataRoot: root,
    profile,
    userHome: router.userHome,
    userConfigDir: router.userConfigDir(),
    hooks,
    claudeVersion: claudeVersion ?? undefined
  })
  if (report.outcome !== 'prepared') {
    throw new Error('Could not prepare a session folder for this Claude session.')
  }
  await getClaudeAgentViewService(manager.dataRoot).prepareProfile(profile.home)
  return profile.home
}

/**
 * A CODEX_HOME for one session: links to the account's home for config, history and sessions
 * (so `codex resume` still finds the transcript), plus its own `auth.json`.
 */
export async function provisionCodexSessionHome(
  dataRoot: string,
  sessionId: string,
  accountHome: string,
  authJson: string
): Promise<string> {
  const home = join(sessionsRoot(dataRoot, 'codex'), sessionId)
  await mkdir(home, { recursive: true, mode: 0o700 })
  for (const entry of await readdir(accountHome, { withFileTypes: true })) {
    if (entry.name === 'auth.json') {
      continue
    }
    const source = join(accountHome, entry.name)
    const target = join(home, entry.name)
    if (entry.isDirectory()) {
      // Junctions need no Windows symlink privilege.
      await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    } else if (process.platform === 'win32') {
      await copyFile(source, target)
    } else {
      await symlink(source, target)
    }
  }
  writeSecureFile(join(home, 'auth.json'), authJson)
  return home
}

/** Session homes hold only links and a login copy; the account's own home keeps everything else. */
export async function removeSessionHome(dataRoot: string, home: string): Promise<void> {
  const within = (root: string) => home.startsWith(`${root}${sep}`)
  if (within(sessionsRoot(dataRoot, 'claude'))) {
    if (process.platform === 'darwin') {
      await execSecurityCommand([
        'delete-generic-password',
        '-s',
        claudeKeychainService(home),
        '-a',
        getKeychainUser()
      ]).catch(() => {})
    }
    // The home sits in `<id>/home` beside its setup marker.
    await rm(dirname(home), { recursive: true, force: true })
  } else if (within(sessionsRoot(dataRoot, 'codex'))) {
    await rm(home, { recursive: true, force: true })
  }
}
