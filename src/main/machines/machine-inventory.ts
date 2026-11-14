import { hostname } from 'node:os'
import { buildMachineSummaries, type MachineSummary } from '../../shared/machines/machine-summaries'
import type { MachineOs } from '../../shared/machines/machine-types'
import type { SshConnectionState } from '../../shared/ssh-types'
import { getRuntimeEnvironmentStatusSnapshots } from '../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { getSshConnectionManager } from '../ssh/targets/ssh-target-registry'
import { listMachineViews } from './machine-services'

function localOs(): MachineOs {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
}

/** The same machine list the desktop's Machines tab shows, built from this host's own registries. */
export function listMachineSummaries(): MachineSummary[] {
  const sshStates = new Map<string, SshConnectionState>()
  for (const [targetId, state] of getSshConnectionManager()?.getAllStates() ?? []) {
    sshStates.set(targetId, state)
  }
  return buildMachineSummaries({
    localName: hostname(),
    localOs: localOs(),
    machines: listMachineViews(),
    sshStates,
    runtimeStatuses: new Map(
      getRuntimeEnvironmentStatusSnapshots().map((snapshot) => [snapshot.environmentId, snapshot])
    )
  })
}
