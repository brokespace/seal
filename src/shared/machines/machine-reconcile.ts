import type { MachineRecord, MachineStore } from './machine-record'
import {
  chooseMerges,
  identifyingServerAddresses,
  isSeparated,
  matchReason,
  type Candidate,
  type MachineEnvironmentFacts,
  type MachineMergeReason,
  type MachineSshTargetFacts,
  wasCreatedFromTarget
} from './machine-host-matching'
import { union, uniqueId } from './machine-record-edits'

export type {
  MachineEnvironmentFacts,
  MachineMergeReason,
  MachineSshTargetFacts
} from './machine-host-matching'
export { normalizeMachineHost } from './machine-host-matching'
export {
  attachToMachine,
  observeMachineIdentity,
  separateMachine,
  setMachineConnection
} from './machine-record-edits'

export type MachineMerge = {
  machineId: string
  removedMachineId: string
  sshTargetId: string
  environmentId: string
  reason: MachineMergeReason
}

export type MachineReconcileResult = {
  store: MachineStore
  merges: MachineMerge[]
  changed: boolean
}

/** Fold a server proven to be a full machine's host into that machine, so it is not listed twice. */
function absorbServers(
  machines: readonly MachineRecord[],
  environments: ReadonlyMap<string, MachineEnvironmentFacts>,
  separations: MachineStore['separations'],
  now: number
): { machines: MachineRecord[]; merges: MachineMerge[] } {
  const full = machines.filter((machine) => machine.sshTargetId && machine.environmentId)
  const replaced = new Map<string, MachineRecord>()
  const removed = new Set<string>()
  const merges: MachineMerge[] = []
  for (const server of machines) {
    if (server.sshTargetId || !server.environmentId) {
      continue
    }
    const environment = environments.get(server.environmentId)!
    const matches = full.flatMap((host) => {
      if (isSeparated(separations, host.sshTargetId!, environment.id)) {
        return []
      }
      return environment.linkedSshTargetId === host.sshTargetId ? [host] : []
    })
    if (matches.length !== 1) {
      continue
    }
    const host = matches[0]
    const current = replaced.get(host.id) ?? host
    replaced.set(host.id, {
      ...current,
      hostnames: union(current.hostnames, server.hostnames),
      machineIds: union(current.machineIds, server.machineIds),
      absorbedEnvironmentIds: union(current.absorbedEnvironmentIds, [
        server.environmentId,
        ...server.absorbedEnvironmentIds
      ]),
      serverInstall: current.serverInstall ?? server.serverInstall,
      createdAt: Math.min(current.createdAt, server.createdAt),
      updatedAt: now
    })
    removed.add(server.id)
    merges.push({
      machineId: host.id,
      removedMachineId: server.id,
      sshTargetId: host.sshTargetId!,
      environmentId: server.environmentId,
      reason: 'linked'
    })
  }
  return {
    machines: machines
      .filter((machine) => !removed.has(machine.id))
      .map((machine) => replaced.get(machine.id) ?? machine),
    merges
  }
}

/**
 * Migrate SSH targets and runtime environments into machines and merge pairs that are one host.
 * Underlying records are never deleted here; a machine only drops a link whose record is gone.
 */
export function reconcileMachines(
  previous: MachineStore,
  facts: {
    sshTargets: readonly MachineSshTargetFacts[]
    environments: readonly MachineEnvironmentFacts[]
  },
  now: number
): MachineReconcileResult {
  const targets = new Map(facts.sshTargets.map((target) => [target.id, target]))
  const environments = new Map(
    facts.environments.map((environment) => [environment.id, environment])
  )
  const seenTargets = new Set<string>()
  const seenEnvironments = new Set<string>()
  const machines: MachineRecord[] = []
  for (const record of previous.machines) {
    const sshTargetId =
      record.sshTargetId && targets.has(record.sshTargetId) && !seenTargets.has(record.sshTargetId)
        ? record.sshTargetId
        : null
    const environmentId =
      record.environmentId &&
      environments.has(record.environmentId) &&
      !seenEnvironments.has(record.environmentId)
        ? record.environmentId
        : null
    if (!sshTargetId && !environmentId) {
      continue
    }
    if (sshTargetId) {
      seenTargets.add(sshTargetId)
    }
    if (environmentId) {
      seenEnvironments.add(environmentId)
    }
    machines.push(
      sshTargetId === record.sshTargetId && environmentId === record.environmentId
        ? record
        : { ...record, sshTargetId, environmentId, updatedAt: now }
    )
  }
  for (const [index, machine] of machines.entries()) {
    // An absorbed server stays hidden only while the machine's link still proves it is the same host.
    const absorbed = machine.absorbedEnvironmentIds.filter(
      (id) =>
        machine.sshTargetId &&
        machine.environmentId &&
        environments.get(id)?.linkedSshTargetId === machine.sshTargetId &&
        !seenEnvironments.has(id) &&
        !isSeparated(previous.separations, machine.sshTargetId, id)
    )
    for (const id of absorbed) {
      seenEnvironments.add(id)
    }
    if (absorbed.length !== machine.absorbedEnvironmentIds.length) {
      machines[index] = { ...machine, absorbedEnvironmentIds: absorbed, updatedAt: now }
    }
  }
  const taken = new Set(machines.map((machine) => machine.id))
  const fresh = (id: string, name: string, link: Partial<MachineRecord>): MachineRecord => {
    const record: MachineRecord = {
      id: uniqueId(id, taken),
      name,
      sshTargetId: null,
      environmentId: null,
      connection: link.environmentId ? 'server' : 'ssh',
      hostnames: [],
      machineIds: [],
      absorbedEnvironmentIds: [],
      createdAt: now,
      updatedAt: now,
      ...link
    }
    taken.add(record.id)
    return record
  }
  for (const target of facts.sshTargets) {
    if (!seenTargets.has(target.id)) {
      const name = target.label || target.configHost || target.host
      machines.push(fresh(target.id, name, { sshTargetId: target.id }))
    }
  }
  for (const environment of facts.environments) {
    if (!seenEnvironments.has(environment.id)) {
      machines.push(fresh(environment.id, environment.name, { environmentId: environment.id }))
    }
  }

  const identifying = identifyingServerAddresses(facts.environments)
  const candidates: Candidate[] = []
  for (const server of machines) {
    if (server.sshTargetId || !server.environmentId) {
      continue
    }
    const environment = environments.get(server.environmentId)!
    for (const ssh of machines) {
      if (!ssh.sshTargetId || ssh.environmentId) {
        continue
      }
      const target = targets.get(ssh.sshTargetId)!
      const reason = matchReason(ssh, server, target, environment, identifying)
      if (
        reason &&
        // Only a server deployed over this target outranks the user's split.
        (environment.linkedSshTargetId === target.id ||
          !isSeparated(previous.separations, target.id, environment.id))
      ) {
        candidates.push({ ssh, server, reason })
      }
    }
  }
  const merges: MachineMerge[] = []
  const removed = new Set<string>()
  const replaced = new Map<string, MachineRecord>()
  for (const { ssh, server, reason } of chooseMerges(candidates)) {
    // A server record cut from this target (a store damaged before SSH targets loaded) is the original.
    const survivor = wasCreatedFromTarget(server, ssh.sshTargetId!) ? server : ssh
    const removedRecord = survivor === ssh ? server : ssh
    replaced.set(survivor.id, {
      ...survivor,
      // A merged host keeps its SSH details for one-click switching but runs on its server.
      connection: survivor === server ? survivor.connection : 'server',
      sshTargetId: ssh.sshTargetId,
      environmentId: server.environmentId,
      hostnames: union(ssh.hostnames, server.hostnames),
      machineIds: union(ssh.machineIds, server.machineIds),
      absorbedEnvironmentIds: union(ssh.absorbedEnvironmentIds, server.absorbedEnvironmentIds),
      serverInstall: ssh.serverInstall ?? server.serverInstall,
      createdAt: Math.min(ssh.createdAt, server.createdAt),
      updatedAt: now
    })
    removed.add(removedRecord.id)
    merges.push({
      machineId: survivor.id,
      removedMachineId: removedRecord.id,
      sshTargetId: ssh.sshTargetId!,
      environmentId: server.environmentId!,
      reason
    })
  }
  const merged = machines
    .filter((machine) => !removed.has(machine.id))
    .map((machine) => replaced.get(machine.id) ?? machine)
  const absorbed = absorbServers(merged, environments, previous.separations, now)
  merges.push(...absorbed.merges)
  const store: MachineStore = {
    version: 1,
    machines: absorbed.machines,
    separations: previous.separations.filter(
      (pair) => targets.has(pair.sshTargetId) && environments.has(pair.environmentId)
    )
  }
  return { store, merges, changed: JSON.stringify(store) !== JSON.stringify(previous) }
}
