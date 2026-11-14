import type { PairedE2EEClientHandshake } from './e2ee/paired-e2ee-client-handshake'

// The host's close code for a hello it will not answer.
const HELLO_REFUSED_CLOSE_CODE = 4001

/** For a host that closes on the hello: nothing older is tried, so the fix is on the host. */
export const REMOTE_RUNTIME_HELLO_REFUSED_MESSAGE =
  'The remote Orca runtime refused the encryption this app requires (E2EE v2 with forward ' +
  'secrecy). Update Orca on the host, then connect again. If the host is already up to date, ' +
  'its identity key changed: pair with it again.'

export type RemoteRuntimeHandshakeState = 'awaiting_ready' | 'awaiting_authenticated' | 'ready'

// Async auth sealing may outlive socket close/replacement; recheck stillAwaiting before send and route sealing errors to fail.
export async function sendRemoteRuntimeTokenAuth(args: {
  handshake: PairedE2EEClientHandshake
  deviceToken: string
  clientCapabilities: readonly string[]
  stillAwaiting: () => boolean
  send: (frame: string) => void
  fail: (error: unknown) => void
}): Promise<void> {
  let frame: string
  try {
    frame = await args.handshake.sealAuth(
      { kind: 'token', deviceToken: args.deviceToken },
      { clientCapabilities: args.clientCapabilities }
    )
  } catch (error) {
    args.fail(error)
    return
  }
  if (args.stillAwaiting()) {
    args.send(frame)
  }
}

/** `handshake` marks a close before its ready as the host refusing the hello. */
export function formatRemoteRuntimeCloseMessage(
  code: number,
  reason: Buffer,
  handshake?: PairedE2EEClientHandshake | null
): string {
  if (code === HELLO_REFUSED_CLOSE_CODE && handshake && handshake.transcriptHashB64() === null) {
    return REMOTE_RUNTIME_HELLO_REFUSED_MESSAGE
  }
  const suffixParts: string[] = []
  if (code !== 1005 && code !== 1006) {
    suffixParts.push(String(code))
  }
  const reasonText = reason.toString().trim()
  if (reasonText) {
    suffixParts.push(reasonText)
  }
  return suffixParts.length > 0
    ? `Remote Orca runtime closed the connection (${suffixParts.join(': ')}).`
    : 'Remote Orca runtime closed the connection.'
}

export function ignoreSettledRemoteRuntimeSocketError(): void {}
