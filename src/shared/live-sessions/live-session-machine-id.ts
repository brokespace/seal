import { LOCAL_EXECUTION_HOST_ID, toSshExecutionHostId } from '../execution-host'
import type { LiveSessionMachine } from './live-session-types'

/** The Seal machine a session runs on: `local`, `machine:<id>`, or (before unification) its host id. */
export function liveSessionMachineId(machine: LiveSessionMachine): string {
  if (machine.machineId) {
    return machine.machineId
  }
  if (machine.executionHostId) {
    return machine.executionHostId
  }
  return machine.kind === 'local' ? LOCAL_EXECUTION_HOST_ID : toSshExecutionHostId(machine.hostId)
}
