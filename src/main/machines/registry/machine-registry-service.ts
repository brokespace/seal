import { app, BrowserWindow } from 'electron'
import { getAppEnvironment } from '../../../shared/app-environment'
import { failInterruptedServerInstalls } from '../../../shared/machines/machine-server-install'
import { MACHINE_IPC } from '../../../shared/machines/machine-types'
import { isVmToolSshConfigTarget } from '../../../shared/ssh-target-source'
import {
  getOrcadSshDeployment,
  getRuntimeSshAccess
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import { listEnvironments } from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { getRuntimeEnvironmentStatusSnapshot } from '../../ipc/runtime-environments/connections/runtime-environment-request-connections'
import { connectRuntimeEnvironmentOnRequest } from '../../ipc/runtime-environments/connectivity/runtime-environment-connectivity-handlers'
import { setInstallLockWaits } from '../../managed-server/install/install-lock-wait-policy'
import {
  onSealServiceOutcome,
  setSealServiceWishes
} from '../../managed-server/service/seal-service-policy'
import { setDirectSshConnectPolicy } from '../../ssh/host-server/ssh-direct-connect-policy'
import {
  connectRegisteredSshTarget,
  getSshConnectionManager,
  getSshTargetRegistryStore,
  listRegisteredSshTargets
} from '../../ssh/targets/ssh-target-registry'
import { isGatedOffWslHost } from '../../wsl/host-lifecycle/wsl-host-gate'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection } from '../connection/machine-connection'
import { ServerMachineConnection } from '../connection/server-machine-connection'
import { SshMachineConnection } from '../connection/ssh-machine-connection'
import { openSystemSshMachineShell } from '../connection/system-ssh-machine-shell'
import type { MachineAccess } from '../machine-services'
import { createRuntimeMachineChannel } from '../runtime/runtime-machine-channel'
import {
  machineServerInstallActivity,
  onMachineServerInstallActivityChanged
} from '../server-install/machine-server-install-activity'
import { createMachineServerSetup } from '../server-install/machine-server-setup-outcomes'
import { MachineRegistry, type MachineRegistryEnvironment } from './machine-registry'
import { readMachineStore, writeMachineStore } from './machine-store'

let registry: MachineRegistry | null = null
let local: MachineConnection | null = null

function broadcastMachinesChanged(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try {
        window.webContents.send(MACHINE_IPC.changed)
      } catch {
        // A renderer can disappear between isDestroyed() and send().
      }
    }
  }
}

function environmentFacts(userDataPath: string): MachineRegistryEnvironment[] {
  return listEnvironments(userDataPath)
    .filter((environment) => !isGatedOffWslHost(environment))
    .map((environment) => {
      const preferred =
        environment.endpoints.find((endpoint) => endpoint.id === environment.preferredEndpointId) ??
        environment.endpoints[0]
      return {
        id: environment.id,
        name: environment.name,
        endpoints: environment.endpoints.map((endpoint) => endpoint.endpoint),
        linkedSshTargetId: getRuntimeSshAccess(environment)?.sshTargetId ?? null,
        managedSshTargetId: getOrcadSshDeployment(environment)?.sshTargetId ?? null,
        machineName:
          getRuntimeEnvironmentStatusSnapshot(environment.id)?.status?.machineName ?? null,
        preferredEndpoint: preferred?.endpoint ?? null
      }
    })
}

function createRegistry(userDataPath: string): MachineRegistry {
  return new MachineRegistry({
    readStore: () => readMachineStore(userDataPath),
    writeStore: (store) => writeMachineStore(userDataPath, store),
    // Owned targets back managed servers and VMs; VM tools' own hosts are plumbing, not machines.
    sshTargets: () =>
      listRegisteredSshTargets()
        .filter((target) => !target.owner && !isVmToolSshConfigTarget(target))
        .map((target) => ({
          id: target.id,
          label: target.label,
          host: target.host,
          configHost: target.configHost,
          username: target.username,
          port: target.port,
          identityFile: target.identityFile,
          jumpHost: target.jumpHost
        })),
    environments: () => environmentFacts(userDataPath),
    local: () => (local ??= createLocalMachineConnection()),
    sshConnection: (machineId, targetId) =>
      new SshMachineConnection(machineId, {
        link: () => getSshConnectionManager()?.getConnection(targetId) ?? null,
        connect: async () => {
          await connectRegisteredSshTarget(targetId)
        },
        openSystemShell: (prelude, options, handlers) => {
          const target = getSshTargetRegistryStore()?.getTarget(targetId)
          if (!target) {
            throw new Error('This machine has no SSH details')
          }
          return openSystemSshMachineShell(target, prelude, options, handlers)
        }
      }),
    serverConnection: (machineId, environmentId) =>
      new ServerMachineConnection(machineId, {
        channel: createRuntimeMachineChannel(userDataPath, environmentId),
        isConnected: () =>
          getRuntimeEnvironmentStatusSnapshot(environmentId)?.transport === 'ready',
        connect: async () => {
          await connectRuntimeEnvironmentOnRequest(userDataPath, environmentId)
        }
      }),
    changed: broadcastMachinesChanged,
    now: Date.now,
    serverInstallActivity: machineServerInstallActivity,
    log: (message, error) =>
      error === undefined
        ? console.info(message)
        : console.warn(message, error instanceof Error ? error.message : error)
  })
}

export function getMachineRegistry(): MachineRegistry {
  if (!registry) {
    registry = createRegistry(app.getPath('userData'))
    const created = registry
    created.edit(failInterruptedServerInstalls)
    const setup = createMachineServerSetup(created, () => getAppEnvironment().getVersion())
    onMachineServerInstallActivityChanged(broadcastMachinesChanged)
    setDirectSshConnectPolicy(setup.connectsDirectly, setup.outcomes)
    setInstallLockWaits(setup.installLockWait)
    setSealServiceWishes(setup.serviceWish)
    onSealServiceOutcome(setup.serviceOutcome)
  }
  return registry
}

/** How the desktop reaches machines: through its registry, which always holds this computer. */
export function desktopMachineAccess(): MachineAccess {
  return {
    views: () => getMachineRegistry().list(),
    connection: (machineId) => getMachineRegistry().connection(machineId),
    liveSessionSources: () => getMachineRegistry().liveSessionSources()
  }
}

/** Every machine with a usable transport, this computer first. */
export function listMachineConnections(): {
  machineId: string
  name: string
  connection: MachineConnection
}[] {
  const machines = getMachineRegistry()
  machines.reconcile()
  const result = [
    { machineId: 'local', name: 'This computer', connection: machines.connection('local') }
  ]
  for (const view of machines.list()) {
    result.push({ machineId: view.id, name: view.name, connection: machines.connection(view.id) })
  }
  return result
}
