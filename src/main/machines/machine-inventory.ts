import { hostname } from 'node:os'
import { getAppEnvironment } from '../../shared/app-environment'
import { buildMachineSummaries, type MachineSummary } from '../../shared/machines/machine-summaries'
import type { MachineOs } from '../../shared/machines/machine-types'
import { listEnvironments } from '../../shared/remote-runtime/host-store/runtime-environment-store'
import type { SshConnectionState } from '../../shared/ssh-types'
import { publicRuntimeEnvironmentWithHostKey } from '../ipc/runtime-environments/runtime-environment-host-key'
import { getRuntimeEnvironmentStatusSnapshots } from '../ipc/runtime-environments/runtime-environment-request-connections'
import {
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../ssh/targets/ssh-target-registry'
import { isGatedOffWslHost } from '../wsl/host-lifecycle/wsl-host-gate'

function localOs(): MachineOs {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
}

/** The same machine list the desktop's Machines tab shows, built from this host's own registries. */
export function listMachineSummaries(): MachineSummary[] {
  const sshStates = new Map<string, SshConnectionState>()
  for (const [targetId, state] of getSshConnectionManager()?.getAllStates() ?? []) {
    sshStates.set(targetId, state)
  }
  const runtimeEnvironments = listEnvironments(getAppEnvironment().getPath('userData'))
    .filter((environment) => !isGatedOffWslHost(environment))
    .map(publicRuntimeEnvironmentWithHostKey)
  return buildMachineSummaries({
    localName: hostname(),
    localOs: localOs(),
    sshTargets: getSshTargetRegistryStore()?.listTargets() ?? [],
    sshStates,
    runtimeEnvironments,
    runtimeStatuses: new Map(
      getRuntimeEnvironmentStatusSnapshots().map((snapshot) => [snapshot.environmentId, snapshot])
    )
  })
}
