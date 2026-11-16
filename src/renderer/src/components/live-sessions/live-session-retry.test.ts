// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveMessage } from '../../../../shared/live-sessions/live-session-types'
import { retryLiveMessage } from './live-session-retry'

const FAILED: LiveMessage = {
  messageId: 'm1',
  sessionId: 'local:claude:s1',
  text: 'drop the table',
  state: 'failed',
  route: 'tmux',
  error: 'Seal typed it, but the session never showed it',
  createdAt: 1,
  updatedAt: 2
}

function retryCalls(): unknown[][] {
  const retry = vi.fn(async (_request: unknown) => null)
  vi.stubGlobal('api', { liveSessions: { retry } })
  return retry.mock.calls
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('retryLiveMessage', () => {
  it('sends a message its session may have run again only once the user agrees to it', async () => {
    const calls = retryCalls()
    const unconfirmed: LiveMessage = { ...FAILED, unconfirmed: true }

    await retryLiveMessage(unconfirmed, async () => false)
    expect(calls).toEqual([])

    await retryLiveMessage(unconfirmed, async () => true)
    expect(calls).toEqual([[{ messageId: 'm1', mayRunTwice: true }]])
  })

  it('sends a message that never reached its session again without asking', async () => {
    const calls = retryCalls()
    const asked = vi.fn(async () => true)

    await retryLiveMessage(FAILED, asked)
    expect(asked).not.toHaveBeenCalled()
    expect(calls).toEqual([[{ messageId: 'm1' }]])
  })
})
