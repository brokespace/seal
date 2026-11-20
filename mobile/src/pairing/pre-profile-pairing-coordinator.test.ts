import { describe, expect, it, vi } from 'vitest'
import type { PairingOffer } from '../../../src/shared/remote-runtime/pairing/mobile-relay-pairing-offer'
import type { RpcResponse } from '../transport/rpc/rpc-wire-types'
import type { MobileRelayPairingJournal } from './mobile-relay-pairing-journal'
import { startPreProfilePairing } from './pre-profile-pairing-coordinator'

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-crypto', () => ({
  getRandomBytes: (length: number) => new Uint8Array(length).fill(length)
}))
vi.mock('expo-secure-store', () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED' }))
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {} }))
// Both candidate clients are injected, so the real direct transport is never dialed.
vi.mock('../transport/rpc/direct-rpc-connect', () => ({ connect: vi.fn() }))

const NOW = 1_800_000_000_000
const offer = {
  v: 2,
  endpoint: 'ws://192.168.1.10:6768',
  deviceToken: 'device-token',
  publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  relay: {
    v: 1,
    directorUrl: 'https://relay.example',
    cellUrl: 'https://relay.example',
    assignmentEpoch: 7,
    relayHostId: 'riFsLvUkejeCwTXv',
    inviteToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGH012345678',
    inviteExpiresAt: NOW + 300_000,
    e2eeFraming: 2
  }
} satisfies PairingOffer

const never = new Promise<RpcResponse>(() => {})

function pairKnownHost(directReply: (method: string) => Promise<RpcResponse>) {
  const savedHostIds: string[] = []
  const updatedHostIds: string[] = []
  const attempt = startPreProfilePairing({
    offer,
    timeoutMs: 30_000,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the coordinator only sends requests on and closes the injected clients.
    dependencies: {
      connectDirect: () => ({ sendRequest: directReply, close: () => {} }),
      connectRelay: () => ({ sendRequest: () => never, close: () => {} }),
      resolveHostIdentity: async () => ({ id: 'host-known', name: 'Grey Seal' }),
      saveJournal: async (journal: MobileRelayPairingJournal) => {
        savedHostIds.push(journal.metadata.host.id)
      },
      updateJournal: async (
        _id: string,
        update: (metadata: MobileRelayPairingJournal['metadata']) => {
          host: { id: string }
        }
      ) => {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the coordinator's update ignores the stored metadata.
        updatedHostIds.push(update({} as MobileRelayPairingJournal['metadata']).host.id)
      },
      releaseJournal: () => {},
      recoverPendingJournal: async () => {},
      now: () => NOW,
      platform: 'ios'
    } as unknown as Parameters<typeof startPreProfilePairing>[0]['dependencies']
  })
  attempt.result.catch(() => {})
  return { attempt, savedHostIds, updatedHostIds }
}

describe('pre-profile pairing journal identity', () => {
  it('journals a code for a known host under a fresh id while no path has authenticated', async () => {
    const { attempt, savedHostIds, updatedHostIds } = pairKnownHost(() => never)

    await vi.waitFor(() => expect(savedHostIds).toEqual(['host-1800000000000']))
    expect(updatedHostIds).toEqual([])
    attempt.dispose()
  })

  it("takes the known host's id once the host answered on an authenticated path", async () => {
    const { attempt, savedHostIds, updatedHostIds } = pairKnownHost((method) =>
      method === 'status.get'
        ? Promise.resolve({ id: 'rpc-1', ok: true, result: {}, _meta: { runtimeId: 'runtime-1' } })
        : never
    )

    await vi.waitFor(() => expect(updatedHostIds).toEqual(['host-known']))
    expect(savedHostIds).toEqual(['host-1800000000000'])
    attempt.dispose()
  })
})
