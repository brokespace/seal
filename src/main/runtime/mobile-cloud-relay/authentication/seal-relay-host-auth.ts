import type { E2EEKeypair } from '../../rpc/server/pairing/e2ee-keypair'
import { PushGatewaySession } from '../../push/push-gateway-session'
import { deriveRelayHostId } from '../director/relay-http-client'
import type { RelaySessionBrokerOptions } from '../session-lifecycle/relay-session-broker-contract'
import type { RelayAuthContext } from './relay-auth-identity'

export type RelayEndpointConfig = RelaySessionBrokerOptions['authConfig']

/** The Seal relay Worker is director, cell and token mint at one origin. */
export function sealRelayEndpointConfig(relayOrigin: string): RelayEndpointConfig {
  return {
    relayDirectorUrl: relayOrigin,
    relayTokenEndpoint: `${relayOrigin}/v1/host/relay-token`
  }
}

/** The Seal relay mints relay JWTs with `sub`/`prof` derived from the proven host key. */
export function sealRelayIdentity(relayHostId: string): RelayAuthContext['identity'] {
  const subject = `seal:${relayHostId}`
  return { userId: subject, profileId: subject, organizationId: '' }
}

/**
 * No account: the host proves its pairing key with the same sealed challenge the push gateway
 * uses, and the resulting host session is the bearer for relay-token minting.
 */
export function createSealRelayContextReader(input: {
  relayOrigin: string
  keypair: E2EEKeypair
  fetchImpl?: typeof globalThis.fetch
  now?: () => number
}): () => Promise<RelayAuthContext | null> {
  const session = new PushGatewaySession({
    origin: input.relayOrigin,
    keypair: input.keypair,
    fetchImpl: input.fetchImpl ?? globalThis.fetch,
    now: input.now ?? Date.now
  })
  const identity = sealRelayIdentity(deriveRelayHostId(input.keypair.publicKey))
  return async () => {
    const outcome = await session.ensure(null)
    if (!outcome.ok) {
      // Throwing keeps the coordinator's retry path; null would read as a sign-out.
      throw new Error(`seal_relay_host_auth_${outcome.reason}`)
    }
    return { identity, accessToken: outcome.session.token, relayEntitled: true }
  }
}
