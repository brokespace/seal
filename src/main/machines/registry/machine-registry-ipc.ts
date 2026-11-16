import { MachineConnectionTypeSchema } from '../../../shared/machines/machine-record'
import {
  adoptedServerInstall,
  setMachineServerInstall
} from '../../../shared/machines/machine-server-install'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import { removeServerFromMachine } from '../server-install/machine-server-removal'
import { learnOwnServerServices } from '../server-install/own-server-service'
import { startMachineServerUpgradeReconnects } from '../server-install/machine-server-upgrade-reconnect'
import { recheckServerServiceWarnings } from '../server-install/server-service-warning-recheck'
import {
  declineServerInstall,
  installServerOnSshMachine
} from '../server-install/ssh-machine-server-install'
import { getMachineRegistry } from './machine-registry-service'

function connectionTypeOf(value: unknown): 'ssh' | 'server' {
  const parsed = MachineConnectionTypeSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error('Choose SSH or Seal server')
  }
  return parsed.data
}

function linkOf(
  args: Record<string, unknown>
): { sshTargetId: string } | { environmentId: string } {
  if (typeof args.sshTargetId === 'string' && args.sshTargetId) {
    return { sshTargetId: args.sshTargetId }
  }
  return { environmentId: requireString(args.environmentId, 'environmentId') }
}

export function registerMachineRegistryHandlers(handle: MachineInvokeRegistrar): void {
  // Created here so the SSH connect policy is in place before the window restores its connections.
  getMachineRegistry()

  handle(MACHINE_IPC.list, () => {
    const views = getMachineRegistry().list()
    learnOwnServerServices(views)
    recheckServerServiceWarnings(views)
    return views
  })

  handle(MACHINE_IPC.setConnection, (args) =>
    getMachineRegistry().setConnection(
      machineIdOf(args.machineId),
      connectionTypeOf(args.connection)
    )
  )

  handle(MACHINE_IPC.renameMachine, (args) =>
    getMachineRegistry().rename(machineIdOf(args.machineId), requireString(args.name, 'name'))
  )

  handle(MACHINE_IPC.adopt, (args) => {
    const link = linkOf(args)
    const registry = getMachineRegistry()
    const adopted = registry.adopt({
      link,
      connection: connectionTypeOf(args.connection),
      ...(typeof args.name === 'string' && args.name.trim() ? { name: args.name } : {}),
      ...(typeof args.machineId === 'string' ? { machineId: machineIdOf(args.machineId) } : {})
    })
    // Only a machine's own SSH details can carry Seal's server; a paired server is the user's.
    const install =
      'sshTargetId' in link
        ? adoptedServerInstall(args.serverInstall, args.serviceManager, Date.now())
        : null
    if (!install) {
      return adopted
    }
    registry.edit((store, now) => setMachineServerInstall(store, adopted.recordId, install, now))
    return registry.view(adopted.id)
  })

  handle(MACHINE_IPC.installServer, (args) =>
    installServerOnSshMachine({
      machineId: machineIdOf(args.machineId),
      ...(args.manager === 'pm2' || args.manager === 'auto' ? { manager: args.manager } : {}),
      ...(args.moveAnyway === true ? { moveAnyway: true } : {})
    })
  )

  handle(MACHINE_IPC.declineServerInstall, (args) =>
    declineServerInstall(machineIdOf(args.machineId))
  )

  handle(MACHINE_IPC.removeServer, (args) => removeServerFromMachine(machineIdOf(args.machineId)))

  handle(MACHINE_IPC.separate, (args) => getMachineRegistry().separate(machineIdOf(args.machineId)))

  handle(MACHINE_IPC.connect, async (args) => {
    const machineId = machineIdOf(args.machineId)
    await getMachineRegistry().connection(machineId).connect()
    void getMachineRegistry().probeIdentity(machineId)
  })

  startMachineServerUpgradeReconnects()
}
