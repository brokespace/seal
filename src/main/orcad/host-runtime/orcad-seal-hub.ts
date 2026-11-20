import type { ClaudeRateLimitAccountsState } from '../../../shared/managed-account-types'
import { installHomeChat } from '../../home-chat/home-chat-install'
import type { HomeChatMachineSource } from '../../home-chat/machines/home-chat-machine-provider'
import { installLiveSessionNotifier } from '../../live-sessions/live-session-notifier'
import { installLiveSessions } from '../../live-sessions/live-sessions-install'
import { startMachineDiskIndexKeeper } from '../../machines/resources/machine-disk-index-keeper'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { createExternalSessionPhonePush } from '../../runtime/push/notifications/external-session-phone-push'
import { installSealMcp } from '../../seal-mcp/seal-mcp-install'

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
  const liveSessions = installLiveSessions(runtime, store)
  if (liveSessions) {
    // No desktop to notify: the sessions this server scans reach its paired phones only.
    installLiveSessionNotifier(
      liveSessions.service,
      store,
      createExternalSessionPhonePush(runtime, liveSessions.service.registry)
    )
  }
  void installHomeChat({
    claudeAccounts: accounts?.claudeAccounts ?? { listAccounts: () => NO_CLAUDE_ACCOUNTS },
    codexAccounts: () => store.getSettings().codexManagedAccounts,
    repos: () => store.getRepos(),
    machines: HEADLESS_MACHINES
  }).catch((error: unknown) => console.warn('[orcad] Home chat failed to start:', error))
  installSealMcp(runtime)
  // A server keeps its own disks indexed; waiting for a desktop to look would leave it unindexed.
  startMachineDiskIndexKeeper({ orcadSidecar: false })
}
