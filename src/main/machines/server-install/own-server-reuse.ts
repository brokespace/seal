/** Connects an SSH machine through the `seal serve` its user already runs there. Nothing on the host is installed, restarted or removed. */
import { randomUUID } from 'node:crypto'
import { getAppEnvironment } from '../../../shared/app-environment'
import {
  DECLINED_SERVER_INSTALL,
  setMachineServerInstall
} from '../../../shared/machines/machine-server-install'
import type { MachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import { findEnvironmentWithHostKey } from '../../../shared/remote-runtime/host-catalog/runtime-environment-host-key-match'
import { findCollidingEnvironmentName } from '../../../shared/remote-runtime/host-catalog/runtime-environment-name-collision'
import {
  getPreferredLoopbackRuntimePort,
  getRuntimeSshAccess
} from '../../../shared/remote-runtime/host-catalog/runtime-environments'
import {
  addEnvironmentFromPairingCode,
  getPairingConnectionDependency,
  listEnvironments,
  parseRemotePairingCode,
  removeEnvironment
} from '../../../shared/remote-runtime/host-store/runtime-environment-store'
import { INSTALLED_CLI_COMMAND_NAME } from '../../cli/installation/cli-install-constants'
import { publishRuntimeEnvironmentCatalogChanged } from '../../ipc/runtime-environments/catalog/runtime-environment-catalog-broadcast'
import { clearRuntimeEnvironmentManualDisconnect } from '../../ipc/runtime-environments/connectivity/runtime-environment-manual-disconnect'
import { verifyAndAddRuntimeEnvironmentFromPairingCode } from '../../ipc/runtime-environments/pairing/runtime-environment-pairing-verification'
import { publishVerifiedPairing } from '../../ipc/runtime-environments/pairing/runtime-environment-verified-pairing-publish'
import type { OwnSealServe } from '../../managed-server/service/own-seal-serve-probe'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  linkRuntimeSshAccess,
  unlinkRuntimeSshAccess
} from '../../ssh/runtime-access/runtime-ssh-access'
import type { MachineRegistry } from '../registry/machine-registry'
import { getMachineRegistry } from '../registry/machine-registry-service'
import {
  machineServerInstallActivity,
  noteSealServiceOutcome
} from './machine-server-install-activity'
import { onPlainSshSession } from './machine-ssh-session'
import { runOwnSealCli } from './own-seal-cli-command'
import { checkHostForOwnSealServe, forgetOwnSealServeAnswer } from './own-seal-serve-check'

const PAIR_TIMEOUT_MS = 30_000
const BY_HAND = `Run "${INSTALLED_CLI_COMMAND_NAME} pair" on the machine, then add the link it prints with Add machine > Connect via Seal server.`

type SavedServer = ReturnType<typeof listEnvironments>[number]

const reuses = new Map<string, Promise<MachineView>>()

/** Rejects with what to do by hand when the server cannot be connected from here. */
export function reuseOwnServerOnSshMachine(machineId: MachineId): Promise<MachineView> {
  const registry = getMachineRegistry()
  const machine = registry.view(machineId)
  const running = reuses.get(machine.recordId)
  if (running) {
    return running
  }
  const reuse = Promise.resolve()
    .then(() => reuseOwnServer(registry, machine))
    .finally(() => reuses.delete(machine.recordId))
  reuses.set(machine.recordId, reuse)
  return reuse
}

async function reuseOwnServer(
  registry: MachineRegistry,
  machine: MachineView
): Promise<MachineView> {
  const sshTargetId = machine.ssh?.targetId
  if (machine.connection !== 'ssh' || !sshTargetId) {
    throw new Error('Only a machine connected over SSH can switch to the Seal server it runs')
  }
  if (machineServerInstallActivity.installing(machine.recordId)) {
    throw new Error('Seal server is being installed on this machine')
  }
  const userDataPath = getAppEnvironment().getPath('userData')
  // The tunnel to the server runs over this session, so one opened here stays once the server is connected.
  const { found, server } = await onPlainSshSession(
    sshTargetId,
    async (session) => {
      const found = await checkHostForOwnSealServe(registry, sshTargetId, session)
      if (!found) {
        throw new Error('This machine no longer runs a Seal server of its own')
      }
      const pairingUrl = await ownServerPairingUrl(session)
      const server = await byHandWhenItFails(() =>
        connectOwnServer(userDataPath, machine, sshTargetId, pairingUrl)
      )
      return { found, server }
    },
    () => true
  )
  return bindOwnServer(registry, machine, sshTargetId, found, server)
}

async function byHandWhenItFails<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/[.\s]+$/u, '')
    throw new Error(`Seal could not connect to the server on this machine: ${reason}. ${BY_HAND}`)
  }
}

/** The link `seal pair` prints. The running server makes it; nothing about the server changes. */
async function ownServerPairingUrl(session: SshConnection): Promise<string> {
  const offer = await runOwnSealCli(session, 'pair', {
    timeoutMs: PAIR_TIMEOUT_MS,
    whenNotFound: BY_HAND
  })
  if (offer.available !== true || typeof offer.pairingUrl !== 'string') {
    const guidance = typeof offer.guidance === 'string' ? ` ${offer.guidance}` : ''
    throw new Error(`The Seal server on this machine gave no pairing link.${guidance} ${BY_HAND}`)
  }
  return offer.pairingUrl
}

async function connectOwnServer(
  userDataPath: string,
  machine: MachineView,
  sshTargetId: string,
  pairingUrl: string
): Promise<SavedServer> {
  const offer = parseRemotePairingCode(userDataPath, pairingUrl)
  const servers = listEnvironments(userDataPath)
  const saved = findEnvironmentWithHostKey(servers, offer.publicKeyB64)
  if (saved) {
    // A server that is already paired keeps its pairing; only a tunnel it lacks is added.
    // One paired through a tunnel the user runs keeps that tunnel: the link refuses a second.
    return getRuntimeSshAccess(saved) ||
      saved.connectionDependency === 'ssh-tunnel' ||
      getPreferredLoopbackRuntimePort(saved) === null
      ? saved
      : linkThroughSsh(userDataPath, saved, sshTargetId)
  }
  const name = freeServerName(servers, machine.name)
  if (!('connectionDependency' in getPairingConnectionDependency('ssh-tunnel', offer))) {
    return pairDirectly(userDataPath, name, pairingUrl)
  }
  // A server that listens on the machine's loopback is reached only through the SSH tunnel.
  // Saved without a tunnel of the user's own: the link below refuses a server that depends on one.
  const added = addEnvironmentFromPairingCode(userDataPath, { name, pairingCode: pairingUrl })
  clearRuntimeEnvironmentManualDisconnect(added.id)
  try {
    return await linkThroughSsh(userDataPath, added, sshTargetId)
  } catch (error) {
    await forgetUnlinkedServer(userDataPath, added.id)
    throw error
  } finally {
    publishRuntimeEnvironmentCatalogChanged()
  }
}

function freeServerName(servers: readonly SavedServer[], wanted: string): string {
  for (let count = 1; ; count += 1) {
    const name = count === 1 ? wanted : `${wanted} ${count}`
    if (!findCollidingEnvironmentName(servers, name)) {
      return name
    }
  }
}

/** The link's check proves, through Seal's own tunnel, that the server holds the key the pairing link named. */
async function linkThroughSsh(
  userDataPath: string,
  server: SavedServer,
  sshTargetId: string
): Promise<SavedServer> {
  const remotePort = getPreferredLoopbackRuntimePort(server)
  if (remotePort === null) {
    throw new Error('The pairing link names no port on the machine')
  }
  await linkRuntimeSshAccess(
    userDataPath,
    { selector: server.id, requestId: randomUUID(), sshTargetId, remotePort },
    { invalidateTransport: invalidateServerTransport }
  )
  return server
}

/** The same check and save as Add machine > Connect via Seal server. */
async function pairDirectly(
  userDataPath: string,
  name: string,
  pairingCode: string
): Promise<SavedServer> {
  const result = await verifyAndAddRuntimeEnvironmentFromPairingCode(userDataPath, {
    name,
    pairingCode
  })
  if (!result.ok) {
    throw new Error(result.message)
  }
  await publishVerifiedPairing(userDataPath, result, null)
  const saved = listEnvironments(userDataPath).find((entry) => entry.id === result.environment.id)
  if (!saved) {
    throw new Error('The server was paired but is not in the list of saved servers')
  }
  return saved
}

/** A server saved for a tunnel that could not be made is no use; the SSH details go back to how they were. */
async function forgetUnlinkedServer(userDataPath: string, environmentId: string): Promise<void> {
  try {
    await unlinkRuntimeSshAccess(
      userDataPath,
      { selector: environmentId, requestId: randomUUID() },
      { invalidateTransport: invalidateServerTransport }
    )
    removeEnvironment(userDataPath, environmentId)
    await invalidateServerTransport(environmentId)
  } catch (error) {
    console.warn('[machines] could not forget a server whose SSH tunnel was not made:', error)
  }
}

// Import lazily: runtime-environments wires every server handler, and only a reuse needs it.
async function invalidateServerTransport(environmentId: string): Promise<void> {
  const { invalidateRuntimeEnvironmentTransport } =
    await import('../../ipc/runtime-environments/runtime-environments')
  await invalidateRuntimeEnvironmentTransport(environmentId)
}

function bindOwnServer(
  registry: MachineRegistry,
  machine: MachineView,
  sshTargetId: string,
  found: OwnSealServe,
  server: SavedServer
): MachineView {
  registry.reconcile()
  const bound = registry.adopt({
    link: { environmentId: server.id },
    connection: 'server',
    machineId: machine.id
  })
  // Declined: the server is the user's, so Seal neither upgrades nor removes it.
  registry.edit((store, now) =>
    setMachineServerInstall(store, bound.recordId, DECLINED_SERVER_INSTALL, now)
  )
  noteSealServiceOutcome(sshTargetId, { manager: found.manager })
  forgetOwnSealServeAnswer(sshTargetId)
  return registry.view(bound.id)
}
