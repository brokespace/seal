import { getAppEnvironment } from '../../../shared/app-environment'
import type { MachineRecord } from '../../../shared/machines/machine-record'
import { getOrcadSshDeployment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'

type RuntimeEnvironment = ReturnType<typeof listEnvironments>[number]

/** The server Seal deployed over the machine's own SSH target; null when the user runs it or it has none. */
export function sealDeployedServer(
  record: Pick<MachineRecord, 'sshTargetId' | 'environmentId'>
): RuntimeEnvironment | null {
  const { sshTargetId, environmentId } = record
  if (!sshTargetId || !environmentId) {
    return null
  }
  const environment = listEnvironments(getAppEnvironment().getPath('userData')).find(
    (candidate) => candidate.id === environmentId
  )
  return environment && getOrcadSshDeployment(environment)?.sshTargetId === sshTargetId
    ? environment
    : null
}
