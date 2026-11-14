import type WebSocket from 'ws'
import type { RelayHostCloseReason } from '../../../../shared/relay-host-close-reason'
import { MOBILE_RELAY_CLOSE_CODE } from '../../../../shared/remote-runtime/relay/mobile-relay-close-codes'
import { closeRemoteRuntimeSocket } from '../../../../shared/remote-runtime/remote-runtime-socket-close'

const NORMAL_CLOSE_CODE = 1000
const REASONED_CLOSE_FLUSH_MS = 1_000

/** Ends a control socket that broke the protocol; `reason` is internal text of any length. */
export function failRelayControlSocket(socket: WebSocket | null, reason: string): void {
  closeRemoteRuntimeSocket(socket, MOBILE_RELAY_CLOSE_CODE.BAD_OUTER_CREDENTIAL, reason)
}

// Only auth loss sends a named close; rotation/drain/quit/sleep terminate abruptly to avoid false sign-outs.
// Bound named-close handshakes, then terminate so fencing remains hard.
export function closeRelayControlSocket(
  socket: WebSocket | null,
  hostCloseReason?: RelayHostCloseReason
): void {
  if (!socket) {
    return
  }
  if (hostCloseReason && socket.readyState === socket.OPEN) {
    closeRemoteRuntimeSocket(socket, NORMAL_CLOSE_CODE, hostCloseReason)
    const timer = setTimeout(() => socket.terminate(), REASONED_CLOSE_FLUSH_MS)
    timer.unref?.()
    return
  }
  socket.terminate()
}
