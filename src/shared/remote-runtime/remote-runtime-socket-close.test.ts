import { describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { closeRemoteRuntimeSocket, truncateSocketCloseReason } from './remote-runtime-socket-close'

function socketThatRejectsLongReasons() {
  const close = vi.fn((_code?: number, reason?: string) => {
    if (Buffer.byteLength(reason ?? '') > 123) {
      throw new RangeError('The message must not be greater than 123 bytes')
    }
  })
  const terminate = vi.fn()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only close and terminate are exercised.
  return { socket: { close, terminate } as unknown as WebSocket, close, terminate }
}

describe('closeRemoteRuntimeSocket', () => {
  it('truncates an over-long reason to 123 bytes instead of throwing', () => {
    const { socket, close, terminate } = socketThatRejectsLongReasons()

    closeRemoteRuntimeSocket(socket, 4401, 'x'.repeat(200))

    expect(close).toHaveBeenCalledExactlyOnceWith(4401, 'x'.repeat(123))
    expect(terminate).not.toHaveBeenCalled()
  })

  it('never splits a multi-byte character at the limit', () => {
    expect(truncateSocketCloseReason(`${'x'.repeat(122)}é`)).toBe('x'.repeat(122))
    expect(truncateSocketCloseReason(`${'x'.repeat(121)}é`)).toBe(`${'x'.repeat(121)}é`)
  })

  it('terminates the socket when close itself throws', () => {
    const terminate = vi.fn()
    const close = vi.fn(() => {
      throw new TypeError('First argument must be a valid error code number')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only close and terminate are exercised.
    const socket = { close, terminate } as unknown as WebSocket

    expect(() => closeRemoteRuntimeSocket(socket, 99, 'reason')).not.toThrow()
    expect(terminate).toHaveBeenCalledOnce()
  })
})
