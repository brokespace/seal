// Desktop only: the headless server has no window to notify or to bring forward.
import { app, BrowserWindow, Notification } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { LIVE_SESSION_IPC } from '../../shared/live-sessions/live-session-ipc-channels'
import type { AgentSessionSurface } from '../../shared/live-sessions/live-session-types'
import { liveSessionPaneKeyOf } from '../../shared/live-sessions/live-session-surface'
import type { NotificationSettings } from '../../shared/notification-settings-types'
import {
  migrateLiveSessionsNotify,
  outsideSessionsMuted
} from '../../shared/live-sessions/live-session-settings'
import { deliverNativeNotification } from '../ipc/native-notification-delivery'
import { getTrustedUIRendererWindow } from '../ipc/ui'
import { activeSessionWorkspaceId } from '../runtime/terminal/wait/active-worktree-context-fallback'
import { getSessionSummariesHost } from '../session-summaries/session-summaries-instance'
import { safelyRevealWindow } from '../window/activation/focus-existing-window'
import { isBackgroundLaunch } from '../window/activation/foreground-activation-policy'
import {
  isLiveSessionNoticeEnabled,
  LiveSessionNotifier,
  type LiveSessionNotification
} from './live-session-notifier'
import type { LiveSessionService } from './live-session-service'

type NotificationSettingsStore = {
  getSettings(): Pick<GlobalSettings, 'liveSessionsNotify' | 'notifications'>
  updateSettings(updates: Partial<GlobalSettings>): unknown
  getWorkspaceSession(): Parameters<typeof activeSessionWorkspaceId>[0]
}

/** A focused Seal shows a pane session only in its own workspace, the rule its owner's lane follows. */
function lookingAt(surface: AgentSessionSurface, store: NotificationSettingsStore): boolean {
  if (
    !BrowserWindow.getAllWindows().some((window) => !window.isDestroyed() && window.isFocused())
  ) {
    return false
  }
  const workspaceId = getSessionSummariesHost()?.paneWorkspaceId(surface) ?? null
  return (
    workspaceId === null || workspaceId === activeSessionWorkspaceId(store.getWorkspaceSession())
  )
}

// Held until clicked or closed: a collected Notification never delivers its click.
const shownNotifications = new Set<Notification>()

function showSessionNotification(
  { sessionId, title, body, surface }: LiveSessionNotification,
  settings: NotificationSettings
): void {
  const worktreeId = getSessionSummariesHost()?.paneWorkspaceId(surface)
  if (worktreeId && surface.kind !== 'external') {
    // A session in a Seal pane opens where its owner's own notifications do: on its tab.
    void deliverNativeNotification(
      {
        source: 'agent-task-complete',
        worktreeId,
        paneKey: liveSessionPaneKeyOf({ surface, inputRoutes: [] }) ?? undefined,
        surface: surface.kind === 'chat' ? 'agent-session' : 'terminal'
      },
      { title, body },
      // That lane's renderer plays a custom sound; nothing plays one for this notification.
      { ...settings, customSoundId: 'system' }
    )
    return
  }
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

export function installLiveSessionDesktopNotifications(
  service: LiveSessionService,
  store: NotificationSettingsStore
): void {
  const migration = migrateLiveSessionsNotify(store.getSettings())
  if (migration) {
    store.updateSettings(migration)
  }
  const notifier = new LiveSessionNotifier({
    wanted: (kind, surface) => {
      const settings = store.getSettings()
      const { notifications } = settings
      return (
        isLiveSessionNoticeEnabled(notifications, kind) &&
        !(surface.kind === 'external' && outsideSessionsMuted(settings)) &&
        !(notifications.suppressWhenFocused && lookingAt(surface, store)) &&
        Notification.isSupported()
      )
    },
    show: (notification) =>
      showSessionNotification(notification, store.getSettings().notifications),
    // Installed after this, and only where replies are classified.
    replyAsk: (session) => getSessionSummariesHost()?.replyAsk(session) ?? 'tells',
    askedReply: (sessionId) => getSessionSummariesHost()?.askedReply(sessionId) ?? null
  })
  service.subscribe((event) => notifier.onEvent(event))
}
