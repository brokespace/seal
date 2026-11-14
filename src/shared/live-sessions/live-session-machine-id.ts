import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import type { LiveSessionMachine } from './live-session-types'

/** The Seal machine a session runs on: `local`, `machine:<id>`, or (before unification) its host id. */
export function liveSessionMachineId(
  machine: Pick<LiveSessionMachine, 'hostId' | 'machineId' | 'executionHostId'> & { kind: string }
): string {
  if (machine.machineId) {
    return machine.machineId
  }
  if (machine.executionHostId) {
    return machine.executionHostId
  }
  if (machine.kind === 'local') {
    return LOCAL_EXECUTION_HOST_ID
  }
  // Older hosts sent `runtime` sessions already carrying their `runtime:<id>` host id.
  return machine.kind === 'runtime' ? machine.hostId : toSshExecutionHostId(machine.hostId)
}
