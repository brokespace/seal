export type LiveSessionSettings = {
  /** Off keeps `seal shell-integration` installed but runs claude/codex unwrapped on every host. */
  liveSessionsWrapAgents?: boolean
  /** Minutes a Seal-owned session may sit idle with nothing attached before Seal ends it; 0 never. */
  liveSessionsIdleReapMinutes?: number
  /**
   * False keeps sessions outside Seal's panes silent, carried over from the switch the two agent
   * notification settings replaced. It is never written anew; turning it back on removes it.
   */
  liveSessionsNotify?: boolean
}

/** A profile that turned the legacy switch off still hears nothing about sessions outside Seal. */
export function outsideSessionsMuted(
  settings: Pick<LiveSessionSettings, 'liveSessionsNotify'>
): boolean {
  return settings.liveSessionsNotify === false
}

/**
 * The settings update that drops the legacy switch where it was on, which is what "Agent needs
 * input" and "Agent task complete" now mean for sessions outside Seal; null when there is nothing
 * to drop. Off is kept: folding it into those two would silence chats and terminal agents too.
 */
export function migrateLiveSessionsNotify(
  settings: Pick<LiveSessionSettings, 'liveSessionsNotify'>
): { liveSessionsNotify: undefined } | null {
  return settings.liveSessionsNotify === true ? { liveSessionsNotify: undefined } : null
}
