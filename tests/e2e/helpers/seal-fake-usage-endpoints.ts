import type { ElectronApplication } from '@stablyai/playwright-test'

/** Percent used in the 5-hour and 7-day windows, or a login the provider no longer accepts. */
export type FakeAccountUsage = { session: number; weekly: number; plan?: string } | 'rejected'

/**
 * Answers Claude's and Codex's usage endpoints inside the app's own network session, keyed by the
 * access token each account sends. Calling it again replaces the readings.
 */
export async function serveFakeAccountUsage(
  app: ElectronApplication,
  usageByAccessToken: Record<string, FakeAccountUsage>
): Promise<void> {
  await app.evaluate(({ net, session }, usage) => {
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      })
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
      const reading = usage[token]
      if (!reading || reading === 'rejected') {
        return json(
          { error: { type: 'authentication_error', message: 'OAuth token revoked' } },
          401
        )
      }
      const sessionReset = Date.now() + 2 * 3600 * 1000
      const weeklyReset = Date.now() + 4 * 24 * 3600 * 1000
      if (claude) {
        return json({
          five_hour: {
            utilization: reading.session,
            resets_at: new Date(sessionReset).toISOString()
          },
          seven_day: { utilization: reading.weekly, resets_at: new Date(weeklyReset).toISOString() }
        })
      }
      return json({
        plan_type: reading.plan ?? 'pro',
        rate_limit: {
          primary_window: {
            used_percent: reading.session,
            limit_window_seconds: 5 * 3600,
            reset_at: Math.floor(sessionReset / 1000)
          },
          secondary_window: {
            used_percent: reading.weekly,
            limit_window_seconds: 7 * 24 * 3600,
            reset_at: Math.floor(weeklyReset / 1000)
          }
        }
      })
    })
  }, usageByAccessToken)
}
