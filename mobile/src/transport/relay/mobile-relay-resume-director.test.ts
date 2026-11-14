import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RelayDirectorHttpError,
  RelayDirectorResolveTimeoutError,
  RelayResolveTimeoutBudget,
  resolveMobileRelayEndpoint
} from './mobile-relay-resume-director'

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.example',
  cellUrl: 'https://relay.example',
  assignmentEpoch: 7,
  relayHostId: 'AbCdEf0123_-xyZ9',
  e2eeFraming: 2 as const
}

describe('mobile relay resume director', () => {
  it('rejects oversized bodies despite an underreported content length', async () => {
    const oversizedBody =
      ' '.repeat(16 * 1024) +
      JSON.stringify({
        v: 1,
        cellUrl: 'https://relay.example',
        assignmentEpoch: 8,
        leaseExpiresAt: 1
      })
    await expect(
      resolveMobileRelayEndpoint({
        relay,
        resumeToken: 'A'.repeat(43),
        fetchImpl: async () => new Response(oversizedBody, { headers: { 'content-length': '1' } })
      })
    ).rejects.toThrow(/too large/)
  })

  afterEach(() => vi.useRealTimers())

  it('names a timed-out resolve so the next one can get a longer budget', async () => {
    vi.useFakeTimers()
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )
    const resolving = resolveMobileRelayEndpoint({
      relay,
      resumeToken: 'A'.repeat(43),
      fetchImpl: hanging,
      timeoutMs: 5_000
    })
    const settled = expect(resolving).rejects.toBeInstanceOf(RelayDirectorResolveTimeoutError)
    await vi.advanceTimersByTimeAsync(5_000)
    await settled
  })

  const resolveTo = (cellUrl: string) =>
    resolveMobileRelayEndpoint({
      relay,
      resumeToken: 'A'.repeat(43),
      fetchImpl: async () =>
        new Response(JSON.stringify({ v: 1, cellUrl, assignmentEpoch: 8, leaseExpiresAt: 1 }))
    })

  it.each(['https://cell.attacker.example', 'https://relay.example.attacker.example'])(
    'fails a resolution to %s instead of returning it',
    async (cellUrl) => {
      await expect(resolveTo(cellUrl)).rejects.toThrow(
        'relay cell is outside the origins this host may use'
      )
    }
  )

  it.each(['https://relay.example', 'https://relay.seal.wotarmelon.com'])(
    'follows the director to %s',
    async (cellUrl) => {
      await expect(resolveTo(cellUrl)).resolves.toEqual({
        v: 1,
        directorUrl: 'https://relay.example',
        cellUrl,
        assignmentEpoch: 8,
        relayHostId: 'AbCdEf0123_-xyZ9',
        e2eeFraming: 2
      })
    }
  )
})

describe('RelayResolveTimeoutBudget', () => {
  it('widens 5s to 10s after a timeout and narrows again after a success', () => {
    const budget = new RelayResolveTimeoutBudget()
    expect(budget.timeoutMs).toBe(5_000)
    budget.failed(new RelayDirectorHttpError(503, null))
    expect(budget.timeoutMs).toBe(5_000)
    budget.failed(new RelayDirectorResolveTimeoutError(5_000))
    expect(budget.timeoutMs).toBe(10_000)
    budget.failed(new RelayDirectorHttpError(503, null))
    expect(budget.timeoutMs).toBe(10_000)
    budget.succeeded()
    expect(budget.timeoutMs).toBe(5_000)
  })
})
