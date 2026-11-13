import { importPKCS8, SignJWT } from 'jose'
import { z } from 'zod'
import type { ApnsTransport } from '../../../cloud/apps/push/src/providers/apns/apns-http2-transport'
import {
  FCM_SCOPE,
  FcmClient,
  type FcmTransport
} from '../../../cloud/apps/push/src/providers/fcm/fcm-client'
import { providerRetryAfter } from '../../../cloud/apps/push/src/providers/provider-retry-delay'
import { ApnsSender } from './apns-sender'
import type { SealEnv } from './env'

export type PushProviders = { apns: ApnsSender | null; fcm: FcmClient | null }

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

function providerUrl(env: SealEnv, url: string): string {
  if (!env.PUSH_PROVIDER_ORIGIN_OVERRIDE) {
    return url
  }
  const parsed = new URL(url)
  return `${env.PUSH_PROVIDER_ORIGIN_OVERRIDE}/${parsed.hostname}${parsed.pathname}`
}

// Workers fetch has no redirect: 'error'; a provider redirect surfaces as a non-2xx error instead.
async function postToProvider(url: string, headers: Record<string, string>, body: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000)
  })
  return {
    status: response.status,
    body: await response.text(),
    retryAfterMs: providerRetryAfter(response.headers.get('retry-after') ?? undefined)
  }
}

// Production Workers reach APNs over HTTP/2 through Cloudflare's egress; local workerd cannot.
function fetchApnsTransport(env: SealEnv): ApnsTransport {
  return (request) =>
    postToProvider(
      providerUrl(env, `https://${request.host}${request.path}`),
      request.headers,
      request.body
    )
}

function fetchFcmTransport(env: SealEnv): FcmTransport {
  return (request) =>
    postToProvider(
      providerUrl(env, request.url),
      { authorization: `Bearer ${request.accessToken}`, 'content-type': 'application/json' },
      request.body
    )
}

const ServiceAccountSchema = z.object({
  project_id: z.string(),
  client_email: z.string(),
  private_key: z.string()
})
type ServiceAccount = z.infer<typeof ServiceAccountSchema>
const GoogleTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().optional()
})

function googleAccessToken(env: SealEnv, account: ServiceAccount): () => Promise<string> {
  let cached: { token: string; expiresAt: number } | null = null
  return async () => {
    if (cached && cached.expiresAt - 60_000 > Date.now()) {
      return cached.token
    }
    const now = Math.floor(Date.now() / 1000)
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(account.client_email)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(await importPKCS8(account.private_key, 'RS256'))
    const response = await fetch(providerUrl(env, GOOGLE_TOKEN_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion
      })
    })
    if (!response.ok) {
      throw new Error(`fcm_access_token_${response.status}`)
    }
    const body = GoogleTokenSchema.parse(await response.json())
    cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 }
    return cached.token
  }
}

export function createPushProviders(env: SealEnv): PushProviders {
  const apns =
    env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_PRIVATE_KEY
      ? new ApnsSender({
          topic: env.APNS_TOPIC,
          credentials: {
            teamId: env.APNS_TEAM_ID,
            keyId: env.APNS_KEY_ID,
            keyPem: env.APNS_PRIVATE_KEY
          },
          transport: fetchApnsTransport(env)
        })
      : null
  let fcm: FcmClient | null = null
  if (env.FCM_SERVICE_ACCOUNT_JSON) {
    const account = ServiceAccountSchema.parse(JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON))
    fcm = new FcmClient({
      projectId: account.project_id,
      accessToken: googleAccessToken(env, account),
      transport: fetchFcmTransport(env),
      ...(env.ANDROID_CHANNEL_ID ? { channelId: env.ANDROID_CHANNEL_ID } : {})
    })
  }
  return { apns, fcm }
}
