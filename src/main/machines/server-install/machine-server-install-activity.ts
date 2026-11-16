/** What is known only while the app runs: installs in flight, blocked moves, and what each host said about its service. */
import type { MachineServiceManager } from '../../../shared/machines/machine-server-install'
import type { MachineView } from '../../../shared/machines/machine-view'
import type { OwnSealServe } from '../../managed-server/service/own-seal-serve-probe'
import type { SealServiceOutcome } from '../../managed-server/service/seal-service-policy'
import type { MachineServerInstallActivity } from '../registry/machine-views'

const installs = new Map<string, Promise<MachineView>>()
const blockedMoves = new Map<string, { detail: string | null }>()
const serviceOutcomes = new Map<string, SealServiceOutcome>()
const ownServes = new Map<string, OwnSealServe>()
const hostsWithoutOwnServe = new Set<string>()
const managerWishes = new Map<string, MachineServiceManager>()
const hostWaits = new Set<string>()
const removals = new Set<string>()
const directConnects = new Set<string>()
let changed: () => void = () => {}

export function onMachineServerInstallActivityChanged(listener: () => void): void {
  changed = listener
}

export const machineServerInstallActivity: MachineServerInstallActivity = {
  installing: (recordId) => installs.has(recordId),
  blockedMove: (sshTargetId) => blockedMoves.get(sshTargetId) ?? null,
  reportedKeeper: (sshTargetId) => serviceOutcomes.get(sshTargetId) ?? null,
  ownServe: (sshTargetId) => ownServes.get(sshTargetId) ?? null,
  waitsForHost: (sshTargetId) => hostWaits.has(sshTargetId)
}

/** Runs one install per machine; a second request for the same machine gets the running one. */
export function joinMachineServerInstall(
  recordId: string,
  run: () => Promise<MachineView>
): Promise<MachineView> {
  const running = installs.get(recordId)
  if (running) {
    return running
  }
  const install = Promise.resolve()
    .then(run)
    .finally(() => {
      installs.delete(recordId)
      changed()
    })
  installs.set(recordId, install)
  changed()
  return install
}

/** A move refused only for saved items that cannot move; `null` clears it. */
export function noteBlockedServerMove(
  sshTargetId: string,
  blocked: { detail: string | null } | null
): void {
  const had = blockedMoves.has(sshTargetId)
  if (blocked) {
    blockedMoves.set(sshTargetId, blocked)
  } else {
    blockedMoves.delete(sshTargetId)
  }
  if (had || blocked) {
    changed()
  }
}

export function noteSealServiceOutcome(
  sshTargetId: string,
  outcome: SealServiceOutcome | null
): void {
  if (outcome) {
    const known = serviceOutcomes.get(sshTargetId)
    // An answer that leaves the account or linger out does not know them, so the known ones stay.
    const hostUser = outcome.hostUser ?? known?.hostUser
    const linger = outcome.linger ?? (known?.manager === outcome.manager ? known.linger : undefined)
    serviceOutcomes.set(sshTargetId, {
      ...outcome,
      ...(hostUser !== undefined ? { hostUser } : {}),
      ...(linger !== undefined ? { linger } : {})
    })
  } else if (!serviceOutcomes.delete(sshTargetId)) {
    return
  }
  changed()
}

export function latestSealServiceOutcome(sshTargetId: string): SealServiceOutcome | null {
  return serviceOutcomes.get(sshTargetId) ?? null
}

/** What a host answered in this app run: the `seal serve` service its user already runs, or `null` for none. */
export function noteOwnSealServe(sshTargetId: string, found: OwnSealServe | null): void {
  if (found) {
    hostsWithoutOwnServe.delete(sshTargetId)
    ownServes.set(sshTargetId, found)
  } else {
    hostsWithoutOwnServe.add(sshTargetId)
    if (!ownServes.delete(sshTargetId)) {
      return
    }
  }
  changed()
}

export function forgetOwnSealServe(sshTargetId: string): void {
  hostsWithoutOwnServe.delete(sshTargetId)
  if (ownServes.delete(sshTargetId)) {
    changed()
  }
}

export function ownSealServeOn(sshTargetId: string): OwnSealServe | null {
  return ownServes.get(sshTargetId) ?? null
}

/** True once the host answered, in this app run, that its user runs no `seal serve` service. */
export function hostRunsNoOwnSealServe(sshTargetId: string): boolean {
  return hostsWithoutOwnServe.has(sshTargetId)
}

/** An install that waits for another install on the host to end or to be given up. */
export function noteInstallWaitsForHost(sshTargetId: string, waits: boolean): void {
  if (waits === hostWaits.has(sshTargetId)) {
    return
  }
  if (waits) {
    hostWaits.add(sshTargetId)
  } else {
    hostWaits.delete(sshTargetId)
  }
  changed()
}

/** The user's choice of manager for a server that is already installed, held until its next launch. */
export async function whileManagerIsWished<T>(
  sshTargetId: string,
  manager: MachineServiceManager,
  work: () => Promise<T>
): Promise<T> {
  managerWishes.set(sshTargetId, manager)
  try {
    return await work()
  } finally {
    managerWishes.delete(sshTargetId)
  }
}

export function wishedManager(sshTargetId: string): MachineServiceManager | null {
  return managerWishes.get(sshTargetId) ?? null
}

/** A server being removed must not get its service back when the decommission wakes it. */
export async function whileServerIsRemoved<T>(
  sshTargetId: string,
  work: () => Promise<T>
): Promise<T> {
  if (removals.has(sshTargetId)) {
    throw new Error('Seal server is already being removed from this machine')
  }
  removals.add(sshTargetId)
  try {
    return await work()
  } finally {
    removals.delete(sshTargetId)
  }
}

export function isServerBeingRemoved(sshTargetId: string): boolean {
  return removals.has(sshTargetId)
}

/** One connect of a server-connected machine's SSH details that must deploy nothing on the host. */
export async function whileSshConnectsDirectly<T>(
  sshTargetId: string,
  work: () => Promise<T>
): Promise<T> {
  directConnects.add(sshTargetId)
  try {
    return await work()
  } finally {
    directConnects.delete(sshTargetId)
  }
}

export function sshConnectsDirectlyNow(sshTargetId: string): boolean {
  return directConnects.has(sshTargetId)
}
