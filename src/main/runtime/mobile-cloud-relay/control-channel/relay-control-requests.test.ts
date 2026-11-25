import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelayControlRequests } from './relay-control-requests'

const NOW = 1_800_000_000_000

function inviteCreated(expiresAt: number): Record<string, unknown> {
  return {
    type: 'invite-created',
    reqId: 'invite-req',
    inviteToken: 'A'.repeat(43),
    expiresAt,
    maxAttempts: 3
  }
}

describe('RelayControlRequests invite expiry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['in the past', NOW],
    ['one millisecond beyond the invite lifetime plus skew', NOW + 630_001],
    ['at the largest safe integer', Number.MAX_SAFE_INTEGER]
  ])('rejects an invite expiring %s', async (_name, expiresAt) => {
    const requests = new RelayControlRequests()
    const invite = requests.createInvite('invite-req', 'device-1', () => {})

    expect(requests.resolveMessage(inviteCreated(expiresAt))).toBe(true)

    await expect(invite).rejects.toThrow('relay_invite_expiry_out_of_window')
    expect(requests.size).toBe(0)
  })

  it('accepts an invite expiring at the full lifetime plus skew', async () => {
    const requests = new RelayControlRequests()
    const invite = requests.createInvite('invite-req', 'device-1', () => {})

    requests.resolveMessage(inviteCreated(NOW + 630_000))

    await expect(invite).resolves.toMatchObject({ expiresAt: NOW + 630_000 })
  })
})
