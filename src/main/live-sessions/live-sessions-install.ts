import { hostname } from 'node:os'
import { app, BrowserWindow, Notification } from 'electron'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { agentHookServer } from '../agent-hooks/server/agent-hook-server'
import { localAiVaultScanRoots } from '../ai-vault/discovery/ai-vault-scan-roots'
import { getMachineRegistry } from '../machines/registry/machine-registry-service'
import { connectedMachineHosts, LOCAL_HOST_ID, localHost } from './hosts/live-session-hosts'
import { runtimeScanRunner } from './hosts/connected-runtime-hosts'
import { aiVaultTranscriptFiles } from './discovery/local-transcript-files'
import { LiveSessionService } from './live-session-service'
import { createSealPaneAccess } from './seal-panes/seal-pane-runtime'
import { registerLiveSessionIpc } from './live-sessions-ipc'
import { getLiveSessionService, setLiveSessionService } from './live-session-service-instance'
import { idleReapMinutes, SealIdleReaper } from './delivery/seal-idle-reaper'
import { LiveSessionNotifier, type LiveSessionNotification } from './live-session-notifier'
import { LIVE_SESSION_IPC } from '../../shared/live-sessions/live-session-ipc-channels'
import { getTrustedUIRendererWindow } from '../ipc/ui'
import { safelyRevealWindow } from '../window/activation/focus-existing-window'
import { isBackgroundLaunch } from '../window/activation/foreground-activation-policy'
import {
  runShellIntegration,
  ShellIntegrationSync,
  wrapAgentsEnabled
} from './shell-integration/shell-integration-hosts'

type LiveSessionSettingsStore = {
  getSettings(): Pick<
    GlobalSettings,
    | 'liveSessionsWrapAgents'
    | 'liveSessionsIdleReapMinutes'
    | 'liveSessionsNotify'
    | 'notifications'
  >
  onSettingsChanged(listener: (updates: Partial<GlobalSettings>) => void): unknown
}

// Held until clicked or closed: a collected Notification never delivers its click.
const shownNotifications = new Set<Notification>()

function showSessionNotification({ sessionId, title, body }: LiveSessionNotification): void {
  const notification = new Notification({ title, body })
  shownNotifications.add(notification)
  notification.on('close', () => shownNotifications.delete(notification))
  notification.on('failed', () => shownNotifications.delete(notification))
  notification.on('click', () => {
    shownNotifications.delete(notification)
    const window = getTrustedUIRendererWindow()
    if (!window || window.isDestroyed()) {
      return
    }
    if (process.platform === 'darwin' && !isBackgroundLaunch()) {
      app.focus({ steal: true })
    }
    safelyRevealWindow(window)
    window.webContents.send(LIVE_SESSION_IPC.open, { sessionId })
  })
  notification.show()
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
  // Discovery reads `ps`, tmux and transcripts with a POSIX shell; Windows reaches its remote machines only.
  const local =
    process.platform === 'win32'
      ? null
      : localHost(hostname(), aiVaultTranscriptFiles(localAiVaultScanRoots))
  const userDataPath = app.getPath('userData')
  const serverScan = runtimeScanRunner(userDataPath)
  const allHosts = () => [
    ...(local ? [local] : []),
    ...connectedMachineHosts(
      getMachineRegistry()
        .liveSessionSources()
        .flatMap((source) => {
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
  registerLiveSessionIpc(service, async (hostId, action) => {
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
  })
  const notifier = new LiveSessionNotifier({
    wanted: () => {
      const settings = store.getSettings()
      const lookingAtSeal =
        settings.notifications.suppressWhenFocused &&
        BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())
      return (
        settings.notifications.enabled &&
        settings.liveSessionsNotify !== false &&
        !lookingAtSeal &&
        Notification.isSupported()
      )
    },
    show: showSessionNotification
  })
  service.subscribe((event) => notifier.onEvent(event))
  setLiveSessionService(service)
  service.start()
  app.on('will-quit', () => {
    service.stop()
  })
  return service
}
