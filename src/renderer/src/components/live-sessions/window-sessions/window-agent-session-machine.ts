import type { DashboardAgentRow } from '@/components/dashboard/rows/dashboard-agent-row'
import { getExecutionHostIdForWorktree } from '@/lib/workspace/ownership/worktree-runtime-owner'
import { selectExecutionHostDisplayLabel } from '@/runtime/hosts/display/execution-host-display-label'
import { getAgentPaneExecutionHost } from '@/store/slices/agent-status/agent-pane-execution-host'
import type { AppState } from '@/store/types'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import type {
  LiveSession,
  LiveSessionMachine
} from '../../../../../shared/live-sessions/live-session-types'

const THIS_COMPUTER: LiveSessionMachine = {
  hostId: LOCAL_EXECUTION_HOST_ID,
  label: LOCAL_EXECUTION_HOST_ID,
  kind: 'local',
  machineId: LOCAL_EXECUTION_HOST_ID,
  executionHostId: LOCAL_EXECUTION_HOST_ID,
  connection: 'local'
}

function rowHost(state: AppState, row: DashboardAgentRow, worktreeId: string): ExecutionHostId {
  const host =
    row.rowSource === 'retained'
      ? state.retainedAgentsByPaneKey[row.paneKey]?.executionHostId
      : getAgentPaneExecutionHost(state, row.paneKey, row.entry, row.tab.ptyId)
  return host && host !== 'foreign' ? host : getExecutionHostIdForWorktree(state, worktreeId)
}

/** The machine a row's pane or chat runs on, as the registry names it wherever a record of that machine says. */
export function windowAgentSessionMachine(
  state: AppState,
  row: DashboardAgentRow,
  worktreeId: string,
  records: readonly LiveSession[]
): LiveSessionMachine {
  const hostId = rowHost(state, row, worktreeId)
  const parsed = parseExecutionHostId(hostId)
  if (!parsed || parsed.kind === 'local') {
    return THIS_COMPUTER
  }
  return (
    records.find((session) => session.machine.executionHostId === hostId)?.machine ?? {
      hostId,
      label: selectExecutionHostDisplayLabel(state, hostId),
      kind: 'remote',
      executionHostId: hostId,
      connection: parsed.kind === 'runtime' ? 'server' : 'ssh'
    }
  )
}
