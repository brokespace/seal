import { hostname } from 'node:os'
import { app } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { localAiVaultScanRoots } from '../ai-vault/discovery/ai-vault-scan-roots'
import { connectedSshHosts, LOCAL_HOST_ID, localHost } from './hosts/live-session-hosts'
import { connectedRuntimeHosts } from './hosts/connected-runtime-hosts'
import { aiVaultTranscriptFiles } from './discovery/local-transcript-files'
import { LiveSessionService } from './live-session-service'
import { createSealPaneAccess } from './seal-panes/seal-pane-runtime'
import { registerLiveSessionIpc } from './live-sessions-ipc'
import { getLiveSessionService, setLiveSessionService } from './live-session-service-instance'
import { idleReapMinutes, SealIdleReaper } from './delivery/seal-idle-reaper'
import {
  runShellIntegration,
  ShellIntegrationSync,
  wrapAgentsEnabled
} from './shell-integration/shell-integration-hosts'

type LiveSessionSettingsStore = {
  getSettings(): Pick<GlobalSettings, 'liveSessionsWrapAgents' | 'liveSessionsIdleReapMinutes'>
  onSettingsChanged(listener: (updates: Partial<GlobalSettings>) => void): unknown
}

export function installLiveSessions(
  runtime: OrcaRuntimeService,
  store: LiveSessionSettingsStore
): LiveSessionService {
  const existing = getLiveSessionService()
  if (existing) {
    return existing
  }
  const log = (message: string, error?: unknown) => console.warn(message, error ?? '')
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its SSH hosts only.
  const local =
    process.platform === 'win32'
      ? null
      : localHost(hostname(), aiVaultTranscriptFiles(localAiVaultScanRoots))
  const userDataPath = app.getPath('userData')
  const allHosts = () => [
    ...(local ? [local] : []),
    ...connectedSshHosts(),
    ...connectedRuntimeHosts(userDataPath)
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
  const service = new LiveSessionService({
    userDataPath,
    hosts: () => {
      const hosts = allHosts()
      wrapSync.reconcile(hosts)
      return hosts
    },
    sealPanes,
    log
  })
  registerLiveSessionIpc(service, async (hostId, action) => {
    const host = allHosts().find((candidate) => candidate.machine.hostId === hostId)
    if (!host) {
      throw new Error(
        hostId === LOCAL_HOST_ID
          ? 'Shell integration needs macOS or Linux'
          : 'Connect to this host first'
      )
    }
    const status = await runShellIntegration(host, action)
    if (action === 'install' && !wrapAgentsEnabled(store.getSettings())) {
      return runShellIntegration(host, 'disable')
    }
    return status
  })
  const reaper = new SealIdleReaper({
    hosts: allHosts,
    minutes: () => idleReapMinutes(store.getSettings().liveSessionsIdleReapMinutes),
    log
  })
  setLiveSessionService(service)
  service.start()
  reaper.start()
  app.on('will-quit', () => {
    service.stop()
    reaper.stop()
  })
  return service
}
