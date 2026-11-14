import type { LiveSession } from './live-session-types'

/** The Seal panes that are a session record; a pane's hook status is that session's status source. */
export function liveSessionPaneKeys(
  sessions: readonly Pick<LiveSession, 'inputRoutes'>[]
): Set<string> {
  const keys = new Set<string>()
  for (const session of sessions) {
    for (const route of session.inputRoutes) {
      if (route.kind === 'seal-pane') {
        keys.add(route.paneKey)
      }
    }
  }
  return keys
}
