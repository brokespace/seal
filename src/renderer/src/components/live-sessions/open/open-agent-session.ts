import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { activateTabAndFocusPane } from '@/lib/workspace/tabs/activate-tab-and-focus-pane'
import { activateWorkspaceTabPaletteResult } from '@/lib/workspace/search/tabs/workspace-tab-palette-activation'
import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { Tab } from '../../../../../shared/tab-types'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { liveSessionTitle } from '../live-session-presentation'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import type { SplitViewTabPlace } from '@/components/split-view/split-view-types'
import { windowAgentSessionWorktreeId } from '../window-sessions/window-agent-session'
import type { AgentSessionOpenMode } from './agent-session-open-mode'
import { isChatTabOf, isTerminalTabOfPane } from './agent-session-tab-match'
import { agentSessionTabWorktreeId } from './agent-session-workspace'
import {
  activateExternalAgentSessionTab,
  findExternalAgentSessionTab,
  openExternalAgentSessionTab
} from './external-agent-session-tab'

export type { AgentSessionOpenMode } from './agent-session-open-mode'

// Opening a session shows that session alone: an empty workspace gets no default shell beside it.
export const SESSION_OPEN_ACTIVATION = { providesInitialSurface: true } as const

function findTab(matches: (tab: Tab) => boolean): Tab | null {
  for (const tabs of Object.values(useAppStore.getState().unifiedTabsByWorktree)) {
    const tab = tabs.find(matches)
    if (tab) {
      return tab
    }
  }
  return null
}

function showWorkspaceTab(tab: Tab, contentType: 'agent-session' | 'terminal'): boolean {
  const shown = activateWorkspaceTabPaletteResult({
    worktreeId: tab.worktreeId,
    tabId: tab.id,
    contentType,
    entityId: tab.entityId,
    groupId: tab.groupId,
    ...(tab.executionHostId ? { executionHostId: tab.executionHostId } : {})
  })
  return shown.status !== 'failed'
}

function showChatTab(chatSessionId: string): boolean {
  const tab = findTab((t) => isChatTabOf(t, chatSessionId))
  return tab !== null && showWorkspaceTab(tab, 'agent-session')
}

function showTerminalPane(paneKey: string): boolean {
  const leafId = paneKey.slice(paneKey.lastIndexOf(':') + 1)
  const tab = findTab((t) => isTerminalTabOfPane(t, paneKey))
  if (!tab || !showWorkspaceTab(tab, 'terminal')) {
    return false
  }
  // Makes the pane its split's active one, as a click on it does.
  activateTabAndFocusPane(tab.entityId, leafId, {
    ackPaneKeyOnSuccess: `${tab.entityId}:${leafId}`,
    flashFocusedPane: true,
    scrollToBottomIfOutputSinceLastView: true
  })
  return true
}

/** A session only this window lists has no record a tab could read: its workspace is all there is to show once its pane is gone. */
function showOwnWorkspace(session: LiveSession | null): boolean {
  const worktreeId = session && windowAgentSessionWorktreeId(session)
  if (!worktreeId) {
    return false
  }
  activateAndRevealWorkspace(worktreeId, SESSION_OPEN_ACTIVATION)
  return true
}

/**
 * The record's own tab: where a session started outside Seal shows, and any session whose tab is
 * gone. One with no workspace opens at `place`, or without one in the workspace in view.
 */
function showExternalTab(
  sessionId: string,
  session: LiveSession | null,
  mode: AgentSessionOpenMode,
  place: SplitViewTabPlace | undefined
): boolean {
  const state = useAppStore.getState()
  const open = findExternalAgentSessionTab(state, sessionId)
  const own = agentSessionTabWorktreeId(sessionId, session)
  const worktreeId = own ?? place?.worktreeId ?? state.activeWorktreeId
  if (!worktreeId || (!open && !session)) {
    return false
  }
  if (!activateAndRevealWorkspace(worktreeId, SESSION_OPEN_ACTIVATION)) {
    return true
  }
  if (!session) {
    return open !== null && activateExternalAgentSessionTab(worktreeId, open.id)
  }
  return (
    openExternalAgentSessionTab({
      worktreeId,
      sessionId,
      mode,
      ...(!own && place && place.zone !== 'center' ? { edge: place.zone } : {}),
      label: liveSessionTitle(session),
      agent: session.provider
    }) !== null
  )
}

/**
 * The one way to show a session: a preview tab, kept as a tab, or in a split. A row passes the
 * record it shows, which the registry may not list yet; anything else names it by its record id.
 * `place` is where a drop or the menu put it, which only a session with no workspace goes by.
 */
export function openAgentSession(
  target: string | LiveSession,
  mode: AgentSessionOpenMode = 'preview',
  place?: SplitViewTabPlace
): void {
  const id = liveSessionRegistryStore.currentId(typeof target === 'string' ? target : target.id)
  const session =
    liveSessionRegistryStore.getState().sessions.find((s) => s.id === id) ??
    (typeof target === 'string' ? null : target)
  liveSessionMarksStore.reveal(id)
  const surface = session?.surface
  const shown =
    (surface?.kind === 'chat' && showChatTab(surface.sessionId)) ||
    (surface?.kind === 'cli' && showTerminalPane(surface.paneKey)) ||
    showOwnWorkspace(session) ||
    showExternalTab(id, session, mode, place)
  if (!shown) {
    toast.message(
      translate(
        'seal.sessionTab.open.noWorkspace',
        'Open a workspace first: this session has none to open in.'
      )
    )
  }
}
