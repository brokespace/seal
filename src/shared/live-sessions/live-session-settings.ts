export type LiveSessionSettings = {
  /** Off keeps `seal shell-integration` installed but runs claude/codex unwrapped on every host. */
  liveSessionsWrapAgents?: boolean
  /** Minutes a Seal-owned session may sit idle with nothing attached before Seal ends it; 0 never. */
  liveSessionsIdleReapMinutes?: number
}
