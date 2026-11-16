import type { NotificationSettings } from '../notification-settings-types'

export type LiveSessionSettings = {
  /** Off keeps `seal shell-integration` installed but runs claude/codex unwrapped on every host. */
  liveSessionsWrapAgents?: boolean
  /** Minutes a Seal-owned session may sit idle with nothing attached before Seal ends it; 0 never. */
  liveSessionsIdleReapMinutes?: number
  /** Legacy switch for sessions outside Seal's panes; only `migrateLiveSessionsNotify` reads it. */
  liveSessionsNotify?: boolean
}

export type LiveSessionsNotifyMigration = {
  liveSessionsNotify: undefined
  notifications?: NotificationSettings
}

/**
 * The settings update that folds the legacy switch into "Agent needs input" and "Agent task
 * complete", which now cover sessions outside Seal too; null once there is nothing left to fold.
 */
export function migrateLiveSessionsNotify(settings: {
  liveSessionsNotify?: boolean
  notifications: NotificationSettings
}): LiveSessionsNotifyMigration | null {
  if (settings.liveSessionsNotify === undefined) {
    return null
  }
  if (settings.liveSessionsNotify !== false) {
    return { liveSessionsNotify: undefined }
  }
  return {
    liveSessionsNotify: undefined,
    notifications: { ...settings.notifications, agentNeedsInput: false, agentTaskComplete: false }
  }
}
