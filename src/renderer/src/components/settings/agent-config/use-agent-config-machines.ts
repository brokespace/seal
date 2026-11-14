import { useMemo } from 'react'
import { useAppStore } from '@/store/index'
import {
  getLocalExecutionHostLabel,
  getRepoExecutionHostId
} from '../../../../../shared/execution-host'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { AgentConfigCopyProject } from '../../agent-config/model/agent-config-context'
import { useMachinesInventory } from '../../machines/model/use-machines-inventory'

/** Every machine, and every project as a place configuration can be copied to. */
export function useAgentConfigMachines(): {
  machines: MachineSummary[]
  projects: AgentConfigCopyProject[]
} {
  const { machines } = useMachinesInventory(getLocalExecutionHostLabel())
  const repos = useAppStore((state) => state.repos)
  const projects = useMemo(() => {
    const machineByHost = new Map(machines.map((machine) => [machine.executionHostId, machine.id]))
    return repos.flatMap((repo) => {
      const machineId = machineByHost.get(getRepoExecutionHostId(repo))
      return machineId ? [{ label: repo.displayName, path: repo.path, machineId }] : []
    })
  }, [machines, repos])
  return { machines, projects }
}
