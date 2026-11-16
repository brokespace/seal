import { MachineConnectionTypeSchema } from '../../../shared/machines/machine-record'
import {
  declineMachineServerInstall,
  MACHINE_SERVICE_MANAGERS
} from '../../../shared/machines/machine-server-install'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import type { MachineServiceManagerChoice } from '../../../shared/machines/machine-view'
import { machineIdOf, requireString, type MachineInvokeRegistrar } from '../machine-ipc-args'
import { removeServerFromMachine } from '../server-install/machine-server-removal'
import { learnOwnSealServes } from '../server-install/own-seal-serve-check'
import { reuseOwnServerOnSshMachine } from '../server-install/own-server-reuse'
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

const SERVICE_MANAGER_CHOICES: readonly MachineServiceManagerChoice[] = [
  'auto',
  ...MACHINE_SERVICE_MANAGERS
]

function serviceManagerChoiceOf(value: unknown): MachineServiceManagerChoice | null {
  return SERVICE_MANAGER_CHOICES.find((choice) => choice === value) ?? null
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
    const registry = getMachineRegistry()
    const views = registry.list()
    learnOwnSealServes(registry, views)
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
    // An install is asked for through installServer, which checks the host first; here only "no" is kept.
    if (!('sshTargetId' in link) || args.serverInstall !== 'never') {
      return adopted
    }
    registry.edit(declineMachineServerInstall(adopted.recordId))
    return registry.view(adopted.id)
  })

  handle(MACHINE_IPC.installServer, (args) => {
    const manager = serviceManagerChoiceOf(args.manager)
    return installServerOnSshMachine({
      machineId: machineIdOf(args.machineId),
      ...(manager ? { manager } : {}),
      ...(args.moveAnyway === true ? { moveAnyway: true } : {})
    })
  })

  handle(MACHINE_IPC.reuseOwnServer, (args) =>
    reuseOwnServerOnSshMachine(machineIdOf(args.machineId))
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
