/** Connects an SSH machine through the `seal serve` its user already runs there. Nothing on the host is installed, restarted or removed. */
import { randomUUID } from 'node:crypto'
import { getAppEnvironment } from '../../../shared/app-environment'
import { InFlightPromiseDedupe } from '../../../shared/in-flight-promise-dedupe'
import {
  declineMachineServerInstall,
  withoutTrailingFullStop
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
import {
  readOwnSealServeStartCommand,
  type OwnSealServe
} from '../../managed-server/service/own-seal-serve-probe'
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
import { OwnSealCliAnswerError, runOwnSealCli } from './own-seal-cli-command'
import { checkHostForOwnSealServe, forgetOwnSealServeAnswer } from './own-seal-serve-check'

const PAIR_TIMEOUT_MS = 30_000
const BY_HAND = `Run "${INSTALLED_CLI_COMMAND_NAME} pair" on the machine, then add the link it prints with Add machine > Connect via Seal server.`

type SavedServer = ReturnType<typeof listEnvironments>[number]

// No expiry: a second request for the machine joins the reuse that runs, however long it takes.
const reuses = new InFlightPromiseDedupe<MachineView>(0)

/** Rejects with what to do by hand when the server cannot be connected from here. */
export function reuseOwnServerOnSshMachine(machineId: MachineId): Promise<MachineView> {
  const registry = getMachineRegistry()
  const machine = registry.view(machineId)
  return reuses.run(machine.recordId, () => reuseOwnServer(registry, machine))
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
      const pairingUrl = await ownServerPairingUrl(session, found, machine.name)
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
    const reason = withoutTrailingFullStop(error instanceof Error ? error.message : String(error))
    throw new Error(`Seal could not connect to the server on this machine: ${reason}. ${BY_HAND}`)
  }
}

/** The link `seal pair` prints. The running server makes it; nothing about the server changes. */
async function ownServerPairingUrl(
  session: SshConnection,
  found: OwnSealServe,
  machineName: string
): Promise<string> {
  const offer = await runOwnSealCli(session, 'pair', {
    timeoutMs: PAIR_TIMEOUT_MS,
    whenNotFound: BY_HAND
  }).catch(async (error: unknown) => {
    throw error instanceof OwnSealCliAnswerError
      ? await unansweredPairing(session, found, machineName, error)
      : error
  })
  if (offer.available !== true || typeof offer.pairingUrl !== 'string') {
    const guidance = typeof offer.guidance === 'string' ? ` ${offer.guidance}` : ''
    throw new Error(`The Seal server on this machine gave no pairing link.${guidance} ${BY_HAND}`)
  }
  return offer.pairingUrl
}

/** The CLI answered with an error, so the service manager is asked whether the server runs at all. */
async function unansweredPairing(
  session: SshConnection,
  found: OwnSealServe,
  machineName: string,
  refusal: OwnSealCliAnswerError
): Promise<Error> {
  const start = await readOwnSealServeStartCommand(session, found).catch(() => null)
  const again = 'then choose “Use this server” again.'
  if (start) {
    return new Error(
      `The Seal server you set up on ${machineName} is not running. Start it there (for example “${start}”), ${again}`
    )
  }
  // One line: the page shows only the first line of a failure.
  const said = withoutTrailingFullStop(refusal.message.trim().split(/\r?\n/u)[0] ?? '')
  return new Error(
    `The Seal server you set up on ${machineName} did not answer${said ? ` (“${said}”)` : ''}. Check that it is running there, ${again}`
  )
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
  // The port the server listens on there. A saved pairing may name the local end of a tunnel the user ran.
  const remotePort = loopbackPortOnMachine(offer.endpoint)
  if (saved) {
    // A server that is already paired keeps its pairing; only a tunnel it lacks is added.
    // One paired through a tunnel the user runs keeps that tunnel: the link refuses a second.
    return getRuntimeSshAccess(saved) ||
      saved.connectionDependency === 'ssh-tunnel' ||
      getPreferredLoopbackRuntimePort(saved) === null ||
      remotePort === null
      ? saved
      : linkSavedThroughSsh(userDataPath, saved, sshTargetId, remotePort)
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
    if (remotePort === null) {
      throw new Error('The pairing link names no port on the machine')
    }
    return await linkThroughSsh(userDataPath, added, sshTargetId, remotePort)
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

function loopbackPortOnMachine(endpoint: string): number | null {
  return getPreferredLoopbackRuntimePort({
    endpoints: [{ id: 'offer', endpoint }],
    preferredEndpointId: 'offer'
  })
}

/** The link's check proves, through Seal's own tunnel, that the server holds the key the pairing link named. */
async function linkThroughSsh(
  userDataPath: string,
  server: SavedServer,
  sshTargetId: string,
  remotePort: number
): Promise<SavedServer> {
  try {
    await linkRuntimeSshAccess(
      userDataPath,
      { selector: server.id, requestId: randomUUID(), sshTargetId, remotePort },
      { invalidateTransport: invalidateServerTransport }
    )
  } catch (error) {
    const reason = withoutTrailingFullStop(error instanceof Error ? error.message : String(error))
    throw new Error(`Seal's SSH tunnel to port ${remotePort} on the machine failed: ${reason}`)
  }
  return server
}

/** A saved server keeps its pairing either way; a link left half made, now or by an earlier try, is dropped. */
async function linkSavedThroughSsh(
  userDataPath: string,
  saved: SavedServer,
  sshTargetId: string,
  remotePort: number
): Promise<SavedServer> {
  if (saved.pendingSshAccessOperation) {
    await dropUnfinishedLink(userDataPath, saved.id)
  }
  try {
    return await linkThroughSsh(userDataPath, saved, sshTargetId, remotePort)
  } catch (error) {
    const left = listEnvironments(userDataPath).find((entry) => entry.id === saved.id)
    if (left?.pendingSshAccessOperation) {
      await dropUnfinishedLink(userDataPath, saved.id).catch((dropError: unknown) => {
        console.warn('[machines] could not drop an SSH tunnel link that was not made:', dropError)
      })
    }
    throw error
  }
}

async function dropUnfinishedLink(userDataPath: string, environmentId: string): Promise<void> {
  await unlinkRuntimeSshAccess(
    userDataPath,
    { selector: environmentId, requestId: randomUUID() },
    { invalidateTransport: invalidateServerTransport }
  )
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
    await dropUnfinishedLink(userDataPath, environmentId)
    removeEnvironment(userDataPath, environmentId)
    await invalidateServerTransport(environmentId)
  } catch (error) {
    console.warn('[machines] could not forget a server whose SSH tunnel was not made:', error)
  }
}

// Import lazily: runtime-environments wires every server handler, and only a reuse or restart needs it.
export async function invalidateServerTransport(environmentId: string): Promise<void> {
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
  registry.edit(declineMachineServerInstall(bound.recordId))
  noteSealServiceOutcome(sshTargetId, { manager: found.manager })
  forgetOwnSealServeAnswer(sshTargetId)
  return registry.view(bound.id)
}
