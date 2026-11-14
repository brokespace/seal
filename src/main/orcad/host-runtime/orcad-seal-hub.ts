import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { installHomeChat } from '../../home-chat/home-chat-install'
import { installLiveSessions } from '../../live-sessions/live-sessions-install'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { installSealMcp } from '../../seal-mcp/seal-mcp-install'

const NO_CLAUDE_ACCOUNTS: ClaudeRateLimitAccountsState = { accounts: [], activeAccountId: null }

/** The headless server answers the phone's Seal hub (live sessions, Home chat) and MCP clients like the desktop does. */
export function installOrcadSealHub(
  runtime: OrcaRuntimeService,
  store: Store,
  accounts: { claudeAccounts: { listAccounts: () => ClaudeRateLimitAccountsState } } | null
): void {
  installLiveSessions(runtime, store)
  void installHomeChat({
    claudeAccounts: accounts?.claudeAccounts ?? { listAccounts: () => NO_CLAUDE_ACCOUNTS },
    codexAccounts: () => store.getSettings().codexManagedAccounts,
    repos: () => store.getRepos()
  }).catch((error: unknown) => console.warn('[orcad] Home chat failed to start:', error))
  installSealMcp(runtime)
}
