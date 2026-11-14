import WebSocket from 'ws'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  hostSessionToken,
  newHostKeypair,
  startRelayUnderTest,
  type RelayUnderTest
} from './relay-attack-surface'

let relay: RelayUnderTest
const host = newHostKeypair()

function upgradeStatus(url: string): Promise<number | string> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url)
    socket.on('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    socket.on('open', () => resolve('open'))
    socket.on('error', (error) => resolve(String(error)))
  })
}

// SR-07, F7: a mangled percent-escape is the caller's error, not an exception in the Worker.
describe('malformed percent-escapes', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest({ enrolled: [host] })
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it('answers 400 on the unauthenticated host data path', async () => {
    const base = relay.origin.replace(/^http/, 'ws')

    expect(await upgradeStatus(`${base}/v1/host/data/%E0%A4%A`)).toBe(400)
  })

  it('answers 400 on push device removal', async () => {
    const session = await hostSessionToken(relay.origin, host)

    const response = await fetch(`${relay.origin}/v1/devices/%E0%A4%A`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session}` },
      signal: AbortSignal.timeout(5000)
    })

    expect(response.status).toBe(400)
  })
})
