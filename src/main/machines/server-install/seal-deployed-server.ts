import { getAppEnvironment } from '../../../shared/app-environment'
import type { MachineRecord } from '../../../shared/machines/machine-record'
import { getOrcadSshDeployment } from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { getManagedOrcadFenceEnvironmentId } from '../../../shared/managed-orcad-ssh-owner'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'

type RuntimeEnvironment = ReturnType<typeof listEnvironments>[number]

/** The registered server this SSH target is held for, when Seal deployed it over the target; a connect through it installs nothing new. */
export function sealServerDeployedOverSshTarget(sshTargetId: string): RuntimeEnvironment | null {
  const environmentId = getManagedOrcadFenceEnvironmentId(
    getSshTargetRegistryStore()?.getTarget(sshTargetId)
  )
  return sealDeployedServer({ sshTargetId, environmentId })
}

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
