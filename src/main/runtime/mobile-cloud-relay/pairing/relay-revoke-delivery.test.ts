import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayRetrySchedule } from '../authentication/relay-retry-schedule'
import { RelayRevokeDelivery } from './relay-revoke-delivery'
import { RelayRevokeOutbox } from './relay-revoke-outbox'

const HOST = 'AbCdEf0123_-xyZ9'
const OWNER = 'user-1\0profile-1\0org-1'
let dir: string

beforeEach(() => {
  vi.useFakeTimers()
  dir = mkdtempSync(join(tmpdir(), 'orca-relay-revoke-delivery-'))
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
})

function queuedRevoke() {
  const outbox = new RelayRevokeOutbox(dir)
  const item = outbox.enqueue({
    relayHostId: HOST,
    relayDeviceId: 'device-1',
    ownerIdentityKey: OWNER
  })
  return { outbox, item }
}

describe('RelayRevokeDelivery', () => {
  it('sends a revoke the relay did not confirm again, with the same request id, until it is confirmed', async () => {
    const { outbox, item } = queuedRevoke()
    const revokeDevice = vi
      .fn<(relayDeviceId: string, reqId?: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('relay_control_request_timeout'))
      .mockRejectedValueOnce(new Error('relay_control_not_active'))
      .mockResolvedValue(undefined)
    const sender = { hostId: HOST, ownerIdentityKey: OWNER, revokeDevice }
    const onDelivered = vi.fn()
    const delivery = new RelayRevokeDelivery({
      outbox,
      activeSender: () => sender,
      onDelivered,
      // No jitter: every retry waits the one-second floor.
      retry: new RelayRetrySchedule(() => 0)
    })

    delivery.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(revokeDevice).toHaveBeenCalledTimes(1)
    expect(outbox.pendingFor(OWNER, HOST)).toEqual([item])

    await vi.advanceTimersByTimeAsync(1000)
    expect(revokeDevice).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)

    expect(revokeDevice.mock.calls).toEqual([
      ['device-1', item.reqId],
      ['device-1', item.reqId],
      ['device-1', item.reqId]
    ])
    expect(new RelayRevokeOutbox(dir).pendingFor(OWNER, HOST)).toEqual([])
    expect(onDelivered).toHaveBeenCalledTimes(1)
  })

  it('keeps a revoke queued while the relay is away and sends it once a broker registers', async () => {
    const { outbox } = queuedRevoke()
    const revokeDevice = vi.fn(async () => {})
    let sender: {
      hostId: string
      ownerIdentityKey: string
      revokeDevice: typeof revokeDevice
    } | null = null
    const delivery = new RelayRevokeDelivery({
      outbox,
      activeSender: () => sender,
      onDelivered: vi.fn()
    })

    delivery.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(outbox.pendingFor(OWNER, HOST)).toHaveLength(1)

    sender = { hostId: HOST, ownerIdentityKey: OWNER, revokeDevice }
    delivery.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(revokeDevice).toHaveBeenCalledTimes(1)
    expect(outbox.pendingFor(OWNER, HOST)).toEqual([])
  })
})
