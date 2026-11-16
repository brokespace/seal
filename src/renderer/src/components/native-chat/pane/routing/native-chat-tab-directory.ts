import { isFloatingWorkspaceId } from '../../../../../../shared/workspace/identity/floating-workspace-worktree'
import { resolveWorkspaceDirectory } from '@/lib/workspace/paths/workspace-directory'
import type { WorkspaceDirectoryState } from '@/lib/workspace/paths/workspace-directory'
import { firstRegisteredStructuredChatTab } from '@/lib/agent-session/tab-identity/structured-chat-tab-index'
import type { ExecutionHostId } from '../../../../../../shared/execution-host/execution-host'
import type { StructuredSessionLaunchDirectory } from '@/store/slices/agent-status/structured-session-launch-directories'

type NativeChatDirectoryTab = {
  id: string
  entityId?: string
  contentType?: string
  agentSessionAgent?: unknown
}

export type NativeChatTabDirectoryState = WorkspaceDirectoryState & {
  unifiedTabsByWorktree?: Record<string, readonly NativeChatDirectoryTab[]>
  structuredSessionLaunchDirectoryByTabId?: Record<string, StructuredSessionLaunchDirectory>
}

export type NativeChatTabDirectoryResolution =
  | { status: 'resolved'; directory: string }
  /** A floating structured chat whose pinned folder the status feed has not delivered yet. */
  | { status: 'awaiting-pin' }
  | { status: 'unavailable' }

/** Use the host-pinned directory for floating structured chats; settings can move after launch. Other tabs resolve by workspace id, or by the subfolder their chat started in. */
export function resolveNativeChatTabDirectoryResolution(
  state: NativeChatTabDirectoryState,
  tabId: string,
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): NativeChatTabDirectoryResolution {
  // The status bridge's own predicate, so no tab waits on a pin it never mirrors.
  const chatTab = firstRegisteredStructuredChatTab(state.unifiedTabsByWorktree?.[worktreeId], tabId)
  const structuredTab = isFloatingWorkspaceId(worktreeId) ? chatTab : undefined
  if (!structuredTab) {
    // A workspace chat started in a subfolder runs there, so its relative paths resolve there too.
    const subfolder = state.structuredSessionLaunchDirectoryByTabId?.[tabId]
    const directory =
      chatTab && subfolder && subfolder.sessionId === chatTab.entityId
        ? subfolder.launchDirectory
        : resolveWorkspaceDirectory(state, worktreeId, executionHostId)
    return directory ? { status: 'resolved', directory } : { status: 'unavailable' }
  }
  // Why: a floating chat only runs on the local host, so no other host holds its folder.
  if (executionHostId && executionHostId !== 'local') {
    return { status: 'unavailable' }
  }
  const pinned = state.structuredSessionLaunchDirectoryByTabId?.[tabId]
  // A missing pin may still be loading; settings cannot prove where this session runs.
  return pinned && pinned.sessionId === structuredTab.entityId
    ? { status: 'resolved', directory: pinned.launchDirectory }
    : { status: 'awaiting-pin' }
}

export function resolveNativeChatTabDirectory(
  state: NativeChatTabDirectoryState,
  tabId: string,
  worktreeId: string,
  executionHostId?: ExecutionHostId | null
): string | null {
  const resolution = resolveNativeChatTabDirectoryResolution(
    state,
    tabId,
    worktreeId,
    executionHostId
  )
  return resolution.status === 'resolved' ? resolution.directory : null
}
