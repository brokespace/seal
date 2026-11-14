import type { OrcaRuntimeRpcServer } from '../runtime/rpc/server/runtime-rpc'
import type { MobilePairingOffer } from '../runtime/rpc/server/runtime-rpc-pairing-types'
import { resolveAdvertisedPairingEndpoint } from '../runtime/rpc/server/pairing/network/pairing-endpoint'
import { assertServeProjectRoot, renderServePairingQr } from './serve-pairing-output'
import type { ServeReadiness, ServeReadinessOutput } from './serve-readiness'

export type ServePairingRpc = Pick<
  OrcaRuntimeRpcServer,
  'getWebSocketEndpoint' | 'createPairingOffer' | 'createMobilePairingOffer' | 'isNetworkExposed'
>

const LOOPBACK_RELAY_GUIDANCE =
  'This server listens only on this machine, so a phone pairs through Relay. Run `orca pair --mobile --relay` to try again, or restart with --bind <address> to pair over the LAN.'

// Nothing on the network reaches a loopback listener; the relay does, over this host's own outbound connection.
async function relayMobilePairingOffer(
  rpc: ServePairingRpc,
  pairingAddress: string | null | undefined
): Promise<MobilePairingOffer> {
  const offer = await rpc.createMobilePairingOffer({
    address: pairingAddress,
    connectionMode: 'automatic',
    name: `Mobile ${new Date().toLocaleDateString()}`
  })
  return offer.available || offer.reason !== 'relay_mint_failed'
    ? offer
    : { ...offer, guidance: `${offer.guidance} ${LOOPBACK_RELAY_GUIDANCE}` }
}

export async function buildServePairingReadiness(
  options: {
    pairingAddress?: string | null
    noPairing?: boolean
    mobilePairing?: boolean
    grantDesktopControl?: boolean
  },
  rpc: ServePairingRpc
): Promise<Pick<ServeReadiness, 'boundEndpoint' | 'advertisedEndpoint' | 'pairing'>> {
  const boundEndpoint = rpc.getWebSocketEndpoint()
  const advertised = boundEndpoint
    ? resolveAdvertisedPairingEndpoint(boundEndpoint, options.pairingAddress)
    : null
  const offer = options.noPairing
    ? ({
        available: false,
        reason: 'disabled_by_operator',
        guidance: 'Restart without --no-pairing to create a client pairing offer.'
      } as const)
    : options.mobilePairing && !rpc.isNetworkExposed()
      ? await relayMobilePairingOffer(rpc, options.pairingAddress)
      : rpc.createPairingOffer({
          address: options.pairingAddress,
          name: `${options.mobilePairing ? 'Mobile' : 'CLI'} ${new Date().toLocaleDateString()}`,
          scope: options.mobilePairing ? 'mobile' : 'runtime',
          grants: options.grantDesktopControl ? ['desktop-control'] : []
        })

  return {
    boundEndpoint,
    advertisedEndpoint: advertised?.ok ? advertised.endpoint : null,
    pairing: offer.available
      ? {
          available: true,
          url: offer.pairingUrl,
          endpoint: offer.endpoint,
          deviceId: offer.deviceId,
          webClientUrl: offer.webClientUrl,
          scope: options.mobilePairing ? 'mobile' : 'runtime',
          qr: options.mobilePairing ? await renderServePairingQr(offer.pairingUrl) : null,
          expiresAt: offer.offerExpiresAt
        }
      : offer
  }
}

export function servePublishMode(options: {
  recipeJson?: boolean
  projectRoot?: string | null
  json?: boolean
}): ServeReadinessOutput {
  return options.recipeJson && options.projectRoot
    ? { mode: 'recipe-json', projectRoot: assertServeProjectRoot(options.projectRoot) }
    : { mode: options.json ? 'json' : 'human' }
}
