// Reads the host's live-session registry the way the window does, and waits on what it publishes.
import type { Page } from '@stablyai/playwright-test'
import type { LiveSession } from '../../../src/shared/live-sessions/live-session-types'
import type { SessionRecapView } from '../../../src/shared/session-recap/session-recap-types'
import { expect } from './orca-app'

/** A registry session id on this machine, as rows carry it in `data-live-session-row`. */
export function localLiveSessionId(
  provider: 'claude' | 'codex',
  providerSessionId: string
): string {
  return `local:${provider}:${providerSessionId}`
}

/** Every session the registry publishes (`window.api.liveSessions.snapshot`). */
export async function readLiveSessions(page: Page): Promise<LiveSession[]> {
  return page.evaluate(async () => (await window.api.liveSessions.snapshot()).sessions)
}

/** One session with its `status`, `statusSource`, `summary`, `recap`, `customTitle` and `title`; null when unlisted. */
export async function readLiveSession(page: Page, sessionId: string): Promise<LiveSession | null> {
  return (await readLiveSessions(page)).find((session) => session.id === sessionId) ?? null
}

/** Scans every host now instead of waiting for the registry's next tick (3 to 12 s locally). */
export async function rescanLiveSessions(page: Page): Promise<void> {
  await page.evaluate(() => window.api.liveSessions.refresh())
}

/**
 * Rescans until the session matches. A status leaves "working" on the second scan that says so,
 * so one forced scan is not enough.
 */
export async function waitForLiveSession(
  page: Page,
  sessionId: string,
  matches: (session: LiveSession) => boolean,
  options: { timeout?: number; message?: string } = {}
): Promise<LiveSession> {
  let last: LiveSession | null = null
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        last = await readLiveSession(page, sessionId)
        return last !== null && matches(last)
      },
      {
        timeout: options.timeout ?? 60_000,
        message: options.message ?? `live session ${sessionId} did not reach the expected state`
      }
    )
    .toBe(true)
  return last!
}

/** One method of the window's own runtime; throws the host's error when it refuses. */
export async function callLocalRuntime<T>(
  page: Page,
  method: string,
  params?: unknown
): Promise<T> {
  const reply = await page.evaluate((call) => window.api.runtime.call(call), { method, params })
  if (!reply.ok) {
    throw new Error(`${method} failed: ${JSON.stringify(reply.error)}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the RPC contract types each method's result; the envelope carries it as unknown.
  return reply.result as T
}

/** The whole recap as the recap panel reads it, without counting as the user's visit. */
export async function readSessionRecap(page: Page, sessionId: string): Promise<SessionRecapView> {
  return callLocalRuntime<SessionRecapView>(page, 'sessionRecap.get', { sessionId })
}
