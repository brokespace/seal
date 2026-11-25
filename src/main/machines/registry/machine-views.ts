import {
  activeMachineConnection,
  type MachineRecord,
  type MachineStore
} from '../../../shared/machines/machine-record'
import {
  installedServerKeeper,
  serverServiceRemains,
  type MachineServerKeeper
} from '../../../shared/machines/machine-server-install'
import { machineServerInstallAction } from '../../../shared/machines/machine-server-install-action'
import { toMachineId } from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import type { MachineRegistryEnvironment, MachineRegistrySshTarget } from './machine-registry'

/** What is known only while the app runs, keyed the way the connect flow reports it. */
export type MachineServerInstallActivity = {
  installing(recordId: string): boolean
  blockedMove(sshTargetId: string): { detail: string | null } | null
  reportedKeeper(sshTargetId: string): {
    manager: MachineServerKeeper
    startsAtBoot?: boolean | null
    linger?: boolean
    hostUser?: string
    launchdNeedsLogin?: true
  } | null
  /** The `seal serve` service the user already runs on the host. */
  ownServe(sshTargetId: string): NonNullable<MachineView['serverOwnServe']> | null
  /** An install on this host waits for another one to end or to be given up. */
  waitsForHost(sshTargetId: string): boolean
}

function sshAddress(target: MachineRegistrySshTarget): string {
  const host = target.host || target.configHost || target.label
  const user = target.username ? `${target.username}@` : ''
  const port = target.port && target.port !== 22 ? `:${target.port}` : ''
  return `${user}${host}${port}`
}

function serverInstallView(
  record: MachineRecord,
  connection: MachineView['connection'],
  hasSshDetails: boolean,
  environment: MachineRegistryEnvironment | undefined,
  activity: MachineServerInstallActivity | undefined
): Pick<
  MachineView,
  | 'serverInstall'
  | 'serverInstallAction'
  | 'serverMoveBlocked'
  | 'serverStartsAtBoot'
  | 'serverKeeper'
  | 'serverRunByUser'
  | 'serverServiceRemains'
  | 'serverHostUser'
  | 'serverOwnServe'
  | 'serverLaunchdNeedsLogin'
  | 'serverLingerOff'
  | 'serverInstallWaitsForHost'
> {
  const serverInstall = record.serverInstall ?? null
  const targetId = record.sshTargetId
  const managedOver = connection === 'server' ? (environment?.managedSshTargetId ?? null) : null
  const managedServer =
    managedOver === null ? null : managedOver === targetId ? 'own-target' : 'other-target'
  // A server Seal deployed over another target is not the one this machine's SSH details reach.
  const reported =
    targetId && managedServer !== 'other-target'
      ? (activity?.reportedKeeper(targetId) ?? null)
      : null
  const blocked =
    targetId && connection === 'ssh' && serverInstall?.state === 'failed'
      ? (activity?.blockedMove(targetId) ?? null)
      : null
  // The record only knows the keeper of a server Seal installed.
  const keeper =
    reported?.manager ??
    (connection === 'ssh' || managedServer ? installedServerKeeper(serverInstall) : null)
  const ownServe =
    targetId && connection === 'ssh' && hasSshDetails
      ? (activity?.ownServe(targetId) ?? null)
      : null
  const waitsForHost =
    targetId !== null && connection === 'ssh' && (activity?.waitsForHost(targetId) ?? false)
  const action = machineServerInstallAction({
    connection,
    hasSshDetails,
    serverInstall,
    // A connect nobody asked through Machines can run a waiting install too.
    installing: (activity?.installing(record.id) ?? false) || waitsForHost,
    managedServer,
    reportedKeeper: reported?.manager ?? null,
    ownServe: ownServe !== null
  })
  return {
    serverInstall,
    serverInstallAction: action,
    ...(blocked ? { serverMoveBlocked: blocked } : {}),
    ...(keeper === 'pm2' && reported ? { serverStartsAtBoot: reported.startsAtBoot ?? null } : {}),
    ...(keeper ? { serverKeeper: keeper } : {}),
    ...(connection === 'server' && managedServer === null
      ? { serverRunByUser: true as const }
      : {}),
    ...(connection === 'ssh' && serverServiceRemains(serverInstall)
      ? { serverServiceRemains: true as const }
      : {}),
    ...(reported?.hostUser ? { serverHostUser: reported.hostUser } : {}),
    ...(ownServe && action === 'reuse' ? { serverOwnServe: ownServe } : {}),
    ...(keeper === 'systemd-user' && (reported?.linger ?? serverInstall?.linger) === false
      ? { serverLingerOff: true as const }
      : {}),
    ...(reported?.launchdNeedsLogin ? { serverLaunchdNeedsLogin: true as const } : {}),
    ...(waitsForHost && action === 'installing' ? { serverInstallWaitsForHost: true as const } : {})
  }
}

/** What the renderer shows per machine: both transports' stored details, and which one is in use. */
export function buildMachineViews(
  store: MachineStore,
  sshTargets: readonly MachineRegistrySshTarget[],
  environments: readonly MachineRegistryEnvironment[],
  activity?: MachineServerInstallActivity
): MachineView[] {
  const targets = new Map(sshTargets.map((target) => [target.id, target]))
  const servers = new Map(environments.map((environment) => [environment.id, environment]))
  return store.machines
    .map((record): MachineView | null => {
      const connection = activeMachineConnection(record)
      if (!connection) {
        return null
      }
      const target = record.sshTargetId ? targets.get(record.sshTargetId) : undefined
      const environment = record.environmentId ? servers.get(record.environmentId) : undefined
      return {
        id: toMachineId(record.id),
        recordId: record.id,
        name: record.name,
        connection,
        ssh: target
          ? {
              targetId: target.id,
              address: sshAddress(target),
              host: target.host || target.configHost || '',
              username: target.username,
              port: target.port,
              identityFile: target.identityFile ?? null,
              jumpHost: target.jumpHost ?? null
            }
          : null,
        server: environment
          ? {
              environmentId: environment.id,
              name: environment.name,
              endpoint: environment.preferredEndpoint
            }
          : null,
        ...serverInstallView(record, connection, target !== undefined, environment, activity)
      }
    })
    .filter((view): view is MachineView => view !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}
