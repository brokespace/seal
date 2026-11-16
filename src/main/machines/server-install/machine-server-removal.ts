/** "Remove Seal server": stops the server, returns the machine to plain SSH, then takes the service off the host. */
import type { MachineRecord } from '../../../shared/machines/machine-record'
import {
  DECLINED_SERVER_INSTALL,
  installedServerKeeper,
  returnMachineToPlainSsh,
  serverServiceRemains,
  setMachineServerInstall,
  stoppedServerInstall
} from '../../../shared/machines/machine-server-install'
import type { MachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import { removeSealService } from '../../managed-server/service/seal-service-removal'
import { getManagedServerActions } from '../../runtime/hosts/management/managed-server-actions-registry'
import type { MachineRegistry } from '../registry/machine-registry'
import { getMachineRegistry } from '../registry/machine-registry-service'
import {
  latestSealServiceOutcome,
  machineServerInstallActivity,
  noteBlockedServerMove,
  noteSealServiceOutcome,
  whileServerIsRemoved
} from './machine-server-install-activity'
import { sshSessionTo } from './machine-ssh-session'
import { sealDeployedServer } from './seal-deployed-server'

const TERMINALS_RUNNING_CODE = 'orcad_decommission_terminals_running'

export async function removeServerFromMachine(machineId: MachineId): Promise<MachineView> {
  const registry = getMachineRegistry()
  const record = registry.record(machineId)
  if (!record) {
    throw new Error('Machine not found')
  }
  const { sshTargetId } = record
  const environment = sealDeployedServer(record)
  // An earlier removal stopped the server; only its service is left to take off the machine.
  const serviceOnly = !environment && serverServiceRemains(record.serverInstall)
  if (!sshTargetId || (!environment && !serviceOnly)) {
    throw new Error('Seal did not install a server on this machine, so there is none to remove')
  }
  if (machineServerInstallActivity.installing(record.id)) {
    throw new Error('Seal server is being installed on this machine')
  }
  const actions = getManagedServerActions()
  if (environment && !actions) {
    throw new Error('Seal servers cannot be managed yet. Try again in a moment.')
  }
  // The service wish stays off throughout, so the stop's wake of the server reinstalls nothing.
  await whileServerIsRemoved(sshTargetId, async () => {
    if (environment && actions) {
      // The stop needs the server running, so the service that keeps it comes off afterwards.
      const stopped = await actions.stop(environment.id)
      if (stopped.outcome === 'refused') {
        throw new Error(
          stopped.code === TERMINALS_RUNNING_CODE
            ? 'Terminals are still running through Seal server on this machine. Close them, then remove Seal server again.'
            : stopped.reason
        )
      }
      returnToPlainSsh(registry, record, sshTargetId)
    }
    await removeServiceOverSsh(
      sshTargetId,
      registry.record(machineId)?.serverInstall?.manager !== undefined
    )
    registry.edit((store, now) =>
      setMachineServerInstall(store, record.id, DECLINED_SERVER_INSTALL, now)
    )
  })
  return registry.view(machineId)
}

/** The record keeps the service on it until the host confirms it is gone. */
function returnToPlainSsh(
  registry: MachineRegistry,
  record: MachineRecord,
  sshTargetId: string
): void {
  const keeper =
    latestSealServiceOutcome(sshTargetId)?.manager ?? installedServerKeeper(record.serverInstall)
  noteSealServiceOutcome(sshTargetId, null)
  noteBlockedServerMove(sshTargetId, null)
  registry.reconcile()
  registry.edit((store, now) =>
    returnMachineToPlainSsh(store, record.id, stoppedServerInstall(keeper), now)
  )
}

/** The stop hung up the host's session, so this connects again, now over plain SSH. */
async function removeServiceOverSsh(sshTargetId: string, registered: boolean): Promise<void> {
  try {
    await removeSealService(await sshSessionTo(sshTargetId))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const left = registered ? 'is still registered' : 'may still be registered'
    throw new Error(
      `Seal server was stopped and this machine is back on SSH, but its service ${left} on the machine. ${reason}`,
      { cause: error }
    )
  }
}
