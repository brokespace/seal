import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import { parsePaneKey } from '../../shared/workspace-layout/stable-pane-id'

export type CliTabTitleRuntime = {
  agentTransitions: { latestRow(paneKey: string): AgentStatusIpcPayload | null }
  /** Names a tab the way a client's rename does, with or without a window open. */
  setMobileSessionTabProps(
    worktree: string,
    props: { tabId: string; customTitle: string | null }
  ): Promise<unknown>
}

/** Gives the terminal tab of a CLI session its row's name; null goes back to the tab's own title. */
export function renameCliSessionTab(
  runtime: CliTabTitleRuntime,
  paneKey: string,
  title: string | null,
  log: (message: string, error?: unknown) => void
): void {
  const worktreeId = runtime.agentTransitions.latestRow(paneKey)?.worktreeId
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!worktreeId || !tabId) {
    return
  }
  void runtime
    .setMobileSessionTabProps(`id:${worktreeId}`, { tabId, customTitle: title })
    .catch((error: unknown) => log('[session-titles] renaming a terminal tab failed', error))
}
