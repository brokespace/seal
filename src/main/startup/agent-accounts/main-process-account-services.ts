import { app } from 'electron'
import { KeybindingService } from '../../keybindings/keybinding-service'
import { createProviderAccountServices } from '../../providers/accounts/provider-account-services'
import { createCodexSessionMigrationScheduler } from '../../codex/history/backfill/codex-session-migration-scheduler'
import { startCodexSessionBackfillInBackground } from '../../codex/history/backfill/codex-session-backfill'
import { startCodexSessionIndexHealInBackground } from '../../codex/history/index/codex-session-index-heal'
import { startCodexStateDbBackfillRecoveryInBackground } from '../../codex/history/index/codex-state-db-backfill-recovery'
import { getOrcaManagedCodexHomePath } from '../../codex/configuration/homes/codex-home-paths'
import {
  hasOpenCodeGoApiKey,
  readOpenCodeGoApiKey,
  saveOpenCodeGoApiKey
} from '../../opencode/accounts/opencode-go-api-key-store'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { resolveHostCodexSessionSourceHome } from '../../codex/history/rollouts/codex-session-source-home'
import { browserManager } from '../../browser/guest-lifecycle/manager/browser-manager'
import { prewarmStructuredAgentModelCatalogs } from '../../runtime/agent-session/model-catalog/structured-agent-model-catalog-wiring'
import { mainProcessState as state } from '../main-process-state'
import { setSealFleetTransport } from '../../seal-accounts/seal-fleet-sync'
import {
  sealDesktopFleetTransport,
  sealDesktopReplicaTargets
} from '../../seal-accounts/seal-desktop-fleet-transport'
import { startSealConfigReplication } from '../../seal-accounts/seal-config-replication'
import { onRuntimeEnvironmentStatusPublished } from '../../ipc/runtime-environments/status/runtime-environment-status-owner'
import { trackRuntimeEnvironmentVerifiedTransitions } from '../../ipc/runtime-environments/status/runtime-environment-verified-transitions'
import { getSealAccountManager } from '../../seal-accounts/seal-account-manager'
import { installSealConnectorsFleet } from '../../seal-connectors/seal-connectors-fleet'
import { getSealConnectorsService } from '../../seal-connectors/seal-connectors-install'
import { getMachineRegistry } from '../../machines/registry/machine-registry-service'

// Settings that change which account or binary a new chat's agent runs under.
const MODEL_CATALOG_ACCOUNT_SETTINGS = [
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime',
  'codexManagedAccounts',
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'claudeManagedAccounts',
  'agentDefaultEnv',
  'agentCmdOverrides'
] as const

export function initializeMainProcessAccountServices(): void {
  const store = state.store
  if (!store || !state.claudeUsage || !state.codexUsage) {
    throw new Error('Usage stores must be initialized before account services')
  }
  state.codexSessionMigration = createCodexSessionMigrationScheduler({
    isEligible: () =>
      state.codexRuntimeHome?.isHostSystemDefaultSessionMigrationEligible() === true,
    isQuitting: () => state.isQuitting,
    resolveSystemCodexHomePathOverride: () =>
      resolveHostCodexSessionSourceHome(store.getSettings()),
    prepareScheduledRun: (scanDates) =>
      state.codexRuntimeHome?.prepareHostSystemDefaultSessionMigrationPass(scanDates),
    finishScheduledRun: () => state.codexRuntimeHome?.finishHostSystemDefaultSessionMigrationPass(),
    startBackfill: startCodexSessionBackfillInBackground,
    startIndexHeal: startCodexSessionIndexHealInBackground
  })
  const services = createProviderAccountServices(store, {
    codexAccountLifecycle: { onHostSystemDefaultSelected: state.codexSessionMigration.requestRun },
    setClaudeStatusLineListener: (listener) => agentHookServer.setClaudeStatusLineListener(listener)
  })
  setSealFleetTransport(sealDesktopFleetTransport)
  const sealAccounts = getSealAccountManager()
  if (sealAccounts) {
    startSealConfigReplication(sealAccounts, {
      targets: sealDesktopReplicaTargets,
      call: sealDesktopFleetTransport,
      onHostOnline: (listener) =>
        onRuntimeEnvironmentStatusPublished(trackRuntimeEnvironmentVerifiedTransitions(listener))
    })
  }
  const sealConnectors = getSealConnectorsService()
  if (sealConnectors) {
    installSealConnectorsFleet({
      service: sealConnectors,
      targets: sealDesktopReplicaTargets,
      call: sealDesktopFleetTransport,
      onHostOnline: (listener) =>
        onRuntimeEnvironmentStatusPublished(trackRuntimeEnvironmentVerifiedTransitions(listener)),
      label: (target) =>
        target === 'local'
          ? 'This computer'
          : (getMachineRegistry()
              .records()
              .find((record) => record.environmentId === target)?.name ?? target)
    })
  }
  state.rateLimits = services.rateLimits
  state.codexRuntimeHome = services.codexRuntimeHome
  state.codexAccounts = services.codexAccounts
  state.claudeRuntimeAuth = services.claudeRuntimeAuth
  state.claudeAccounts = services.claudeAccounts
  void startCodexStateDbBackfillRecoveryInBackground(getOrcaManagedCodexHomePath())
  // Defer shared-home migration; compatibility launches re-arm non-destructive scans for new rollouts (#4444, #8612, #12480).
  state.codexSessionMigration.scheduleInitialRun()
  store.onSettingsChanged((updates) => {
    // An account switch would otherwise leave the next chat's picker on a cold catalog.
    if (MODEL_CATALOG_ACCOUNT_SETTINGS.some((key) => key in updates)) {
      prewarmStructuredAgentModelCatalogs()
    }
  })
  store.migrateLegacyOpenCodeGoApiKey({
    has: hasOpenCodeGoApiKey,
    read: readOpenCodeGoApiKey,
    save: saveOpenCodeGoApiKey
  })
  state.keybindings = new KeybindingService({
    homePath: app.getPath('home'),
    getLegacyOverrides: () => store.getSettings().keybindings,
    legacyTabSwitchDefaults: store.getSettings().tabSwitchKeybindingSeed === 'legacy',
    legacySearchDefaults:
      (process.platform === 'darwin'
        ? store.getSettings().searchKeybindingSeed
        : store.getSettings().nonMacSearchKeybindingSeed) === 'legacy'
  })
  browserManager.setSettingsResolver(() => ({ keybindings: state.keybindings?.getOverrides() }))
}
