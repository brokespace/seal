import type { Env as EdgeEnv } from '../../../cloud/apps/relay-edge/src/env'
import type { SealHostRelay } from './seal-host-relay'
import type { SealPushHost } from './seal-push-host'

export type SealEnv = EdgeEnv & {
  // Same namespace as HOST_RELAY, typed with the Seal assignment method.
  SEAL_HOST_RELAY: DurableObjectNamespace<SealHostRelay>
  PUSH_HOSTS: DurableObjectNamespace<SealPushHost>
  HOST_AUTH_LIMITER?: RateLimit
  RELAY_JWT_PRIVATE_JWK: string
  HOST_SESSION_SECRET: string
  APNS_TOPIC: string
  APNS_TEAM_ID?: string
  APNS_KEY_ID?: string
  APNS_PRIVATE_KEY?: string
  ANDROID_CHANNEL_ID?: string
  FCM_SERVICE_ACCOUNT_JSON?: string
  // Tests only: send provider traffic to a local fake instead of Apple/Google.
  PUSH_PROVIDER_ORIGIN_OVERRIDE?: string
}
