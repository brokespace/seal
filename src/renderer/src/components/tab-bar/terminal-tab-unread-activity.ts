import {
  readAgentAttentionUnreadReason,
  type ReadableAgentAttentionUnread
} from '@/attention/agent-attention-contract'

/** Bell or unacked agent completion — same sources the tab strip and floating launcher use. */
export function terminalTabHasUnreadActivity({
  terminalTabId,
  unreadTerminalTabs,
  unreadAgentCompletionPanes
}: {
  terminalTabId: string
  unreadTerminalTabs: Record<string, ReadableAgentAttentionUnread>
  unreadAgentCompletionPanes: Record<string, ReadableAgentAttentionUnread>
}): boolean {
  return (
    readAgentAttentionUnreadReason(unreadTerminalTabs[terminalTabId]) !== null ||
    hasUnreadAgentCompletionForTerminalTab(unreadAgentCompletionPanes, terminalTabId)
  )
}

// Why: production writes replace this map; WeakMap supports retained snapshots without pinning them.
let unreadAgentCompletionTabIdsBySnapshot = new WeakMap<
  Record<string, ReadableAgentAttentionUnread>,
  ReadonlySet<string>
>()

function getUnreadAgentCompletionTabIds(
  unreadAgentCompletionPanes: Record<string, ReadableAgentAttentionUnread>
): ReadonlySet<string> {
  const cached = unreadAgentCompletionTabIdsBySnapshot.get(unreadAgentCompletionPanes)
  if (cached) {
    return cached
  }

  // Why: every mounted tab runs this selector per store write; index each immutable marker snapshot once.
  const tabIds = new Set<string>()
  for (const paneKey of Object.keys(unreadAgentCompletionPanes)) {
    if (!unreadAgentCompletionPanes[paneKey]) {
      continue
    }
    const separatorIndex = paneKey.indexOf(':')
    tabIds.add(separatorIndex === -1 ? paneKey : paneKey.slice(0, separatorIndex))
  }
  unreadAgentCompletionTabIdsBySnapshot.set(unreadAgentCompletionPanes, tabIds)
  return tabIds
}

/** Match pane-level unread completion markers to their owning terminal tab. */
export function hasUnreadAgentCompletionForTerminalTab(
  unreadAgentCompletionPanes: Record<string, ReadableAgentAttentionUnread> | undefined,
  tabId: string
): boolean {
  return unreadAgentCompletionPanes
    ? getUnreadAgentCompletionTabIds(unreadAgentCompletionPanes).has(tabId)
    : false
}

export function resetUnreadAgentCompletionTabIdsCacheForTest(): void {
  unreadAgentCompletionTabIdsBySnapshot = new WeakMap()
}
