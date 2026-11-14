import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { installHomeChat } from '../../home-chat/home-chat-install'
import type { HomeChatMachineSource } from '../../home-chat/machines/home-chat-machine-provider'
import { installLiveSessions } from '../../live-sessions/live-sessions-install'
import { startMachineDiskIndexKeeper } from '../../machines/resources/machine-disk-index-keeper'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { installSealMcp } from '../../seal-mcp/seal-mcp-install'
import { getMainE2EConfig } from '../../startup/testing/e2e-config'

const NO_CLAUDE_ACCOUNTS: ClaudeRateLimitAccountsState = { accounts: [], activeAccountId: null }

// The machine registry is desktop-only, so the headless assistant works on this host alone.
const HEADLESS_MACHINES: HomeChatMachineSource = {
  list: () => [],
  summarize: () => {
    throw new Error('No other machines on a headless server')
  },
  connection: () => {
    throw new Error('No other machines on a headless server')
  }
}

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
    repos: () => store.getRepos(),
    machines: HEADLESS_MACHINES
  }).catch((error: unknown) => console.warn('[orcad] Home chat failed to start:', error))
  installSealMcp(runtime)
  // A server keeps its own disks indexed; waiting for a desktop to look would leave it unindexed.
  startMachineDiskIndexKeeper(getMainE2EConfig().enabled ? 'this is an end-to-end test run' : null)
}
