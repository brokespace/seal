import { DurableObject } from 'cloudflare:workers'
import { PUSH_LIMITS } from '../../../cloud/packages/push-contract/src/push-limits'
import type {
  PushDeviceRegistrationRequest,
  PushDeviceSummary
} from '../../../cloud/packages/push-contract/src/device-registration-messages'
import type {
  PushSendRequest,
  PushSendResult
} from '../../../cloud/packages/push-contract/src/send-messages'
import { buildPushDelivery } from '../../../cloud/apps/push/src/delivery/push-delivery-message'
import type { PushProviderOutcome } from '../../../cloud/apps/push/src/providers/push-provider-outcome'
import type { SealEnv } from './env'
import { equalStrings, type PendingChallenge } from './host-auth'
import { createPushProviders, type PushProviders } from './push-providers'

type DeviceRecord = {
  registrationId: string
  deviceId: string
  platform: 'ios' | 'android'
  token: string
  apnsEnvironment: 'sandbox' | 'production' | null
  dead: boolean
}

// One object per host fingerprint: its pending auth challenges, push devices and send quota.
export class SealPushHost extends DurableObject<SealEnv> {
  private providers: PushProviders | null = null

  constructor(ctx: DurableObjectState, env: SealEnv) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, proof_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS devices (
          registration_id TEXT PRIMARY KEY, device_id TEXT NOT NULL UNIQUE, platform TEXT NOT NULL,
          token TEXT NOT NULL, apns_environment TEXT, dead INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS send_quota (id INTEGER PRIMARY KEY CHECK (id = 1), window_start INTEGER NOT NULL, used INTEGER NOT NULL);
      `)
    })
  }

  storeChallenge(challengeId: string, pending: PendingChallenge): void {
    const sql = this.ctx.storage.sql
    sql.exec(
      'DELETE FROM challenges WHERE expires_at < ?',
      Date.now() - PUSH_LIMITS.clockSkewToleranceMs
    )
    sql.exec(
      'INSERT INTO challenges (id, proof_hash, expires_at) VALUES (?, ?, ?)',
      challengeId,
      pending.proofHash,
      pending.expiresAt
    )
  }

  consumeChallenge(challengeId: string, proofHash: string): boolean {
    const sql = this.ctx.storage.sql
    const row = sql
      .exec<{ proof_hash: string; expires_at: number }>(
        'SELECT proof_hash, expires_at FROM challenges WHERE id = ?',
        challengeId
      )
      .toArray()[0]
    if (!row) {
      return false
    }
    sql.exec('DELETE FROM challenges WHERE id = ?', challengeId)
    return row.expires_at >= Date.now() && equalStrings(row.proof_hash, proofHash)
  }

  registerDevice(request: PushDeviceRegistrationRequest): { registrationId: string } | null {
    const sql = this.ctx.storage.sql
    const existing = sql
      .exec<{ registration_id: string }>(
        'SELECT registration_id FROM devices WHERE device_id = ?',
        request.deviceId
      )
      .toArray()[0]
    const registrationId = existing?.registration_id ?? crypto.randomUUID()
    if (!existing) {
      const count = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM devices').one().n
      if (count >= PUSH_LIMITS.maxDevicesPerHost) {
        return null
      }
    }
    sql.exec(
      `INSERT INTO devices (registration_id, device_id, platform, token, apns_environment, dead, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(registration_id) DO UPDATE SET platform = excluded.platform, token = excluded.token,
         apns_environment = excluded.apns_environment, dead = 0, updated_at = excluded.updated_at`,
      registrationId,
      request.deviceId,
      request.platform,
      request.token,
      request.apnsEnvironment ?? null,
      Date.now()
    )
    return { registrationId }
  }

  removeDevice(registrationId: string): boolean {
    return (
      this.ctx.storage.sql.exec('DELETE FROM devices WHERE registration_id = ?', registrationId)
        .rowsWritten > 0
    )
  }

  listDevices(): PushDeviceSummary[] {
    return this.devices().map((device) => ({
      registrationId: device.registrationId,
      deviceId: device.deviceId,
      platform: device.platform,
      dead: device.dead
    }))
  }

  async send(hostFingerprint: string, request: PushSendRequest): Promise<PushSendResult[]> {
    const byId = new Map(this.devices().map((device) => [device.registrationId, device]))
    const expiresAt =
      request.notification.expiresAt ?? Date.now() + PUSH_LIMITS.notificationTtlSeconds * 1000
    return Promise.all(
      request.registrationIds.map(async (registrationId): Promise<PushSendResult> => {
        const device = byId.get(registrationId)
        if (!device || device.dead) {
          return { registrationId, status: 'dead' }
        }
        if (!this.reserveQuota()) {
          return { registrationId, status: 'rate_limited' }
        }
        const delivery = buildPushDelivery({
          expiresAt,
          registrationId,
          hostFingerprint,
          notification: request.notification
        })
        const outcome = await this.deliver(device, delivery)
        if (outcome.status === 'dead') {
          this.ctx.storage.sql.exec(
            'UPDATE devices SET dead = 1 WHERE registration_id = ?',
            registrationId
          )
          return { registrationId, status: 'dead' }
        }
        return { registrationId, status: outcome.status === 'sent' ? 'queued' : 'error' }
      })
    )
  }

  private async deliver(
    device: DeviceRecord,
    delivery: ReturnType<typeof buildPushDelivery>
  ): Promise<PushProviderOutcome> {
    this.providers ??= createPushProviders(this.env)
    if (device.platform === 'ios') {
      if (!this.providers.apns || !device.apnsEnvironment) {
        return { status: 'error', reason: 'apns_not_configured' }
      }
      return this.providers.apns.send(delivery, {
        token: device.token,
        apnsEnvironment: device.apnsEnvironment
      })
    }
    if (!this.providers.fcm) {
      return { status: 'error', reason: 'fcm_not_configured' }
    }
    return this.providers.fcm.send(delivery, { token: device.token })
  }

  private reserveQuota(now = Date.now()): boolean {
    const sql = this.ctx.storage.sql
    const row = sql
      .exec<{ window_start: number; used: number }>(
        'SELECT window_start, used FROM send_quota WHERE id = 1'
      )
      .toArray()[0]
    const fresh = !row || now - row.window_start >= PUSH_LIMITS.eventQuotaWindowMs
    const used = fresh ? 0 : row.used
    if (used >= PUSH_LIMITS.hostEventsPerWindow) {
      return false
    }
    sql.exec(
      'INSERT INTO send_quota (id, window_start, used) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET window_start = excluded.window_start, used = excluded.used',
      fresh ? now : row.window_start,
      used + 1
    )
    return true
  }

  private devices(): DeviceRecord[] {
    return this.ctx.storage.sql
      .exec<{
        registration_id: string
        device_id: string
        platform: string
        token: string
        apns_environment: string | null
        dead: number
      }>(
        'SELECT registration_id, device_id, platform, token, apns_environment, dead FROM devices ORDER BY updated_at'
      )
      .toArray()
      .map((row) => ({
        registrationId: row.registration_id,
        deviceId: row.device_id,
        platform: row.platform === 'android' ? 'android' : 'ios',
        token: row.token,
        apnsEnvironment:
          row.apns_environment === 'sandbox' || row.apns_environment === 'production'
            ? row.apns_environment
            : null,
        dead: row.dead === 1
      }))
  }
}
