import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../agent-session/view/structured-agent-session-projection'
import { structuredSessionIdFromNotificationPane } from '../agent-session/view/structured-session-notification-pane'
import type { AgentSessionSurface, LiveSession } from './live-session-types'

function chatSurface(sessionId: string): AgentSessionSurface {
  return { kind: 'chat', sessionId, tabId: structuredAgentSessionTabId(sessionId) }
}

/**
 * Where a session runs and who owns it. A registry that does not set `surface` yet says it through
 * its input routes: a chat's hook row is listed as a Seal pane under the chat's own pane key.
 */
export function liveSessionSurfaceOf(
  session: Pick<LiveSession, 'surface' | 'inputRoutes'>
): AgentSessionSurface {
  if (session.surface) {
    return session.surface
  }
  for (const route of session.inputRoutes) {
    if (route.kind === 'structured') {
      return chatSurface(route.sessionId)
    }
    if (route.kind === 'seal-pane') {
      const chat = structuredSessionIdFromNotificationPane(route.paneKey)
      return chat ? chatSurface(chat) : { kind: 'cli', paneKey: route.paneKey }
    }
  }
  return { kind: 'external' }
}

/** The pane key tab attention, agent rows and hook status know a session's surface by; null for an external one. */
export function liveSessionPaneKeyOf(
  session: Pick<LiveSession, 'surface' | 'inputRoutes'>
): string | null {
  const surface = liveSessionSurfaceOf(session)
  if (surface.kind === 'chat') {
    return structuredAgentSessionPaneKey(surface.tabId, surface.sessionId)
  }
  return surface.kind === 'cli' ? surface.paneKey : null
}
