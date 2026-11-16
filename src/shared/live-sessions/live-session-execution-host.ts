import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../execution-host'
import type { LiveSessionMachine } from './live-session-types'

/** The execution host a session's machine is reached on now, SSH or Seal server alike: its workspaces live there. */
export function liveSessionExecutionHost(machine: LiveSessionMachine): ExecutionHostId {
  const current = machine.executionHostId ? parseExecutionHostId(machine.executionHostId) : null
  if (current) {
    return current.id
  }
  return machine.kind === 'remote' ? toSshExecutionHostId(machine.hostId) : LOCAL_EXECUTION_HOST_ID
}
