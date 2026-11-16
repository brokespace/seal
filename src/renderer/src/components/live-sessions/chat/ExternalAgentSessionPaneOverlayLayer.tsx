import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWindowBackdropActive } from '@/app-shell/appearance/window-backdrop'
import NativeChatView from '@/components/native-chat/NativeChatView'
import { RetainedPaneHost } from '@/components/tab-group/RetainedPaneHost'
import { useAppStore } from '@/store'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'
import { EXTERNAL_AGENT_SESSION_TAB } from '../open/external-agent-session-tab'

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

const ExternalAgentSessionOverlaySlot = memo(function ExternalAgentSessionOverlaySlot({
  tab,
  worktreeId,
  isActive,
  isFocusedGroup,
  hasSplitGroups,
  onFocusOwningGroup
}: {
  tab: Tab
  worktreeId: string
  isActive: boolean
  isFocusedGroup: boolean
  hasSplitGroups: boolean
  onFocusOwningGroup: (groupId: string) => void
}): React.JSX.Element {
  const backdropActive = useWindowBackdropActive()
  return (
    <RetainedPaneHost
      groupId={tab.groupId}
      isVisible={isActive}
      // Why not over a backdrop: dimming the translucent chat also dims its text.
      dimmed={hasSplitGroups && !isFocusedGroup && !backdropActive}
      // Why the chat's attribute: the chat appearance styles select the pane by it.
      data-structured-agent-session-overlay-tab-id={tab.id}
      onFocusOwningGroup={onFocusOwningGroup}
    >
      <NativeChatView
        mode="external"
        tabId={tab.id}
        groupId={tab.groupId}
        worktreeId={worktreeId}
        sessionId={tab.entityId}
        isVisible={isActive}
        isFocusedGroup={isFocusedGroup}
      />
    </RetainedPaneHost>
  )
})

/** The bodies of a workspace's external session tabs, kept mounted like its chats. */
const ExternalAgentSessionPaneOverlayLayer = memo(function ExternalAgentSessionPaneOverlayLayer({
  worktreeId,
  isWorktreeActive,
  isWorktreeFocused = isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
  /** Keyboard ownership; a workspace can be on screen without it. */
  isWorktreeFocused?: boolean
}): React.JSX.Element {
  const { unifiedTabs, groups, activeGroupId } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS,
      activeGroupId: state.activeGroupIdByWorktree[worktreeId]
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )
  const groupActiveTabById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.activeTabId] as const)),
    [groups]
  )
  const externalTabs = useMemo(
    () => unifiedTabs.filter((tab) => tab.contentType === EXTERNAL_AGENT_SESSION_TAB),
    [unifiedTabs]
  )

  return (
    <>
      {externalTabs.map((tab) => {
        const isActive = isWorktreeActive && groupActiveTabById.get(tab.groupId) === tab.id
        return (
          <ExternalAgentSessionOverlaySlot
            key={tab.id}
            tab={tab}
            worktreeId={worktreeId}
            isActive={isActive}
            isFocusedGroup={isWorktreeFocused && isActive && tab.groupId === activeGroupId}
            hasSplitGroups={groups.length > 1}
            onFocusOwningGroup={focusOwningGroup}
          />
        )
      })}
    </>
  )
})

export default ExternalAgentSessionPaneOverlayLayer
