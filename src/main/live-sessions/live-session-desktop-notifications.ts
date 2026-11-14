import { app, BrowserWindow, Notification } from 'electron'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { LIVE_SESSION_IPC } from '../../shared/live-sessions/live-session-ipc-channels'
import { getTrustedUIRendererWindow } from '../ipc/ui'
import { safelyRevealWindow } from '../window/activation/focus-existing-window'
import { isBackgroundLaunch } from '../window/activation/foreground-activation-policy'
import { LiveSessionNotifier, type LiveSessionNotification } from './live-session-notifier'
import type { LiveSessionService } from './live-session-service'

type NotificationSettingsStore = {
  getSettings(): Pick<GlobalSettings, 'liveSessionsNotify' | 'notifications'>
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

/** Desktop only: a system notification when a session starts waiting on the person. */
export function installLiveSessionNotifications(
  service: LiveSessionService,
  store: NotificationSettingsStore
): void {
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
}
