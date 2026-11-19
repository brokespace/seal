import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AgentPluginInventory,
  AgentPluginMachineResult,
  AgentPluginTargets,
  AgentPluginView
} from '../../../../shared/agent-plugins/agent-plugin-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import { agentConfigApi, agentConfigErrorText } from '../agent-config/model/agent-config-client'

export type AgentPluginMachineState =
  | { kind: 'loading' }
  | { kind: 'ready'; inventory: AgentPluginInventory }
  | { kind: 'failed'; error: string }

/** One plugin across every machine whose ledger has it. */
export type AgentPluginFleetEntry = {
  name: string
  description: string
  byMachine: Map<MachineId, AgentPluginView>
  /** Every machine's record is given the same targets on each change. */
  targets: AgentPluginTargets
  listings: AgentPluginView['listings']
  enabled: boolean
}

export function failedMachineResult(
  machineId: MachineId,
  error: unknown
): AgentPluginMachineResult {
  return { machineId, ok: false, steps: [], record: null, error: agentConfigErrorText(error) }
}

/** Every online machine's plugin ledger, merged by plugin name. */
export function useAgentPluginsFleet(machines: readonly MachineSummary[]): {
  states: ReadonlyMap<MachineId, AgentPluginMachineState>
  entries: AgentPluginFleetEntry[]
  reload: () => void
} {
  const [states, setStates] = useState<ReadonlyMap<MachineId, AgentPluginMachineState>>(new Map())
  const [generation, setGeneration] = useState(0)
  const onlineIds = machines
    .filter((machine) => machine.status === 'online')
    .map((machine) => machine.id)
    .join('\n')
  const latest = useRef(0)

  useEffect(() => {
    const ids = onlineIds ? onlineIds.split('\n').filter(Boolean) : []
    const run = ++latest.current
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: built from MachineSummary ids above.
    const machineIds = ids as MachineId[]
    setStates(new Map(machineIds.map((id) => [id, { kind: 'loading' as const }])))
    for (const machineId of machineIds) {
      void agentConfigApi()
        .agentPluginInventory({ machineId })
        .then(
          (inventory): AgentPluginMachineState => ({ kind: 'ready', inventory }),
          (error: unknown): AgentPluginMachineState => ({
            kind: 'failed',
            error: agentConfigErrorText(error)
          })
        )
        .then((state) => {
          if (latest.current === run) {
            setStates((previous) => new Map(previous).set(machineId, state))
          }
        })
    }
  }, [onlineIds, generation])

  const entries = useMemo(() => {
    const byName = new Map<string, AgentPluginFleetEntry>()
    for (const [machineId, state] of states) {
      if (state.kind !== 'ready') {
        continue
      }
      for (const plugin of state.inventory.plugins) {
        const entry: AgentPluginFleetEntry = byName.get(plugin.name) ?? {
          name: plugin.name,
          description: plugin.description,
          byMachine: new Map(),
          targets: plugin.targets,
          listings: plugin.listings,
          enabled: false
        }
        entry.byMachine.set(machineId, plugin)
        entry.enabled = entry.enabled || plugin.enabled
        byName.set(plugin.name, entry)
      }
    }
    return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
  }, [states])

  const reload = useCallback(() => setGeneration((value) => value + 1), [])
  return { states, entries, reload }
}
