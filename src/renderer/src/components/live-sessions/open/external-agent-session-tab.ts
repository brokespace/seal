import { requestNativeChatComposerFocus } from '@/components/native-chat/composer/focus/native-chat-composer-focus-intent'
import { useAppStore } from '@/store/index'
import { resolveEditorPreviewIntent } from '@/store/slices/editor/tabs/editor-preview-tab-setting'
import { patchTab } from '@/store/slices/tabs/tab-group-state'
import type { AppState } from '@/store/types'
import type { AgentSessionAgentId } from '../../../../../shared/live-sessions/adapters/agent-session-agent-ids'
import type { Tab } from '../../../../../shared/tab-types'
import type { AgentSessionOpenMode } from './agent-session-open-mode'

/** The workspace tab of a session started outside Seal; its entityId is the live-session record id. */
export const EXTERNAL_AGENT_SESSION_TAB = 'external-agent-session'

type TabsState = Pick<AppState, 'unifiedTabsByWorktree'>

function externalTabs(state: TabsState, sessionId: string): Tab[] {
  return Object.values(state.unifiedTabsByWorktree).flatMap((tabs) =>
    tabs.filter(
      (tab) => tab.contentType === EXTERNAL_AGENT_SESSION_TAB && tab.entityId === sessionId
    )
  )
}

export function findExternalAgentSessionTab(state: TabsState, sessionId: string): Tab | null {
  return externalTabs(state, sessionId)[0] ?? null
}

/** Shows a tab in its group and makes that group the workspace's focused one; never switches workspace. */
function showTab(tab: Tab, keepPreview: boolean): void {
  const state = useAppStore.getState()
  state.focusGroup(tab.worktreeId, tab.groupId)
  state.activateTab(tab.id, { worktreeId: tab.worktreeId, preservePreview: keepPreview })
  state.setActiveTabType('agent-session', tab.worktreeId)
}

/** A click on the tab in the strip: selecting a preview does not keep it, only a double click does. */
export function activateExternalAgentSessionTab(worktreeId: string, tabId: string): boolean {
  const tab = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.id === tabId && candidate.contentType === EXTERNAL_AGENT_SESSION_TAB
  )
  if (!tab) {
    return false
  }
  showTab(tab, true)
  requestNativeChatComposerFocus(tab.id)
  return true
}

/**
 * Shows the session's tab, creating it in `worktreeId` when it has none. The workspace itself is
 * not switched to. Returns the tab id, or null when the group to split from is gone.
 */
export function openExternalAgentSessionTab(args: {
  worktreeId: string
  sessionId: string
  mode: AgentSessionOpenMode
  label: string
  agent: AgentSessionAgentId
}): string | null {
  const state = useAppStore.getState()
  const open = findExternalAgentSessionTab(state, args.sessionId)
  if (open) {
    showTab(open, args.mode === 'preview')
    return open.id
  }
  const init = { entityId: args.sessionId, label: args.label, agentSessionAgent: args.agent }
  const sourceGroupId = state.activeGroupIdByWorktree[args.worktreeId]
  const created =
    args.mode === 'split' && sourceGroupId
      ? state.createUnifiedTabInSplit(
          args.worktreeId,
          EXTERNAL_AGENT_SESSION_TAB,
          { sourceGroupId, splitDirection: 'right' },
          init
        )
      : state.createUnifiedTab(args.worktreeId, EXTERNAL_AGENT_SESSION_TAB, {
          ...init,
          isPreview: resolveEditorPreviewIntent(state, args.mode === 'preview')
        })
  if (!created) {
    return null
  }
  // Creation selects the tab in its group; the workspace's shown surface is set here.
  useAppStore.getState().focusGroup(args.worktreeId, created.groupId)
  useAppStore.getState().setActiveTabType('agent-session', args.worktreeId)
  return created.id
}

/** The same session under the id its transcript gave it keeps its tab. */
export function renameExternalAgentSessionTabs(fromSessionId: string, toSessionId: string): void {
  if (fromSessionId === toSessionId) {
    return
  }
  for (const tab of externalTabs(useAppStore.getState(), fromSessionId)) {
    useAppStore.setState(
      (state) => patchTab(state.unifiedTabsByWorktree, tab.id, { entityId: toSessionId }) ?? state
    )
  }
}

/** Keeps the strip's title in step with the session's; a name the user gave the tab still wins. */
export function setExternalAgentSessionTabLabel(sessionId: string, label: string): void {
  const state = useAppStore.getState()
  for (const tab of externalTabs(state, sessionId)) {
    if (tab.label !== label) {
      state.setTabLabel(tab.id, label)
    }
  }
}
