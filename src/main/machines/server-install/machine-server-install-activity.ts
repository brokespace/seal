/** What is known only while the app runs: installs in flight, blocked moves, and what each host said about its service. */
import type { MachineView } from '../../../shared/machines/machine-view'
import type { SealServiceOutcome } from '../../managed-server/service/seal-service-policy'
import type { MachineServerInstallActivity } from '../registry/machine-views'

const installs = new Map<string, Promise<MachineView>>()
const blockedMoves = new Map<string, { detail: string | null }>()
const serviceOutcomes = new Map<string, SealServiceOutcome>()
const pm2Wishes = new Set<string>()
const removals = new Set<string>()
const directConnects = new Set<string>()
let changed: () => void = () => {}

export function onMachineServerInstallActivityChanged(listener: () => void): void {
  changed = listener
}

export const machineServerInstallActivity: MachineServerInstallActivity = {
  installing: (recordId) => installs.has(recordId),
  blockedMove: (sshTargetId) => blockedMoves.get(sshTargetId) ?? null,
  reportedKeeper: (sshTargetId) => serviceOutcomes.get(sshTargetId) ?? null
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
    serviceOutcomes.set(sshTargetId, outcome)
  } else if (!serviceOutcomes.delete(sshTargetId)) {
    return
  }
  changed()
}

export function latestSealServiceOutcome(sshTargetId: string): SealServiceOutcome | null {
  return serviceOutcomes.get(sshTargetId) ?? null
}

/** The user's choice of PM2 for a server that is already installed, held until its next launch. */
export async function whilePm2IsWished<T>(sshTargetId: string, work: () => Promise<T>): Promise<T> {
  pm2Wishes.add(sshTargetId)
  try {
    return await work()
  } finally {
    pm2Wishes.delete(sshTargetId)
  }
}

export function isPm2Wished(sshTargetId: string): boolean {
  return pm2Wishes.has(sshTargetId)
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
