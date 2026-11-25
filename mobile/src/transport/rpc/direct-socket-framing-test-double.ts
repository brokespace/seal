import type { createDirectSocketFraming as createRealFraming } from './direct-socket-framing'

const SEALED_PREFIX = 'encrypted:'

/**
 * Stands in for E2EE v2 in connection-state tests: a frame is `encrypted:<json>`, so a test
 * can feed host replies synchronously. The real framing has its own tests.
 */
export function createDirectSocketFraming(
  args: Parameters<typeof createRealFraming>[0]
): ReturnType<typeof createRealFraming> {
  const { events, socket } = args
  let started = false
  let authenticated = false
  let disposed = false

  const handleText = (raw: string): void => {
    if (!raw.startsWith(SEALED_PREFIX)) {
      const frame: { type?: unknown } = JSON.parse(raw)
      if (!authenticated && frame.type === 'e2ee_ready') {
        events.onReadyAccepted()
        socket.send(`${SEALED_PREFIX}${JSON.stringify({ type: 'e2ee_auth' })}`)
      }
      return
    }
    const plaintext = raw.slice(SEALED_PREFIX.length)
    if (authenticated) {
      events.onText(plaintext)
      return
    }
    const reply: { type?: unknown } = JSON.parse(plaintext)
    if (reply.type === 'e2ee_authenticated') {
      authenticated = true
      events.onAuthenticated()
    } else if (reply.type === 'e2ee_error') {
      events.onAuthRejected()
    }
  }

  return {
    start: () => {
      socket.send(JSON.stringify({ type: 'e2ee_hello', v: 2 }))
      started = true
    },
    handleInbound: (raw) => {
      if (disposed) {
        return
      }
      if (typeof raw === 'string') {
        handleText(raw)
      } else if (authenticated && raw instanceof Uint8Array) {
        events.onBinary(raw)
      }
    },
    sendText: (plaintext) => {
      if (!started || disposed) {
        return false
      }
      socket.send(`${SEALED_PREFIX}${plaintext}`)
      return true
    },
    dispose: () => {
      disposed = true
    }
  }
}
