import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  deletePairingKeychainItem,
  readPairingKeychainItem,
  writePairingKeychainItem
} from '../../host-credentials/pairing-keychain'
import { readMobileRelayCredentialBundle } from '../../host-credentials/mobile-relay-credential-bundle'
import { loadHostCatalog, loadHosts } from '../../host-catalog/host-store'
import {
  connectMobileRelayForPairing,
  type PairingCandidateClient
} from '../../pairing/mobile-relay-physical-client'
import { isPinnedMobileRelayCell } from '../../transport/relay/mobile-relay-cell-pin'
import { connect } from '../../transport/rpc/direct-rpc-connect'
import { sendUnregister } from './mobile-push-registration-operations'
import {
  createRemovedHostPushUnregisterOutbox,
  type RemovedHostRoute,
  type RemovedHostSecrets
} from './removed-host-push-unregister-outbox'

const QUEUE_KEY = 'seal:removedHostPushUnregisters:v1'
const DELIVERY_TIMEOUT_MS = 10_000

// SecureStore keys must match [A-Za-z0-9._-].
function secretsKey(hostId: string): string {
  return `seal.push-unregister.${hostId}`
}

// One request per path the removed desktop was reachable on; the unregister is idempotent.
async function deliverUnregister(
  host: RemovedHostRoute,
  secrets: RemovedHostSecrets
): Promise<boolean> {
  const clients: PairingCandidateClient[] = [
    connect(host.endpoint, secrets.deviceToken, host.publicKeyB64)
  ]
  try {
    if (host.relay && secrets.resumeToken && isPinnedMobileRelayCell(host.relay)) {
      clients.push(
        connectMobileRelayForPairing({
          relay: host.relay,
          deviceToken: secrets.deviceToken,
          desktopPublicKeyB64: host.publicKeyB64,
          credential: secrets.resumeToken,
          expectedCredentialKind: 'resume',
          requestTimeoutMs: DELIVERY_TIMEOUT_MS
        })
      )
    }
    const answers = await Promise.all(
      clients.map((client) => sendUnregister(client, DELIVERY_TIMEOUT_MS, { awaitConnect: true }))
    )
    return answers.includes(true)
  } finally {
    for (const client of clients) {
      client.close()
    }
  }
}

// A host is still in the catalog while its removal runs; that is not a new pairing.
const removalsInFlight = new Set<string>()

const outbox = createRemovedHostPushUnregisterOutbox({
  readQueue: () => AsyncStorage.getItem(QUEUE_KEY),
  writeQueue: (value) => AsyncStorage.setItem(QUEUE_KEY, value),
  readSecrets: (hostId) => readPairingKeychainItem(secretsKey(hostId)),
  writeSecrets: (hostId, value) => writePairingKeychainItem(secretsKey(hostId), value),
  deleteSecrets: (hostId) => deletePairingKeychainItem(secretsKey(hostId)),
  deliver: deliverUnregister,
  isPairedAgain: async (host) =>
    !removalsInFlight.has(host.hostId) &&
    (await loadHostCatalog()).some(
      (paired) => paired.id === host.hostId || paired.publicKeyB64 === host.publicKeyB64
    ),
  now: Date.now
})

/** Call before the host's credentials are removed: they are what a later attempt authenticates with. */
export async function queueRemovedHostPushUnregister(hostId: string): Promise<void> {
  const host = (await loadHosts()).find((candidate) => candidate.id === hostId)
  if (!host) {
    return
  }
  const bundle = await readMobileRelayCredentialBundle(hostId).catch(() => null)
  removalsInFlight.add(hostId)
  await outbox.queue(
    {
      hostId,
      endpoint: host.endpoint,
      publicKeyB64: host.publicKeyB64,
      ...(host.relay ? { relay: host.relay } : {})
    },
    {
      deviceToken: host.deviceToken,
      ...(bundle ? { resumeToken: bundle.current.token } : {})
    }
  )
}

/** The removal ended. A host that stayed paired keeps its registration, so its request is dropped. */
export async function settleRemovedHostPushUnregister(
  hostId: string,
  removed: boolean
): Promise<void> {
  removalsInFlight.delete(hostId)
  if (!removed) {
    await outbox.cancel(hostId)
  }
}

export const flushRemovedHostPushUnregisters = outbox.flush
