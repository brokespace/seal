import { describe, expect, it } from 'vitest'
import { EMPTY_MACHINE_STORE, type MachineStore } from './machine-record'
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
