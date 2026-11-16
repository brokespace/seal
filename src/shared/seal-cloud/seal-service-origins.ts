import { cleanCloudServiceOrigin } from '../network/cloud-service-url'

/** Seal's self-hosted relay and push Worker (cloud/seal-relay); forks change these to their own deploy. */
export const SEAL_BUILD_SERVICE_ORIGINS = {
  relay: 'https://relay.seal.wotarmelon.com',
  push: 'https://push.seal.wotarmelon.com'
} as const

/** Cells besides the director itself that hosts and phones of this build follow; multi-cell forks list theirs. */
export const SEAL_BUILD_RELAY_CELL_ORIGINS: readonly string[] = []

type ServiceEnv = Record<string, string | undefined>

/** `SEAL_RELAY_URL` overrides the build default; development builds may point at loopback HTTP. */
export function resolveSealRelayOrigin(env: ServiceEnv, packaged: boolean): string {
  return (
    cleanCloudServiceOrigin(env.SEAL_RELAY_URL ?? env.ORCA_RELAY_URL, !packaged) ??
    SEAL_BUILD_SERVICE_ORIGINS.relay
  )
}

/** `SEAL_RELAY_CELL_ORIGINS` (comma-separated HTTPS origins) adds cells a host accepts from its director. */
export function resolveSealRelayCellOrigins(env: ServiceEnv): string[] {
  const configured = (env.SEAL_RELAY_CELL_ORIGINS ?? '')
    .split(',')
    .map((origin) => cleanCloudServiceOrigin(origin, false))
    .filter((origin): origin is string => origin !== null)
  return [...new Set([...SEAL_BUILD_RELAY_CELL_ORIGINS, ...configured])]
}

export function resolveSealPushOrigin(env: ServiceEnv, packaged: boolean): string {
  return (
    cleanCloudServiceOrigin(env.SEAL_PUSH_URL ?? env.ORCA_PUSH_GATEWAY_URL, !packaged) ??
    SEAL_BUILD_SERVICE_ORIGINS.push
  )
}
