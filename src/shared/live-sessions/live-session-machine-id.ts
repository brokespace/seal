import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../execution-host'
import type { MachineSummary } from '../machines/machine-summaries'
import type { LiveSession, LiveSessionMachine } from './live-session-types'

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

/** A machine by every id its sessions may name it: one machine however Seal reaches it. */
export type LiveSessionMachineIdentity = { id: string } & Partial<
  Pick<MachineSummary, 'executionHostId' | 'sshTargetId' | 'runtimeEnvironmentId'>
>

/** Its sessions on either transport: a merged machine is one machine however Seal reaches it. */
export function liveSessionsOnMachine<T extends Pick<LiveSession, 'machine'>>(
  sessions: readonly T[],
  machine: LiveSessionMachineIdentity
): T[] {
  const ids = new Set<string>([machine.id])
  if (machine.executionHostId) {
    ids.add(machine.executionHostId)
  }
  if (machine.sshTargetId) {
    ids.add(toSshExecutionHostId(machine.sshTargetId))
  }
  if (machine.runtimeEnvironmentId) {
    ids.add(toRuntimeExecutionHostId(machine.runtimeEnvironmentId))
  }
  return sessions.filter(
    (session) =>
      ids.has(liveSessionMachineId(session.machine)) ||
      (session.machine.executionHostId !== undefined && ids.has(session.machine.executionHostId))
  )
}
