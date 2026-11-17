import {
  openItemsInSplitView,
  workspaceSplitViewItem
} from '@/components/split-view/split-view-commands'
import { startTabPointerDrag } from '@/components/split-view/tab-pointer-drag'
import type { SplitViewZone } from '@/components/split-view/split-view-types'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { agentSessionTabWorktreeId } from './agent-session-workspace'
import { openAgentSession } from './open-agent-session'

/**
 * A session row's drag to the panes, from its pointer-down. Every session drags: its workspace
 * lands in the pane with its tab in front, and one with no workspace joins the workspace the pane
 * already shows.
 */
export function startAgentSessionRowDrag(
  event: { button: number; clientX: number; clientY: number },
  row: HTMLElement,
  session: LiveSession
): void {
  startTabPointerDrag(event, row, agentSessionTabWorktreeId(session.id, session), (place) =>
    openAgentSession(session, 'tab', place)
  )
}

/** The menu twin of that drag, onto the focused pane. */
export function openAgentSessionInSplitView(session: LiveSession, zone: SplitViewZone): void {
  const worktreeId = agentSessionTabWorktreeId(session.id, session)
  if (worktreeId) {
    openItemsInSplitView([workspaceSplitViewItem({ id: worktreeId })], zone)
  }
  openAgentSession(session, 'tab', { worktreeId, zone })
}
