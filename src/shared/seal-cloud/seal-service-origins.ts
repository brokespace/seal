import { cleanCloudServiceOrigin } from '../cloud-service-url'

/** Seal's self-hosted relay and push Worker (cloud/seal-relay); forks change these to their own deploy. */
export const SEAL_BUILD_SERVICE_ORIGINS = {
  relay: 'https://relay.seal.wotarmelon.com',
  push: 'https://push.seal.wotarmelon.com'
} as const

type ServiceEnv = Record<string, string | undefined>

/** `SEAL_RELAY_URL` overrides the build default; development builds may point at loopback HTTP. */
export function resolveSealRelayOrigin(env: ServiceEnv, packaged: boolean): string {
  return (
    cleanCloudServiceOrigin(env.SEAL_RELAY_URL ?? env.ORCA_RELAY_URL, !packaged) ??
    SEAL_BUILD_SERVICE_ORIGINS.relay
  )
}

export function resolveSealPushOrigin(env: ServiceEnv, packaged: boolean): string {
  return (
    cleanCloudServiceOrigin(env.SEAL_PUSH_URL ?? env.ORCA_PUSH_GATEWAY_URL, !packaged) ??
    SEAL_BUILD_SERVICE_ORIGINS.push
  )
}
