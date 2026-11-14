import {
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { isFreshNonDoneAgentStatus } from '../../../../../shared/agent-status/contracts/agent-status-freshness'
import type { AgentStatusEntry } from '../../../../../shared/agent-status/contracts/agent-status-types'
import { resolveAgentStatusWorktreeId } from '../../../../../shared/agent-status/identity/agent-status-worktree-attribution'
import { getTabIdToWorktreeId } from '@/lib/workspace/tabs/tab-worktree-index'

export type MachineAgentSession = {
  paneKey: string
  worktreeId: string
  agentType: string | null
  state: AgentStatusEntry['state']
  prompt: string
}

/** Groups live (fresh, unfinished) agent sessions by the machine their workspace runs on. */
export function groupLiveAgentSessionsByMachine(
  agentStatusByPaneKey: Readonly<Record<string, AgentStatusEntry>> | null | undefined,
  tabsByWorktree: Parameters<typeof getTabIdToWorktreeId>[0],
  machineForWorktree: (worktreeId: string) => ExecutionHostId,
  now: number
): Map<ExecutionHostId, MachineAgentSession[]> {
  const result = new Map<ExecutionHostId, MachineAgentSession[]>()
  const entries = Object.entries(agentStatusByPaneKey ?? {}).filter(([, entry]) =>
    isFreshNonDoneAgentStatus(entry, now)
  )
  if (entries.length === 0) {
    return result
  }
  const worktreeIdByTabId = getTabIdToWorktreeId(tabsByWorktree)
  for (const [paneKey, entry] of entries) {
    const worktreeId = resolveAgentStatusWorktreeId(entry, worktreeIdByTabId)
    if (!worktreeId) {
      continue
    }
    const machineId = machineForWorktree(worktreeId)
    const sessions = result.get(machineId) ?? []
    sessions.push({
      paneKey,
      worktreeId,
      agentType: entry.agentType ?? null,
      state: entry.state,
      prompt: entry.prompt
    })
    result.set(machineId, sessions)
  }
  return result
}

/** A merged machine owns workspaces opened through either of its transports. */
export function groupSessionsByMachine(
  machines: readonly MachineSummary[],
  sessionsByHost: ReadonlyMap<ExecutionHostId, MachineAgentSession[]>
): Map<MachineId, MachineAgentSession[]> {
  const result = new Map<MachineId, MachineAgentSession[]>()
  for (const machine of machines) {
    const hosts = new Set<ExecutionHostId>([machine.executionHostId])
    if (machine.sshTargetId) {
      hosts.add(toSshExecutionHostId(machine.sshTargetId))
    }
    if (machine.runtimeEnvironmentId) {
      hosts.add(toRuntimeExecutionHostId(machine.runtimeEnvironmentId))
    }
    const sessions = [...hosts].flatMap((host) => sessionsByHost.get(host) ?? [])
    if (sessions.length > 0) {
      result.set(machine.id, sessions)
    }
  }
  return result
}
