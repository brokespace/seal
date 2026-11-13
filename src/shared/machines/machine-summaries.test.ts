import { describe, expect, it } from 'vitest'
import type { MachineView } from './machine-view'
import type { RuntimeHostStatusSnapshot } from '../remote-runtime/host-status/runtime-host-status'
import { buildMachineSummaries, type MachineSummaryInputs } from './machine-summaries'

const kesselMl: MachineView = {
  id: 'machine:kessel-ssh',
  recordId: 'kessel-ssh',
  name: 'kessel-ml',
  connection: 'server',
  ssh: {
    targetId: 'kessel-ssh',
    address: 'brian@kessel-ml:2222',
    host: 'kessel-ml',
    username: 'brian',
    port: 2222,
    identityFile: null,
    jumpHost: null
  },
  server: { environmentId: 'env-kessel', name: 'kessel-ml server', endpoint: 'ws://kessel-ml:6768' }
}

const droppedServer: RuntimeHostStatusSnapshot = {
  environmentId: 'env-kessel',
  pairingRevision: 1,
  sequence: 1,
  checkedAt: 1,
  status: null,
  verification: 'verified',
  transport: 'disconnected'
}

describe('buildMachineSummaries', () => {
  it('reports each machine once, through the transport it is set to use', () => {
    const inputs: Omit<MachineSummaryInputs, 'machines'> = {
      localName: 'This computer',
      localOs: 'darwin',
      sshStates: new Map([
        ['kessel-ssh', { status: 'connected', error: null, remotePlatform: 'linux' }]
      ]),
      runtimeStatuses: new Map([['env-kessel', droppedServer]])
    }
    const overServer = buildMachineSummaries({ ...inputs, machines: [kesselMl] })
    expect(overServer.map((m) => m.id)).toEqual(['local', 'machine:kessel-ssh'])
    expect(overServer[1]).toMatchObject({
      connection: 'server',
      // A live SSH session must not make a server machine look online.
      status: 'offline',
      address: 'brian@kessel-ml:2222',
      executionHostId: 'runtime:env-kessel',
      sshTargetId: 'kessel-ssh'
    })

    const overSsh = buildMachineSummaries({
      ...inputs,
      machines: [{ ...kesselMl, connection: 'ssh' }]
    })
    expect(overSsh[1]).toMatchObject({
      connection: 'ssh',
      status: 'online',
      os: 'linux',
      executionHostId: 'ssh:kessel-ssh',
      runtimeEnvironmentId: 'env-kessel'
    })
  })
})
