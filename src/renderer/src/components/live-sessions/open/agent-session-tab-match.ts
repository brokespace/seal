import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { Tab } from '../../../../../shared/tab-types'
import { toHostSessionPaneKey } from '../../../../../shared/workspace-layout/terminal-surface-id'
import { EXTERNAL_AGENT_SESSION_TAB } from './external-agent-session-tab'

export type TabContent = Pick<Tab, 'contentType' | 'entityId'>

export function isChatTabOf(tab: TabContent, chatSessionId: string): boolean {
  return tab.contentType === 'agent-session' && tab.entityId === chatSessionId
}

export function isTerminalTabOfPane(tab: TabContent, paneKey: string): boolean {
  const leafId = paneKey.slice(paneKey.lastIndexOf(':') + 1)
  return (
    tab.contentType === 'terminal' &&
    // A paired host's record names the pane by that host's tab, which this window mirrors under its own id.
    toHostSessionPaneKey(`${tab.entityId}:${leafId}`) === toHostSessionPaneKey(paneKey)
  )
}

/** Whether a tab is where a session shows: its chat, its terminal, or the tab of its record. */
export function isSessionTab(tab: TabContent, session: LiveSession): boolean {
  const { surface } = session
  return (
    (tab.contentType === EXTERNAL_AGENT_SESSION_TAB && tab.entityId === session.id) ||
    (surface.kind === 'chat' && isChatTabOf(tab, surface.sessionId)) ||
    (surface.kind === 'cli' && isTerminalTabOfPane(tab, surface.paneKey))
  )
}
