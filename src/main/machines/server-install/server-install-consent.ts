/** Seal puts its server on an SSH host only after the user confirmed the install there; every other connect is a plain SSH session. */
import {
  activeMachineConnection,
  type MachineRecord
} from '../../../shared/machines/machine-record'
import { awaitsServerInstall } from '../../../shared/machines/machine-server-install'
import { getSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import type { MachineRegistry } from '../registry/machine-registry'
import { hostRunsNoOwnSealServe } from './machine-server-install-activity'
import { sealServerDeployedOverSshTarget } from './seal-deployed-server'

/** Null where Machines does not run, as in `seal serve`: nothing is confirmed there. */
type Machines = Pick<MachineRegistry, 'recordForSshTarget' | 'reconcile'> | null

export const SERVER_INSTALL_NEEDS_CONFIRMATION =
  'Seal server is installed from the machine’s page. Open Machines, choose this machine, then choose “Install Seal server”.'

/** SSH details saved a moment ago have no machine until the machines are rebuilt from them. */
function machineOf(machines: Machines, sshTargetId: string): MachineRecord | null {
  if (!machines) {
    return null
  }
  const record = machines.recordForSshTarget(sshTargetId)
  if (record) {
    return record
  }
  machines.reconcile()
  return machines.recordForSshTarget(sshTargetId)
}

/** Only the confirmed install sets the record waiting, and the host must have answered in this app run that it runs no server of the user's own. */
function installIsConfirmed(record: MachineRecord | null, sshTargetId: string): boolean {
  return awaitsServerInstall(record?.serverInstall) && hostRunsNoOwnSealServe(sshTargetId)
}

/** A VM that a recipe started for Seal has no machine and no page to confirm on; starting it asked for the server. */
function isRecipeVm(sshTargetId: string): boolean {
  return getSshTargetRegistryStore()?.getTarget(sshTargetId)?.owner?.type === 'on-demand-runtime'
}

/** False for a connect that gets a plain SSH session and puts nothing on the host. */
export function sshConnectUsesSealServer(machines: Machines, sshTargetId: string): boolean {
  const record = machineOf(machines, sshTargetId)
  if (installIsConfirmed(record, sshTargetId)) {
    return true
  }
  if (!sealServerDeployedOverSshTarget(sshTargetId)) {
    return isRecipeVm(sshTargetId)
  }
  return !record || activeMachineConnection(record) !== 'ssh'
}

/** For a deploy asked for outside a connect: it may change a server Seal already deployed or finish a confirmed install, and nothing else. */
export function assertServerDeployIsConfirmed(machines: Machines, sshTargetId: string): void {
  if (
    !sealServerDeployedOverSshTarget(sshTargetId) &&
    !installIsConfirmed(machineOf(machines, sshTargetId), sshTargetId)
  ) {
    throw new Error(SERVER_INSTALL_NEEDS_CONFIRMATION)
  }
}
