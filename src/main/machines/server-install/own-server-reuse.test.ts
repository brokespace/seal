import { beforeEach, describe, expect, it, vi } from 'vitest'

type SavedState = { environments: Record<string, unknown>[]; offerEndpoint: string }
const state = vi.hoisted((): SavedState => ({
  environments: [],
  offerEndpoint: 'ws://127.0.0.1:6768'
}))
const link = vi.hoisted(() => vi.fn())
const unlink = vi.hoisted(() => vi.fn())

vi.mock('../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '/user-data' })
}))
vi.mock('../../../shared/remote-runtime/host-store/runtime-environment-store', () => ({
  addEnvironmentFromPairingCode: vi.fn(),
  getPairingConnectionDependency: vi.fn(),
  listEnvironments: () => state.environments,
  parseRemotePairingCode: () => ({
    v: 2,
    endpoint: state.offerEndpoint,
    deviceToken: 'offer-device',
    publicKeyB64: 'host-key'
  }),
  removeEnvironment: vi.fn()
}))
vi.mock('../../ssh/runtime-access/runtime-ssh-access', () => ({
  linkRuntimeSshAccess: link,
  unlinkRuntimeSshAccess: unlink
}))
vi.mock('./machine-ssh-session', () => ({
  onPlainSshSession: (_target: string, work: (session: null) => unknown) => work(null)
}))
vi.mock('./own-seal-serve-check', () => ({
  checkHostForOwnSealServe: async () => ({ manager: 'systemd-user', name: 'seal-serve.service' }),
  forgetOwnSealServeAnswer: vi.fn()
}))
vi.mock('./own-seal-cli-command', () => ({
  OwnSealCliAnswerError: class extends Error {},
  runOwnSealCli: async () => ({ available: true, pairingUrl: 'seal://pair?offer' })
}))
vi.mock('./machine-server-install-activity', () => ({
  machineServerInstallActivity: { installing: () => false },
  noteSealServiceOutcome: vi.fn()
}))
vi.mock('../../managed-server/service/own-seal-serve-probe', () => ({
  readOwnSealServeStartCommand: async () => null
}))
vi.mock('../../ipc/runtime-environments/catalog/runtime-environment-catalog-broadcast', () => ({
  publishRuntimeEnvironmentCatalogChanged: vi.fn()
}))
vi.mock(
  '../../ipc/runtime-environments/connectivity/runtime-environment-manual-disconnect',
  () => ({
    clearRuntimeEnvironmentManualDisconnect: vi.fn()
  })
)
vi.mock('../../ipc/runtime-environments/pairing/runtime-environment-pairing-verification', () => ({
  verifyAndAddRuntimeEnvironmentFromPairingCode: vi.fn()
}))
vi.mock(
  '../../ipc/runtime-environments/pairing/runtime-environment-verified-pairing-publish',
  () => ({
    publishVerifiedPairing: vi.fn()
  })
)
vi.mock('../../ipc/runtime-environments/runtime-environments', () => ({
  invalidateRuntimeEnvironmentTransport: vi.fn()
}))
const MACHINE_ID: MachineId = 'machine:kessel'
const machine = {
  id: MACHINE_ID,
  recordId: 'record-kessel',
  name: 'kessel-ar-dev',
  connection: 'ssh',
  ssh: { targetId: 'ssh-kessel' }
}
vi.mock('../registry/machine-registry-service', () => ({
  getMachineRegistry: () => ({
    view: () => machine,
    reconcile: vi.fn(),
    adopt: () => ({ id: machine.id, recordId: machine.recordId }),
    edit: vi.fn()
  })
}))

import type { MachineId } from '../../../shared/machines/machine-types'
import { reuseOwnServerOnSshMachine } from './own-server-reuse'

/** A server paired earlier through a tunnel the user ran: its saved port is that tunnel's local end. */
function savedThroughUserTunnel(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'env-kessel',
    name: 'kessel-dev',
    preferredEndpointId: 'ws-env-kessel',
    endpoints: [
      {
        id: 'ws-env-kessel',
        kind: 'websocket',
        endpoint: 'ws://127.0.0.1:16768',
        deviceToken: 'saved-device',
        publicKeyB64: 'host-key'
      }
    ],
    ...extra
  }
}

describe('connecting the Seal server a machine already runs', () => {
  beforeEach(() => {
    link.mockReset()
    unlink.mockReset()
    state.offerEndpoint = 'ws://127.0.0.1:6768'
    state.environments = [savedThroughUserTunnel()]
  })

  it('tunnels to the port the server listens on there, not the saved local tunnel port', async () => {
    await reuseOwnServerOnSshMachine(MACHINE_ID)

    expect(link).toHaveBeenCalledTimes(1)
    expect(link.mock.calls[0][1]).toMatchObject({
      selector: 'env-kessel',
      sshTargetId: 'ssh-kessel',
      remotePort: 6768
    })
    expect(unlink).not.toHaveBeenCalled()
  })

  it('drops a link an earlier try left half made before linking again', async () => {
    state.environments = [
      savedThroughUserTunnel({
        pendingSshAccessOperation: { operation: 'link', remotePort: 16_768 }
      })
    ]

    await reuseOwnServerOnSshMachine(MACHINE_ID)

    expect(unlink).toHaveBeenCalledTimes(1)
    expect(unlink.mock.invocationCallOrder[0]).toBeLessThan(link.mock.invocationCallOrder[0])
    expect(link.mock.calls[0][1]).toMatchObject({ remotePort: 6768 })
  })

  it('says which tunnel failed and why, and drops the half-made link', async () => {
    link.mockImplementation(async () => {
      state.environments = [
        savedThroughUserTunnel({
          pendingSshAccessOperation: { operation: 'link', remotePort: 6768 }
        })
      ]
      throw new Error(
        'Could not connect to the remote Orca runtime at ws://127.0.0.1:50123: nothing is listening there.'
      )
    })

    await expect(reuseOwnServerOnSshMachine(MACHINE_ID)).rejects.toThrow(
      "Seal could not connect to the server on this machine: Seal's SSH tunnel to port 6768 on the machine failed: Could not connect to the remote Orca runtime at ws://127.0.0.1:50123: nothing is listening there."
    )
    expect(unlink).toHaveBeenCalledTimes(1)
  })
})
