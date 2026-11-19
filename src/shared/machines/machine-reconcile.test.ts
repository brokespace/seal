import { describe, expect, it } from 'vitest'
import { EMPTY_MACHINE_STORE, type MachineRecord, type MachineStore } from './machine-record'
import {
  attachToMachine,
  observeMachineIdentity,
  reconcileMachines,
  separateMachine,
  setMachineConnection,
  type MachineEnvironmentFacts,
  type MachineSshTargetFacts
} from './machine-reconcile'

const kesselSsh: MachineSshTargetFacts = {
  id: 'ssh-kessel',
  label: 'kessel-ml',
  host: 'brian@kessel-ml.tail9f2.ts.net'
}
const kesselServer: MachineEnvironmentFacts = {
  id: 'env-kessel',
  name: 'kessel-ml server',
  endpoints: ['ws://100.101.7.4:6768'],
  linkedSshTargetId: null,
  machineName: 'kessel-ml'
}
const gpuSsh: MachineSshTargetFacts = { id: 'ssh-gpu', label: 'gpu-box', host: '10.0.0.9' }

function reconcile(
  sshTargets: MachineSshTargetFacts[],
  environments: MachineEnvironmentFacts[],
  previous: MachineStore = EMPTY_MACHINE_STORE
): ReturnType<typeof reconcileMachines> {
  return reconcileMachines(previous, { sshTargets, environments }, 1000)
}

describe('reconcileMachines', () => {
  it('migrates kessel-ml, saved as both an SSH host and a server, into one machine on its server', () => {
    const { store, merges } = reconcile([kesselSsh, gpuSsh], [kesselServer])

    expect(store.machines).toEqual([
      {
        id: 'ssh-kessel',
        name: 'kessel-ml',
        connection: 'server',
        sshTargetId: 'ssh-kessel',
        environmentId: 'env-kessel',
        hostnames: [],
        machineIds: [],
        absorbedEnvironmentIds: [],
        createdAt: 1000,
        updatedAt: 1000
      },
      {
        id: 'ssh-gpu',
        name: 'gpu-box',
        connection: 'ssh',
        sshTargetId: 'ssh-gpu',
        environmentId: null,
        hostnames: [],
        machineIds: [],
        absorbedEnvironmentIds: [],
        createdAt: 1000,
        updatedAt: 1000
      }
    ])
    expect(merges).toEqual([
      {
        machineId: 'ssh-kessel',
        removedMachineId: 'env-kessel',
        sshTargetId: 'ssh-kessel',
        environmentId: 'env-kessel',
        reason: 'hostname'
      }
    ])
  })

  it('is stable once migrated', () => {
    const first = reconcile([kesselSsh, gpuSsh], [kesselServer]).store
    const second = reconcile([kesselSsh, gpuSsh], [kesselServer], first)
    expect(second.changed).toBe(false)
    expect(second.store).toEqual(first)
  })

  it('keeps a user-chosen SSH connection across restarts', () => {
    const migrated = reconcile([kesselSsh], [kesselServer]).store
    const switched = setMachineConnection(migrated, 'ssh-kessel', 'ssh', 2000)
    const next = reconcile([kesselSsh], [kesselServer], switched).store
    expect(next.machines).toHaveLength(1)
    expect(next.machines[0]).toMatchObject({
      connection: 'ssh',
      sshTargetId: 'ssh-kessel',
      environmentId: 'env-kessel'
    })
  })

  it('merges a managed server with the SSH target that deployed it, whatever their names', () => {
    const { merges } = reconcile(
      [{ id: 'ssh-a', label: 'work', host: '192.168.1.20' }],
      [
        {
          id: 'env-a',
          name: 'office',
          endpoints: ['ws://127.0.0.1:41234'],
          linkedSshTargetId: 'ssh-a',
          machineName: null
        }
      ]
    )
    expect(merges.map((merge) => merge.reason)).toEqual(['linked'])
  })

  it('merges on a shared address but not on a relay address several servers use', () => {
    const direct = reconcile(
      [{ id: 'ssh-a', label: 'a', host: '100.70.1.2' }],
      [
        {
          id: 'env-a',
          name: 'x',
          endpoints: ['ws://100.70.1.2:6768'],
          linkedSshTargetId: null,
          machineName: null
        }
      ]
    )
    expect(direct.merges.map((merge) => merge.reason)).toEqual(['address'])

    const relayed = reconcile(
      [{ id: 'ssh-a', label: 'a', host: 'relay.example.com' }],
      [
        {
          id: 'env-a',
          name: 'x',
          endpoints: ['wss://relay.example.com/a'],
          linkedSshTargetId: null,
          machineName: null
        },
        {
          id: 'env-b',
          name: 'y',
          endpoints: ['wss://relay.example.com/b'],
          linkedSshTargetId: null,
          machineName: null
        }
      ]
    )
    expect(relayed.merges).toEqual([])
    expect(relayed.store.machines).toHaveLength(3)
  })

  it('does not merge same-named hosts whose OS machine ids differ', () => {
    let store = reconcile([kesselSsh], [kesselServer]).store
    store = separateMachine(store, 'ssh-kessel', 1100)
    store = observeMachineIdentity(
      store,
      { sshTargetId: 'ssh-kessel' },
      { hostname: 'kessel-ml', machineId: 'AAA' },
      1200
    )
    store = observeMachineIdentity(
      store,
      { environmentId: 'env-kessel' },
      { hostname: 'kessel-ml', machineId: 'BBB' },
      1200
    )
    const result = reconcile([kesselSsh], [kesselServer], { ...store, separations: [] })
    expect(result.merges).toEqual([])
  })

  it('never re-merges a pair the user split', () => {
    const split = separateMachine(reconcile([kesselSsh], [kesselServer]).store, 'ssh-kessel', 1100)
    const next = reconcile([kesselSsh], [kesselServer], split)
    expect(next.merges).toEqual([])
    expect(next.store.machines.map((machine) => [machine.connection, machine.id])).toEqual([
      ['ssh', 'ssh-kessel'],
      ['server', 'env-kessel']
    ])
  })

  it('keeps a machine when one of its transports is deleted, and drops it only when both are', () => {
    const merged = reconcile([kesselSsh], [kesselServer]).store
    const serverGone = reconcile([kesselSsh], [], merged).store
    expect(serverGone.machines).toEqual([
      expect.objectContaining({ id: 'ssh-kessel', sshTargetId: 'ssh-kessel', environmentId: null })
    ])
    expect(reconcile([], [], merged).store.machines).toEqual([])
  })
})

const managedServerA: MachineEnvironmentFacts = {
  id: 'env-a',
  name: 'kessel-ar-dev',
  endpoints: [],
  linkedSshTargetId: 'ssh-ar',
  machineName: null
}
const managedServerB = { ...managedServerA, id: 'env-b' }
const arSsh: MachineSshTargetFacts = { id: 'ssh-ar', label: 'kessel-ar-dev', host: 'ar-dev' }
const installed = { policy: 'auto', state: 'installed' } as const

function fullMachine(overrides: Partial<MachineRecord> = {}): MachineRecord {
  return {
    id: 'ssh-ar',
    name: 'kessel-ar-dev',
    connection: 'server',
    sshTargetId: 'ssh-ar',
    environmentId: 'env-b',
    hostnames: [],
    machineIds: [],
    absorbedEnvironmentIds: [],
    serverInstall: installed,
    createdAt: 500,
    updatedAt: 500,
    ...overrides
  }
}

describe('absorbed servers', () => {
  const store = (machine: MachineRecord): MachineStore => ({
    ...EMPTY_MACHINE_STORE,
    machines: [machine]
  })

  it('folds a second server linked to a full machine into it instead of listing it twice', () => {
    const result = reconcile([arSsh], [managedServerA, managedServerB], store(fullMachine()))
    expect(result.store.machines).toEqual([
      fullMachine({ absorbedEnvironmentIds: ['env-a'], updatedAt: 1000 })
    ])
    expect(result.merges).toEqual([
      {
        machineId: 'ssh-ar',
        removedMachineId: 'env-a',
        sshTargetId: 'ssh-ar',
        environmentId: 'env-a',
        reason: 'linked'
      }
    ])
    expect(reconcile([arSsh], [managedServerA, managedServerB], result.store).changed).toBe(false)
  })

  it('leaves a server the user separated from the machine as its own machine', () => {
    const previous = {
      ...store(fullMachine()),
      separations: [{ sshTargetId: 'ssh-ar', environmentId: 'env-a' }]
    }
    const { store: next } = reconcile([arSsh], [managedServerA, managedServerB], previous)
    expect(next.machines.map((machine) => machine.id)).toEqual(['ssh-ar', 'env-a'])
  })

  it('forgets an absorbed server once it is deleted', () => {
    const previous = store(fullMachine({ absorbedEnvironmentIds: ['env-a'] }))
    const { store: next } = reconcile([arSsh], [managedServerB], previous)
    expect(next.machines[0].absorbedEnvironmentIds).toEqual([])
  })

  it('keeps an absorbed server hidden across reconciles', () => {
    const previous = store(fullMachine({ absorbedEnvironmentIds: ['env-a'] }))
    const { store: next } = reconcile([arSsh], [managedServerA, managedServerB], previous)
    expect(next.machines).toHaveLength(1)
  })

  it('does not absorb a server that only shares an OS machine id with a full machine', () => {
    const previous: MachineStore = {
      ...EMPTY_MACHINE_STORE,
      machines: [
        fullMachine({ machineIds: ['mid-1'] }),
        fullMachine({
          id: 'env-a',
          sshTargetId: null,
          environmentId: 'env-a',
          machineIds: ['mid-1'],
          serverInstall: undefined
        })
      ]
    }
    const unlinked = { ...managedServerA, linkedSshTargetId: null }
    const { store: next } = reconcile([arSsh], [unlinked, managedServerB], previous)
    expect(next.machines.map((machine) => machine.id)).toEqual(['ssh-ar', 'env-a'])
  })

  it('releases an absorbed server when the machine loses its own server, then pairs it normally', () => {
    const previous = store(fullMachine({ absorbedEnvironmentIds: ['env-a'] }))
    const { store: next } = reconcile([arSsh], [managedServerA], previous)
    expect(
      next.machines.map((machine) => [
        machine.id,
        machine.environmentId,
        machine.absorbedEnvironmentIds
      ])
    ).toEqual([['ssh-ar', 'env-a', []]])
  })

  it('releases an absorbed server that is not linked to the machine target', () => {
    const previous = store(fullMachine({ absorbedEnvironmentIds: ['env-a'] }))
    const other = { ...managedServerA, linkedSshTargetId: 'ssh-other' }
    const { store: next } = reconcile([arSsh], [other, managedServerB], previous)
    expect(next.machines.map((machine) => [machine.id, machine.absorbedEnvironmentIds])).toEqual([
      ['ssh-ar', []],
      ['env-a', []]
    ])
  })

  it('keeps a split machine split by separating its absorbed servers too', () => {
    const split = separateMachine(
      store(fullMachine({ absorbedEnvironmentIds: ['env-a'] })),
      'ssh-ar',
      1100
    )
    expect(split.separations).toEqual([
      { sshTargetId: 'ssh-ar', environmentId: 'env-b' },
      { sshTargetId: 'ssh-ar', environmentId: 'env-a' }
    ])
    expect(split.machines.flatMap((machine) => machine.absorbedEnvironmentIds)).toEqual([])
  })

  it('absorbs the server a new one replaces instead of orphaning it', () => {
    const replaced = attachToMachine(
      store(fullMachine({ environmentId: 'env-a' })),
      'ssh-ar',
      { environmentId: 'env-b' },
      2000
    )
    expect(replaced.machines[0]).toMatchObject({
      environmentId: 'env-b',
      absorbedEnvironmentIds: ['env-a']
    })
    const { store: next } = reconcile([arSsh], [managedServerA, managedServerB], replaced)
    expect(next.machines).toHaveLength(1)
  })

  it('releases an absorbed server when it is attached elsewhere', () => {
    const attached = attachToMachine(
      {
        ...EMPTY_MACHINE_STORE,
        machines: [
          fullMachine({ absorbedEnvironmentIds: ['env-a'] }),
          fullMachine({ id: 'ssh-gpu', sshTargetId: 'ssh-gpu', environmentId: null })
        ]
      },
      'ssh-gpu',
      { environmentId: 'env-a' },
      2000
    )
    expect(attached.machines.map((machine) => machine.absorbedEnvironmentIds)).toEqual([[], []])
  })

  it('heals a machine whose SSH link was dropped before SSH targets loaded', () => {
    const damaged = store(
      fullMachine({ id: 'ssh-ar', sshTargetId: null, connection: 'server', environmentId: 'env-b' })
    )
    const { store: next } = reconcile([arSsh], [managedServerB], damaged)
    expect(next.machines).toEqual([fullMachine({ updatedAt: 1000 })])
  })

  it('keeps the connection the user chose when a damaged machine is repaired', () => {
    const damaged = store(fullMachine({ sshTargetId: null, connection: 'ssh' }))
    const { store: next } = reconcile([arSsh], [managedServerB], damaged)
    expect(next.machines).toEqual([fullMachine({ connection: 'ssh', updatedAt: 1000 })])
  })
})

describe('attachToMachine', () => {
  it('pairs a server with an existing SSH machine without switching its connection', () => {
    const store = reconcile([gpuSsh], []).store
    const paired = attachToMachine(store, 'ssh-gpu', { environmentId: 'env-gpu' }, 2000)
    expect(paired.machines).toEqual([
      expect.objectContaining({ id: 'ssh-gpu', connection: 'ssh', environmentId: 'env-gpu' })
    ])
  })

  it('refuses details that already belong to another full machine', () => {
    const store = reconcile([kesselSsh, gpuSsh], [kesselServer]).store
    expect(() => attachToMachine(store, 'ssh-gpu', { environmentId: 'env-kessel' }, 2000)).toThrow(
      'Those details already belong to another machine'
    )
  })
})
