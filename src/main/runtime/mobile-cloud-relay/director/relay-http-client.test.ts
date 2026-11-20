import { describe, expect, it, vi } from 'vitest'

import { RelayAssignRateGate } from './relay-assign-rate-gate'
import { requestRelayAssignment } from './relay-http-client'

type AssignInput = Parameters<typeof requestRelayAssignment>[0]

function assignSuccessResponse(cellUrl = 'https://relay.example'): Response {
  return Response.json({ v: 1, cellUrl, assignmentEpoch: 4, lease: 'lease-jwt' })
}

function fakeAssignClock(onSleep?: () => void) {
  let now = 1_000_000
  const sleeps: number[] = []
  return {
    sleeps,
    advance: (ms: number): void => {
      now += ms
    },
    options: {
      now: () => now,
      random: () => 0,
      sleep: async (ms: number): Promise<void> => {
        sleeps.push(ms)
        now += ms
        onSleep?.()
      }
    }
  }
}

describe('relay assignment rate gate', () => {
  const request = (
    input: Partial<AssignInput> & Pick<AssignInput, 'fetch' | 'assignRateGate'>
  ): Promise<unknown> =>
    requestRelayAssignment({
      directorUrl: 'https://relay.example',
      relayToken: 'scoped-token',
      relayHostId: 'AbCdEf0123_-xyZ9',
      ...input
    })

  it('keeps a Retry-After hint past the retry timer the coordinator cancels', async () => {
    const clock = fakeAssignClock()
    const assignRateGate = new RelayAssignRateGate(clock.options)
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '30' } }))
      .mockResolvedValueOnce(assignSuccessResponse())

    await expect(request({ fetch, assignRateGate })).rejects.toThrow('relay_assignment_failed_429')
    // Reconcile resets retry timers; the gate must retain long Retry-After and fail inline with the remainder.
    clock.advance(6_000)
    await expect(request({ fetch, assignRateGate })).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 24_000
    })
    expect(clock.sleeps).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)

    clock.advance(25_000)
    await request({ fetch, assignRateGate })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

describe('relay assignment cell pin', () => {
  const assign = (cellUrl: string, input: Partial<AssignInput> = {}): Promise<unknown> =>
    requestRelayAssignment({
      directorUrl: 'https://relay.example',
      relayToken: 'scoped-token',
      relayHostId: 'AbCdEf0123_-xyZ9',
      allowedCellOrigins: [],
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(assignSuccessResponse(cellUrl)),
      ...input
    })

  it('follows the director to itself', async () => {
    await expect(assign('https://relay.example')).resolves.toEqual({
      v: 1,
      cellUrl: 'https://relay.example',
      assignmentEpoch: 4,
      lease: 'lease-jwt'
    })
  })

  it.each([
    'https://cell.attacker.example',
    'https://relay.example.attacker.example',
    'https://relay.example:8443',
    'http://127.0.0.1:8787'
  ])('fails an assignment to %s as a bad director answer', async (cellUrl) => {
    await expect(assign(cellUrl)).rejects.toMatchObject({
      message: 'relay_assignment_failed_502',
      statusCode: 502
    })
  })

  it('follows the director to an explicitly allowed cell', async () => {
    await expect(
      assign('https://relay-c1.example', { allowedCellOrigins: ['https://relay-c1.example'] })
    ).resolves.toMatchObject({ cellUrl: 'https://relay-c1.example' })
  })

  it('keeps a loopback development director on its own origin', async () => {
    await expect(
      assign('http://127.0.0.1:8787', { directorUrl: 'http://127.0.0.1:8787' })
    ).resolves.toMatchObject({ cellUrl: 'http://127.0.0.1:8787' })
  })
})
