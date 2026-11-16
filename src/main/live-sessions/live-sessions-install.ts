import { hostname } from 'node:os'
import { getAppEnvironment } from '../../shared/app-environment'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { Store } from '../persistence/loading-store/store'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { localAiVaultScanRoots } from '../ai-vault/discovery/ai-vault-scan-roots'
import { listLiveSessionMachineSources } from '../machines/machine-services'
import {
  connectedMachineHosts,
  liveSessionMachineOf,
  LOCAL_HOST_ID,
  localHost
} from './hosts/live-session-hosts'
import { isRuntimeServerReachable, runtimeScanRunner } from './hosts/connected-runtime-hosts'
import { createStructuredSessionAccess } from './sources/structured-session-source'
import { FederatedSessions } from './federation/federated-sessions'
import { runtimeFederationTransport } from './federation/runtime-federation-transport'
import { aiVaultTranscriptFiles } from './discovery/local-transcript-files'
import { LiveSessionService } from './live-session-service'
import { createSealPaneAccess } from './seal-panes/seal-pane-runtime'
import { getLiveSessionService, setLiveSessionService } from './live-session-service-instance'
import { idleReapMinutes, SealIdleReaper } from './delivery/seal-idle-reaper'
import type {
  ShellIntegrationAction,
  ShellIntegrationStatus
} from '../../shared/shell-integration/shell-integration-installer'
import {
  runShellIntegration,
  ShellIntegrationSync,
  wrapAgentsEnabled
} from './shell-integration/shell-integration-hosts'
import { installWorkspaceLink } from './workspace-link/workspace-link-install'

export type HostShellIntegration = (
  hostId: string,
  action: ShellIntegrationAction
) => Promise<ShellIntegrationStatus>

/** Starts discovery on this host; the desktop additionally wires its window IPC to the result. */
export function installLiveSessions(
  runtime: OrcaRuntimeService,
  store: Store
): { service: LiveSessionService; shellIntegration: HostShellIntegration } | null {
  if (getLiveSessionService()) {
    return null
  }
  const log = (message: string, error?: unknown) => console.warn(message, error ?? '')
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its remote machines only.
  const local =
    process.platform === 'win32'
      ? null
      : localHost(hostname(), aiVaultTranscriptFiles(localAiVaultScanRoots))
  const userDataPath = getAppEnvironment().getPath('userData')
  const serverScan = runtimeScanRunner(userDataPath)
  const allHosts = () => [
    ...(local ? [local] : []),
    ...connectedMachineHosts(
      listLiveSessionMachineSources().flatMap((source) => {
        if (!source.environmentId) {
          return [source]
        }
        const serverRun = serverScan(source.environmentId, source.name)
        return serverRun ? [{ ...source, serverRun }] : []
      })
    )
  ]
  const federation = new FederatedSessions({
    transport: runtimeFederationTransport(userDataPath),
    log
  })
  // A server lists its own machine whatever its platform: only the scan from here needs a POSIX shell.
  const syncFederation = (): void =>
    federation.sync(
      listLiveSessionMachineSources().flatMap(({ environmentId, ...source }) =>
        environmentId && source.connection.isConnected() && isRuntimeServerReachable(environmentId)
          ? [{ machine: liveSessionMachineOf(source), environmentId }]
          : []
      )
    )
  const localMachine = { hostId: LOCAL_HOST_ID, label: hostname(), kind: 'local' as const }
  const chats = createStructuredSessionAccess(runtime, {
    // A chat runs where its host does: here, or on a server whose own registry lists it.
    machineOf: (executionHostId) =>
      executionHostId === LOCAL_HOST_ID ? (local?.machine ?? localMachine) : null,
    log
  })
  const wrapSync = new ShellIntegrationSync(() => wrapAgentsEnabled(store.getSettings()), log)
  store.onSettingsChanged((updates) => {
    if ('liveSessionsWrapAgents' in updates) {
      wrapSync.settingChanged()
      wrapSync.reconcile(allHosts())
    }
  })
  const sealPanes = createSealPaneAccess(runtime, {
    snapshot: () => agentHookServer.getStatusSnapshot(),
    checkAgentPresence: (paneKey) => agentHookServer.checkAgentPresence(paneKey)
  })
  const reaper = new SealIdleReaper({
    minutes: () => idleReapMinutes(store.getSettings().liveSessionsIdleReapMinutes),
    log
  })
  const workspaceLink = installWorkspaceLink({ runtime, store, log })
  const service = new LiveSessionService({
    userDataPath,
    hosts: () => {
      const hosts = allHosts()
      wrapSync.reconcile(hosts)
      syncFederation()
      return hosts
    },
    sealPanes,
    chats,
    federation,
    onHostScanned: (host, sessions) => reaper.onHostScanned(host, sessions),
    link: workspaceLink.link,
    log
  })
  const shellIntegration: HostShellIntegration = async (hostId, action) => {
    const host = allHosts().find((candidate) => candidate.machine.hostId === hostId)
    if (!host) {
      throw new Error(
        hostId === LOCAL_HOST_ID
          ? 'Shell integration needs macOS or Linux'
          : 'Connect to this machine first'
      )
    }
    const status = await runShellIntegration(host, action)
    if (action === 'install' && !wrapAgentsEnabled(store.getSettings())) {
      return runShellIntegration(host, 'disable')
    }
    return status
  }
  setLiveSessionService(service)
  workspaceLink.start(service.registry)
  service.start()
  getAppEnvironment().onWillQuit(() => {
    workspaceLink.stop()
    service.stop()
  })
  return { service, shellIntegration }
}
