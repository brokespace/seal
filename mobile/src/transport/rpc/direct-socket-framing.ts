import { MobileE2EEV2ClientSession } from '../encryption/mobile-e2ee-v2-client-session'
import {
  MobileE2EEAuthenticationError,
  MobileE2EEV2PhysicalChannel
} from '../encryption/mobile-e2ee-v2-physical-channel'
import type { ConnectionLogEmitter } from '../../diagnostics/connection/connection-log-types'
import { websocketPayloadToUint8 } from '../encryption/websocket-payload-bytes'

export type DirectSocketFramingEvents = {
  onReadyAccepted: () => void
  onAuthenticated: () => void
  onText: (plaintext: string) => void
  onBinary: (plaintext: Uint8Array) => void
  onAuthRejected: () => void
  onProtocolError: (error: Error) => void
}

export type DirectSocketFraming = {
  // Throws when the hello cannot be written.
  start: () => void
  handleInbound: (raw: unknown) => void
  // false = not ready yet; throws when the socket write fails.
  sendText: (plaintext: string) => boolean
  dispose: () => void
}

/** Forward-secret E2EE v2 is the only framing; a host that answers with anything else is refused. */
export function createDirectSocketFraming(args: {
  socket: WebSocket
  serverPublicKeyB64: string
  deviceToken: string
  emitLog: ConnectionLogEmitter
  events: DirectSocketFramingEvents
}): DirectSocketFraming {
  const { events } = args
  let authenticated = false
  const channel = new MobileE2EEV2PhysicalChannel({
    session: MobileE2EEV2ClientSession.create({
      desktopPublicKeyB64: args.serverPublicKeyB64,
      transport: 'direct'
    }),
    socket: args.socket,
    deviceToken: args.deviceToken,
    decodeBinary: websocketPayloadToUint8,
    onReadyAccepted: () => {
      args.emitLog('success', 'Received e2ee_ready (v2)', 'Sending device token')
      events.onReadyAccepted()
    },
    onAuthenticated: () => {
      authenticated = true
      events.onAuthenticated()
    },
    onText: events.onText,
    onBinary: events.onBinary,
    // Why: a handshake the host cannot complete spends the bounded auth retries and then stops.
    onError: (error) =>
      error instanceof MobileE2EEAuthenticationError || !authenticated
        ? events.onAuthRejected()
        : events.onProtocolError(error)
  })
  return {
    start: () => {
      channel.start()
      args.emitLog('info', 'Sent e2ee_hello (v2)', 'Awaiting server e2ee_ready')
    },
    handleInbound: (raw: unknown) => void channel.handleMessage(raw),
    sendText: (plaintext: string) => channel.sendText(plaintext),
    dispose: () => channel.dispose()
  }
}
