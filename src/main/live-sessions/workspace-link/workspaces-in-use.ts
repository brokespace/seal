import { normalizeWorkspaceSessionKeyToWorkspaceId } from '../../../shared/workspace-scope'
import type { WorkspaceSessionState } from '../../../shared/workspace-session/workspace-session-state-types'
import { agentHookServer } from '../../agent-hooks/server/agent-hook-server'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { Store } from '../../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'

/** Activation and visit recency are left out: looking at a workspace is not using it. */
const TAB_FIELDS = [
  'tabsByWorktree',
  'unifiedTabs',
  'openFilesByWorktree',
  'browserTabsByWorktree',
  'clientHostedBrowserPagesByWorktree'
] as const satisfies readonly (keyof WorkspaceSessionState)[]

/** Ids of the workspaces that hold a tab, an agent pane or a chat. */
export function workspacesInUse(
  store: Pick<Store, 'getWorkspaceSession' | 'getWorkspaceSessionHostIds'>
): Set<string> {
  const inUse = new Set<string>()
  for (const hostId of store.getWorkspaceSessionHostIds()) {
    const session = store.getWorkspaceSession(hostId)
    for (const field of TAB_FIELDS) {
      for (const [key, tabs] of Object.entries(session[field] ?? {})) {
        if (tabs.length > 0) {
          inUse.add(normalizeWorkspaceSessionKeyToWorkspaceId(key))
        }
      }
    }
  }
  for (const row of agentHookServer.getStatusSnapshot()) {
    if (row.worktreeId) {
      inUse.add(row.worktreeId)
    }
  }
  for (const record of getStructuredAgentSessionHost()?.deps.store.listRecords() ?? []) {
    if (record.location.workspaceId) {
      inUse.add(record.location.workspaceId)
    }
  }
  return inUse
}

/** Ids of the workspaces with a terminal, whether or not a saved tab shows it. */
export async function workspacesWithTerminals(
  runtime: Pick<OrcaRuntimeService, 'listTerminals'>
): Promise<Set<string>> {
  const { terminals } = await runtime.listTerminals(undefined, Number.MAX_SAFE_INTEGER)
  return new Set(terminals.map((terminal) => terminal.worktreeId))
}
