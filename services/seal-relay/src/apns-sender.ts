import { importPKCS8, SignJWT } from 'jose'
import { z } from 'zod'
import { apnsBody } from '../../../cloud/apps/push/src/providers/apns/apns-client'
import type { ApnsTransport } from '../../../cloud/apps/push/src/providers/apns/apns-http2-transport'
import type { PushDelivery } from '../../../cloud/apps/push/src/delivery/push-delivery-message'
import type { PushProviderOutcome } from '../../../cloud/apps/push/src/providers/push-provider-outcome'

const APNS_HOSTS = {
  production: 'api.push.apple.com',
  sandbox: 'api.sandbox.push.apple.com'
} as const
const ApnsErrorSchema = z.object({ reason: z.string() })
const DEAD_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered'])
// Apple rejects tokens older than an hour and throttles reissue under ~20 minutes.
const TOKEN_ROTATION_MS = 50 * 60 * 1000

export type ApnsCredentials = { teamId: string; keyId: string; keyPem: string }

function readReason(body: string): string {
  try {
    const parsed = ApnsErrorSchema.safeParse(JSON.parse(body))
    return parsed.success ? parsed.data.reason : 'unknown'
  } catch {
    return 'unparseable'
  }
}

// The upstream ApnsClient signs with node:crypto's raw ECDSA output, which workerd lacks.
export class ApnsSender {
  private cached: { token: string; issuedAtMs: number } | null = null

  constructor(
    private readonly options: {
      topic: string
      credentials: ApnsCredentials
      transport: ApnsTransport
    }
  ) {}

  private async providerToken(nowMs: number): Promise<string> {
    if (this.cached && nowMs - this.cached.issuedAtMs < TOKEN_ROTATION_MS) {
      return this.cached.token
    }
    const { teamId, keyId, keyPem } = this.options.credentials
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt(Math.floor(nowMs / 1000))
      .sign(await importPKCS8(keyPem, 'ES256'))
    this.cached = { token, issuedAtMs: nowMs }
    return token
  }

  async send(
    delivery: PushDelivery,
    device: { token: string; apnsEnvironment: keyof typeof APNS_HOSTS }
  ): Promise<PushProviderOutcome> {
    const now = Date.now()
    const expiration = Math.floor(delivery.expiresAt / 1000)
    if (expiration * 1000 <= now) {
      return { status: 'error', reason: 'expired' }
    }
    const dismiss = delivery.orca.kind === 'dismiss'
    let response
    try {
      response = await this.options.transport({
        host: APNS_HOSTS[device.apnsEnvironment],
        path: `/3/device/${device.token}`,
        headers: {
          authorization: `bearer ${await this.providerToken(now)}`,
          'apns-topic': this.options.topic,
          'apns-push-type': dismiss ? 'background' : 'alert',
          'apns-priority': dismiss ? '5' : '10',
          'apns-expiration': String(expiration),
          ...(dismiss ? {} : { 'apns-collapse-id': delivery.collapseId })
        },
        body: apnsBody(delivery)
      })
    } catch (error) {
      return {
        status: 'error',
        reason: error instanceof Error ? error.name : 'transport_failed',
        retryable: true
      }
    }
    if (response.status === 200) {
      return { status: 'sent' }
    }
    const reason = readReason(response.body)
    if (response.status === 410 || (response.status === 400 && DEAD_TOKEN_REASONS.has(reason))) {
      return { status: 'dead', reason }
    }
    return {
      status: 'error',
      reason,
      retryable: response.status === 429 || response.status >= 500,
      ...(response.retryAfterMs === undefined ? {} : { retryAfterMs: response.retryAfterMs })
    }
  }
}
