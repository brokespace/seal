/** Installs Seal's server on a machine the user reaches over SSH, or turns a running one into a service. */
import { getAppEnvironment } from '../../../shared/app-environment'
import {
  awaitsServerInstall,
  DECLINED_SERVER_INSTALL,
  keptRunningServerInstall,
  pendingServerInstall,
  preferredServiceManager,
  setMachineServerInstall,
  type MachineServiceManager
} from '../../../shared/machines/machine-server-install'
import type { MachineId } from '../../../shared/machines/machine-types'
import type {
  MachineServerInstallRequest,
  MachineView
} from '../../../shared/machines/machine-view'
import { restartManagedOrcadEnvironment } from '../../managed-server/lifecycle/orcad-managed-launch-session'
import { hasSealServiceManager } from '../../managed-server/service/seal-service-removal'
import { getSshHostServerStatus } from '../../ssh/host-server/ssh-host-server-status'
import {
  connectRegisteredSshTarget,
  getSshConnectionManager,
  getSshTargetRegistryStore
} from '../../ssh/targets/ssh-target-registry'
import type { MachineRegistry } from '../registry/machine-registry'
import { getMachineRegistry } from '../registry/machine-registry-service'
import { failedInstallServiceCleanup } from './failed-install-service-cleanup'
import {
  joinMachineServerInstall,
  latestSealServiceOutcome,
  machineServerInstallActivity,
  noteBlockedServerMove,
  whileManagerIsWished
} from './machine-server-install-activity'
import { onPlainSshSession } from './machine-ssh-session'
import { checkHostForOwnSealServe } from './own-seal-serve-check'
import { keepOwnServerRunning } from './own-server-service'
import { sealDeployedServer } from './seal-deployed-server'

const NO_SERVICE_MANAGER =
  'This machine has no service manager that can keep Seal server running, so it still starts when Seal connects. Seal can use PM2 or a systemd user service: install PM2 on the machine, then try again.'

/** `auto` asks for no manager; no choice at all keeps the one the machine's record asks for. */
function askedManager(
  request: MachineServerInstallRequest,
  machine: MachineView
): MachineServiceManager | null {
  if (!request.manager) {
    return preferredServiceManager(machine.serverInstall)
  }
  return request.manager === 'auto' ? null : request.manager
}

/**
 * Resolves the machine as it ended up: through its server, over plain SSH with the reason the
 * install failed, or unchanged because its user already runs a server there. Rejects only when SSH
 * itself cannot connect or answer, or a running server cannot restart.
 */
export function installServerOnSshMachine(
  request: MachineServerInstallRequest
): Promise<MachineView> {
  const registry = getMachineRegistry()
  const machine = registry.view(request.machineId)
  // Read again once the install is over: the view it resolves with still says `installing`.
  return joinMachineServerInstall(machine.recordId, () =>
    machine.serverInstallAction === 'keep-running'
      ? keepRunning(registry, machine, request)
      : installOverSsh(registry, machine, request)
  ).then(() => registry.view(machine.id))
}

/** Seal's own server restarts into a service; a server the user runs installs its own. */
async function keepRunning(
  registry: MachineRegistry,
  machine: MachineView,
  request: MachineServerInstallRequest
): Promise<MachineView> {
  const sshTargetId = machine.ssh?.targetId
  const environmentId = machine.server?.environmentId
  if (!sshTargetId || !environmentId) {
    throw new Error('This machine has no Seal server to keep running')
  }
  if (sealDeployedServer({ sshTargetId, environmentId })) {
    return keepServerRunning(registry, machine, request)
  }
  await keepOwnServerRunning(sshTargetId)
  return registry.view(machine.id)
}

export function declineServerInstall(machineId: MachineId): MachineView {
  const registry = getMachineRegistry()
  const machine = registry.view(machineId)
  if (machineServerInstallActivity.installing(machine.recordId)) {
    throw new Error('Seal server is being installed on this machine')
  }
  if (machine.ssh) {
    noteBlockedServerMove(machine.ssh.targetId, null)
  }
  registry.edit((store, now) =>
    setMachineServerInstall(store, machine.recordId, DECLINED_SERVER_INSTALL, now)
  )
  return registry.view(machineId)
}

async function installOverSsh(
  registry: MachineRegistry,
  machine: MachineView,
  request: MachineServerInstallRequest
): Promise<MachineView> {
  if (machine.connection !== 'ssh') {
    throw new Error(
      machine.serverInstallAction === 'own-server'
        ? 'Seal did not install the server on this machine. Run "seal serve service install" on the machine to keep it running.'
        : 'Seal server already runs on this machine'
    )
  }
  if (!machine.ssh) {
    throw new Error('This machine has no SSH details')
  }
  if (machine.serverInstall?.state === 'installed' && machine.serverInstall.policy === 'auto') {
    throw new Error(
      'Seal server is already installed on this machine. Switch its connection to Seal server to use it.'
    )
  }
  const targetId = machine.ssh.targetId
  // Asked before anything changes: a server the user already runs here is theirs, and Seal adds no second one.
  const ownServe = await onPlainSshSession(
    targetId,
    (session) => checkHostForOwnSealServe(registry, targetId, session),
    (found) => found === null
  )
  if (ownServe) {
    noteBlockedServerMove(targetId, null)
    registry.edit((store, now) =>
      setMachineServerInstall(store, machine.recordId, DECLINED_SERVER_INSTALL, now)
    )
    return registry.view(machine.id)
  }
  if (request.moveAnyway) {
    allowMoveLeavingSavedItems(targetId)
  }
  askHostAgain(targetId)
  await failedInstallServiceCleanup(targetId)
  noteBlockedServerMove(targetId, null)
  const prefer = askedManager(request, machine)
  registry.edit((store, now) =>
    setMachineServerInstall(store, machine.recordId, pendingServerInstall(prefer, now), now)
  )
  await connectRegisteredSshTarget(targetId)
  // A connect that began before the record changed is joined, and that one installed nothing.
  const install = registry.recordForSshTarget(targetId)?.serverInstall
  if (awaitsServerInstall(install) && !install?.reason && !getSshHostServerStatus(targetId)) {
    await connectRegisteredSshTarget(targetId)
  }
  return registry.view(machine.id)
}

/** A host found unable to run the server is remembered per app version; an install the user asks for checks it again. */
function askHostAgain(sshTargetId: string): void {
  const targets = getSshTargetRegistryStore()
  if (targets?.getTarget(sshTargetId)?.managedServerUnavailable) {
    targets.updateTarget(sshTargetId, { managedServerUnavailable: undefined })
  }
}

/** The same store update as upstream's "Move anyway"; the next connect reads it and clears it. */
function allowMoveLeavingSavedItems(sshTargetId: string): void {
  const targets = getSshTargetRegistryStore()
  if (!targets?.getTarget(sshTargetId)) {
    throw new Error('This machine has no SSH details')
  }
  targets.updateTarget(sshTargetId, {
    managedServerLeaveBehind: { confirmedAt: new Date().toISOString() }
  })
}

/** A restart launches the server again, and a launch on a machine that wants a service installs it. */
async function keepServerRunning(
  registry: MachineRegistry,
  machine: MachineView,
  request: MachineServerInstallRequest
): Promise<MachineView> {
  const environmentId = machine.server?.environmentId
  const targetId = machine.ssh?.targetId
  if (!environmentId || !targetId) {
    throw new Error('This machine has no Seal server to keep running')
  }
  // Checked first: the restart below would stop the server and start it the same way.
  const connection = getSshConnectionManager()?.getConnection(targetId)
  const prefer = askedManager(request, machine)
  if (connection && !(await hasSealServiceManager(connection, prefer ? { prefer } : {}))) {
    throw new Error(NO_SERVICE_MANAGER)
  }
  registry.edit((store, now) =>
    setMachineServerInstall(
      store,
      machine.recordId,
      keptRunningServerInstall(machine.serverInstall, now),
      now
    )
  )
  const restart = (): ReturnType<typeof restartManagedOrcadEnvironment> =>
    restartManagedOrcadEnvironment(getAppEnvironment().getPath('userData'), environmentId)
  const result = await (prefer ? whileManagerIsWished(targetId, prefer, restart) : restart())
  if (result.outcome === 'terminals-running') {
    const terminals =
      result.liveSessions === null
        ? 'Terminals may still be running'
        : `${result.liveSessions} ${result.liveSessions === 1 ? 'terminal is' : 'terminals are'} still running`
    throw new Error(
      `${terminals} on this machine, so its Seal server was not restarted. It becomes a service the next time it starts.`
    )
  }
  if (result.outcome === 'not-restarted') {
    throw new Error(result.reason)
  }
  // Import lazily: runtime-environments wires every server handler, and only a restart needs it.
  const { invalidateRuntimeEnvironmentTransport } =
    await import('../../ipc/runtime-environments/runtime-environments')
  await invalidateRuntimeEnvironmentTransport(environmentId)
  if (latestSealServiceOutcome(targetId)?.manager === 'detached') {
    throw new Error(NO_SERVICE_MANAGER)
  }
  return registry.view(machine.id)
}
