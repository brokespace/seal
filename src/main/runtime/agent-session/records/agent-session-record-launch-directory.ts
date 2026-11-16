import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'
import { isFloatingWorkspaceId } from '../../../../shared/floating-workspace-worktree'

/** First pin wins: resolving workspace settings again must not silently move an existing conversation. */
export function pinAgentSessionRecordLaunchDirectory(
  record: AgentSessionRecord,
  launchDirectory: string,
  now: number
): AgentSessionRecord {
  if (record.launchDirectory !== undefined) {
    return record
  }
  return { ...record, launchDirectory, updatedAt: now }
}

/** A floating chat's folder, or the workspace subfolder a chat was founded in. Any other stored folder is an older build's pin: the worktree/folder id names that chat's place. */
export function agentSessionPinnedLaunchDirectory(
  record: Pick<AgentSessionRecord, 'launchDirectory' | 'launchDirectoryInWorkspace' | 'location'>
): string | undefined {
  return isFloatingWorkspaceId(record.location.workspaceId) || record.launchDirectoryInWorkspace
    ? record.launchDirectory
    : undefined
}
