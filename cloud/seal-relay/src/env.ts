import type { Env as EdgeEnv } from '../../../cloud/apps/relay-edge/src/env'
import type { SealHostRelay } from './seal-host-relay'
import type { SealMcpTunnel } from './seal-mcp-tunnel'
import type { SealPushHost } from './seal-push-host'

export type SealEnv = EdgeEnv & {
  // Same namespace as HOST_RELAY, typed with the Seal assignment method.
  SEAL_HOST_RELAY: DurableObjectNamespace<SealHostRelay>
  PUSH_HOSTS: DurableObjectNamespace<SealPushHost>
  MCP_TUNNEL: DurableObjectNamespace<SealMcpTunnel>
  // A missing limiter binding refuses the requests it guards (source-rate-limit.ts).
  HOST_AUTH_LIMITER?: RateLimit
  HOST_API_LIMITER?: RateLimit
  MCP_LIMITER?: RateLimit
  // Host fingerprints (or base64 host public keys) that may use this relay; unset enrols nobody.
  HOST_ALLOWLIST?: string
  RELAY_JWT_PRIVATE_JWK: string
  HOST_SESSION_SECRET: string
  APNS_TOPIC: string
  APNS_TEAM_ID?: string
  APNS_KEY_ID?: string
  APNS_PRIVATE_KEY?: string
  ANDROID_CHANNEL_ID?: string
  FCM_SERVICE_ACCOUNT_JSON?: string
}
