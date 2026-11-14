import type { MachineRecord, MachineStore } from './machine-record'
import {
  chooseMerges,
  identifyingServerAddresses,
  isSeparated,
  matchReason,
  type Candidate,
  type MachineEnvironmentFacts,
  type MachineMergeReason,
  type MachineSshTargetFacts
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
        (reason === 'linked' || !isSeparated(previous.separations, target.id, environment.id))
      ) {
        candidates.push({ ssh, server, reason })
      }
    }
  }
  const merges: MachineMerge[] = []
  const removed = new Set<string>()
  const replaced = new Map<string, MachineRecord>()
  for (const { ssh, server, reason } of chooseMerges(candidates)) {
    replaced.set(ssh.id, {
      ...ssh,
      // A merged host keeps its SSH details for one-click switching but runs on its server.
      connection: 'server',
      environmentId: server.environmentId,
      hostnames: union(ssh.hostnames, server.hostnames),
      machineIds: union(ssh.machineIds, server.machineIds),
      createdAt: Math.min(ssh.createdAt, server.createdAt),
      updatedAt: now
    })
    removed.add(server.id)
    merges.push({
      machineId: ssh.id,
      removedMachineId: server.id,
      sshTargetId: ssh.sshTargetId!,
      environmentId: server.environmentId!,
      reason
    })
  }
  const store: MachineStore = {
    version: 1,
    machines: machines
      .filter((machine) => !removed.has(machine.id))
      .map((machine) => replaced.get(machine.id) ?? machine),
    separations: previous.separations.filter(
      (pair) => targets.has(pair.sshTargetId) && environments.has(pair.environmentId)
    )
  }
  return { store, merges, changed: JSON.stringify(store) !== JSON.stringify(previous) }
}
