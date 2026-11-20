import type { CommandHandler } from '../dispatch/dispatch'
import { resolveLaunchUserDataPath } from '../runtime/launch-user-data-path'
import { RuntimeClientError } from '../runtime/types'
import { readProfileRuntimePublicKey } from '../../shared/remote-runtime/host-store/runtime-e2ee-keypair-file'
import {
  deriveRelayHostId,
  formatRelayHostFingerprint
} from '../../shared/remote-runtime/relay/relay-host-id'

export const RELAY_HANDLERS: Record<string, CommandHandler> = {
  'relay host-id': async (ctx) => {
    const userDataPath = resolveLaunchUserDataPath()
    const publicKey = readProfileRuntimePublicKey(userDataPath)
    if (!publicKey) {
      throw new RuntimeClientError(
        'pairing_key_missing',
        `The profile at ${userDataPath} has no pairing key yet. Start Seal once (the app or \`seal serve\`), then run this again.`
      )
    }
    const hostId = deriveRelayHostId(publicKey)
    console.log(
      ctx.json
        ? JSON.stringify(
            { ok: true, result: { hostId, fingerprint: formatRelayHostFingerprint(hostId) } },
            null,
            2
          )
        : hostId
    )
  }
}
