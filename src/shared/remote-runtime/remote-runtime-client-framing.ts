import {
  createPairedE2EEClientHandshake,
  type PairedE2EEClientHandshake
} from './e2ee/paired-e2ee-client-handshake'
import { NODE_PAIRED_E2EE_PRIMITIVES } from './e2ee/node/paired-e2ee-node-primitives'
import { serializeRemoteRuntimePayload } from './remote-runtime-memory-limits'
import { parseRemoteRuntimeJsonText } from './requests/remote-runtime-request-frames'

/**
 * Desktop and CLI runtime clients speak forward-secret E2EE v2 and nothing older: a host that
 * refuses it fails the dial. Throws on an invalid host public key.
 */
export function createRemoteRuntimeClientHandshake(
  hostPublicKeyB64: string
): PairedE2EEClientHandshake {
  return createPairedE2EEClientHandshake({
    primitives: NODE_PAIRED_E2EE_PRIMITIVES,
    hostPublicKeyB64,
    transport: 'direct',
    v2TokenCapabilities: true,
    parseJson: parseRemoteRuntimeJsonText,
    serializeJson: serializeRemoteRuntimePayload
  })
}
