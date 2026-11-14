import {
  activeMachineConnection,
  type MachineConnectionType,
  type MachineRecord,
  type MachineStore
} from '../../../shared/machines/machine-record'
import {
  attachToMachine,
  observeMachineIdentity,
  reconcileMachines,
  separateMachine,
  setMachineConnection,
  type MachineEnvironmentFacts,
  type MachineMerge,
  type MachineSshTargetFacts
} from '../../../shared/machines/machine-reconcile'
import {
  LOCAL_MACHINE_ID,
  machineRecordId,
  toMachineId,
  type MachineId
} from '../../../shared/machines/machine-types'
import type { MachineView } from '../../../shared/machines/machine-view'
import { buildMachineViews } from './machine-views'
import type { MachineConnection } from '../connection/machine-connection'

export type MachineRegistrySshTarget = MachineSshTargetFacts & {
  username: string
  port: number
  identityFile?: string
  jumpHost?: string
}

export type MachineRegistryEnvironment = MachineEnvironmentFacts & {
  preferredEndpoint: string | null
}

export type MachineRegistryDeps = {
  readStore(): MachineStore
  writeStore(store: MachineStore): void
  sshTargets(): readonly MachineRegistrySshTarget[]
  environments(): readonly MachineRegistryEnvironment[]
  local(): MachineConnection
  sshConnection(machineId: MachineId, targetId: string): MachineConnection
  serverConnection(machineId: MachineId, environmentId: string): MachineConnection
  changed(): void
  now(): number
  log?(message: string, error?: unknown): void
}

type CachedConnection = { key: string; connection: MachineConnection }

/** Owns machine records: migrates and merges them, and hands out one connection per machine. */
export class MachineRegistry {
  private store: MachineStore | null = null
  private readonly connections = new Map<string, CachedConnection>()
  private readonly identityProbes = new Map<string, Promise<void>>()
  private readonly probedTransports = new Set<string>()
  private lastMerges: MachineMerge[] = []

  constructor(private readonly deps: MachineRegistryDeps) {}

  /** Rebuild from the SSH and server stores; persists and notifies only when something moved. */
  reconcile(): MachineStore {
    const previous = this.store ?? this.deps.readStore()
    const result = reconcileMachines(
      previous,
      { sshTargets: this.deps.sshTargets(), environments: this.deps.environments() },
      this.deps.now()
    )
    this.store = result.store
    if (result.merges.length > 0) {
      this.lastMerges = result.merges
      for (const merge of result.merges) {
        this.deps.log?.(
          `[machines] merged ${merge.removedMachineId} into ${merge.machineId} (${merge.reason})`
        )
      }
    }
    if (result.changed) {
      this.persist(result.store)
    }
    return result.store
  }

  private persist(store: MachineStore): void {
    this.store = store
    try {
      this.deps.writeStore(store)
    } catch (error) {
      this.deps.log?.('[machines] could not save machines', error)
    }
    this.deps.changed()
  }

  private current(): MachineStore {
    return this.store ?? this.reconcile()
  }

  merges(): readonly MachineMerge[] {
    return this.lastMerges
  }

  records(): readonly MachineRecord[] {
    return this.current().machines
  }

  record(machineId: string): MachineRecord | null {
    const recordId = machineRecordId(machineId)
    return this.current().machines.find((machine) => machine.id === recordId) ?? null
  }

  recordForSshTarget(targetId: string): MachineRecord | null {
    return this.current().machines.find((machine) => machine.sshTargetId === targetId) ?? null
  }

  recordForEnvironment(environmentId: string): MachineRecord | null {
    return (
      this.current().machines.find((machine) => machine.environmentId === environmentId) ?? null
    )
  }

  /** True when this SSH target belongs to a machine the user set to connect over SSH. */
  connectsOverSsh(targetId: string): boolean {
    const record = this.recordForSshTarget(targetId)
    return record ? activeMachineConnection(record) === 'ssh' : false
  }

  list(): MachineView[] {
    return buildMachineViews(this.reconcile(), this.deps.sshTargets(), this.deps.environments())
  }

  /** The one connection every feature uses for this machine, whichever transport it is set to. */
  connection(machineId: string): MachineConnection {
    if (machineId === LOCAL_MACHINE_ID) {
      return this.deps.local()
    }
    const record = this.record(machineId)
    const transport = record ? activeMachineConnection(record) : null
    if (!record || !transport) {
      throw new Error('Unknown machine')
    }
    const key = transport === 'ssh' ? `ssh:${record.sshTargetId}` : `server:${record.environmentId}`
    const cached = this.connections.get(record.id)
    if (cached?.key === key) {
      return cached.connection
    }
    const id = toMachineId(record.id)
    const connection =
      transport === 'ssh'
        ? this.deps.sshConnection(id, record.sshTargetId!)
        : this.deps.serverConnection(id, record.environmentId!)
    this.connections.set(record.id, { key, connection })
    return connection
  }

  /** Each machine's scan source, keyed by record id so session ids survive merges and switches. */
  liveSessionSources(): {
    recordId: string
    machineId: string
    name: string
    executionHostId: string
    /** Set when the machine connects via its Seal server. */
    environmentId: string | null
    connection: MachineConnection
  }[] {
    this.reconcile()
    return this.current().machines.flatMap((record) => {
      const transport = activeMachineConnection(record)
      if (!transport) {
        return []
      }
      return [
        {
          recordId: record.id,
          machineId: toMachineId(record.id),
          name: record.name,
          executionHostId:
            transport === 'ssh' ? `ssh:${record.sshTargetId}` : `runtime:${record.environmentId}`,
          environmentId: transport === 'server' ? record.environmentId : null,
          connection: this.connection(toMachineId(record.id))
        }
      ]
    })
  }

  /** Ask the live transport who the host is; a new answer can merge machines. */
  probeIdentity(machineId: string): Promise<void> {
    const record = this.record(machineId)
    const transport = record ? activeMachineConnection(record) : null
    if (!record || !transport) {
      return Promise.resolve()
    }
    const probeKey = `${record.id}:${transport}`
    if (this.probedTransports.has(probeKey)) {
      return this.identityProbes.get(record.id) ?? Promise.resolve()
    }
    this.probedTransports.add(probeKey)
    const probe = (async () => {
      const identity = await this.connection(machineId).identity()
      const link =
        transport === 'ssh'
          ? { sshTargetId: record.sshTargetId! }
          : { environmentId: record.environmentId! }
      const next = observeMachineIdentity(this.current(), link, identity, this.deps.now())
      if (next !== this.current()) {
        this.persist(next)
        this.reconcile()
      }
    })()
      .catch((error: unknown) => {
        this.probedTransports.delete(probeKey)
        this.deps.log?.('[machines] identity probe failed', error)
      })
      .finally(() => this.identityProbes.delete(record.id))
    this.identityProbes.set(record.id, probe)
    return probe
  }

  setConnection(machineId: string, connection: MachineConnectionType): MachineView {
    const recordId = this.requireRecordId(machineId)
    this.persist(setMachineConnection(this.current(), recordId, connection, this.deps.now()))
    return this.requireView(recordId)
  }

  rename(machineId: string, name: string): MachineView {
    const recordId = this.requireRecordId(machineId)
    const trimmed = name.trim()
    if (!trimmed) {
      throw new Error('A machine needs a name')
    }
    const store = this.current()
    this.persist({
      ...store,
      machines: store.machines.map((machine) =>
        machine.id === recordId
          ? { ...machine, name: trimmed, updatedAt: this.deps.now() }
          : machine
      )
    })
    return this.requireView(recordId)
  }

  /** Bind a just-added SSH target or server to a machine and choose how it connects. */
  adopt(args: {
    link: { sshTargetId: string } | { environmentId: string }
    connection: MachineConnectionType
    name?: string
    machineId?: string
  }): MachineView {
    this.reconcile()
    let store = this.current()
    if (args.machineId) {
      store = attachToMachine(
        store,
        this.requireRecordId(args.machineId),
        args.link,
        this.deps.now()
      )
    }
    const record = store.machines.find((machine) =>
      'sshTargetId' in args.link
        ? machine.sshTargetId === args.link.sshTargetId
        : machine.environmentId === args.link.environmentId
    )
    if (!record) {
      throw new Error('Those details are not saved yet')
    }
    store = setMachineConnection(store, record.id, args.connection, this.deps.now())
    this.persist(store)
    if (args.name) {
      return this.rename(toMachineId(record.id), args.name)
    }
    return this.requireView(record.id)
  }

  separate(machineId: string): MachineView[] {
    const recordId = this.requireRecordId(machineId)
    this.persist(separateMachine(this.current(), recordId, this.deps.now()))
    return this.list()
  }

  private requireRecordId(machineId: string): string {
    const record = this.record(machineId)
    if (!record) {
      throw new Error('Machine not found')
    }
    return record.id
  }

  private requireView(recordId: string): MachineView {
    const view = this.list().find((machine) => machine.recordId === recordId)
    if (!view) {
      throw new Error('Machine not found')
    }
    return view
  }
}
