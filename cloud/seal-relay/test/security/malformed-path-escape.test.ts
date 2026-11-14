import WebSocket from 'ws'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { describePoc } from './poc-opt-in'
import {
  hostSessionToken,
  newHostKeypair,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest

function upgradeStatus(url: string): Promise<number | string> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url)
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    socket.on('open', () => resolve('open'))
    socket.on('error', (error) => resolve(String(error)))
  })
}

describePoc('PoC SR-07: a malformed percent-escape makes the Worker throw', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest()
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('unauthenticated: /v1/host/data/<bad escape> answers 500 instead of a rejection', async () => {
    const base = relay.origin.replace(/^http/, 'ws')
    expect(await upgradeStatus(`${base}/v1/host/data/%E0%A4%A`)).toBe(500)
    // Control: a well-formed but unknown connection id is refused cleanly.
    expect(await upgradeStatus(`${base}/v1/host/data/not-a-connection`)).toBe(429)
  })

  it('any enrolled host: DELETE /v1/devices/<bad escape> is not rejected cleanly', async () => {
    const session = await hostSessionToken(relay.origin, newHostKeypair())
    // A correct handler answers 400/404; decodeURIComponent throwing instead yields a 500 or a
    // hung request (connection never completes), both of which an authenticated caller can trigger.
    const outcome = await fetch(`${relay.origin}/v1/devices/%E0%A4%A`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session}` },
      signal: AbortSignal.timeout(5000)
    }).then(
      (response) => response.status,
      (error: unknown) => (error instanceof Error ? error.name : 'error')
    )
    expect([500, 'TimeoutError']).toContain(outcome)
  })
})
