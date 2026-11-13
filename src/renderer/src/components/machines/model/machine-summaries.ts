import {
  LOCAL_EXECUTION_HOST_ID,
  toRuntimeExecutionHostId,
  toSshExecutionHostId
} from '../../../../../shared/execution-host'
import type { MachineId, MachineOs } from '../../../../../shared/machines/machine-types'
import type { SshConnectionState, SshTarget } from '../../../../../shared/ssh-types'
import { isVmToolSshConfigTarget } from '../../../../../shared/ssh-target-source'
import type { PublicKnownRuntimeEnvironment } from '../../../../../shared/remote-runtime/host-catalog/runtime-environments'
import type { RuntimeHostStatusSnapshot } from '../../../../../shared/remote-runtime/host-status/runtime-host-status'

export type MachineStatus = 'online' | 'connecting' | 'offline' | 'error'

export type MachineSummary = {
  id: MachineId
  kind: 'local' | 'ssh' | 'runtime'
  label: string
  /** `user@host:port`, or the runtime's machine name. */
  address: string | null
  status: MachineStatus
  statusDetail: string | null
  os: MachineOs | null
  sshTargetId: string | null
  runtimeEnvironmentId: string | null
  /** SSH host whose Orca runtime is also paired. */
  hasRuntime: boolean
}

function sshAddress(target: SshTarget): string {
  const host = target.host || target.configHost || target.label
  const user = target.username ? `${target.username}@` : ''
  const port = target.port && target.port !== 22 ? `:${target.port}` : ''
  return `${user}${host}${port}`
}

type SshStateInput = Pick<SshConnectionState, 'status' | 'error' | 'remotePlatform'>
type RuntimeEnvironmentInput = Pick<PublicKnownRuntimeEnvironment, 'id' | 'name'> & {
  sshAccess?: { sshTargetId: string }
}

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

function runtimeStatus(snapshot: RuntimeHostStatusSnapshot | undefined): {
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
  sshTargets: readonly SshTarget[]
  sshStates: ReadonlyMap<string, SshStateInput>
  runtimeEnvironments: readonly RuntimeEnvironmentInput[]
  runtimeStatuses: ReadonlyMap<string, RuntimeHostStatusSnapshot>
}

/** This computer first, then SSH hosts, then runtimes not already reachable over SSH. */
export function buildMachineSummaries(inputs: MachineSummaryInputs): MachineSummary[] {
  const runtimeBySshTarget = new Map<string, RuntimeEnvironmentInput>()
  for (const environment of inputs.runtimeEnvironments) {
    if (environment.sshAccess?.sshTargetId) {
      runtimeBySshTarget.set(environment.sshAccess.sshTargetId, environment)
    }
  }
  const local: MachineSummary = {
    id: LOCAL_EXECUTION_HOST_ID,
    kind: 'local',
    label: inputs.localName,
    address: null,
    status: 'online',
    statusDetail: null,
    os: inputs.localOs,
    sshTargetId: null,
    runtimeEnvironmentId: null,
    hasRuntime: false
  }
  const ssh = inputs.sshTargets
    // Server-owned internal hops and VM tools' own hosts are plumbing, not machines the user added.
    .filter((target) => !target.owner && !isVmToolSshConfigTarget(target))
    .map((target): MachineSummary => {
      const state = inputs.sshStates.get(target.id)
      const { status, detail } = sshMachineStatus(state)
      return {
        id: toSshExecutionHostId(target.id),
        kind: 'ssh',
        label: target.label || sshAddress(target),
        address: sshAddress(target),
        status,
        statusDetail: detail,
        os: osFromPlatform(state?.remotePlatform),
        sshTargetId: target.id,
        runtimeEnvironmentId: runtimeBySshTarget.get(target.id)?.id ?? null,
        hasRuntime: runtimeBySshTarget.has(target.id)
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  const sshIds = new Set(inputs.sshTargets.map((target) => target.id))
  const runtimes = inputs.runtimeEnvironments
    .filter(
      (environment) => !environment.sshAccess || !sshIds.has(environment.sshAccess.sshTargetId)
    )
    .map((environment): MachineSummary => {
      const snapshot = inputs.runtimeStatuses.get(environment.id)
      const { status, detail } = runtimeStatus(snapshot)
      return {
        id: toRuntimeExecutionHostId(environment.id),
        kind: 'runtime',
        label: environment.name,
        address: snapshot?.status?.machineName ?? null,
        status,
        statusDetail: detail,
        os: osFromPlatform(snapshot?.status?.hostPlatform),
        sshTargetId: null,
        runtimeEnvironmentId: environment.id,
        hasRuntime: true
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
  return [local, ...ssh, ...runtimes]
}
