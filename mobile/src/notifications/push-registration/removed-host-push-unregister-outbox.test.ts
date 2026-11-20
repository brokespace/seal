import { describe, expect, it, vi } from 'vitest'
import {
  createRemovedHostPushUnregisterOutbox,
  type RemovedHostRoute,
  type RemovedHostSecrets
} from './removed-host-push-unregister-outbox'

const SEVEN_DAYS_MS = 604_800_000

const host = {
  hostId: 'host-1',
  endpoint: 'ws://192.168.1.10:6768',
  publicKeyB64: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
  relay: {
    v: 1 as const,
    directorUrl: 'https://relay.seal.wotarmelon.com',
    cellUrl: 'https://relay.seal.wotarmelon.com',
    assignmentEpoch: 3,
    relayHostId: 'riFsLvUkejeCwTXv',
    e2eeFraming: 2 as const
  }
}
const secrets = { deviceToken: 'device-token', resumeToken: 'resume-token' }

function createOutbox() {
  let queue: string | null = null
  const stored = new Map<string, string>()
  const clock = { now: 1_800_000_000_000 }
  const deliver = vi.fn(async (_host: RemovedHostRoute, _secrets: RemovedHostSecrets) => false)
  const isPairedAgain = vi.fn(async (_host: RemovedHostRoute) => false)
  const create = () =>
    createRemovedHostPushUnregisterOutbox({
      readQueue: async () => queue,
      writeQueue: async (value) => {
        queue = value
      },
      readSecrets: async (hostId) => stored.get(hostId) ?? null,
      writeSecrets: async (hostId, value) => {
        stored.set(hostId, value)
      },
      deleteSecrets: async (hostId) => {
        stored.delete(hostId)
      },
      deliver,
      isPairedAgain,
      now: () => clock.now
    })
  return { create, stored, clock, deliver, isPairedAgain }
}

describe('removed host push unregister outbox', () => {
  it('keeps asking across restarts until the desktop answers, then forgets its credentials', async () => {
    const { create, stored, deliver } = createOutbox()
    await create().queue(host, secrets)

    await create().flush()
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(stored.has('host-1')).toBe(true)

    deliver.mockResolvedValueOnce(true)
    await create().flush()
    expect(deliver).toHaveBeenLastCalledWith(host, secrets)
    expect(stored.has('host-1')).toBe(false)

    await create().flush()
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('gives up without dialing once the desktop would have dropped the registration itself', async () => {
    const { create, stored, clock, deliver } = createOutbox()
    await create().queue(host, secrets)

    clock.now += SEVEN_DAYS_MS
    await create().flush()

    expect(deliver).not.toHaveBeenCalled()
    expect(stored.has('host-1')).toBe(false)
  })

  it('leaves a desktop that was paired again to its live pairing', async () => {
    const { create, stored, deliver, isPairedAgain } = createOutbox()
    await create().queue(host, secrets)

    isPairedAgain.mockResolvedValue(true)
    await create().flush()

    expect(deliver).not.toHaveBeenCalled()
    expect(stored.has('host-1')).toBe(false)
  })

  it('drops a cancelled request and its credentials', async () => {
    const { create, stored, deliver } = createOutbox()
    await create().queue(host, secrets)

    await create().cancel('host-1')
    await create().flush()

    expect(deliver).not.toHaveBeenCalled()
    expect(stored.has('host-1')).toBe(false)
  })

  it('holds 16 removed desktops and evicts the oldest with its credentials', async () => {
    const { create, stored, deliver } = createOutbox()
    const outbox = create()
    for (let index = 0; index < 17; index += 1) {
      await outbox.queue({ ...host, hostId: `host-${index}` }, secrets)
    }

    await outbox.flush()

    expect(stored.has('host-0')).toBe(false)
    expect(deliver.mock.calls.map(([queued]) => queued.hostId)).toEqual(
      Array.from({ length: 16 }, (_, index) => `host-${index + 1}`)
    )
  })
})
