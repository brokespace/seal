import { describe, expect, it } from 'vitest'
import { EMPTY_MACHINE_STORE, type MachineStore } from '../../../shared/machines/machine-record'
import type { MachineId } from '../../../shared/machines/machine-types'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection, MachineTransport } from '../connection/machine-connection'
import {
  MachineRegistry,
  type MachineRegistryEnvironment,
  type MachineRegistrySshTarget
} from './machine-registry'

type Dialed = { machineId: MachineId; transport: MachineTransport; link: string }

function fakeConnection(
  dialed: Dialed[],
  machineId: MachineId,
  transport: MachineTransport,
  link: string,
  identityMachineId: string | null
): MachineConnection {
  dialed.push({ machineId, transport, link })
  return {
    ...createLocalMachineConnection(),
    machineId,
    transport,
    identity: async () => ({ hostname: null, machineId: identityMachineId })
  }
}

function registryFor(
  sshTargets: MachineRegistrySshTarget[],
  environments: MachineRegistryEnvironment[],
  identities: Record<string, string> = {}
) {
  let saved: MachineStore = EMPTY_MACHINE_STORE
  const dialed: Dialed[] = []
  const registry = new MachineRegistry({
    readStore: () => saved,
    writeStore: (store) => {
      saved = store
    },
    sshTargets: () => sshTargets,
    environments: () => environments,
    local: createLocalMachineConnection,
    sshConnection: (id, targetId) =>
      fakeConnection(dialed, id, 'ssh', targetId, identities[targetId] ?? null),
    serverConnection: (id, environmentId) =>
      fakeConnection(dialed, id, 'server', environmentId, identities[environmentId] ?? null),
    changed: () => {},
    now: () => 1000
  })
  return { registry, dialed, saved: () => saved }
}

const kesselSsh: MachineRegistrySshTarget = {
  id: 'ssh-kessel',
  label: 'kessel-ml',
  host: 'kessel-ml',
  username: 'brian',
  port: 22
}
const kesselServer: MachineRegistryEnvironment = {
  id: 'env-kessel',
  name: 'kessel-ml',
  endpoints: ['ws://100.101.7.4:6768'],
  linkedSshTargetId: null,
  machineName: null,
  preferredEndpoint: 'ws://100.101.7.4:6768'
}

describe('MachineRegistry', () => {
  it('routes every feature of a merged machine through the transport it is set to', () => {
    const { registry, dialed } = registryFor([kesselSsh], [kesselServer])

    const [view] = registry.list()
    const onServer = registry.connection(view.id)
    const scanOnServer = registry.liveSessionSources()
    registry.setConnection(view.id, 'ssh')
    const onSsh = registry.connection(view.id)
    const scanOnSsh = registry.liveSessionSources()

    expect(view).toMatchObject({ id: 'machine:ssh-kessel', connection: 'server' })
    expect(dialed).toEqual([
      { machineId: 'machine:ssh-kessel', transport: 'server', link: 'env-kessel' },
      { machineId: 'machine:ssh-kessel', transport: 'ssh', link: 'ssh-kessel' }
    ])
    expect([onServer.transport, onSsh.transport]).toEqual(['server', 'ssh'])
    expect(registry.connectsOverSsh('ssh-kessel')).toBe(true)
    expect(scanOnServer.map((source) => [source.recordId, source.executionHostId])).toEqual([
      ['ssh-kessel', 'runtime:env-kessel']
    ])
    expect(scanOnSsh.map((source) => [source.recordId, source.executionHostId])).toEqual([
      ['ssh-kessel', 'ssh:ssh-kessel']
    ])
  })

  it('keeps a server-connected machine from starting an SSH session for its stored details', () => {
    const { registry } = registryFor([kesselSsh], [kesselServer])
    expect(registry.connectsOverSsh('ssh-kessel')).toBe(false)
  })

  it('merges two machines once each transport reports the same OS machine id', async () => {
    const lab: MachineRegistrySshTarget = {
      id: 'ssh-lab',
      label: 'lab',
      host: '10.0.0.5',
      username: 'brian',
      port: 22
    }
    const office: MachineRegistryEnvironment = {
      id: 'env-office',
      name: 'office',
      endpoints: ['wss://relay.example.com/x'],
      linkedSshTargetId: null,
      machineName: null,
      preferredEndpoint: null
    }
    const { registry, saved } = registryFor([lab], [office], {
      'ssh-lab': 'f00d',
      'env-office': 'f00d'
    })
    expect(registry.list()).toHaveLength(2)

    await registry.probeIdentity('machine:ssh-lab')
    await registry.probeIdentity('machine:env-office')

    expect(registry.list().map((view) => [view.id, view.connection])).toEqual([
      ['machine:ssh-lab', 'server']
    ])
    expect(saved().machines[0]).toMatchObject({
      sshTargetId: 'ssh-lab',
      environmentId: 'env-office',
      machineIds: ['f00d']
    })
  })

  it('adds a pairing to an existing SSH machine without switching how it connects', () => {
    const environments: MachineRegistryEnvironment[] = []
    const { registry } = registryFor(
      [{ id: 'ssh-gpu', label: 'gpu', host: '10.0.0.9', username: 'b', port: 22 }],
      environments
    )
    registry.list()
    environments.push({
      id: 'env-gpu',
      name: 'gpu server',
      endpoints: ['ws://10.0.0.77:6768'],
      linkedSshTargetId: null,
      machineName: null,
      preferredEndpoint: null
    })

    const view = registry.adopt({
      link: { environmentId: 'env-gpu' },
      connection: 'ssh',
      machineId: 'machine:ssh-gpu'
    })

    expect(view).toMatchObject({ id: 'machine:ssh-gpu', connection: 'ssh' })
    expect(view.server?.environmentId).toBe('env-gpu')
    expect(registry.list()).toHaveLength(1)
  })
})
