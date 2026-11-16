import type { AgentSessionRecord } from '../../../../shared/agent-session/lifecycle/agent-session-record'

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

/** A floating chat's folder or a workspace subfolder; a chat at its worktree/folder root records none, since the id names that place. */
export function agentSessionPinnedLaunchDirectory(
  record: Pick<AgentSessionRecord, 'launchDirectory' | 'location'>
): string | undefined {
  return record.launchDirectory
}
