import type { ElectronApplication } from '@stablyai/playwright-test'
import {
  claudeUsageLoginRevoked,
  type FakeUsageResponse
} from '../../../src/main/rate-limits/providers/claude/claude-oauth-usage-responses.test-fixture'

/**
 * Percent used in the 5-hour and 7-day windows; a login the provider no longer accepts; or the
 * exact response the usage endpoint gives.
 */
export type FakeAccountUsage =
  | { session: number; weekly: number; plan?: string }
  | 'rejected'
  | FakeUsageResponse

function claudeResponse(reading: FakeAccountUsage, now: number): FakeUsageResponse {
  if (reading === 'rejected') {
    return claudeUsageLoginRevoked()
  }
  if ('status' in reading) {
    return reading
  }
  return {
    status: 200,
    body: {
      five_hour: {
        utilization: reading.session,
        resets_at: new Date(now + 2 * 3600 * 1000).toISOString()
      },
      seven_day: {
        utilization: reading.weekly,
        resets_at: new Date(now + 4 * 24 * 3600 * 1000).toISOString()
      },
      seven_day_oauth_apps: null,
      seven_day_opus: null,
      seven_day_sonnet: null,
      extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null }
    }
  }
}

function codexResponse(reading: FakeAccountUsage, now: number): FakeUsageResponse {
  if (reading === 'rejected') {
    return { status: 401, body: { error: { message: 'Token revoked' } } }
  }
  if ('status' in reading) {
    return reading
  }
  return {
    status: 200,
    body: {
      plan_type: reading.plan ?? 'pro',
      rate_limit: {
        primary_window: {
          used_percent: reading.session,
          limit_window_seconds: 5 * 3600,
          reset_at: Math.floor((now + 2 * 3600 * 1000) / 1000)
        },
        secondary_window: {
          used_percent: reading.weekly,
          limit_window_seconds: 7 * 24 * 3600,
          reset_at: Math.floor((now + 4 * 24 * 3600 * 1000) / 1000)
        }
      }
    }
  }
}

/**
 * Answers Claude's and Codex's usage endpoints inside the app's own network session, keyed by the
 * access token each account sends. Calling it again replaces the readings.
 */
export async function serveFakeAccountUsage(
  app: ElectronApplication,
  usageByAccessToken: Record<string, FakeAccountUsage>
): Promise<void> {
  const now = Date.now()
  const replies = Object.fromEntries(
    Object.entries(usageByAccessToken).map(([token, reading]) => [
      token,
      { claude: claudeResponse(reading, now), codex: codexResponse(reading, now) }
    ])
  )
  const revoked = claudeUsageLoginRevoked()
  await app.evaluate(
    ({ net, session }, { byToken, unknownToken }) => {
      const { protocol } = session.defaultSession
      if (protocol.isProtocolHandled('https')) {
        protocol.unhandle('https')
      }
      protocol.handle('https', (request) => {
        const url = new URL(request.url)
        const claude = url.hostname === 'api.anthropic.com' && url.pathname === '/api/oauth/usage'
        const codex = url.hostname === 'chatgpt.com' && url.pathname === '/backend-api/wham/usage'
        if (!claude && !codex) {
          return net.fetch(request, { bypassCustomProtocolHandlers: true })
        }
        const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
        const reply = byToken[token]?.[claude ? 'claude' : 'codex'] ?? unknownToken
        return new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'content-type': 'application/json', ...reply.headers }
        })
      })
    },
    { byToken: replies, unknownToken: revoked }
  )
}
