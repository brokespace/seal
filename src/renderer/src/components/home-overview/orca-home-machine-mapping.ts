import {
  LOCAL_EXECUTION_HOST_ID,
  RUNTIME_OWNED_SSH_TARGET_ID_PREFIX,
  toSshExecutionHostId
} from '../../../../shared/execution-host'
import type { HostMemory } from '../../../../shared/process-stats-types'
import type { SshConnectionState, SshConnectionStatus } from '../../../../shared/ssh-types'
import type { HomeMachine, HomeMachineStatus } from './home-overview-model'

export function homeMachineStatusFromSsh(
  status: SshConnectionStatus | undefined
): HomeMachineStatus {
  switch (status) {
    case 'connected':
      return 'online'
    case 'connecting':
    case 'deploying-relay':
    case 'reconnecting':
      return 'connecting'
    case 'auth-failed':
    case 'reconnection-failed':
    case 'error':
      return 'error'
    case 'disconnected':
    case undefined:
      return 'offline'
  }
}

export function orcaLocalMachine(input: {
  label: string
  host: HostMemory | null | undefined
  /** Windows reports a zero load average, which would read as idle. */
  loadAverageSupported: boolean
}): HomeMachine {
  const { host } = input
  const load =
    host && input.loadAverageSupported && host.cpuCoreCount > 0
      ? host.loadAverage1m / host.cpuCoreCount
      : undefined
  return {
    id: LOCAL_EXECUTION_HOST_ID,
    label: input.label,
    kind: 'local',
    status: 'online',
    ...(load !== undefined ? { load } : {}),
    ...(host ? { memoryUsedPercent: host.memoryUsagePercent } : {})
  }
}

export function orcaSshMachines(
  labels: ReadonlyMap<string, string>,
  states: ReadonlyMap<string, SshConnectionState>
): HomeMachine[] {
  const machines: HomeMachine[] = []
  for (const [targetId, label] of labels) {
    // Recipe VMs are plumbing owned by runtime environments, not machines the user added.
    if (targetId.startsWith(RUNTIME_OWNED_SSH_TARGET_ID_PREFIX)) {
      continue
    }
    const state = states.get(targetId)
    const status = homeMachineStatusFromSsh(state?.status)
    machines.push({
      id: toSshExecutionHostId(targetId),
      label: label || targetId,
      kind: 'ssh',
      status,
      ...(status === 'error' && state?.error ? { error: state.error } : {})
    })
  }
  return machines.sort((a, b) => a.label.localeCompare(b.label))
}
