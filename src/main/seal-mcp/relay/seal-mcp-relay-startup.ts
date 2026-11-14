import { PushGatewaySession } from '../../runtime/push/push-gateway-session'
import type { E2EEKeypair } from '../../runtime/rpc/server/pairing/e2ee-keypair'
import { sealMcpHttpUrls } from '../http/seal-mcp-http-urls'
import { whenSealMcpServiceRuns } from '../seal-mcp-service-instance'
import { SealMcpRelayTunnel, type SealMcpRelayIdentity } from './seal-mcp-relay-tunnel'

type RuntimeRpcEndpoints = {
  getE2EEKeypair: () => E2EEKeypair | null
  getWebSocketEndpoint: () => string | null
}

/**
 * This host's identity on the relay: it signs in with its pairing key, as it does for push, so no
 * account is involved and only the holder of that key can serve its MCP URL.
 */
export function sealMcpRelayIdentitySource(input: {
  relayOrigin: string
  getKeypair: () => E2EEKeypair | null
}): () => SealMcpRelayIdentity | null {
  let signedIn: { publicKeyB64: string; identity: SealMcpRelayIdentity } | null = null
  return () => {
    const keypair = input.getKeypair()
    if (!keypair) {
      return null
    }
    if (signedIn?.publicKeyB64 !== keypair.publicKeyB64) {
      const gateway = new PushGatewaySession({
        origin: input.relayOrigin,
        keypair,
        fetchImpl: globalThis.fetch,
        now: Date.now
      })
      signedIn = {
        publicKeyB64: keypair.publicKeyB64,
        identity: {
          hostId: gateway.hostFingerprint,
          session: async (stale) => {
            const outcome = await gateway.ensure(stale)
            if (!outcome.ok) {
              throw new Error(`seal_relay_host_auth_${outcome.reason}`)
            }
            return outcome.session.token
          }
        }
      }
    }
    return signedIn.identity
  }
}

/** Tells the MCP server where it is reachable and keeps its relay tunnel in step with Settings. */
export function startSealMcpEndpoints(input: {
  runtimeRpc: RuntimeRpcEndpoints
  relayOrigin: string
}): () => void {
  let stopTunnel = (): void => {}
  const cancel = whenSealMcpServiceRuns((service) => {
    const tunnel = new SealMcpRelayTunnel({
      relayOrigin: input.relayOrigin,
      identity: sealMcpRelayIdentitySource({
        relayOrigin: input.relayOrigin,
        getKeypair: input.runtimeRpc.getE2EEKeypair
      }),
      service,
      onStatus: () => service.statusChanged()
    })
    service.setEndpoints(() => ({
      httpUrls: sealMcpHttpUrls(input.runtimeRpc.getWebSocketEndpoint()),
      relayUrl: tunnel.publicUrl,
      relayConnected: tunnel.connected
    }))
    tunnel.start()
    stopTunnel = () => tunnel.stop()
  })
  return () => {
    cancel()
    stopTunnel()
  }
}
