import type WebSocket from 'ws'

// RFC 6455 caps a close frame's reason at 123 bytes; `ws` throws a RangeError on more.
const SOCKET_CLOSE_REASON_MAX_BYTES = 123

export function truncateSocketCloseReason(reason: string): string {
  const bytes = new TextEncoder().encode(reason)
  if (bytes.byteLength <= SOCKET_CLOSE_REASON_MAX_BYTES) {
    return reason
  }
  let end = SOCKET_CLOSE_REASON_MAX_BYTES
  // Never cut inside a multi-byte character: back up past its continuation bytes.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) {
    end--
  }
  return new TextDecoder().decode(bytes.subarray(0, end))
}

/** Never throws: an invalid code or reason terminates the socket instead of escaping to the caller. */
export function closeRemoteRuntimeSocket(
  socket: WebSocket | null,
  code?: number,
  reason?: string
): void {
  if (!socket) {
    return
  }
  try {
    if (code === undefined) {
      socket.close()
    } else {
      socket.close(code, truncateSocketCloseReason(reason ?? ''))
    }
  } catch {
    try {
      socket.terminate()
    } catch {
      // Socket teardown is best effort after request ownership has been released.
    }
  }
}
