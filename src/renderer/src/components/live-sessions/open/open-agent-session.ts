import { openLiveSessionKeepingTab } from '../menu/live-session-menu-effects'
import type { LiveSessionOpenMode } from '../workspace/live-session-tabs-store'

export type AgentSessionOpenMode = LiveSessionOpenMode

/** The one way to show a session by its record id: a preview tab, kept as a tab, or in a split. */
export function openAgentSession(sessionId: string, mode: AgentSessionOpenMode = 'preview'): void {
  openLiveSessionKeepingTab(sessionId, mode)
}
