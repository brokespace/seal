import { structuredAgentSessionPaneKey } from '../agent-session/view/structured-agent-session-projection'
import type { LiveSession } from './live-session-types'

/** The pane key tab attention, agent rows and hook status know a session's surface by; null for an external one. */
export function liveSessionPaneKeyOf({ surface }: Pick<LiveSession, 'surface'>): string | null {
  if (surface.kind === 'chat') {
    return structuredAgentSessionPaneKey(surface.tabId, surface.sessionId)
  }
  return surface.kind === 'cli' ? surface.paneKey : null
}
