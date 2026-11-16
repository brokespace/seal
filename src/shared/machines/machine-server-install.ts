import { compareAppVersions } from '../app-version'
import {
  activeMachineConnection,
  type MachineRecord,
  type MachineServerInstall,
  type MachineStore
} from './machine-record'

/** How a Seal server is kept running on a machine. */
export type MachineServerKeeper = NonNullable<MachineServerInstall['manager']>

export const DECLINED_SERVER_INSTALL: MachineServerInstall = { policy: 'never', state: 'declined' }

/** True while a machine asked for Seal's server and no attempt has settled; absent reads as never. */
export function awaitsServerInstall(install: MachineServerInstall | null | undefined): boolean {
  return install?.policy === 'auto' && install.state === 'pending'
}

/** While pending, `manager` holds the user's choice of PM2 over the manager Seal would pick. */
export function prefersPm2(install: MachineServerInstall | null | undefined): boolean {
  return install?.manager === 'pm2' && install.state !== 'installed'
}

export function pendingServerInstall(preferPm2: boolean, now: number): MachineServerInstall {
  return {
    policy: 'auto',
    state: 'pending',
    ...(preferPm2 ? { manager: 'pm2' as const } : {}),
    attemptedAt: now
  }
}

/** A running server the user asked to keep as a service; what is known about it stays. */
export function keptRunningServerInstall(
  previous: MachineServerInstall | null | undefined,
  now: number
): MachineServerInstall {
  return {
    ...(previous?.state === 'installed' ? previous : {}),
    policy: 'auto',
    state: 'installed',
    attemptedAt: now
  }
}

/** `auto` installs on the next connect, `never` keeps plain SSH; anything else leaves the record. */
export function adoptedServerInstall(
  choice: unknown,
  serviceManager: unknown,
  now: number
): MachineServerInstall | null {
  if (choice === 'auto') {
    return pendingServerInstall(serviceManager === 'pm2', now)
  }
  return choice === 'never' ? DECLINED_SERVER_INSTALL : null
}

/** The keeper a finished install is known to have; a pending or failed one only holds a choice. */
export function installedServerKeeper(
  install: MachineServerInstall | null | undefined
): MachineServerKeeper | null {
  return install?.state === 'installed' ? (install.manager ?? null) : null
}

function sameInstall(a: MachineServerInstall | undefined, b: MachineServerInstall): boolean {
  return (
    a !== undefined &&
    a.policy === b.policy &&
    a.state === b.state &&
    a.manager === b.manager &&
    a.linger === b.linger &&
    a.reason === b.reason &&
    a.version === b.version &&
    a.attemptedAt === b.attemptedAt
  )
}

type ServerInstallChange = {
  serverInstall: MachineServerInstall
  connection?: MachineRecord['connection']
}

function changeMachine(
  store: MachineStore,
  machineId: string,
  change: (machine: MachineRecord) => ServerInstallChange | null,
  now: number
): MachineStore {
  const machine = store.machines.find((candidate) => candidate.id === machineId)
  const next = machine ? change(machine) : null
  if (!machine || !next) {
    return store
  }
  const connection = next.connection ?? machine.connection
  if (connection === machine.connection && sameInstall(machine.serverInstall, next.serverInstall)) {
    return store
  }
  return {
    ...store,
    machines: store.machines.map((candidate) =>
      candidate === machine
        ? { ...machine, connection, serverInstall: next.serverInstall, updatedAt: now }
        : candidate
    )
  }
}

export function setMachineServerInstall(
  store: MachineStore,
  machineId: string,
  serverInstall: MachineServerInstall,
  now: number
): MachineStore {
  return changeMachine(store, machineId, () => ({ serverInstall }), now)
}

function unfinishedServerInstall(
  state: 'failed' | 'pending',
  reason: string,
  now: number
): (machine: MachineRecord) => ServerInstallChange {
  return (machine) => ({
    serverInstall: {
      policy: 'auto',
      state,
      ...(prefersPm2(machine.serverInstall) ? { manager: 'pm2' as const } : {}),
      reason,
      attemptedAt: now
    },
    // A server the failed setup left registered must not become the machine's transport.
    ...(machine.sshTargetId ? { connection: 'ssh' as const } : {})
  })
}

/** The attempt failed, so the machine works over plain SSH until the user retries. */
export function failMachineServerInstall(
  store: MachineStore,
  machineId: string,
  reason: string,
  now: number
): MachineStore {
  return changeMachine(store, machineId, unfinishedServerInstall('failed', reason, now), now)
}

/** The install waits for something that ends by itself, so every later connect tries it again. */
export function deferMachineServerInstall(
  store: MachineStore,
  machineId: string,
  reason: string,
  now: number
): MachineStore {
  return changeMachine(store, machineId, unfinishedServerInstall('pending', reason, now), now)
}

/** The machine connected through the server Seal installed for it. */
export function completeMachineServerInstall(
  store: MachineStore,
  machineId: string,
  served: {
    environmentId: string
    /** `null`: not known; `undefined`: as recorded before. */
    version: string | null | undefined
    keeper: { manager: MachineServerKeeper; linger?: boolean } | null
  },
  now: number
): MachineStore {
  return changeMachine(
    store,
    machineId,
    (machine) => {
      const previous = machine.serverInstall
      if (previous?.policy !== 'auto') {
        return null
      }
      const known = installedServerKeeper(previous)
      const keeper = served.keeper ?? (known ? { manager: known, linger: previous.linger } : null)
      const version = served.version === undefined ? previous.version : served.version
      return {
        serverInstall: {
          policy: 'auto',
          state: 'installed',
          ...(keeper ? { manager: keeper.manager } : {}),
          ...(keeper?.linger !== undefined ? { linger: keeper.linger } : {}),
          ...(version ? { version } : {}),
          ...(previous.attemptedAt !== undefined ? { attemptedAt: previous.attemptedAt } : {})
        },
        ...(machine.environmentId === served.environmentId ? { connection: 'server' as const } : {})
      }
    },
    now
  )
}

/** What the host said about its service; a pending record keeps the user's choice until it settles. */
export function noteMachineServerKeeper(
  store: MachineStore,
  machineId: string,
  keeper: { manager: MachineServerKeeper; linger?: boolean },
  now: number
): MachineStore {
  return changeMachine(
    store,
    machineId,
    (machine) => {
      const previous = machine.serverInstall
      if (previous?.policy !== 'auto' || previous.state !== 'installed') {
        return null
      }
      return {
        serverInstall: {
          policy: 'auto',
          state: 'installed',
          manager: keeper.manager,
          ...(keeper.linger !== undefined ? { linger: keeper.linger } : {}),
          ...(previous.version !== undefined ? { version: previous.version } : {}),
          ...(previous.attemptedAt !== undefined ? { attemptedAt: previous.attemptedAt } : {})
        }
      }
    },
    now
  )
}

/** Seal's server was stopped for removal; its service stays on record until the host confirms it is gone. */
export function stoppedServerInstall(keeper: MachineServerKeeper | null): MachineServerInstall {
  return {
    policy: 'never',
    state: 'installed',
    ...(keeper && keeper !== 'detached' ? { manager: keeper } : {})
  }
}

/** True after a removal that stopped the server but could not confirm its service is gone. */
export function serverServiceRemains(install: MachineServerInstall | null | undefined): boolean {
  return install?.policy === 'never' && install.state === 'installed'
}

/** After Seal's server was stopped: the machine connects over SSH and nothing is installed again. */
export function returnMachineToPlainSsh(
  store: MachineStore,
  machineId: string,
  serverInstall: MachineServerInstall,
  now: number
): MachineStore {
  return changeMachine(
    store,
    machineId,
    (machine) => ({
      serverInstall,
      ...(machine.sshTargetId ? { connection: 'ssh' as const } : {})
    }),
    now
  )
}

/** Machines on a Seal-installed server that last connected under another app version. */
export function machinesAwaitingServerUpgrade(
  machines: readonly MachineRecord[],
  appVersion: string
): MachineRecord[] {
  return machines.filter(
    (machine) =>
      machine.sshTargetId !== null &&
      activeMachineConnection(machine) === 'server' &&
      machine.serverInstall?.policy === 'auto' &&
      machine.serverInstall.state === 'installed' &&
      // No version: the server was newer than this app when it last connected, and the app may have caught up.
      (machine.serverInstall.version === undefined ||
        compareAppVersions(machine.serverInstall.version, appVersion) < 0)
  )
}
