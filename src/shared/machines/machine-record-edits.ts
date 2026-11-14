import { normalizeMachineHost } from './machine-host-matching'
import type { MachineIdentity, MachineRecord, MachineStore } from './machine-record'

export function uniqueId(wanted: string, taken: ReadonlySet<string>): string {
  if (!taken.has(wanted)) {
    return wanted
  }
  let suffix = 2
  while (taken.has(`${wanted}-${suffix}`)) {
    suffix += 1
  }
  return `${wanted}-${suffix}`
}

export function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

/** Record what a transport reported about its host, so later merges can match on it. */
export function observeMachineIdentity(
  store: MachineStore,
  link: { sshTargetId: string } | { environmentId: string },
  identity: MachineIdentity,
  now: number
): MachineStore {
  const hostname = normalizeMachineHost(identity.hostname)
  const machineId = identity.machineId?.trim().toLowerCase() || null
  let changed = false
  const machines = store.machines.map((machine) => {
    const linked =
      'sshTargetId' in link
        ? machine.sshTargetId === link.sshTargetId
        : machine.environmentId === link.environmentId
    if (!linked) {
      return machine
    }
    const hostnames = hostname ? union(machine.hostnames, [hostname]) : machine.hostnames
    const machineIds = machineId ? union(machine.machineIds, [machineId]) : machine.machineIds
    if (
      hostnames.length === machine.hostnames.length &&
      machineIds.length === machine.machineIds.length
    ) {
      return machine
    }
    changed = true
    return { ...machine, hostnames, machineIds, updatedAt: now }
  })
  return changed ? { ...store, machines } : store
}

/** Split a merged machine back into an SSH machine and a server machine that stay apart. */
export function separateMachine(store: MachineStore, machineId: string, now: number): MachineStore {
  const machine = store.machines.find((candidate) => candidate.id === machineId)
  if (!machine?.sshTargetId || !machine.environmentId) {
    return store
  }
  const taken = new Set(store.machines.map((candidate) => candidate.id))
  const server: MachineRecord = {
    ...machine,
    id: uniqueId(machine.environmentId, taken),
    connection: 'server',
    sshTargetId: null,
    hostnames: [],
    machineIds: [],
    createdAt: now,
    updatedAt: now
  }
  return {
    version: 1,
    machines: [
      ...store.machines.map((candidate): MachineRecord =>
        candidate.id === machineId
          ? {
              ...candidate,
              connection: 'ssh',
              environmentId: null,
              hostnames: [],
              machineIds: [],
              updatedAt: now
            }
          : candidate
      ),
      server
    ],
    separations: [
      ...store.separations,
      { sshTargetId: machine.sshTargetId, environmentId: machine.environmentId }
    ]
  }
}

/** Switch which stored transport a machine uses; the other one's details stay untouched. */
export function setMachineConnection(
  store: MachineStore,
  machineId: string,
  connection: MachineRecord['connection'],
  now: number
): MachineStore {
  const machine = store.machines.find((candidate) => candidate.id === machineId)
  if (!machine) {
    throw new Error('Machine not found')
  }
  if (connection === 'ssh' ? !machine.sshTargetId : !machine.environmentId) {
    throw new Error(
      connection === 'ssh'
        ? 'Add SSH details to this machine before switching it to SSH'
        : 'Pair a Seal server for this machine before switching it to the server'
    )
  }
  if (machine.connection === connection) {
    return store
  }
  return {
    ...store,
    machines: store.machines.map((candidate) =>
      candidate.id === machineId ? { ...candidate, connection, updatedAt: now } : candidate
    )
  }
}

/** Give a machine the other transport's details (a new SSH target or a paired server). */
export function attachToMachine(
  store: MachineStore,
  machineId: string,
  link: { sshTargetId: string } | { environmentId: string },
  now: number
): MachineStore {
  const machine = store.machines.find((candidate) => candidate.id === machineId)
  if (!machine) {
    throw new Error('Machine not found')
  }
  const owner = store.machines.find((candidate) =>
    'sshTargetId' in link
      ? candidate.sshTargetId === link.sshTargetId
      : candidate.environmentId === link.environmentId
  )
  if (owner && owner.id !== machineId && owner.sshTargetId && owner.environmentId) {
    throw new Error('Those details already belong to another machine')
  }
  const separations = store.separations.filter((pair) =>
    'sshTargetId' in link
      ? !(pair.sshTargetId === link.sshTargetId && pair.environmentId === machine.environmentId)
      : !(pair.environmentId === link.environmentId && pair.sshTargetId === machine.sshTargetId)
  )
  return {
    version: 1,
    separations,
    machines: store.machines
      .filter((candidate) => candidate === machine || candidate !== owner)
      .map((candidate) =>
        candidate === machine
          ? {
              ...candidate,
              ...('sshTargetId' in link
                ? { sshTargetId: link.sshTargetId }
                : { environmentId: link.environmentId }),
              hostnames: union(candidate.hostnames, owner?.hostnames ?? []),
              machineIds: union(candidate.machineIds, owner?.machineIds ?? []),
              updatedAt: now
            }
          : candidate
      )
  }
}
