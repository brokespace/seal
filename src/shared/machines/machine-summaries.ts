import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../execution-host'
import { LOCAL_MACHINE_ID, type MachineId, type MachineOs } from './machine-types'
import type { MachineView } from './machine-view'
import type { SshConnectionState } from '../ssh-types'
import type { RuntimeHostStatusSnapshot } from '../remote-runtime/host-status/runtime-host-status'

export type MachineStatus = 'online' | 'connecting' | 'offline' | 'error'

export type MachineSummary = {
  id: MachineId
  /** How Seal reaches it now; every feature behaves the same either way. */
  connection: 'local' | 'ssh' | 'server'
  label: string
  /** `user@host:port`, or the server's machine name. */
  address: string | null
  status: MachineStatus
  statusDetail: string | null
  os: MachineOs | null
  /** Stored SSH details, kept even while the machine uses its server. */
  sshTargetId: string | null
  /** Stored Seal server pairing, kept even while the machine uses SSH. */
  runtimeEnvironmentId: string | null
  /** Where workspaces and agents for this machine run. */
  executionHostId: ExecutionHostId
}

type SshStateInput = Pick<SshConnectionState, 'status' | 'error' | 'remotePlatform'>

export function sshMachineStatus(state: SshStateInput | undefined): {
  status: MachineStatus
  detail: string | null
} {
  switch (state?.status) {
    case 'connected':
      return { status: 'online', detail: null }
    case 'connecting':
    case 'deploying-relay':
    case 'reconnecting':
      return { status: 'connecting', detail: null }
    case 'auth-failed':
    case 'reconnection-failed':
    case 'error':
      return { status: 'error', detail: state.error ?? null }
    case 'disconnected':
    case undefined:
      return { status: 'offline', detail: null }
  }
}

function serverStatus(snapshot: RuntimeHostStatusSnapshot | undefined): {
  status: MachineStatus
  detail: string | null
} {
  if (!snapshot) {
    return { status: 'offline', detail: null }
  }
  if (snapshot.verification === 'blocked') {
    return { status: 'error', detail: snapshot.blockedReason ?? null }
  }
  if (snapshot.transport === 'ready' && snapshot.status) {
    return { status: 'online', detail: null }
  }
  if (snapshot.transport === 'connecting' || snapshot.verification === 'checking') {
    return { status: 'connecting', detail: null }
  }
  return { status: 'offline', detail: null }
}

function osFromPlatform(platform: string | undefined): MachineOs | null {
  return platform === 'linux' || platform === 'darwin' || platform === 'win32' ? platform : null
}

export type MachineSummaryInputs = {
  localName: string
  localOs: MachineOs | null
  machines: readonly MachineView[]
  sshStates: ReadonlyMap<string, SshStateInput>
  runtimeStatuses: ReadonlyMap<string, RuntimeHostStatusSnapshot>
}

export function summarizeMachine(
  machine: MachineView,
  inputs: Pick<MachineSummaryInputs, 'sshStates' | 'runtimeStatuses'>
): MachineSummary {
  const sshState = machine.ssh ? inputs.sshStates.get(machine.ssh.targetId) : undefined
  const snapshot = machine.server
    ? inputs.runtimeStatuses.get(machine.server.environmentId)
    : undefined
  const overSsh = machine.connection === 'ssh' && machine.ssh !== null
  const { status, detail } = overSsh ? sshMachineStatus(sshState) : serverStatus(snapshot)
  return {
    id: machine.id,
    connection: overSsh ? 'ssh' : 'server',
    label: machine.name,
    address:
      machine.ssh?.address ?? snapshot?.status?.machineName ?? machine.server?.endpoint ?? null,
    status,
    statusDetail: detail,
    os: osFromPlatform(sshState?.remotePlatform) ?? osFromPlatform(snapshot?.status?.hostPlatform),
    sshTargetId: machine.ssh?.targetId ?? null,
    runtimeEnvironmentId: machine.server?.environmentId ?? null,
    executionHostId:
      overSsh || !machine.server
        ? toSshExecutionHostId(machine.ssh?.targetId ?? machine.recordId)
        : toRuntimeExecutionHostId(machine.server.environmentId)
  }
}

/** This computer first, then every machine once, however it connects. */
export function buildMachineSummaries(inputs: MachineSummaryInputs): MachineSummary[] {
  const local: MachineSummary = {
    id: LOCAL_MACHINE_ID,
    connection: 'local',
    label: inputs.localName,
    address: null,
    status: 'online',
    statusDetail: null,
    os: inputs.localOs,
    sshTargetId: null,
    runtimeEnvironmentId: null,
    executionHostId: LOCAL_EXECUTION_HOST_ID
  }
  return [local, ...inputs.machines.map((machine) => summarizeMachine(machine, inputs))]
}
