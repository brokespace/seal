import { dirname, join } from 'node:path'
import { resolveClaudeDefaultHome } from '../claude-accounts/profiles/claude-profile-paths'
import { shareClaudeMcpSignIns } from '../claude-accounts/profiles/setup/claude-profile-mcp-sign-ins'
import type { SealAccountManager } from './seal-account-manager'

/**
 * Re-shares MCP server sign-ins with every Claude account and session home on this host, so a
 * refresh token one home rotated reaches the others before they spend the old one.
 */
export async function upkeepClaudeMcpSignIns(
  manager: Pick<SealAccountManager, 'services' | 'store' | 'candidates'>
): Promise<void> {
  const router = manager.services.claudeRuntimeAuth.router
  const userConfigDir = router.userConfigDir()
  const defaultHome = resolveClaudeDefaultHome(router.userHome, userConfigDir)
  const homes = new Set<string>()
  for (const candidate of manager.candidates('claude')) {
    if (candidate.kind === 'oauth' && candidate.localId) {
      homes.add(router.accountHome(candidate.localId))
    }
  }
  for (const session of manager.store.getState().sessions) {
    if (session.provider === 'claude' && session.profileHome) {
      homes.add(session.profileHome)
    }
  }
  for (const home of homes) {
    await shareClaudeMcpSignIns({
      defaultHome,
      profileHome: home,
      systemDefault: !userConfigDir,
      record: join(dirname(home), 'mcp-sign-ins-sync.json'),
      platform: process.platform
    }).catch((error: unknown) =>
      console.warn(
        '[seal-accounts] Could not share MCP sign-ins:',
        error instanceof Error ? error.message : String(error)
      )
    )
  }
}
