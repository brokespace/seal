import { describe, expect, it, vi } from 'vitest'
import { resolveMobileRelayEndpoint } from './mobile-relay-resume-director'

const relay = {
  v: 1 as const,
  directorUrl: 'https://relay.example',
  cellUrl: 'https://relay.example',
  assignmentEpoch: 7,
  relayHostId: 'AbCdEf0123_-xyZ9',
  e2eeFraming: 2 as const
}

describe('mobile relay resume director', () => {
  it('rejects non-canonical targets and oversized bodies', async () => {
    const badTarget = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            v: 1,
            cellUrl: 'http://relay.example',
            assignmentEpoch: 8,
            leaseExpiresAt: 1
          })
        )
    )
    await expect(
      resolveMobileRelayEndpoint({ relay, resumeToken: 'A'.repeat(43), fetchImpl: badTarget })
    ).rejects.toThrow(/cellUrl/)

    const oversized = vi.fn(
      async () =>
        new Response('x'.repeat(16 * 1024 + 1), { headers: { 'content-length': '16385' } })
    )
    await expect(
      resolveMobileRelayEndpoint({ relay, resumeToken: 'A'.repeat(43), fetchImpl: oversized })
    ).rejects.toThrow(/too large/)

    const oversizedBody =
      ' '.repeat(16 * 1024) +
      JSON.stringify({
        v: 1,
        cellUrl: 'https://relay.example',
        assignmentEpoch: 8,
        leaseExpiresAt: 1
      })
    for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
      await expect(
        resolveMobileRelayEndpoint({
          relay,
          resumeToken: 'A'.repeat(43),
          fetchImpl: async () => new Response(oversizedBody, { headers })
        })
      ).rejects.toThrow(/too large/)
    }
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
