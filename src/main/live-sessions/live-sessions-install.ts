import { hostname } from 'node:os'
import { getAppEnvironment } from '../../shared/app-environment'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { localAiVaultScanRoots } from '../ai-vault/discovery/ai-vault-scan-roots'
import { listLiveSessionMachineSources } from '../machines/machine-services'
import { connectedMachineHosts, LOCAL_HOST_ID, localHost } from './hosts/live-session-hosts'
import { runtimeScanRunner } from './hosts/connected-runtime-hosts'
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

type LiveSessionSettingsStore = {
  getSettings(): Pick<GlobalSettings, 'liveSessionsWrapAgents' | 'liveSessionsIdleReapMinutes'>
  onSettingsChanged(listener: (updates: Partial<GlobalSettings>) => void): unknown
}

export type HostShellIntegration = (
  hostId: string,
  action: ShellIntegrationAction
) => Promise<ShellIntegrationStatus>

/** Starts discovery on this host; the desktop additionally wires its window IPC to the result. */
export function installLiveSessions(
  runtime: OrcaRuntimeService,
  store: LiveSessionSettingsStore
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
  const wrapSync = new ShellIntegrationSync(() => wrapAgentsEnabled(store.getSettings()), log)
  store.onSettingsChanged((updates) => {
    if ('liveSessionsWrapAgents' in updates) {
      wrapSync.settingChanged()
      wrapSync.reconcile(allHosts())
    }
  })
  const sealPanes = createSealPaneAccess(runtime, {
    snapshot: () => agentHookServer.getStatusSnapshot()
  })
  const reaper = new SealIdleReaper({
    minutes: () => idleReapMinutes(store.getSettings().liveSessionsIdleReapMinutes),
    log
  })
  const service = new LiveSessionService({
    userDataPath,
    hosts: () => {
      const hosts = allHosts()
      wrapSync.reconcile(hosts)
      return hosts
    },
    sealPanes,
    onHostScanned: (host, sessions) => reaper.onHostScanned(host, sessions),
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
  service.start()
  getAppEnvironment().onWillQuit(() => service.stop())
  return { service, shellIntegration }
}
