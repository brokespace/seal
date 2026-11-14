import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../execution-host'
import type { MachineSummary } from '../machines/machine-summaries'
import type { LiveSession, LiveSessionMachine } from './live-session-types'

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
