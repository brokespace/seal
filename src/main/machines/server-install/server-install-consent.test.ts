import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saved = vi.hoisted(() => ({ environments: [] as unknown[] }))

vi.mock('../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '/user-data' })
}))
vi.mock('../../../shared/remote-runtime/host-store/runtime-environment-store', () => ({
  listEnvironments: () => saved.environments
}))

import { EMPTY_MACHINE_STORE, type MachineStore } from '../../../shared/machines/machine-record'
import {
  DECLINED_SERVER_INSTALL,
  pendingServerInstall,
  setMachineServerInstall
} from '../../../shared/machines/machine-server-install'
import type { SshTarget } from '../../../shared/ssh-types'
import type { SshConnectionStore } from '../../ssh/targets/ssh-connection-store'
import { setSshTargetRegistryStore } from '../../ssh/targets/ssh-target-registry'
import {
  MachineRegistry,
  type MachineRegistryEnvironment,
  type MachineRegistrySshTarget
} from '../registry/machine-registry'
import { forgetOwnSealServe, noteOwnSealServe } from './machine-server-install-activity'
import { assertServerDeployIsConfirmed, sshConnectUsesSealServer } from './server-install-consent'

const TARGET = 'ssh-kessel'
const kessel: SshTarget = {
  id: TARGET,
  label: 'kessel-ml',
  host: 'kessel-ml',
  port: 22,
  username: 'brian'
}

function serverFacts(
  id: string,
  link: Pick<MachineRegistryEnvironment, 'linkedSshTargetId' | 'managedSshTargetId'>
): MachineRegistryEnvironment {
  return {
    id,
    name: 'kessel-ml',
    endpoints: ['ws://127.0.0.1:46768'],
    machineName: null,
    preferredEndpoint: 'ws://127.0.0.1:46768',
    ...link
  }
}

/** The user's own `seal serve`, reached through a tunnel over the machine's SSH details. */
const ownServer = serverFacts('env-own', { linkedSshTargetId: TARGET, managedSshTargetId: null })
/** The server Seal deployed over the machine's SSH details. */
const sealServer = serverFacts('env-seal', {
  linkedSshTargetId: TARGET,
  managedSshTargetId: TARGET
})

function machinesOf(
  sshTargets: MachineRegistrySshTarget[],
  environments: MachineRegistryEnvironment[]
): MachineRegistry {
  let store: MachineStore = EMPTY_MACHINE_STORE
  const notDialed = (): never => {
    throw new Error('These tests dial no machine')
  }
  return new MachineRegistry({
    readStore: () => store,
    writeStore: (next) => {
      store = next
    },
    sshTargets: () => sshTargets,
    environments: () => environments,
    local: notDialed,
    sshConnection: notDialed,
    serverConnection: notDialed,
    changed: () => {},
    now: () => 1000
  })
}

function saveSshTargets(...targets: SshTarget[]): void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the rule only reads targets by id.
  setSshTargetRegistryStore({
    getTarget: (id: string) => targets.find((target) => target.id === id)
  } as unknown as SshConnectionStore)
}

/** Seal's deployment as both stores hold it: the saved server names the target, and the target is held for it. */
function saveSealDeployment(): void {
  saved.environments = [
    {
      id: sealServer.id,
      orcadDeployment: {
        sshTargetId: TARGET,
        sshTargetGeneration: 1,
        localPort: 46_768,
        remotePort: 16_768
      }
    }
  ]
  saveSshTargets({ ...kessel, orcadFence: { environmentId: sealServer.id } })
}

function awaitInstall(machines: MachineRegistry): void {
  machines.edit((store, now) =>
    setMachineServerInstall(store, TARGET, pendingServerInstall(null, now), now)
  )
}

describe('which SSH connects use Seal server', () => {
  beforeEach(() => {
    saved.environments = []
    saveSshTargets(kessel)
  })

  afterEach(() => {
    forgetOwnSealServe(TARGET)
    setSshTargetRegistryStore(null)
  })

  it('gives SSH details saved after the machines were last read a plain session', () => {
    const sshTargets: MachineRegistrySshTarget[] = []
    const machines = machinesOf(sshTargets, [])
    machines.list()
    sshTargets.push(kessel)

    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
    expect(machines.recordForSshTarget(TARGET)?.connection).toBe('ssh')
  })

  it('gives SSH details that are no machine a plain session', () => {
    expect(sshConnectUsesSealServer(machinesOf([], []), TARGET)).toBe(false)
    expect(sshConnectUsesSealServer(null, TARGET)).toBe(false)
  })

  it('gives a machine connected through a server Seal did not deploy a plain session', () => {
    const machines = machinesOf([kessel], [ownServer])
    saved.environments = [{ id: ownServer.id, sshAccess: { sshTargetId: TARGET } }]

    expect(machines.list()[0]).toMatchObject({ connection: 'server' })
    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
  })

  it('installs only once the host answered that it runs no server of its own', () => {
    const machines = machinesOf([kessel], [])
    machines.list()
    awaitInstall(machines)

    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
    noteOwnSealServe(TARGET, null)
    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(true)
  })

  it('does not install on a checked host whose install was declined', () => {
    const machines = machinesOf([kessel], [])
    machines.list()
    noteOwnSealServe(TARGET, null)
    machines.edit((store, now) =>
      setMachineServerInstall(store, TARGET, DECLINED_SERVER_INSTALL, now)
    )

    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
  })

  it('connects through the server Seal already deployed, unless the machine is set to SSH', () => {
    const machines = machinesOf([kessel], [sealServer])
    saveSealDeployment()
    const [machine] = machines.list()

    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(true)
    expect(sshConnectUsesSealServer(null, TARGET)).toBe(true)
    machines.setConnection(machine.id, 'ssh')
    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
  })

  it('does not use a saved server that no longer holds the SSH details', () => {
    const machines = machinesOf([kessel], [sealServer])
    saveSealDeployment()
    saveSshTargets(kessel)
    machines.list()

    expect(sshConnectUsesSealServer(machines, TARGET)).toBe(false)
  })

  it('deploys on a VM that a recipe started', () => {
    saveSshTargets({ ...kessel, owner: { type: 'on-demand-runtime', runtimeId: 'vm-1' } })

    expect(sshConnectUsesSealServer(machinesOf([], []), TARGET)).toBe(true)
  })
})

describe('a deploy asked for from Settings', () => {
  beforeEach(() => {
    saved.environments = []
    saveSshTargets(kessel)
  })

  afterEach(() => {
    forgetOwnSealServe(TARGET)
    setSshTargetRegistryStore(null)
  })

  it('is refused on a machine that has no Seal server and no confirmed install', () => {
    const machines = machinesOf([kessel], [])
    machines.list()
    noteOwnSealServe(TARGET, null)

    expect(() => assertServerDeployIsConfirmed(machines, TARGET)).toThrow()
  })

  it('may change the server Seal already deployed', () => {
    const machines = machinesOf([kessel], [sealServer])
    saveSealDeployment()
    const [machine] = machines.list()
    machines.setConnection(machine.id, 'ssh')

    expect(() => assertServerDeployIsConfirmed(machines, TARGET)).not.toThrow()
  })
})
