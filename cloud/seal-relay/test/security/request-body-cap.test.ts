import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newHostKeypair, startRelayUnderTest, type RelayUnderTest } from './relay-attack-surface'

let relay: RelayUnderTest

/** A chunked upload with no declared length that keeps the connection open after `bytes`. */
function endlessBody(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent < bytes) {
        sent += 1024
        controller.enqueue(new Uint8Array(1024).fill(0x20))
      }
      // Never closes: only a reader that stops at the cap can answer.
      return new Promise((resolve) => setTimeout(resolve, 5))
    }
  })
}

// F1: the size limit is enforced while reading, so an undeclared or endless body is not buffered.
describe('request body cap', () => {
  beforeAll(async () => {
    relay = await startRelayUnderTest({ enrolled: [newHostKeypair()] })
  })
  afterAll(async () => {
    await relay?.dispose()
  })

  it.each(['/v1/host/challenge', '/v1/host/session', '/v1/resolve'])(
    'answers 413 to an endless upload on %s without waiting for it to finish',
    async (path) => {
      const response = await fetch(`${relay.origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: endlessBody(64 * 1024),
        duplex: 'half',
        signal: AbortSignal.timeout(8000)
      } as RequestInit)

      expect(response.status).toBe(413)
    }
  )
})
